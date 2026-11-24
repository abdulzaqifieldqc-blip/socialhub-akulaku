import { HttpError, json, readJson, mustUuid, PLATFORMS, SEC_HEADERS, sanitizeError } from "./lib/util.js";
import { sb, sbCount, sbRpc, authAdmin, authPublic, audit } from "./lib/supabase.js";
import { authenticate, requireAdmin, checkLoginLimit, noteLoginFail, noteLoginOk } from "./lib/auth.js";
import { encryptText, signPayload, verifyPayload } from "./lib/crypto.js";
import { ALLOWED_MIMES, looksLikeMp4, checkMediaToken } from "./lib/media.js";
import { getAdapter } from "./providers/index.js";
import { handleQueue, enqueueDue, cleanupMedia, reconcileStuck } from "./queue.js";
import { recomputePostStatus } from "./lib/posts.js";

const routes = [];
const route = (method, pattern, handler, auth = false) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, auth });
const platformOf = (p) => { if (!PLATFORMS.includes(p)) throw new HttpError(404, "Platform tidak dikenal."); return p; };
const emailOk = (e) => typeof e === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e);
const configuredOrigin = (env) => {
  let u;
  try { u = new URL(env.PUBLIC_ORIGIN || ""); } catch { throw new HttpError(500, "PUBLIC_ORIGIN belum dikonfigurasi.", "CONFIG_MISSING"); }
  if (u.protocol !== "https:" || !u.hostname || u.hostname.endsWith(".invalid") || u.username || u.password || u.pathname !== "/" || u.search || u.hash)
    throw new HttpError(500, "PUBLIC_ORIGIN harus berupa origin HTTPS produksi yang valid.", "CONFIG_INVALID");
  return u.origin;
};

// ---------- Publik ----------
route("GET", "/api/health", async (_c, _r, env) => json({ ok: true, service: "SocialHub Akulaku API", version: "1.0.0-dev",
  configured: { supabase: !!env.SUPABASE_URL, secret_key: !!env.SUPABASE_SECRET_KEY, r2: !!env.MEDIA, queue: !!env.PUBLISH_QUEUE } }));

route("POST", "/api/auth/login", async (_c, req, env) => {
  const { email, password } = await readJson(req);
  if (!emailOk(email) || typeof password !== "string" || !password) throw new HttpError(400, "Email dan password wajib diisi.");
  const key = checkLoginLimit(req, email);
  const r = await authPublic(env, "token?grant_type=password", { body: { email: email.trim().toLowerCase(), password } });
  if (!r.ok || !r.data?.access_token) { noteLoginFail(key); throw new HttpError(401, "Email atau password salah."); }
  const [profile] = await sb(env, `profiles?id=eq.${r.data.user.id}&select=id,full_name,role,is_active`) || [];
  if (!profile || !profile.is_active) throw new HttpError(403, "Akun belum aktif atau dinonaktifkan.");
  noteLoginOk(key);
  await audit(env, { actor: profile.id, action: "login" });
  return json({ user: { id: profile.id, email: r.data.user.email, full_name: profile.full_name, role: profile.role },
    session: { access_token: r.data.access_token, refresh_token: r.data.refresh_token, expires_at: r.data.expires_at } });
});
route("POST", "/api/auth/refresh", async (_c, req, env) => {
  const { refresh_token } = await readJson(req);
  if (typeof refresh_token !== "string" || !refresh_token) throw new HttpError(400, "refresh_token wajib.");
  const r = await authPublic(env, "token?grant_type=refresh_token", { body: { refresh_token } });
  if (!r.ok) throw new HttpError(401, "Sesi kedaluwarsa. Silakan login lagi.");
  return json({ session: { access_token: r.data.access_token, refresh_token: r.data.refresh_token, expires_at: r.data.expires_at } });
});
route("POST", "/api/auth/forgot", async (_c, req, env) => {   // alur resmi Supabase; respons selalu sama (tidak membocorkan email terdaftar)
  const { email } = await readJson(req);
  if (emailOk(email)) {
    const redirectTo = `${configuredOrigin(env)}/reset-password.html`;
    await authPublic(env, `recover?redirect_to=${encodeURIComponent(redirectTo)}`, { body: { email: email.trim().toLowerCase() } });
  }
  return json({ message: "Jika email terdaftar, tautan reset password telah dikirim." });
});
route("POST", "/api/auth/password", async (c, req, env) => {
  const { password } = await readJson(req);
  if (typeof password !== "string" || password.length < 12) throw new HttpError(400, "Password baru minimal 12 karakter.");
  const token = req.headers.get("Authorization")?.slice(7);
  const result = await authPublic(env, "user", { method: "PUT", token, body: { password } });
  if (!result.ok) throw new HttpError(400, "Password tidak dapat diperbarui. Tautan pemulihan mungkin sudah kedaluwarsa.");
  await audit(env, { actor: c.user.id, action: "password_reset" });
  return json({ ok: true, message: "Password berhasil diperbarui." });
}, true);
route("POST", "/api/auth/logout", async (c, req, env) => {
  await authPublic(env, "logout?scope=local", { token: req.headers.get("Authorization").slice(7) });
  await audit(env, { actor: c.user.id, action: "logout" });
  return json({ ok: true });
}, true);

