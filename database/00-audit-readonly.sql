-- SocialHub Akulaku — PEMERIKSAAN DATABASE (BACA-SAJA, aman dijalankan)
-- Cara: Supabase Dashboard > SQL Editor > tempel seluruh isi file ini > Run.
-- Hasil: satu baris JSON. Salin seluruh nilainya dan tempel ke chat.
-- Query ini hanya SELECT. Tidak mengubah data. Tidak menampilkan secret.
select jsonb_pretty(jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'rls_forced',c.relforcerowsecurity)),'[]') 
             from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
  'columns', (select coalesce(jsonb_agg(jsonb_build_object('t',table_name,'c',column_name,'type',data_type,'null',is_nullable,'def',column_default) order by table_name,ordinal_position),'[]')
              from information_schema.columns where table_schema='public'),
  'constraints', (select coalesce(jsonb_agg(jsonb_build_object('t',conrelid::regclass::text,'name',conname,'def',pg_get_constraintdef(oid))),'[]')
                  from pg_constraint where connamespace='public'::regnamespace),
  'indexes', (select coalesce(jsonb_agg(jsonb_build_object('t',tablename,'def',indexdef)),'[]') from pg_indexes where schemaname='public'),
  'policies', (select coalesce(jsonb_agg(jsonb_build_object('t',tablename,'name',policyname,'cmd',cmd,'roles',roles,'using',qual,'check',with_check)),'[]')
               from pg_policies where schemaname='public'),
  'grants', (select coalesce(jsonb_agg(jsonb_build_object('t',table_name,'grantee',grantee,'priv',privilege_type)),'[]')
             from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')),
  'triggers', (select coalesce(jsonb_agg(jsonb_build_object('t',event_object_schema||'.'||event_object_table,'name',trigger_name,'event',event_manipulation,'action',action_statement)),'[]')
               from information_schema.triggers where trigger_schema in ('public','auth')),
  'functions', (select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'secdef',p.prosecdef,'def',pg_get_functiondef(p.oid))),'[]')
                from pg_proc p where p.pronamespace='public'::regnamespace),
  'roles_in_profiles', (select coalesce(jsonb_agg(jsonb_build_object('role',role,'active',is_active,'n',n)),'[]')
                        from (select role,is_active,count(*) n from public.profiles group by 1,2) s),
  'auth_vs_profiles', jsonb_build_object(
      'auth_users',(select count(*) from auth.users),
      'profiles',(select count(*) from public.profiles),
      'users_without_profile',(select count(*) from auth.users u left join public.profiles p on p.id=u.id where p.id is null))
)) as hasil_audit;
