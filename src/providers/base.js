// Kontrak adapter platform. Setiap platform punya file sendiri karena aturan API-nya berbeda.
export class PublishError extends Error {
  constructor(code, message, { permanent = false } = {}) { super(message); this.code = code; this.permanent = permanent; }
}
export const form = (o) => new URLSearchParams(o).toString();
export async function postForm(url, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(params) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new PublishError("OAUTH_EXCHANGE_FAILED", d.error_description || d.error?.message || d.error_message || `HTTP ${r.status}`, { permanent: true });
  return d;
}
export async function getJson(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new PublishError("OAUTH_EXCHANGE_FAILED", d.error?.message || `HTTP ${r.status}`, { permanent: true });
  return d;
}
// Sampai adapter diuji dengan Developer App resmi, publish() menolak secara jujur (bukan pura-pura berhasil).
export function notVerified(platform) {
  throw new PublishError("ADAPTER_NOT_VERIFIED",
    `Adapter ${platform} belum diverifikasi dengan Developer App resmi, publikasi tidak dikirim.`, { permanent: true });
}
export const addSeconds = (s) => (s ? new Date(Date.now() + Number(s) * 1000).toISOString() : null);