// ---------- Media bertanda tangan (dipakai platform untuk mengambil video; bucket tetap privat) ----------
route("GET", "/api/media/([0-9a-fA-F-]{36})", async (_c, req, env, m) => {
  const id = mustUuid(m[1]);
  if (!(await checkMediaToken(env, id, new URL(req.url).searchParams.get("t")))) throw new HttpError(403, "Tautan media tidak valid atau kedaluwarsa.");
  const [a] = await sb(env, `media_assets?id=eq.${id}&status=eq.uploaded&select=object_key,mime_type,uploaded_at`) || [];
  if (!a) throw new HttpError(404, "Media tidak ditemukan.");
  const uploadedAt = Date.parse(a.uploaded_at || "");
  if (!Number.isFinite(uploadedAt) || uploadedAt < Date.now() - 24 * 3600000) throw new HttpError(410, "Masa akses media telah berakhir.");
  const obj = await env.MEDIA.get(a.object_key, { range: req.headers });
  if (!obj) throw new HttpError(404, "Media tidak ditemukan.");
  const h = new Headers({ ...SEC_HEADERS, "Content-Type": a.mime_type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" });
  const r = obj.range;
  if (r && "offset" in r) { h.set("Content-Range", `bytes ${r.offset}-${r.offset + r.length - 1}/${obj.size}`); h.set("Content-Length", String(r.length)); }
  else h.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: r ? 206 : 200, headers: h });
});

// ---------- Pengguna login ----------
route("GET", "/api/me", async (c) => json({ user: { id: c.user.id, email: c.user.email, ...c.profile } }), true);

route("GET", "/api/dashboard", async (c, _r, env) => {
  const uid = c.user.id;
  const [total, ok, queued, failed] = await Promise.all(["", "&status=eq.published", "&status=in.(queued,processing)", "&status=eq.failed"]
    .map(f => sbCount(env, `post_destinations?user_id=eq.${uid}${f}`)));
  const accounts = await sb(env, `social_accounts?user_id=eq.${uid}&select=platform,username,status,token_expires_at`);
  const recent = await sb(env, `post_destinations?user_id=eq.${uid}&order=created_at.desc&limit=10&select=id,platform,status,error_message,published_at,created_at,post_id`);
  return json({ totals: { total, published: ok, queued, failed }, accounts: accounts || [], recent: recent || [] });
}, true);

route("GET", "/api/social-accounts", async (c, _r, env) => {
  const rows = await sb(env, `social_accounts?user_id=eq.${c.user.id}&select=platform,username,status,token_expires_at`);
  const by = new Map((rows || []).map(x => [x.platform, x]));
  const cfg = await sb(env, "integration_settings?select=platform,status");
  const st = new Map((cfg || []).map(x => [x.platform, x.status]));
  return json({ accounts: PLATFORMS.map(p => ({ ...(by.get(p) || { platform: p, username: null, status: "disconnected", token_expires_at: null }),
    available: st.get(p) === "enabled" })) });
}, true);

