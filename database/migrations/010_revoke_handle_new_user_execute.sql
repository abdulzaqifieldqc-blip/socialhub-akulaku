-- Migration 010 (SUDAH DITERAPKAN ke proyek social-hub pada 2026-11-24 lewat konektor Supabase).
-- Fungsi trigger handle_new_user() tidak perlu dipanggil publik. Trigger tetap berjalan (tidak memeriksa EXECUTE saat dipicu).
do $$ begin
  if to_regprocedure('public.handle_new_user()') is null then raise exception 'handle_new_user() tidak ditemukan'; end if;
end $$;
grant execute on function public.handle_new_user() to postgres, service_role, supabase_auth_admin;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Rollback: grant execute on function public.handle_new_user() to public, anon, authenticated;
