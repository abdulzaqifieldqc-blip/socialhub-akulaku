-- Pemeriksaan SETELAH migration 007 (BACA-SAJA). Jalankan di SQL Editor, salin hasilnya ke chat.
select jsonb_pretty(jsonb_build_object(
  'rls_semua_tabel', (select jsonb_object_agg(c.relname, c.relrowsecurity) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),
  'hak_anon_tersisa', (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon'),
  'hak_tulis_authenticated_tersisa', (select coalesce(jsonb_agg(distinct table_name||':'||privilege_type),'[]') from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),
  'tabel_token_hak_client', (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='social_account_tokens' and grantee in ('anon','authenticated')),
  'status_cancelled_ok', (select count(*) from pg_constraint where conname in ('posts_status_check','post_destinations_status_check') and pg_get_constraintdef(oid) like '%cancelled%'),
  'profil_admin', (select jsonb_agg(jsonb_build_object('role',role,'active',is_active,'ada_email',email is not null)) from public.profiles),
  'integrasi', (select jsonb_agg(jsonb_build_object('platform',platform,'status',status)) from public.integration_settings)
)) as hasil_verifikasi;
