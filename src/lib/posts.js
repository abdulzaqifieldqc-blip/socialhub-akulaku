import { sb } from "./supabase.js";

// Hitung ulang status induk posting dari status tujuan platform.
export async function recomputePostStatus(env, postId) {
  const dests = await sb(env, `post_destinations?post_id=eq.${postId}&select=status`);
  const s = (dests || []).map(d => d.status);
  if (!s.length) return;
  let status;
  if (s.some(x => x === "processing")) status = "processing";
  else if (s.some(x => x === "queued")) status = "queued";
  else if (s.some(x => x === "needs_reconnect")) status = "needs_reconnect";
  else if (s.every(x => x === "cancelled")) status = "cancelled";
  else if (s.every(x => x === "published")) status = "published";
  else if (s.every(x => x === "failed")) status = "failed";
  else status = "partial"; // campuran berhasil/gagal: lihat status per platform
  await sb(env, `posts?id=eq.${postId}`, { method: "PATCH", body: { status, updated_at: new Date().toISOString() } });
}
