-- Rollback 008: mengembalikan EXECUTE ke keadaan sebelum 008 (PUBLIC dan anon boleh EXECUTE).
begin;
grant execute on function public.is_active_admin() to public, anon, authenticated, service_role, postgres;
commit;
