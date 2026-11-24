# SocialHub Stage 6 — Phase 2 (tahap A–B)

Tanggal: 2026-11-24 · Branch: `stage-3-backend` (jangan push ke `main`)

## Perubahan
- `database/migrations/008_function_privileges.sql` — cabut EXECUTE `is_active_admin()` dari PUBLIC dan anon; `authenticated` dan `service_role` tetap (dibutuhkan policy RLS).
- `database/migrations/008_rollback.sql`, `database/09-verify-after-008.sql`.
- `test/migrations.test.js` — 4 tes statis untuk migration (bukan eksekusi ke database).

## Tes (nyata, lokal)
Sebelum: 26 lulus, 0 gagal. Sesudah: 30 lulus, 0 gagal (`npm test`). Semua memakai mock; tidak ada uji ke Supabase/Cloudflare/provider.

## Status
| Item | Status |
|---|---|
| Migration 008 | Ditulis, BELUM dijalankan (butuh persetujuan pemilik) |
| `PUBLIC_ORIGIN` | Masih placeholder `.invalid` — pemilik harus mengisi URL Worker |
| Deploy otomatis (`main.yml`) | Ada: tiap push ke `stage-3-backend` menjalankan tes lalu `wrangler deploy`; butuh secret GitHub CLOUDFLARE_API_TOKEN & CLOUDFLARE_ACCOUNT_ID |
| Uji nyata login/R2/Queue/retry/DLQ/cleanup | BELUM diuji (butuh kredensial/aksi pemilik) |
| Adapter publish 4 platform | Tetap `ADAPTER_NOT_VERIFIED` (butuh Developer App disetujui) |
| RPC transaksi atomik post+destination, rekonsiliasi | BELUM dikerjakan |
| APK | BELUM dibuild/diuji |

## Langkah pemilik
1. Isi `PUBLIC_ORIGIN` di `wrangler.jsonc` dengan URL Worker (HTTPS).
2. Supabase > SQL Editor: jalankan `008_function_privileges.sql`, lalu `09-verify-after-008.sql`, tempel hasilnya ke chat.
3. Tambahkan `https://<URL-Worker>/reset-password.html` ke Supabase Auth > URL Configuration > Redirect URLs.
4. GitHub > Actions > "Build Debug APK" > Run workflow (isi `base_url`).