route("DELETE", "/api/social-accounts/([a-z]+)", async (c, _r, env, m) => {
  const p = platformOf(m[1]);
  await sb(env, `social_accounts?user_id=eq.${c.user.id}&platform=eq.${p}`, { method: "DELETE" });   // token ikut terhapus (cascade)
  await audit(env, { actor: c.user.id, action: "social_disconnect", details: { platform: p } });
  return json({ ok: true });
}, true);

// OAuth: mulai
route("GET", "/api/social/([a-z]+)/connect", async (c, req, env, m) => {
  const p = platformOf(m[1]), adapter = getAdapter(p);
  const [cfg] = await sb(env, `integration_settings?platform=eq.${p}&select=*`) || [];
  if (!cfg || cfg.status !== "enabled" || !cfg.client_id) throw new HttpError(409, `Integrasi ${p} belum diaktifkan oleh admin.`, "PLATFORM_NOT_AVAILABLE");
  if (!env.STATE_SECRET) throw new HttpError(500, "Konfigurasi server belum lengkap: STATE_SECRET.", "CONFIG_MISSING");
  const origin = configuredOrigin(env);
  const redirectUri = cfg.redirect_uri || `${origin}/api/oauth/${p}/callback`;
  const state = await signPayload(env.STATE_SECRET, { u: c.user.id, p, n: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 });
  const scopes = cfg.scopes?.length ? cfg.scopes : adapter.defaultScopes;
  return json({ url: adapter.authUrl({ clientId: cfg.client_id, redirectUri, state, scopes, env }) });
}, true);

// OAuth: callback (navigasi browser; pengguna diidentifikasi lewat state bertanda tangan)
route("GET", "/api/oauth/([a-z]+)/callback", async (_c, req, env, m) => {
  const p = platformOf(m[1]), adapter = getAdapter(p), url = new URL(req.url);
  const back = (q) => Response.redirect(`${configuredOrigin(env)}/oauth-done.html?${q}`, 302);   // halaman perantara: kembali ke APK lewat socialhub://oauth
  const st = await verifyPayload(env.STATE_SECRET || "", url.searchParams.get("state"));
  if (!st || st.p !== p) return back("oauth=invalid_state");
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return back(`oauth=denied&platform=${p}`);
  try {
    const [cfg] = await sb(env, `integration_settings?platform=eq.${p}&select=*`) || [];
    const secret = env[`${p.toUpperCase()}_CLIENT_SECRET`];
    if (cfg?.status !== "enabled" || !cfg?.client_id || !secret) return back(`oauth=not_configured&platform=${p}`);
    const redirectUri = cfg.redirect_uri || `${configuredOrigin(env)}/api/oauth/${p}/callback`;
    const t = await adapter.exchangeCode({ code: url.searchParams.get("code"), clientId: cfg.client_id, clientSecret: secret, redirectUri, env });
    const [acct] = await sb(env, "social_accounts?on_conflict=user_id,platform", { method: "POST", prefer: "resolution=merge-duplicates,return=representation",
      body: { user_id: st.u, platform: p, provider_user_id: t.providerUserId, username: t.username, status: "connected",
        granted_scopes: t.scopes, token_expires_at: t.expiresAt, connected_at: new Date().toISOString() } });
    await sb(env, "social_account_tokens?on_conflict=social_account_id", { method: "POST", prefer: "resolution=merge-duplicates",
      body: { social_account_id: acct.id, access_token_enc: await encryptText(t.accessToken, env.TOKEN_ENC_KEY),
        refresh_token_enc: t.refreshToken ? await encryptText(t.refreshToken, env.TOKEN_ENC_KEY) : null, updated_at: new Date().toISOString() } });
    await audit(env, { actor: st.u, action: "social_connect", details: { platform: p } });
    return back(`connected=${p}`);
  } catch (e) {
    console.error("oauth_callback_error", p, sanitizeError(e.message));
    return back(`oauth=failed&platform=${p}`);
  }
});

