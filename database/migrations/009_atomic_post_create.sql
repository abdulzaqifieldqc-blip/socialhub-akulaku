-- SocialHub Akulaku — Migration 009: pembuatan posting + destination dalam SATU transaksi database.
-- NON-DESTRUKTIF (hanya CREATE FUNCTION). Dipanggil hanya oleh backend (service_role). JANGAN jalankan tanpa persetujuan pemilik.
-- Rollback: 009_rollback.sql. Worker tetap berfungsi tanpa migration ini (memakai jalur kompensasi lama).
begin;
create or replace function public.create_post_with_destinations(
  p_user uuid, p_caption text, p_media uuid, p_scheduled timestamptz,
  p_mime text, p_size bigint, p_platforms text[], p_accounts jsonb, p_dispatch timestamptz)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare v_post uuid; v_plat text;
begin
  if p_platforms is null or coalesce(array_length(p_platforms, 1), 0) = 0 then
    raise exception 'platforms kosong';
  end if;
  insert into public.posts(user_id, caption, media_asset_id, scheduled_at, status, mime_type, file_size_bytes)
    values (p_user, p_caption, p_media, p_scheduled, 'queued', p_mime, p_size)
    returning id into v_post;
  foreach v_plat in array p_platforms loop
    insert into public.post_destinations(post_id, user_id, platform, status, social_account_id, idempotency_key, next_attempt_at)
      values (v_post, p_user, v_plat, 'queued', nullif(p_accounts ->> v_plat, '')::uuid, v_post::text || ':' || v_plat, p_dispatch);
  end loop;
  return v_post;     -- error di mana pun membatalkan seluruh fungsi (atomik)
end $$;
revoke all on function public.create_post_with_destinations(uuid, text, uuid, timestamptz, text, bigint, text[], jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.create_post_with_destinations(uuid, text, uuid, timestamptz, text, bigint, text[], jsonb, timestamptz) to service_role;
commit;
