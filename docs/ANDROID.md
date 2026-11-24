# Android WebView APK

Proyek: `android/` (Kotlin, minSdk 24). Hanya pembungkus WebView — seluruh UI ada di web (`public/`).

## Status
| Item | Status |
|---|---|
| Kode WebView, splash, ikon, deep link OAuth, file chooser video, tombol kembali, halaman error, indikator loading | Ditulis |
| Kompilasi / APK | BELUM dibuild: sesi ini tidak punya Android SDK dan tidak ada akses ke Google Maven. Build lewat GitHub Actions |
| Uji di perangkat (login, upload, OAuth, back, jaringan) | BELUM diuji |

## Keamanan
HTTPS wajib, cleartext dimatikan; hanya host `BASE_URL` dimuat di WebView; tautan lain dibuka di Custom Tabs; skema `intent:`/`file:` diblokir;
tanpa JavaScript bridge; akses file/konten dimatikan; mixed content dilarang; error SSL → `handler.cancel()`; `allowBackup=false`.

## URL produksi
Diset saat build (`-PBASE_URL=https://...`), bukan di backend. Ganti URL = build ulang APK saja.

## Build dari HP
1. Pastikan repo di GitHub berisi folder `android/` dan `.github/workflows/android-debug.yml`.
2. GitHub (browser HP) > tab **Actions** > **Build Debug APK** > **Run workflow** > isi `base_url`.
3. Setelah hijau, buka run tersebut > **Artifacts** > unduh `SocialHub-debug-apk` (ZIP berisi `app-debug.apk`).
4. Ekstrak ZIP di HP, buka `app-debug.apk`, izinkan "install dari sumber ini", lalu instal.

## Alur OAuth di APK
Tombol "Hubungkan" membuka halaman izin platform di Custom Tab → callback Worker → `/oauth-done.html` → `socialhub://oauth?...` membuka kembali aplikasi.
