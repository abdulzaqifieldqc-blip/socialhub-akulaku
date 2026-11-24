// Tes pembuatan posting atomik (RPC) dengan Supabase PALSU — simulasi, bukan uji database nyata.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetLimits } from "../src/lib/auth.js";

const EMP = "22222222-2222-4222-8222-222222222222", MEDIA = "44444444-4444-4444-8444-444444444444", ACCT = "66666666-6666-4666-8666-666666666666";
const NEW = "55555555-5555-4555-8555-555555555555";
let calls, mode, rpcBody;
const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input), method = init.method || "GET"; calls.push(`${method} ${url}`);
  if (url.includes("/auth/v1/user")) return R({ id: EMP, email: "e@x.id" });
  if (url.includes("/rest/v1/rpc/create_post_with_destinations")) { rpcBody = JSON.parse(init.body);
    return mode === "missing" ? R({ code: "PGRST202" }, 404) : mode === "fail" ? R({ message: "x" }, 500) : R(NEW); }
  if (url.includes("/rest/v1/profiles")) return R([{ id: EMP, full_name: "E", role: "employee", is_active: true }]);
  if (url.includes("/rest/v1/media_assets")) return R([{ id: MEDIA, size_bytes: 10, mime_type: "video/mp4" }]);
  if (url.includes("/rest/v1/integration_settings")) return R([{ platform: "tiktok", status: "enabled" }]);
  if (url.includes("/rest/v1/social_accounts")) return R([{ id: ACCT, platform: "tiktok" }]);
  if (url.includes("/rest/v1/posts") && method === "POST") return R([{ id: NEW, status: "queued" }], 201);
  if (url.includes("/rest/v1/")) return R([], 201);
  return R({}, 404);
};
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SECRET_KEY: "sec", MEDIA_SIGNING_SECRET: "s", STATE_SECRET: "st" };
const mk = () => { calls = []; rpcBody = null; _resetLimits();
  return worker.fetch(new Request("https://app.test/api/posts", { method: "POST", headers: { Authorization: "Bearer emp", "content-type": "application/json" },
    body: JSON.stringify({ platforms: ["tiktok"], media_asset_id: MEDIA, caption: "hai" }) }), env, {}); };
const wrote = (tbl) => calls.some(c => c.startsWith("POST") && c.endsWith(`/rest/v1/${tbl}`));

test("posting dibuat lewat satu RPC atomik tanpa insert terpisah", async () => { mode = "ok";
  const r = await mk(); assert.equal(r.status, 201); assert.equal((await r.json()).post.id, NEW);
  assert.equal(rpcBody.p_user, EMP); assert.deepEqual(rpcBody.p_platforms, ["tiktok"]); assert.equal(rpcBody.p_accounts.tiktok, ACCT);
  assert.ok(!wrote("posts") && !wrote("post_destinations")); });
test("RPC belum ada (404) -> jalur cadangan membuat post + destination", async () => { mode = "missing";
  const r = await mk(); assert.equal(r.status, 201); assert.ok(wrote("posts") && wrote("post_destinations")); });
test("RPC gagal (500) -> 500 dan tidak ada insert cadangan (tidak ada data setengah jadi)", async () => { mode = "fail";
  assert.equal((await mk()).status, 500); assert.ok(!wrote("posts") && !wrote("post_destinations")); });
