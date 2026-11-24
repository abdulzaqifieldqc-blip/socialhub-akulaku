export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "no-store"
};
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEC_HEADERS, ...extra }
  });
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PLATFORMS = ["tiktok", "instagram", "facebook", "threads"];
export function mustUuid(v, name = "id") {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, `${name} tidak valid.`);
  return v.toLowerCase();
}
export async function readJson(req, maxBytes = 64 * 1024) {
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "Permintaan terlalu besar.");
  let value;
  try { value = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "JSON tidak valid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "JSON harus berupa objek.");
  return value;
}
// Hapus bagian yang mirip token/secret sebelum disimpan atau ditampilkan.
export function sanitizeError(msg) {
  return String(msg ?? "Kesalahan tidak diketahui")
    .replace(/(access_token|refresh_token|client_secret|authorization|bearer|apikey)["'=:\s]+[A-Za-z0-9._~+\/-]{8,}/gi, "$1=[disembunyikan]")
    .slice(0, 300);
}
export function clientIp(req) { return req.headers.get("CF-Connecting-IP") || "unknown"; }
