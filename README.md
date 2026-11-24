# SocialHub Akulaku — Stage 6

SocialHub Akulaku adalah aplikasi mobile-first untuk mengelola konten dan antrean publikasi empat platform sosial melalui backend Cloudflare Workers, Supabase, Cloudflare Queues, dan R2. Android menggunakan Kotlin + WebView.

> **Status: belum siap produksi.** Adapter publikasi TikTok, Instagram, Facebook, dan Threads masih menolak publikasi sampai API resmi, izin, dan proses review platform diimplementasikan serta diuji. Jangan mengaktifkan integrasi hanya untuk melewati UI.

## Arsitektur aktif

- `src/worker.js` — API, autentikasi, OAuth, upload, admin.
- `src/queue.js` — dispatcher terjadwal, atomic claim, retry terjadwal, cleanup media.
- `src/providers/` — kerangka OAuth dan adapter empat platform.
- `src/lib/` — Supabase REST/Auth, AES-GCM, signed media URL, validasi.
- `database/migrations/` — migration Supabase; jalankan hanya setelah backup dan persetujuan pemilik.
- `public/` — aplikasi web mobile-first.
- `android/` — wrapper Android Kotlin/WebView.
- `legacy/` — implementasi lama, bukan backend Stage 6 aktif.

## Persyaratan

- Node.js 22.13 atau lebih baru.
- Akun Cloudflare Workers, R2, dan Queues.
- Proyek Supabase.
- Aplikasi developer resmi dan izin API setiap platform sebelum publikasi nyata.

## Pengembangan lokal

1. Instal dependensi:

   ```bash
   npm install
   ```

2. Buat `.dev.vars` lokal (jangan commit file ini). Isi nilai rahasia backend:

   ```dotenv
   SUPABASE_SECRET_KEY=...
   TOKEN_ENC_KEY=...
   STATE_SECRET=...
   MEDIA_SIGNING_SECRET=...
   TIKTOK_CLIENT_SECRET=...
   INSTAGRAM_CLIENT_SECRET=...
   FACEBOOK_CLIENT_SECRET=...
   THREADS_CLIENT_SECRET=...
   ```

3. Isi `PUBLIC_ORIGIN` pada `wrangler.jsonc` dengan origin HTTPS yang benar saat menguji OAuth atau pemrosesan media. Nilai placeholder `.invalid` sengaja ditolak.
4. Jalankan:

   ```bash
   npm test
   npm run dev
   ```

## Konfigurasi Cloudflare

- Buat bucket R2 bernama `socialhub-media` atau sesuaikan `wrangler.jsonc`.
- Buat Queue `socialhub-publish` dan dead-letter queue `socialhub-publish-dlq`.
- Pasang semua secret dengan `wrangler secret put NAMA_SECRET`.
- Atur `PUBLIC_ORIGIN` ke origin Worker/domain HTTPS produksi.
- Pastikan Supabase schema sesuai dengan migration dan query di `src/`.

`wrangler.jsonc` mengatur dispatcher setiap menit dan pembersihan media setiap 15 menit. Media unggahan dibatasi masa simpan maksimum 24 jam, kecuali proses aktif masih membutuhkannya. Bucket lifecycle juga perlu disetel sebagai lapisan pengaman, bukan pengganti cleanup aplikasi.

## Database

Migration 007 **belum dijalankan otomatis** oleh proyek. Periksa `database/00-audit-readonly.sql`, baca `database/migrations/007_socialhub_core.sql`, jalankan pada database salinan, lalu verifikasi dengan `database/08-verify-after-007.sql`.

`database/migrations/007_rollback.sql` adalah guard non-destruktif: tidak menghapus tabel, token, atau data. Pemulihan skema harus dibuat sebagai forward migration khusus setelah backup dan review.

## Pengujian

```bash
node --test test/*.test.js
```

Test menggunakan mock Supabase dan adapter; hasil lulus bukan bukti bahwa Supabase, Cloudflare Queue/R2, OAuth, atau API sosial nyata sudah berfungsi.

## Android

Proyek Android ada di `android/`. Build APK memerlukan Android SDK/Gradle dan `BASE_URL` produksi yang benar. APK belum dianggap teruji hanya karena struktur proyek tersedia.

## Catatan keamanan

- Jangan masukkan Supabase Secret Key, token sosial, atau signing key ke frontend atau APK.
- `.env`, `.dev.vars`, dan file rahasia lokal dikecualikan dari Git.
- Jangan push ke `main` untuk pekerjaan pengembangan; gunakan branch kerja `stage-3-backend` sesuai alur proyek.
