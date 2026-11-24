# Backend Cloudflare Worker — Stage 6 / Phase 1

Entry point: `src/worker.js` (fetch, queue, scheduled). Runtime menggunakan Fetch API dan Web Crypto.

## Status implementasi

| Area | Status saat ini |
|---|---|
| Login, refresh, logout, permintaan reset password | Implementasi Supabase Auth; alur reset memakai halaman `reset-password.html`, tetap perlu uji email produksi |
| Otorisasi admin/employee dan profil nonaktif | Implementasi server-side; diuji dengan mock |
| Admin karyawan | Provisioning dan penonaktifan; destination queued dibatalkan ketika employee dinonaktifkan |
| Upload ke R2 privat | Implementasi; belum diuji dengan R2 nyata |
| Dispatcher jadwal | Menggunakan `next_attempt_at` sebagai jadwal/dispatch lease; pengiriman Queue gagal dijadwalkan ulang |
| Atomic claim destination | Compare-and-set `status=queued` → `processing`; diuji dengan mock concurrency |
| Retry | Backoff melalui `next_attempt_at`; dispatcher cron mengirim ulang |
| Media retention | Maksimum 24 jam; cleanup setiap 15 menit; media yang masih dipakai post queued/processing dipertahankan |
| Signed media URL | Origin HTTPS dari `PUBLIC_ORIGIN`, bukan Host request; URL berlaku 6 jam dan endpoint menolak media berumur lebih dari 24 jam |
| Token refresh | Dicoba saat token kedaluwarsa/akan kedaluwarsa jika adapter mendukung; kegagalan menghasilkan `needs_reconnect` |
| OAuth | Kerangka tersedia; hanya status integrasi `enabled` yang dapat memulai/callback |
| Publikasi TikTok/Instagram/Facebook/Threads | Belum diimplementasikan; adapter sengaja menolak dengan `ADAPTER_NOT_VERIFIED` |
| Supabase/Cloudflare integration | Belum diuji terhadap layanan nyata |

## Catatan konsistensi dan batasan

- `next_attempt_at` berfungsi sebagai jadwal durable dan lease dispatch. Ini mengurangi risiko pekerjaan hilang ketika pengiriman Queue gagal atau Worker berhenti setelah klaim dispatch. Ini **belum** merupakan transactional outbox berbasis satu transaksi SQL lintas tabel.
- Pembuatan posting induk dan destination memakai kompensasi penghapusan jika insert destination gagal. Ini bukan transaksi database atomik; implementasi RPC/transaksi SQL tetap direkomendasikan sebelum beban produksi.
- Atomic claim mencegah dua consumer mengambil baris `queued` yang sama secara bersamaan. Exactly-once publikasi eksternal tetap tidak dapat dijamin jika provider berhasil menerima publikasi tetapi respons hilang sebelum database diperbarui; provider idempotency/reconciliation diperlukan.
- Token refresh memerlukan konfigurasi Client ID/Secret dan dukungan refresh adapter. Facebook dapat memerlukan reconnect ketika token kedaluwarsa.
- Penonaktifan employee membatalkan destination `queued`. Pekerjaan `processing` yang sudah berjalan tidak dapat ditarik kembali dari provider.
- Rollback 007 sengaja tidak destruktif. Jangan mengganti guard ini dengan DROP TABLE atau grant luas.
- `PUBLIC_ORIGIN` wajib berupa origin HTTPS produksi dan nilai `.invalid` ditolak.

## Pengujian

Jalankan `node --test test/*.test.js`. Semua tes berjalan dengan mock Supabase/provider; tes tersebut tidak membuktikan konfigurasi atau perilaku layanan eksternal.

## Frontend

`public/` adalah SPA mobile-first. Halaman `reset-password.html` menerima recovery access token Supabase dari URL fragment dan mengirim password baru melalui endpoint autentikasi backend. Tambahkan `https://<PUBLIC_ORIGIN>/reset-password.html` ke daftar Redirect URLs yang diizinkan pada Supabase Auth sebelum menguji email reset.
