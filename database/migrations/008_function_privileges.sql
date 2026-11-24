-- SocialHub Akulaku — Migration 008: batasi EXECUTE pada public.is_active_admin()
-- NON-DESTRUKTIF. Hanya mengubah hak EXECUTE satu fungsi. Tidak ada DROP/DELETE/TRUNCATE.
-- JANGAN dijalankan sebelum pemilik proyek menyetujui. Rollback: 008_rollback.sql
-- Latar belakang: fungsi dipakai di policy RLS untuk role "authenticated" (audit_logs, settings, integration,
-- media, destinations, posts, profiles, social_accounts). Karena itu "authenticated" HARUS tetap punya EXECUTE.
-- Pencabutan dari PUBLIC saja akan memutus akses authenticated bila tidak ada GRANT eksplisit, maka GRANT diberikan di bawah.
begin;
do $$
begin
  if to_regprocedure('public.is_active_admin()') is null then
    raise exception 'public.is_active_admin() tidak ditemukan; migration dibatalkan';
  end if;
end $$;

grant execute on function public.is_active_admin() to authenticated, service_role, postgres;
revoke execute on function public.is_active_admin() from public;
revoke execute on function public.is_active_admin() from anon;
commit;
