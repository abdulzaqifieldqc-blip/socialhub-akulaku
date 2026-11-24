import { sb, audit } from "./lib/supabase.js";
import { decryptText, encryptText } from "./lib/crypto.js";
import { sanitizeError } from "./lib/util.js";
import { signedMediaUrl } from "./lib/media.js";
import { recomputePostStatus } from "./lib/posts.js";
import { getAdapter } from "./providers/index.js";

let adapterResolver = getAdapter;
export const _setAdapterResolver = (fn) => { adapterResolver = fn || getAdapter; };

export const backoffSeconds = (attempt) => Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600);

function publicOrigin(env) {
  let u;
  try { u = new URL(env.PUBLIC_ORIGIN || ""); } catch { throw new Error("PUBLIC_ORIGIN belum dikonfigurasi dengan benar."); }
  if (u.protocol !== "https:" || !u.hostname || u.hostname.endsWith(".invalid") ||
      u.username || u.password || u.pathname !== "/" || u.search || u.hash) {
    throw new Error("PUBLIC_ORIGIN harus berupa origin HTTPS produksi yang valid.");
  }
  return u.origin;
}

async function fail(env, d, code, message, status = "failed") {
  await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH",
    body: { status, error_code: code, error_message: sanitizeError(message), updated_at: new Date().toISOString() } });
  await recomputePostStatus(env, d.post_id);
  await audit(env, { actor: null, target: d.user_id, action: status === "needs_reconnect" ? "publish_needs_reconnect" : "publish_failed",
    details: { post_id: d.post_id, platform: d.platform, code } });
}

async function obtainAccessToken(env, d, acct, tok) {
  if (!tok?.access_token_enc) throw Object.assign(new Error("Token akun tidak tersedia. Hubungkan ulang akun."), { code: "TOKEN_MISSING", permanent: true });
  let accessToken = await decryptText(tok.access_token_enc, env.TOKEN_ENC_KEY);
  const expiry = acct.token_expires_at ? Date.parse(acct.token_expires_at) : NaN;
  if (!Number.isFinite(expiry) || expiry > Date.now() + 5 * 60 * 1000) return accessToken;

  const adapter = adapterResolver(d.platform);
  const clientSecret = env[`${d.platform.toUpperCase()}_CLIENT_SECRET`];
  const [cfg] = await sb(env, `integration_settings?platform=eq.${d.platform}&select=client_id,status`);
  if (cfg?.status !== "enabled" || !cfg.client_id || !clientSecret) {
    throw Object.assign(new Error("Integrasi tidak aktif atau konfigurasi OAuth tidak lengkap."), { code: "INTEGRATION_NOT_READY", permanent: true });
  }
  try {
    const refreshToken = tok.refresh_token_enc ? await decryptText(tok.refresh_token_enc, env.TOKEN_ENC_KEY) : null;
    if (typeof adapter?.refresh !== "function") throw new Error("Provider tidak mendukung refresh token.");
    const refreshed = await adapter.refresh({ accessToken, refreshToken, clientId: cfg.client_id, clientSecret, env });
    if (!refreshed?.accessToken || !refreshed?.expiresAt) throw new Error("Provider tidak mengembalikan token baru yang valid.");
    await sb(env, `social_account_tokens?social_account_id=eq.${acct.id}`, { method: "PATCH", body: {
      access_token_enc: await encryptText(refreshed.accessToken, env.TOKEN_ENC_KEY),
      ...(refreshed.refreshToken ? { refresh_token_enc: await encryptText(refreshed.refreshToken, env.TOKEN_ENC_KEY) } : {}),
      updated_at: new Date().toISOString()
    }});
    await sb(env, `social_accounts?id=eq.${acct.id}`, { method: "PATCH", body: { token_expires_at: refreshed.expiresAt } });
    return refreshed.accessToken;
  } catch (e) {
    throw Object.assign(new Error("Token sosial kedaluwarsa dan tidak dapat diperbarui. Hubungkan ulang akun."), {
      code: "TOKEN_REFRESH_REQUIRED", permanent: true, needsReconnect: true
    });
  }
}

