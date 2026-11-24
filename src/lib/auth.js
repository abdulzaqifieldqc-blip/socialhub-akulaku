import { HttpError, clientIp } from "./util.js";
import { sb, authPublic } from "./supabase.js";

export async function authenticate(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "Silakan login.");
  const r = await authPublic(env, "user", { method: "GET", token });
  if (!r.ok || !r.data?.id) throw new HttpError(401, "Sesi tidak valid atau kedaluwarsa.");
  const rows = await sb(env, `profiles?id=eq.${r.data.id}&select=id,full_name,role,is_active`);
  const profile = rows?.[0];
  if (!profile || !profile.is_active) throw new HttpError(403, "Akun belum aktif atau dinonaktifkan.");
  return { user: { id: r.data.id, email: r.data.email }, profile };
}
export function requireAdmin(ctx) {
  if (!["admin", "owner"].includes(ctx.profile.role)) throw new HttpError(403, "Akses khusus admin.");
}

// Pembatas percobaan login (best-effort per isolate). Tambahkan juga Cloudflare Rate Limiting rule.
const fails = new Map();
export function checkLoginLimit(req, email) {
  const k = `${clientIp(req)}|${String(email).toLowerCase()}`, now = Date.now();
  const rec = fails.get(k);
  if (rec && now - rec.t < 15 * 60 * 1000 && rec.n >= 5) throw new HttpError(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
  return k;
}
export function noteLoginFail(k) {
  const now = Date.now(), rec = fails.get(k);
  fails.set(k, !rec || now - rec.t > 15 * 60 * 1000 ? { n: 1, t: now } : { n: rec.n + 1, t: rec.t });
  if (fails.size > 5000) fails.clear();
}
export const noteLoginOk = (k) => fails.delete(k);
export const _resetLimits = () => fails.clear();
