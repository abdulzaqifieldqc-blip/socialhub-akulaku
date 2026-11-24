const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));

async function aesKey(keyB64) {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY harus 32 byte (base64).");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptText(plain, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(plain));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64(out);
}
export async function decryptText(blob, keyB64) {
  const all = unb64(blob);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(keyB64), all.slice(12));
  return dec.decode(pt);
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function hmacSign(secret, text) {
  return b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(text)));
}
export async function hmacVerify(secret, text, sig) {
  try { return await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(text)); }
  catch { return false; }
}
// Token bertanda tangan sederhana: base64url(payload).signature
export async function signPayload(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmacSign(secret, body)}`;
}
export async function verifyPayload(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !(await hmacVerify(secret, body, sig))) return null;
  try {
    const p = JSON.parse(dec.decode(unb64url(body)));
    return p.exp && p.exp < Date.now() / 1000 ? null : p;
  } catch { return null; }
}