// Upload video: init -> PUT (stream ke R2 privat)
route("POST", "/api/uploads", async (c, req, env) => {
  const { filename, mime_type, size_bytes } = await readJson(req);
  const max = Number(env.MAX_UPLOAD_BYTES || 104857600);
  if (!ALLOWED_MIMES.includes(mime_type)) throw new HttpError(400, "Format harus MP4 atau MOV.");
  if (!Number.isInteger(size_bytes) || size_bytes < 1 || size_bytes > max) throw new HttpError(400, `Ukuran file maksimal ${Math.floor(max / 1048576)} MB.`);
  const ext = mime_type === "video/mp4" ? "mp4" : "mov", id = crypto.randomUUID();
  const key = `users/${c.user.id}/${id}.${ext}`;
  await sb(env, "media_assets", { method: "POST", body: { id, user_id: c.user.id, object_key: key,
    original_filename: String(filename || "video").replace(/[^\w.\- ]/g, "_").slice(0, 120), mime_type, size_bytes, status: "pending" } });
  return json({ id, upload_url: `/api/uploads/${id}` }, 201);
}, true);

route("PUT", "/api/uploads/([0-9a-fA-F-]{36})", async (c, req, env, m) => {
  const id = mustUuid(m[1]);
  const [a] = await sb(env, `media_assets?id=eq.${id}&user_id=eq.${c.user.id}&status=eq.pending&select=*`) || [];
  if (!a) throw new HttpError(404, "Upload tidak ditemukan.");
  if (Number(req.headers.get("Content-Length")) !== a.size_bytes) throw new HttpError(400, "Ukuran upload tidak sesuai.");
  await env.MEDIA.put(a.object_key, req.body, { httpMetadata: { contentType: a.mime_type } });
  const head = await env.MEDIA.head(a.object_key);
  if (!head || head.size !== a.size_bytes || !(await looksLikeMp4(env.MEDIA, a.object_key))) {
    await env.MEDIA.delete(a.object_key);
    await sb(env, `media_assets?id=eq.${id}`, { method: "PATCH", body: { status: "deleted", deleted_at: new Date().toISOString() } });
    throw new HttpError(400, "File bukan video MP4/MOV yang valid.");
  }
  await sb(env, `media_assets?id=eq.${id}`, { method: "PATCH", body: { status: "uploaded", uploaded_at: new Date().toISOString() } });
  return json({ id, status: "uploaded" });
}, true);

