# Social Hub — Starter Project 0.1

Fondasi awal aplikasi Social Hub: Android-friendly web interface + backend API + panel admin dasar.

## Yang sudah tersedia
- Registrasi email karyawan dan login pribadi.
- Password di-hash dengan bcrypt.
- Peran `owner`, `admin`, `employee`.
- Data akun sosial dipisahkan per pengguna.
- Dashboard karyawan dan daftar koneksi TikTok, Instagram, Facebook, Threads.
- Form pembuatan publikasi dan antrean database.
- Riwayat posting per pengguna.
- Panel admin untuk melihat dan menonaktifkan/mengaktifkan karyawan.
- Audit log dasar.

## Yang BELUM aktif
Ini belum menjadi sistem publikasi produksi. OAuth dan pengiriman konten nyata ke empat platform belum diimplementasikan. Endpoint connect sengaja mengembalikan `501`, bukan berpura-pura berhasil. Diperlukan aplikasi developer resmi, persetujuan platform, redirect URI, scopes, token lifecycle, media hosting, dan worker antrean khusus setiap API.

Upload media saat ini menggunakan URL media sebagai placeholder. Sebelum produksi, tambahkan object storage, validasi MIME/ukuran, pemindaian file, dan URL bertanda tangan.

## Persiapan
Persyaratan: Node.js 22.13+ dan PostgreSQL.

1. Buat database PostgreSQL bernama `social_hub`.
2. Jalankan skema:
   ```bash
   psql "$DATABASE_URL" -f database/schema.sql
   ```
3. Salin `.env.example` menjadi `.env`, lalu isi `DATABASE_URL`, `JWT_SECRET`, dan `APP_URL`.
4. Instal dan jalankan:
   ```bash
   npm install
   npm start
   ```
5. Buka `http://localhost:3000`.

## Membuat akun admin pertama
Daftar akun biasa melalui halaman web. Lalu ubah role akun pertama melalui SQL tepercaya:
```sql
UPDATE users SET role='owner' WHERE email='email-admin-anda@example.com';
```
Jangan pernah memberikan akses SQL admin kepada karyawan.

## Android APK
Fondasi ini dapat dibungkus menjadi APK menggunakan Capacitor setelah URL server produksi tersedia. APK harus mengakses backend HTTPS; jangan menaruh secret API atau token sosial di dalam APK. Build APK memerlukan Android SDK/Android Studio atau pipeline build Android.

## Rekomendasi sebelum dipakai perusahaan
- Pakai HTTPS dan domain resmi.
- Tambahkan verifikasi email, reset password, rate limiting, CSRF strategy sesuai auth, session/device management, dan MFA admin.
- Tambahkan enkripsi OAuth token dengan AES-256-GCM menggunakan key dari secret manager/KMS.
- Terapkan isolasi data di seluruh query; uji akses silang antar-karyawan.
- Implementasikan OAuth resmi per platform dan refresh/revocation.
- Buat worker antrean idempotent, retry terbatas, backoff, dan status per platform.
- Buat kebijakan retensi media/log serta backup database.
- Lakukan security review dan uji publikasi dengan akun uji sebelum produksi.


## Cloud storage & queue foundation (v0.2)
New modules:
- `src/storage.js`: S3-compatible signed upload URL generation, object verification and deletion.
- `src/queue.js`: BullMQ queue with retry/backoff and deterministic job IDs.
- `src/retention.js`: retention cleanup logic that excludes media attached to queued/processing posts.
- `database/media-schema.sql`: media metadata table and post relation.

Apply the additional schema:
```bash
psql "$DATABASE_URL" -f database/media-schema.sql
```

Configure S3-compatible credentials and Redis in `.env`. Run the application cleanup worker hourly to enforce the 7-day retention rule while excluding files needed by queued/processing posts. Configure the bucket lifecycle expiry as a later safety net (for example, 10 days), not 7 days, so it cannot delete an asset that the application has deliberately retained for an active publication job.

Important: this is an implementation foundation, not a complete production media service. The upload route, post-upload verification flow, scheduled worker bootstrap, media validation/scanning, and provider-specific publishing adapters still need to be wired and tested. Do not expose S3 credentials in the Android APK; only the backend may create signed URLs.


## Confirmed publishing rule (v0.3)
Each employee's minimum daily target is one shared content item (same source media and same caption) published to TikTok, Instagram, Facebook, and Threads. This creates four independent destination tasks; the daily target is complete only when all four have confirmed success. For 100 employees, the baseline is 100 source uploads and 400 destination tasks per day. See `docs/PRODUCTION-SPEC-v0.3.md` for workflow, retry, accounting, and retention rules.


## Upload architecture (v0.4)
The confirmed direction is **no permanent video storage in Social Hub**. Prefer official direct upload sessions from the Android app when each platform supports them. Some provider APIs require a fetchable media URL; those destinations may need a short-lived temporary relay/object with strict expiry and deletion after provider ingestion. Do not promise zero intermediary transfer for every platform. See `docs/PRODUCTION-SPEC-v0.4.md`. The current starter still has earlier storage scaffolding and is not production-ready; refactoring and platform-specific API implementation remain required.


## Supabase Auth integration (v0.5)
The API now uses Supabase Auth for employee registration/login and validates access tokens against Supabase. It reads profiles and user-owned records through a user-scoped Supabase client so database RLS applies.

Configuration:
- Copy `.env.example` to `.env`.
- Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Install with `npm install`, run with `npm start`.

Important limitations:
- The current database policies intentionally do not permit client-side inserts into posts or destination results.
- OAuth, employee provisioning/invitations, admin status changes, media upload, and actual publishing remain unimplemented.
- Do not add a Supabase Secret key to HTML or APK. If later needed, it belongs only in a protected backend environment.
- The HTML preview is not yet wired to these API endpoints.
