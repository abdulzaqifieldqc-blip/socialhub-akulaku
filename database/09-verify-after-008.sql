-- Pemeriksaan SETELAH migration 008 (BACA-SAJA). Salin hasilnya ke chat.
-- Harapan: anon_bisa_execute=false, authenticated_bisa_execute=true, service_role_bisa_execute=true.
select jsonb_pretty(jsonb_build_object(
  'anon_bisa_execute', has_function_privilege('anon','public.is_active_admin()','EXECUTE'),
  'authenticated_bisa_execute', has_function_privilege('authenticated','public.is_active_admin()','EXECUTE'),
  'service_role_bisa_execute', has_function_privilege('service_role','public.is_active_admin()','EXECUTE'),
  'acl_mentah', (select proacl::text from pg_proc where oid='public.is_active_admin()'::regprocedure),
  'fungsi_publik_dengan_hak_anon', (select coalesce(jsonb_agg(p.proname),'[]') from pg_proc p
      where p.pronamespace='public'::regnamespace and has_function_privilege('anon',p.oid,'EXECUTE'))
)) as hasil_verifikasi_008;