// Buat posting
route("POST", "/api/posts", async (c, req, env) => {
  const b = await readJson(req);
  const platforms = [...new Set(Array.isArray(b.platforms) ? b.platforms : [])];
  if (!platforms.length || !platforms.every(p => PLATFORMS.includes(p))) throw new HttpError(400, "Pilih minimal satu platform yang valid.");
  const caption = typeof b.caption === "string" ? b.caption.trim() : "";
  const mediaId = mustUuid(b.media_asset_id, "media_asset_id");
  let scheduledAt = null;
  if (b.scheduled_at) {
    const t = Date.parse(b.scheduled_at);
    if (!Number.isFinite(t) || t < Date.now() - 60000 || t > Date.now() + 90 * 86400000) throw new HttpError(400, "Jadwal harus dalam 90 hari ke depan.");
    scheduledAt = new Date(t).toISOString();
  }
  for (const p of platforms) {
    const lim = getAdapter(p).limits;
    if (caption.length > lim.maxCaption) throw new HttpError(400, `Caption ${p} maksimal ${lim.maxCaption} karakter.`);
  }
  const [media] = await sb(env, `media_assets?id=eq.${mediaId}&user_id=eq.${c.user.id}&status=eq.uploaded&select=id,size_bytes,mime_type,uploaded_at`) || [];
  if (!media) throw new HttpError(400, "Video belum diunggah atau bukan milik Anda.");
  // Media hanya disimpan 24 jam sejak unggah: jadwal tidak boleh melewati masa itu (margin 1 jam).
  if (scheduledAt && Date.parse(scheduledAt) > Date.parse(media.uploaded_at || 0) + 23 * 3600000)
    throw new HttpError(400, "Jadwal terlalu jauh: video hanya disimpan 24 jam setelah diunggah. Pilih waktu maksimal 23 jam setelah unggah.", "SCHEDULE_BEYOND_RETENTION");
  const cfg = await sb(env, "integration_settings?select=platform,status");
  const enabled = new Set((cfg || []).filter(x => x.status === "enabled").map(x => x.platform));
  const accts = await sb(env, `social_accounts?user_id=eq.${c.user.id}&status=eq.connected&select=id,platform`);
  const acctBy = new Map((accts || []).map(a => [a.platform, a.id]));
  const unavailable = platforms.filter(p => !enabled.has(p));
  if (unavailable.length) throw new HttpError(409, `Belum tersedia (integrasi belum aktif): ${unavailable.join(", ")}.`, "PLATFORM_NOT_AVAILABLE");
  const notConnected = platforms.filter(p => !acctBy.has(p));
  if (notConnected.length) throw new HttpError(409, `Hubungkan akun terlebih dahulu: ${notConnected.join(", ")}.`, "ACCOUNT_NOT_CONNECTED");
  const dispatchAt = scheduledAt || new Date().toISOString();
  let post;
  // Jalur utama: satu transaksi database (migration 009). Jika fungsi belum ada (404) -> jalur kompensasi lama.
  const rpc = await sbRpc(env, "create_post_with_destinations", {
    p_user: c.user.id, p_caption: caption, p_media: mediaId, p_scheduled: scheduledAt, p_mime: media.mime_type, p_size: media.size_bytes,
    p_platforms: platforms, p_accounts: Object.fromEntries(platforms.map(p => [p, acctBy.get(p)])), p_dispatch: dispatchAt });
  if (rpc.ok && typeof rpc.data === "string") post = { id: rpc.data, status: "queued" };
  else if (rpc.status !== 404) throw new HttpError(500, "Kesalahan database.", "DB_ERROR");
  else {
    [post] = await sb(env, "posts", { method: "POST", prefer: "return=representation",
      body: { user_id: c.user.id, caption, media_asset_id: mediaId, scheduled_at: scheduledAt, status: "queued",
        source_filename: null, mime_type: media.mime_type, file_size_bytes: media.size_bytes } });
    try {
      await sb(env, "post_destinations", { method: "POST", prefer: "return=representation",
        body: platforms.map(p => ({ post_id: post.id, user_id: c.user.id, platform: p, status: "queued", social_account_id: acctBy.get(p),
          idempotency_key: `${post.id}:${p}`, next_attempt_at: dispatchAt })) });
    } catch (e) {
      await sb(env, `posts?id=eq.${post.id}&user_id=eq.${c.user.id}`, { method: "DELETE" }).catch(() => {});
      throw e;
    }
  }
  await audit(env, { actor: c.user.id, action: "post_create", details: { post_id: post.id, platforms } });
  return json({ post: { id: post.id, status: post.status }, message: scheduledAt ? "Posting dijadwalkan." : "Posting masuk antrean dan akan diproses oleh dispatcher." }, 201);
}, true);

route("GET", "/api/posts", async (c, _r, env) => json({ posts: await sb(env,
  `posts?user_id=eq.${c.user.id}&order=created_at.desc&limit=100&select=id,caption,status,scheduled_at,created_at,post_destinations(platform,status,error_message,published_at)`) || [] }), true);

route("POST", "/api/posts/([0-9a-fA-F-]{36})/cancel", async (c, _r, env, m) => {
  const id = mustUuid(m[1]);
  const upd = await sb(env, `post_destinations?post_id=eq.${id}&user_id=eq.${c.user.id}&status=eq.queued`,
    { method: "PATCH", body: { status: "cancelled" }, prefer: "return=representation" });
  if (!upd?.length) throw new HttpError(409, "Tidak ada antrean yang bisa dibatalkan.");
  await sb(env, `posts?id=eq.${id}&user_id=eq.${c.user.id}`, { method: "PATCH", body: { status: "cancelled" } });
  await audit(env, { actor: c.user.id, action: "post_cancel", details: { post_id: id } });
  return json({ ok: true });
}, true);

