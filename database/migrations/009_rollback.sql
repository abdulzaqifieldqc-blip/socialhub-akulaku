-- Rollback 009: hanya menghapus fungsi RPC (tidak menyentuh data). Worker otomatis kembali ke jalur kompensasi.
begin;
drop function if exists public.create_post_with_destinations(uuid, text, uuid, timestamptz, text, bigint, text[], jsonb, timestamptz);
commit;
