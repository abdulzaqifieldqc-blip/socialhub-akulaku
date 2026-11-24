# Migration yang sudah diterapkan ke database produksi (social-hub)

| Migration | Tanggal | Cara | Hasil verifikasi |
|---|---|---|---|
| 007 v2 | 2026-11-24 | SQL Editor oleh pemilik | Success |
| 008 function privileges | 2026-11-24 | Konektor Supabase (apply_migration) | anon: tidak bisa EXECUTE is_active_admin(); authenticated & service_role: bisa |
| 009 atomic post create | 2026-11-24 | Konektor Supabase | fungsi ada; hanya service_role bisa EXECUTE |
| 010 revoke handle_new_user | 2026-11-24 | Konektor Supabase | ACL: postgres, service_role, supabase_auth_admin; trigger masih terpasang; tidak ada fungsi public yang bisa dijalankan anon |

Belum diuji end-to-end: login nyata, pembuatan posting lewat RPC dari Worker, pembuatan karyawan baru (trigger handle_new_user).
Pengaturan Auth (redirect URL reset password, leaked password protection) harus diubah manual di dashboard Supabase.
