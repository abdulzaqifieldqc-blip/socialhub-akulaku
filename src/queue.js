import { sb, audit } from "./lib/supabase.js";
import { decryptText } from "./lib/crypto.js";
import { sanitizeError } from "./lib/util.js";
import { signedMediaUrl } from "./lib/media.js";
import { recomputePostStatus } from "./lib/posts.js";
import { getAdapter } from "./providers/index.js";

let adapterResolver = getAdapter;                 // dapat diganti saat pengujian
export const _setAdapterResolver = (fn) => { adapterResolver = fn || getAdapter; };

export const backoffSeconds = (attempt) => Math.min(30 * 2 ** (attempt - 1), 3600);

async function fail(env, d, code, message) {
  await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH",
    body: { status: "failed", error_code: code, error_message: sanitizeError(message), updated_at: new Date().toISOString() } });
  await recomputePostStatus(env, d.post_id);
  await audit(env, { actor: null, target: d.user_id, action: "publish_failed", details: { post_id: d.post_id, platform: d.platform, code } });
}

export async function processDestination(env, destinationId, origin, msg) {
  const max = Number(env.MAX_PUBLISH_ATTEMPTS || 5);
  const rows = await sb(env, `post_destinations?id=eq.${destinationId}&select=*,posts(id,caption,media_asset_id,media_assets(id,mime_type,size_bytes,status))`);
  const d = rows?.[0];
  if (!d || ["published", "cancelled", "failed"].includes(d.status)) return "skipped";   // idempotent: tidak publikasi ganda
  const attempt = (d.attempts || 0) + 1;
  await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH", body: { status: "processing", attempts: attempt, updated_at: new Date().toISOString() } });
  await recomputePostStatus(env, d.post_id);
  try {
    const adapter = adapterResolver(d.platform);
    if (!adapter) throw Object.assign(new Error("Platform tidak dikenal."), { code: "UNKNOWN_PLATFORM", permanent: true });
    const [acct] = await sb(env, `social_accounts?user_id=eq.${d.user_id}&platform=eq.${d.platform}&select=id,status,token_expires_at`) || [];
    if (!acct || acct.status !== "connected") throw Object.assign(new Error("Akun sosial belum terhubung."), { code: "ACCOUNT_NOT_CONNECTED", permanent: true });
    const [tok] = await sb(env, `social_account_tokens?social_account_id=eq.${acct.id}&select=access_token_enc,refresh_token_enc`) || [];
    if (!tok?.access_token_enc) throw Object.assign(new Error("Token akun tidak tersedia. Hubungkan ulang akun."), { code: "TOKEN_MISSING", permanent: true });
    const accessToken = await decryptText(tok.access_token_enc, env.TOKEN_ENC_KEY);
    const media = d.posts?.media_assets;
    if (!media || media.status !== "uploaded") throw Object.assign(new Error("Media belum tersedia."), { code: "MEDIA_MISSING", permanent: true });
    const mediaUrl = await signedMediaUrl(env, origin, media.id, 3600);
    const result = await adapter.publish({ env, accessToken, caption: d.posts.caption, mediaUrl, media });
    await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH", body: {
      status: "published", external_post_id: result?.externalId ?? null, published_at: new Date().toISOString(),
      error_code: null, error_message: null, updated_at: new Date().toISOString() } });
    await recomputePostStatus(env, d.post_id);
    await audit(env, { actor: null, target: d.user_id, action: "publish_success", details: { post_id: d.post_id, platform: d.platform } });
    return "published";
  } catch (e) {
    const permanent = e.permanent === true || attempt >= max;
    if (permanent) { await fail(env, d, e.code || "PUBLISH_FAILED", e.message); return "failed"; }
    await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH", body: {
      status: "queued", error_code: e.code || "RETRYING", error_message: sanitizeError(e.message), updated_at: new Date().toISOString() } });
    msg?.retry?.({ delaySeconds: backoffSeconds(attempt) });
    return "retry";
  }
}

export async function handleQueue(batch, env) {
  if (batch.queue.endsWith("-dlq")) {            // pesan yang gagal total: tandai gagal agar terlihat di dashboard
    for (const m of batch.messages) {
      const rows = await sb(env, `post_destinations?id=eq.${m.body.destinationId}&select=*`);
      if (rows?.[0] && !["published", "cancelled"].includes(rows[0].status)) await fail(env, rows[0], "DEAD_LETTER", "Pekerjaan gagal diproses setelah beberapa percobaan.");
      m.ack();
    }
    return;
  }
  for (const m of batch.messages) {
    try {
      const r = await processDestination(env, m.body.destinationId, m.body.origin, m);
      if (r !== "retry") m.ack();
    } catch (e) { console.error("queue_error", sanitizeError(e.message)); m.retry({ delaySeconds: 60 }); }
  }
}

// Cron tiap menit: antrekan posting terjadwal yang sudah jatuh tempo.
export async function enqueueDue(env) {
  const now = new Date().toISOString();
  const due = await sb(env, `post_destinations?status=eq.queued&next_attempt_at=lte.${encodeURIComponent(now)}&select=id`,
    { method: "PATCH", body: { next_attempt_at: null }, prefer: "return=representation" });
  for (const d of due || []) await env.PUBLISH_QUEUE.send({ destinationId: d.id, origin: env.PUBLIC_ORIGIN });
  return (due || []).length;
}

// Cron harian: hapus media > 7 hari, kecuali yang masih dipakai posting queued/processing.
export async function cleanupMedia(env) {
  const days = Number(env.MEDIA_RETENTION_DAYS || 7);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const old = await sb(env, `media_assets?status=eq.uploaded&uploaded_at=lt.${encodeURIComponent(cutoff)}&select=id,object_key&limit=200`);
  let n = 0;
  for (const m of old || []) {
    const inUse = await sb(env, `posts?media_asset_id=eq.${m.id}&status=in.(queued,processing)&select=id&limit=1`);
    if (inUse?.length) continue;
    await env.MEDIA.delete(m.object_key);
    await sb(env, `media_assets?id=eq.${m.id}`, { method: "PATCH", body: { status: "deleted", deleted_at: new Date().toISOString() } });
    n++;
  }
  return n;
}
