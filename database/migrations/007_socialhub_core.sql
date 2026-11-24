-- SocialHub Akulaku — Migration 007 v2 (disesuaikan dengan hasil audit database aktual 2026-11-24)
-- NON-DESTRUKTIF & idempotent. Tidak ada DROP TABLE/COLUMN, DELETE, TRUNCATE. UUID & akun admin tidak disentuh.
-- JANGAN dijalankan sebelum pemilik proyek menyetujui. Rollback: 007_rollback.sql
-- Cara jalankan: Supabase > SQL Editor > tempel > Run (satu kali). Setelah itu jalankan 08-verify-after-007.sql.
--
-- Temuan audit yang ditangani:
--  (a) anon & authenticated punya SEMUA hak (INSERT/UPDATE/DELETE/TRUNCATE) di 6 tabel -> diperketat (RLS memang aktif).
--  (b) status posts & post_destinations belum punya 'cancelled' -> ditambahkan.
--  (c) profiles belum punya kolom email -> ditambahkan.
--  (d) Policy SELECT lama sudah ketat dan trigger handle_new_user sudah aman (on conflict do nothing) -> DIPERTAHANKAN.
--  (e) unique (post_id,platform) dan (user_id,platform) sudah ada -> tidak diulang.

begin;

-- 0) Backup salinan data di schema terpisah (tabel asli tidak berubah)
create schema if not exists backup_pre007;
do $$
declare t text;
begin
  foreach t in array array['profiles','posts','post_destinations','social_accounts','audit_logs','employee_settings'] loop
    if to_regclass('backup_pre007.'||t) is null then
      execute format('create table backup_pre007.%I as table public.%I', t, t);
    end if;
  end loop;
end $$;
revoke all on schema backup_pre007 from anon, authenticated;

-- 1) Kolom tambahan (hanya ADD)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists deactivated_at timestamptz;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

alter table public.posts add column if not exists scheduled_at timestamptz;
alter table public.posts add column if not exists media_asset_id uuid;
alter table public.post_destinations add column if not exists social_account_id uuid;
alter table public.post_destinations add column if not exists idempotency_key text;
alter table public.post_destinations add column if not exists next_attempt_at timestamptz;

-- 2) Perluas nilai status yang diizinkan: tambah 'cancelled' (nilai lama tetap)
do $$ begin
  if exists (select 1 from pg_constraint where conname='posts_status_check' and pg_get_constraintdef(oid) not like '%cancelled%') then
    alter table public.posts drop constraint posts_status_check;
    alter table public.posts add constraint posts_status_check
      check (status = any (array['draft','queued','processing','partial','published','failed','blocked','cancelled']));
  end if;
  if exists (select 1 from pg_constraint where conname='post_destinations_status_check' and pg_get_constraintdef(oid) not like '%cancelled%') then
    alter table public.post_destinations drop constraint post_destinations_status_check;
    alter table public.post_destinations add constraint post_destinations_status_check
      check (status = any (array['pending','queued','processing','published','failed','blocked','needs_reconnect','cancelled']));
  end if;
end $$;

-- 3) Tabel baru (kepemilikan mengikuti pola tabel lama: referensi ke profiles(id))
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null unique,
  original_filename text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending','uploaded','deleted')),
  uploaded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.social_account_tokens (   -- token terenkripsi; TIDAK bisa diakses client
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  updated_at timestamptz not null default now()
);
create table if not exists public.integration_settings (    -- tanpa secret; Client Secret ada di Worker secrets
  platform text primary key check (platform in ('tiktok','instagram','facebook','threads')),
  client_id text,
  redirect_uri text,
  webhook_url text,
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  scopes text[] not null default '{}',
  status text not null default 'disabled' check (status in ('disabled','configured','under_review','approved','enabled')),
  app_review_status text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.integration_settings(platform)
  select x from unnest(array['tiktok','instagram','facebook','threads']) x on conflict do nothing;

-- 4) Foreign key baru (NOT VALID: tidak memblokir data lama) & index
do $$ begin
  if not exists (select 1 from pg_constraint where conname='posts_media_asset_fk') then
    alter table public.posts add constraint posts_media_asset_fk
      foreign key (media_asset_id) references public.media_assets(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='post_dest_social_account_fk') then
    alter table public.post_destinations add constraint post_dest_social_account_fk
      foreign key (social_account_id) references public.social_accounts(id) on delete set null not valid;
  end if;
end $$;
create unique index if not exists post_destinations_idem_uq on public.post_destinations(idempotency_key) where idempotency_key is not null;
create index if not exists post_dest_due_idx on public.post_destinations(next_attempt_at) where next_attempt_at is not null;
create index if not exists media_assets_user_idx on public.media_assets(user_id, created_at desc);

-- 5) RLS pada tabel baru. Policy tabel lama sudah benar dan dipakai ulang (is_active_admin()).
alter table public.media_assets enable row level security;
alter table public.social_account_tokens enable row level security;   -- tanpa policy = tertutup untuk client
alter table public.integration_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media_assets' and policyname='media_read_own_or_admin') then
    create policy media_read_own_or_admin on public.media_assets for select to authenticated
      using (user_id = (select auth.uid()) or (select public.is_active_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='integration_settings' and policyname='integration_read_admin') then
    create policy integration_read_admin on public.integration_settings for select to authenticated
      using ((select public.is_active_admin()));
  end if;
end $$;

-- 6) GRANT diperketat. Backend memakai service role (tidak terpengaruh). Client langsung hanya boleh BACA data miliknya.
revoke all on public.profiles, public.posts, public.post_destinations, public.social_accounts, public.audit_logs,
              public.employee_settings, public.media_assets, public.social_account_tokens, public.integration_settings from anon;
revoke all on public.social_account_tokens from authenticated;
revoke insert, update, delete, truncate, references, trigger on
  public.profiles, public.posts, public.post_destinations, public.social_accounts, public.audit_logs,
  public.media_assets, public.integration_settings from authenticated;
revoke truncate, delete, references, trigger on public.employee_settings from authenticated;  -- insert/update tetap (ada policy "own")

commit;
