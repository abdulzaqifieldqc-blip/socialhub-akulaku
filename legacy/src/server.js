import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY wajib diisi pada .env");
  process.exit(1);
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL || true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const platforms = ["tiktok", "instagram", "facebook", "threads"];
const baseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Social Hub API", version: "0.5.0", auth: "supabase" });
});

// Build a Supabase client bound to the signed-in user's access token.
// All database access from this client is subject to the database's RLS policies.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Silakan login." });

    const { data: { user }, error } = await baseClient.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Sesi tidak valid atau kedaluwarsa." });

    const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("id,full_name,role,is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed:", profileError.message);
      return res.status(500).json({ error: "Tidak dapat memeriksa profil." });
    }
    if (!profile || !profile.is_active) return res.status(403).json({ error: "Akun belum aktif atau profil tidak ditemukan." });

    req.user = user;
    req.profile = profile;
    req.supabase = userClient;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Pemeriksaan sesi gagal." });
  }
}

function requireAdmin(req, res, next) {
  if (req.profile?.role !== "admin") return res.status(403).json({ error: "Akses khusus admin." });
  next();
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name?.trim() || !email?.trim() || !password || password.length < 10) {
      return res.status(400).json({ error: "Nama, email, dan password minimal 10 karakter wajib diisi." });
    }
    const { data, error } = await baseClient.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: name.trim() } }
    });
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({
      message: data.session ? "Pendaftaran berhasil." : "Pendaftaran diterima. Periksa email untuk konfirmasi jika diminta.",
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      session: data.session
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Pendaftaran gagal." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email dan password wajib diisi." });
    const { data, error } = await baseClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password
    });
    if (error || !data.user || !data.session) {
      return res.status(401).json({ error: "Email atau password salah." });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
    });
    const { data: profile, error: profileError } = await userClient
      .from("profiles").select("id,full_name,role,is_active").eq("id", data.user.id).maybeSingle();

    if (profileError || !profile || !profile.is_active) {
      await baseClient.auth.signOut({ scope: "local" });
      return res.status(403).json({ error: "Profil tidak ditemukan atau akun dinonaktifkan." });
    }
    res.json({
      user: { id: data.user.id, email: data.user.email, ...profile },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login gagal." });
  }
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, ...req.profile } });
});

app.get("/api/social-accounts", requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from("social_accounts")
    .select("id,platform,username,status,token_expires_at")
    .eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: "Tidak dapat mengambil akun sosial." });
  const connected = new Map((data || []).map(x => [x.platform, x]));
  res.json({ accounts: platforms.map(platform => connected.get(platform) || {
    platform, username: null, status: "disconnected", token_expires_at: null
  }) });
});

app.get("/api/posts", requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from("posts")
    .select("id,caption,status,created_at,post_destinations(platform,status,error_code,error_message,published_at)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: "Tidak dapat mengambil riwayat posting." });
  res.json({ posts: data || [] });
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await req.supabase
    .from("profiles").select("id,full_name,role,is_active,created_at")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "Tidak dapat mengambil daftar karyawan. Periksa policy admin." });
  res.json({ users: data || [] });
});

app.get("/api/social/:platform/connect", requireAuth, (req, res) => {
  if (!platforms.includes(req.params.platform)) return res.status(404).json({ error: "Platform tidak dikenal." });
  res.status(501).json({
    error: "OAuth belum diimplementasikan.",
    platform: req.params.platform,
    next_step: "Setiap platform memerlukan developer app, redirect URI, scopes, dan persetujuan resmi."
  });
});

app.post("/api/posts", requireAuth, (_req, res) => {
  res.status(501).json({
    error: "Pembuatan publikasi belum diaktifkan.",
    reason: "Skema database sudah dibuat, tetapi pembuatan empat destination dan upload media harus ditambahkan bersama worker publikasi agar tidak ada status palsu."
  });
});

app.patch("/api/admin/users/:id/status", requireAuth, requireAdmin, (_req, res) => {
  res.status(501).json({
    error: "Perubahan status karyawan melalui backend belum diaktifkan.",
    reason: "Perlu backend-only secret dan audit logging yang aman."
  });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Social Hub API v0.5 berjalan di port ${port}`));