// ---------- Admin ----------
route("GET", "/api/admin/stats", async (c, _r, env) => {
  requireAdmin(c);
  const n = (t, f = "") => sbCount(env, `${t}?select=id${f}`);
  const [emp, act, accts, tot, ok, fail, q] = await Promise.all([
    n("profiles", "&role=eq.employee"), n("profiles", "&role=eq.employee&is_active=eq.true"), n("social_accounts", "&status=eq.connected"),
    n("post_destinations"), n("post_destinations", "&status=eq.published"), n("post_destinations", "&status=eq.failed"),
    n("post_destinations", "&status=in.(queued,processing)")]);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const rows = await sb(env, `post_destinations?created_at=gte.${since}&select=created_at,platform,status&limit=10000`) || [];
  const daily = {}, byPlatform = {};
  for (const r of rows) {
    const d = new Date(Date.parse(r.created_at) + 7 * 3600000).toISOString().slice(0, 10); daily[d] = (daily[d] || 0) + 1;   // hari WIB
    (byPlatform[r.platform] ||= { total: 0, published: 0, failed: 0 }).total++;
    if (r.status === "published") byPlatform[r.platform].published++;
    if (r.status === "failed") byPlatform[r.platform].failed++;
  }
  return json({ employees: { total: emp, active: act, inactive: emp - act }, social_accounts_connected: accts,
    publications: { total: tot, published: ok, failed: fail, queued: q }, daily, by_platform: byPlatform });
}, true);

route("GET", "/api/admin/users", async (c, req, env) => {
  requireAdmin(c);
  const q = (new URL(req.url).searchParams.get("q") || "").replace(/[^\w@. -]/g, "").slice(0, 60);
  const f = q ? `&or=(full_name.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*)` : "";
  return json({ users: await sb(env, `profiles?order=created_at.desc&limit=500&select=id,full_name,email,role,is_active,created_at${f}`) || [] });
}, true);

route("POST", "/api/admin/users", async (c, req, env) => {
  requireAdmin(c);
  const { email, full_name, password } = await readJson(req);
  if (!emailOk(email) || !full_name?.trim() || typeof password !== "string" || password.length < 12) throw new HttpError(400, "Email, nama, dan password minimal 12 karakter wajib diisi.");
  const u = await authAdmin(env, "users", { method: "POST", body: { email: email.trim().toLowerCase(), password, email_confirm: true, user_metadata: { full_name: full_name.trim() } } });
  await sb(env, "profiles?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates",
    body: { id: u.id, full_name: full_name.trim(), email: u.email, role: "employee", is_active: true } });
  await audit(env, { actor: c.user.id, target: u.id, action: "employee_create" });
  return json({ user: { id: u.id, email: u.email, full_name: full_name.trim() } }, 201);
}, true);

route("PATCH", "/api/admin/users/([0-9a-fA-F-]{36})/status", async (c, req, env, m) => {
  requireAdmin(c);
  const id = mustUuid(m[1]), { active } = await readJson(req);
  if (typeof active !== "boolean") throw new HttpError(400, "Nilai 'active' harus true/false.");
  if (id === c.user.id) throw new HttpError(400, "Anda tidak bisa menonaktifkan akun sendiri.");
  const upd = await sb(env, `profiles?id=eq.${id}`, { method: "PATCH", prefer: "return=representation",
    body: { is_active: active, deactivated_at: active ? null : new Date().toISOString() } });
  if (!upd?.length) throw new HttpError(404, "Karyawan tidak ditemukan.");
  await authAdmin(env, `users/${id}`, { method: "PUT", body: { ban_duration: active ? "none" : "876000h" } });   // putus sesi; histori posting tetap
  if (!active) {
    const cancelled = await sb(env, `post_destinations?user_id=eq.${id}&status=eq.queued`,
      { method: "PATCH", body: { status: "cancelled", error_code: "USER_DEACTIVATED", error_message: "Karyawan dinonaktifkan sebelum publikasi.", updated_at: new Date().toISOString() },
        prefer: "return=representation" });
    for (const postId of new Set((cancelled || []).map(x => x.post_id))) await recomputePostStatus(env, postId);
  }
  await audit(env, { actor: c.user.id, target: id, action: active ? "employee_activate" : "employee_deactivate" });
  return json({ ok: true });
}, true);