export async function processDestination(env, destinationId, _origin, msg) {
  const max = Math.max(1, Number(env.MAX_PUBLISH_ATTEMPTS || 5));
  const rows = await sb(env, `post_destinations?id=eq.${destinationId}&select=*,posts(id,caption,media_asset_id,media_assets(id,mime_type,size_bytes,status))`);
  const candidate = rows?.[0];
  if (!candidate || candidate.status !== "queued") return "skipped";

  // Atomic compare-and-set: hanya satu consumer yang dapat mengubah queued -> processing.
  const claimed = await sb(env, `post_destinations?id=eq.${candidate.id}&status=eq.queued`,
    { method: "PATCH", body: { status: "processing", attempts: (candidate.attempts || 0) + 1, next_attempt_at: null, updated_at: new Date().toISOString() },
      prefer: "return=representation" });
  const d = claimed?.[0];
  if (!d) return "skipped";
  const attempt = d.attempts || 1;
  await recomputePostStatus(env, d.post_id);

  try {
    const [profile] = await sb(env, `profiles?id=eq.${d.user_id}&select=id,is_active`);
    if (!profile?.is_active) {
      await fail(env, d, "USER_INACTIVE", "Akun karyawan sudah dinonaktifkan.", "cancelled");
      return "cancelled";
    }
    const adapter = adapterResolver(d.platform);
    if (!adapter) throw Object.assign(new Error("Platform tidak dikenal."), { code: "UNKNOWN_PLATFORM", permanent: true });
    const [acct] = await sb(env, `social_accounts?id=eq.${d.social_account_id}&user_id=eq.${d.user_id}&select=id,status,token_expires_at`);
    if (!acct || acct.status !== "connected") throw Object.assign(new Error("Akun sosial belum terhubung."), { code: "ACCOUNT_NOT_CONNECTED", permanent: true });
    const [tok] = await sb(env, `social_account_tokens?social_account_id=eq.${acct.id}&select=access_token_enc,refresh_token_enc`);
    let accessToken;
    try {
      accessToken = await obtainAccessToken(env, d, acct, tok);
    } catch (e) {
      if (e.needsReconnect) { await fail(env, d, e.code, e.message, "needs_reconnect"); return "needs_reconnect"; }
      throw e;
    }
    const media = d.posts?.media_assets;
    if (!media || media.status !== "uploaded") throw Object.assign(new Error("Media belum tersedia."), { code: "MEDIA_MISSING", permanent: true });
    const origin = publicOrigin(env);
    const mediaUrl = await signedMediaUrl(env, origin, media.id, 6 * 3600);
    const result = await adapter.publish({ env, accessToken, caption: d.posts.caption, mediaUrl, media });
    await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH", body: {
      status: "published", external_post_id: result?.externalId ?? null, published_at: new Date().toISOString(),
      error_code: null, error_message: null, next_attempt_at: null, updated_at: new Date().toISOString() } });
    await recomputePostStatus(env, d.post_id);
    await audit(env, { actor: null, target: d.user_id, action: "publish_success", details: { post_id: d.post_id, platform: d.platform } });
    return "published";
  } catch (e) {
    const permanent = e.permanent === true || attempt >= max;
    if (permanent) { await fail(env, d, e.code || "PUBLISH_FAILED", e.message); return "failed"; }
    const retryAt = new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString();
    await sb(env, `post_destinations?id=eq.${d.id}`, { method: "PATCH", body: {
      status: "queued", next_attempt_at: retryAt, error_code: e.code || "RETRYING",
      error_message: sanitizeError(e.message), updated_at: new Date().toISOString() } });
    await recomputePostStatus(env, d.post_id);
    // Ack pesan ini; dispatcher berbasis next_attempt_at akan mengirim ulang setelah backoff.
    return "deferred";
  }
}

export async function handleQueue(batch, env) {
  if (batch.queue.endsWith("-dlq")) {
    for (const m of batch.messages) {
      const rows = await sb(env, `post_destinations?id=eq.${m.body.destinationId}&select=*`);
      if (rows?.[0] && !["published", "cancelled", "needs_reconnect"].includes(rows[0].status))
        await fail(env, rows[0], "DEAD_LETTER", "Pekerjaan gagal diproses setelah beberapa percobaan.");
      m.ack();
    }
    return;
  }
  for (const m of batch.messages) {
    try {
      const r = await processDestination(env, m.body.destinationId, null, m);
      if (r !== "retry") m.ack();
    } catch (e) {
      console.error("queue_error", sanitizeError(e.message));
      m.retry({ delaySeconds: 60 });
    }
  }
}

// Ambil jadwal secara compare-and-set. Jika pengiriman Queue gagal, kembalikan jadwal
// dengan waktu retry sehingga pekerjaan tidak hilang.
export async function enqueueDue(env) {
  const now = new Date().toISOString();
  const due = await sb(env, `post_destinations?status=eq.queued&next_attempt_at=lte.${encodeURIComponent(now)}&select=id,next_attempt_at&limit=100`);
  let sent = 0;
  for (const item of due || []) {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const claim = await sb(env, `post_destinations?id=eq.${item.id}&status=eq.queued&next_attempt_at=eq.${encodeURIComponent(item.next_attempt_at)}`,
      { method: "PATCH", body: { next_attempt_at: leaseUntil, updated_at: now }, prefer: "return=representation" });
    if (!claim?.length) continue;
    try {
      await env.PUBLISH_QUEUE.send({ destinationId: item.id });
      sent++;
    } catch (e) {
      const retryAt = new Date(Date.now() + 60 * 1000).toISOString();
      await sb(env, `post_destinations?id=eq.${item.id}&status=eq.queued`, { method: "PATCH",
        body: { next_attempt_at: retryAt, error_code: "QUEUE_DISPATCH_FAILED", error_message: sanitizeError(e.message), updated_at: new Date().toISOString() } });
    }
  }
  return sent;
}

// Media sementara: hapus setelah 24 jam, kecuali masih diperlukan oleh pekerjaan aktif.
export async function cleanupMedia(env) {
  const hours = Math.min(24, Math.max(1, Number(env.MEDIA_RETENTION_HOURS || 24)));
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
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

// Rekonsiliasi: destination yang tersangkut "processing" (Worker berhenti di tengah jalan). Provider mungkin SUDAH menerima posting,
// jadi TIDAK dicoba ulang otomatis (mencegah publikasi ganda). Ditandai gagal-tidak-pasti agar dicek manual di platform.
export async function reconcileStuck(env, minutes = 15) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  const stuck = await sb(env, `post_destinations?status=eq.processing&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,post_id,user_id,platform&limit=100`);
  let n = 0;
  for (const d of stuck || []) {
    const upd = await sb(env, `post_destinations?id=eq.${d.id}&status=eq.processing&updated_at=lt.${encodeURIComponent(cutoff)}`, { method: "PATCH", prefer: "return=representation",
      body: { status: "failed", error_code: "AMBIGUOUS_PROCESSING",
        error_message: "Proses terhenti sehingga status publikasi tidak pasti. Periksa langsung di platform sebelum mengulang.", updated_at: new Date().toISOString() } });
    if (!upd?.length) continue;
    await recomputePostStatus(env, d.post_id);
    await audit(env, { actor: null, target: d.user_id, action: "publish_ambiguous", details: { post_id: d.post_id, platform: d.platform } });
    n++;
  }
  return n;
}
