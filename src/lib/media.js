import { signPayload, verifyPayload } from "./crypto.js";
import { HttpError } from "./util.js";

export const ALLOWED_MIMES = ["video/mp4", "video/quicktime"];

export async function signedMediaUrl(env, origin, mediaId, ttlSeconds = 3600) {
  if (!env.MEDIA_SIGNING_SECRET) throw new HttpError(500, "Konfigurasi server belum lengkap: MEDIA_SIGNING_SECRET.", "CONFIG_MISSING");
  const t = await signPayload(env.MEDIA_SIGNING_SECRET, { m: mediaId, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  return `${origin}/api/media/${mediaId}?t=${encodeURIComponent(t)}`;
}
export async function checkMediaToken(env, mediaId, token) {
  const p = env.MEDIA_SIGNING_SECRET ? await verifyPayload(env.MEDIA_SIGNING_SECRET, token) : null;
  return !!p && p.m === mediaId;
}
// Cek file benar-benar MP4/MOV (kotak "ftyp" di byte 4-8), bukan sekadar nama/MIME dari klien.
export async function looksLikeMp4(bucket, key) {
  const o = await bucket.get(key, { range: { offset: 0, length: 12 } });
  if (!o) return false;
  const b = new Uint8Array(await o.arrayBuffer());
  return b.length >= 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === "ftyp";
}