route("GET", "/api/admin/publications", async (c, req, env) => {
  requireAdmin(c);
  const sp = new URL(req.url).searchParams; let f = "";
  if (sp.get("platform") && PLATFORMS.includes(sp.get("platform"))) f += `&platform=eq.${sp.get("platform")}`;
  if (sp.get("status") && /^[a-z]+$/.test(sp.get("status"))) f += `&status=eq.${sp.get("status")}`;
  if (sp.get("user_id")) f += `&user_id=eq.${mustUuid(sp.get("user_id"), "user_id")}`;
  if (sp.get("from") && !isNaN(Date.parse(sp.get("from")))) f += `&created_at=gte.${encodeURIComponent(new Date(sp.get("from")).toISOString())}`;
  if (sp.get("to") && !isNaN(Date.parse(sp.get("to")))) f += `&created_at=lte.${encodeURIComponent(new Date(sp.get("to")).toISOString())}`;
  return json({ items: await sb(env, `post_destinations?order=created_at.desc&limit=200&select=id,post_id,user_id,platform,status,error_code,error_message,attempts,published_at,created_at${f}`) || [] });
}, true);

route("GET", "/api/admin/accounts", async (c, _r, env) => {
  requireAdmin(c);
  return json({ accounts: await sb(env, "social_accounts?order=connected_at.desc&limit=500&select=id,user_id,platform,username,status,token_expires_at,connected_at") || [] });
}, true);

route("GET", "/api/admin/audit", async (c, _r, env) => {
  requireAdmin(c);
  return json({ logs: await sb(env, "audit_logs?order=created_at.desc&limit=200&select=id,actor_user_id,target_user_id,action,details,created_at") || [] });
}, true);

route("GET", "/api/admin/integrations", async (c, _r, env) => {
  requireAdmin(c);
  const rows = await sb(env, "integration_settings?select=*") || [];
  return json({ integrations: rows.map(r => ({ ...r, client_secret_configured: !!env[`${r.platform.toUpperCase()}_CLIENT_SECRET`] })) });   // secret tidak pernah dikirim
}, true);

route("PUT", "/api/admin/integrations/([a-z]+)", async (c, req, env, m) => {
  requireAdmin(c);
  const p = platformOf(m[1]), b = await readJson(req), patch = { updated_by: c.user.id, updated_at: new Date().toISOString() };
  for (const k of ["client_id", "redirect_uri", "webhook_url", "app_review_status"]) if (typeof b[k] === "string") patch[k] = b[k].trim().slice(0, 500) || null;
  if (["sandbox", "production"].includes(b.environment)) patch.environment = b.environment;
  if (["disabled", "configured", "under_review", "approved", "enabled"].includes(b.status)) patch.status = b.status;
  if (Array.isArray(b.scopes)) patch.scopes = b.scopes.filter(s => typeof s === "string" && /^[\w.:-]{1,80}$/.test(s)).slice(0, 30);
  for (const k of ["redirect_uri", "webhook_url"]) if (patch[k] && !/^https:\/\//.test(patch[k])) throw new HttpError(400, `${k} harus HTTPS.`);
  if (patch.status === "enabled") {
    const [current] = await sb(env, `integration_settings?platform=eq.${p}&select=client_id,redirect_uri`);
    const clientId = patch.client_id ?? current?.client_id;
    const redirectUri = patch.redirect_uri ?? current?.redirect_uri;
    if (!clientId || !env[`${p.toUpperCase()}_CLIENT_SECRET`]) throw new HttpError(409, "Client ID dan Client Secret wajib dikonfigurasi sebelum integrasi diaktifkan.");
    if (redirectUri && !/^https:\/\//.test(redirectUri)) throw new HttpError(400, "Redirect URI harus HTTPS.");
  }
  await sb(env, `integration_settings?platform=eq.${p}`, { method: "PATCH", body: patch });
  await audit(env, { actor: c.user.id, action: "integration_update", details: { platform: p, fields: Object.keys(patch).filter(k => !k.startsWith("updated")) } });
  return json({ ok: true });
}, true);

// ---------- Entry point ----------
async function handleFetch(req, env) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const ctx = r.auth ? await authenticate(req, env) : null;
    return r.handler(ctx, req, env, m);
  }
  throw new HttpError(404, "Endpoint tidak ditemukan.");
}
export default {
  async fetch(req, env, ctx) {
    try { return await handleFetch(req, env, ctx); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error("unhandled", sanitizeError(e?.message));
      return json({ error: "Terjadi kesalahan server." }, 500);
    }
  },
  queue: (batch, env) => handleQueue(batch, env),
  async scheduled(event, env) {
    if (event.cron === "* * * * *") await enqueueDue(env);
    else { await cleanupMedia(env); await reconcileStuck(env); }
  }
};
