-- Rollback Migration 007 v2. Hanya membatalkan perubahan 007. Data lama tidak disentuh.
-- Salinan data awal tetap ada di schema backup_pre007 (tidak dihapus).
-- PERINGATAN: bila sudah ada posting berstatus 'cancelled', kembalikan constraint status HANYA setelah mengubahnya.
begin;
drop policy if exists media_read_own_or_admin on public.media_assets;
drop policy if exists integration_read_admin on public.integration_settings;
drop index if exists public.post_destinations_idem_uq, public.post_dest_due_idx, public.media_assets_user_idx;
alter table public.posts drop constraint if exists posts_media_asset_fk;
alter table public.post_destinations drop constraint if exists post_dest_social_account_fk;
drop table if exists public.social_account_tokens;
drop table if exists public.integration_settings;
drop table if exists public.media_assets;
-- Kembalikan constraint status ke definisi awal
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status = any (array['draft','queued','processing','partial','published','failed','blocked']));
alter table public.post_destinations drop constraint if exists post_destinations_status_check;
alter table public.post_destinations add constraint post_destinations_status_check
  check (status = any (array['pending','queued','processing','published','failed','blocked','needs_reconnect']));
-- Kembalikan grant bawaan Supabase pada 6 tabel awal
grant all on public.profiles, public.posts, public.post_destinations, public.social_accounts,
             public.audit_logs, public.employee_settings to anon, authenticated;
-- Kolom tambahan (email, deactivated_at, scheduled_at, ...) sengaja dibiarkan (tidak berbahaya).
commit;
