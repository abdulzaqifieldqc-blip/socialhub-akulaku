// Tes ketahanan dengan Supabase PALSU — simulasi, bukan uji nyata.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { reconcileStuck } from "../src/queue.js";
import { recomputePostStatus } from "../src/lib/posts.js";
import { _resetLimits } from "../src/lib/auth.js";

const EMP = "22222222-2222-4222-8222-222222222222", MEDIA = "44444444-4444-4444-8444-444444444444", ACCT = "66666666-6666-4666-8666-666666666666";
let calls, bodies, stuck, dests, uploadedAt;
const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input), method = init.method || "GET"; calls.push(`${method} ${url}`); if (init.body) bodies.push({ url, method, body: JSON.parse(init.body) });
  if (url.includes("/auth/v1/user")) return R({ id: EMP, email: "e@x.id" });
  if (url.includes("/rest/v1/rpc/")) return R("55555555-5555-4555-8555-555555555555");
  if (url.includes("/rest/v1/profiles")) return R([{ id: EMP, full_name: "E", role: "employee", is_active: true }]);
  if (url.includes("/rest/v1/media_assets")) return R([{ id: MEDIA, size_bytes: 10, mime_type: "video/mp4", uploaded_at: uploadedAt }]);
  if (url.includes("/rest/v1/integration_settings")) return R([{ platform: "tiktok", status: "enabled" }]);
  if (url.includes("/rest/v1/social_accounts")) return R([{ id: ACCT, platform: "tiktok" }]);
  if (url.includes("/rest/v1/post_destinations") && method === "GET") return R(url.includes("status=eq.processing") ? stuck : dests);
  if (url.includes("/rest/v1/post_destinations") && method === "PATCH") return R([{ id: "d1" }]);
  return R([], 200);
};
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SECRET_KEY: "sec", MEDIA_SIGNING_SECRET: "s", STATE_SECRET: "st",
  PUBLISH_QUEUE: { send: async () => { calls.push("QUEUE_SEND"); } } };
const reset = () => { calls = []; bodies = []; stuck = []; dests = []; uploadedAt = new Date(Date.now() - 3600000).toISOString(); _resetLimits(); };

test("rekonsiliasi: destination tersangkut 'processing' ditandai tidak pasti, TIDAK dicoba ulang otomatis", async () => { reset();
  stuck = [{ id: "d1", post_id: "p1", user_id: EMP, platform: "tiktok" }]; dests = [{ status: "failed" }];
  assert.equal(await reconcileStuck(env, 15), 1);
  const patch = bodies.find(b => b.url.includes("post_destinations?id=eq.d1"));
  assert.equal(patch.body.status, "failed"); assert.equal(patch.body.error_code, "AMBIGUOUS_PROCESSING");
  assert.ok(!calls.includes("QUEUE_SEND")); assert.ok(!bodies.some(b => b.body?.status === "queued")); });
test("rekonsiliasi: tidak ada yang tersangkut -> tidak ada perubahan", async () => { reset();
  assert.equal(await reconcileStuck(env, 15), 0); assert.ok(!bodies.length); });
test("status induk untuk needs_reconnect memakai nilai yang diizinkan CHECK database ('blocked')", async () => { reset();
  dests = [{ status: "needs_reconnect" }, { status: "published" }]; await recomputePostStatus(env, "p1");
  const p = bodies.find(b => b.url.includes("/rest/v1/posts?id=eq.p1")); assert.equal(p.body.status, "blocked");
  assert.ok(["draft", "queued", "processing", "partial", "published", "failed", "blocked", "cancelled"].includes(p.body.status)); });
const mk = (hoursAhead) => { _resetLimits(); return worker.fetch(new Request("https://app.test/api/posts", { method: "POST", headers: { Authorization: "Bearer e", "content-type": "application/json" },
  body: JSON.stringify({ platforms: ["tiktok"], media_asset_id: MEDIA, caption: "x", scheduled_at: new Date(Date.now() + hoursAhead * 3600000).toISOString() }) }), env, {}); };
test("jadwal melewati masa simpan media (24 jam) ditolak", async () => { reset();
  const r = await mk(48); assert.equal(r.status, 400); assert.equal((await r.json()).code, "SCHEDULE_BEYOND_RETENTION"); });
test("jadwal dalam masa simpan media diterima", async () => { reset(); assert.equal((await mk(5)).status, 201); });
