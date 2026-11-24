import { HttpError, sanitizeError } from "./util.js";

// Kunci format baru (sb_secret_/sb_publishable_) bukan JWT: kirim hanya lewat header apikey.
function keyHeaders(key) { return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` }; }
function need(env, k) { if (!env[k]) throw new HttpError(500, `Konfigurasi server belum lengkap: ${k}.`, "CONFIG_MISSING"); return env[k]; }

// Akses database dengan kunci server-side (SUPABASE_SECRET_KEY). Otorisasi dicek di kode Worker.
export async function sb(env, path, { method = "GET", body, prefer, headers = {} } = {}) {
  const key = need(env, "SUPABASE_SECRET_KEY");
  const res = await fetch(`${need(env, "SUPABASE_URL")}/rest/v1/${path}`, {
    method,
    headers: { ...keyHeaders(key), "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("supabase_rest_error", res.status, sanitizeError(t));
    throw new HttpError(res.status === 409 ? 409 : 500, res.status === 409 ? "Data sudah ada." : "Kesalahan database.", "DB_ERROR");
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
export async function sbCount(env, path) {
  const key = need(env, "SUPABASE_SECRET_KEY");
  const res = await fetch(`${need(env, "SUPABASE_URL")}/rest/v1/${path}`, {
    method: "HEAD", headers: { ...keyHeaders(key), Prefer: "count=exact" }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("supabase_count_error", res.status, sanitizeError(t));
    throw new HttpError(500, "Gagal membaca statistik database.", "DB_COUNT_ERROR");
  }
  const range = res.headers.get("content-range") || "*/0";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}
export async function authAdmin(env, path, { method = "GET", body } = {}) {
  const key = need(env, "SUPABASE_SECRET_KEY");
  const res = await fetch(`${need(env, "SUPABASE_URL")}/auth/v1/admin/${path}`, {
    method, headers: { ...keyHeaders(key), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 422 ? 422 : 400, data.msg || data.message || "Permintaan auth gagal.", "AUTH_ADMIN_ERROR");
  return data;
}
export async function authPublic(env, path, { method = "POST", body, token } = {}) {
  const res = await fetch(`${need(env, "SUPABASE_URL")}/auth/v1/${path}`, {
    method,
    headers: { apikey: need(env, "SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
export async function audit(env, { actor = null, target = null, action, details = {} }) {
  try {
    await sb(env, "audit_logs", { method: "POST", body: { actor_user_id: actor, target_user_id: target, action, details } });
  } catch (e) { console.error("audit_failed", action); }   // audit gagal tidak boleh menjatuhkan permintaan
}

// Panggil fungsi database (RPC). Mengembalikan { ok, status, data }; TIDAK melempar saat fungsi belum ada (404),
// agar pemanggil bisa memakai jalur cadangan.
export async function sbRpc(env, name, args) {
  const key = need(env, "SUPABASE_SECRET_KEY");
  const res = await fetch(`${need(env, "SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { ...keyHeaders(key), "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const text = await res.text().catch(() => "");
  if (!res.ok && res.status !== 404) console.error("supabase_rpc_error", name, res.status, sanitizeError(text));
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, data };
}
