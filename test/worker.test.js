// Pengujian dengan Supabase PALSU (mock) — ini simulasi, BUKAN uji ke database/API sungguhan.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { processDestination, _setAdapterResolver, backoffSeconds } from "../src/queue.js";
import { encryptText, decryptText, signPayload, verifyPayload } from "../src/lib/crypto.js";
import { _resetLimits } from "../src/lib/auth.js";
import { sanitizeError, readJson } from "../src/lib/util.js";

const U_ADMIN = "11111111-1111-4111-8111-111111111111", U_EMP = "22222222-2222-4222-8222-222222222222", U_OFF = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";
const tokens = { adm: U_ADMIN, emp: U_EMP, off: U_OFF };
const profiles = { [U_ADMIN]: { id: U_ADMIN, full_name: "Admin", role: "admin", is_active: true },
  [U_EMP]: { id: U_EMP, full_name: "Emp", role: "employee", is_active: true }, [U_OFF]: { id: U_OFF, full_name: "Off", role: "employee", is_active: false } };
let calls, db;
function reset() { calls = []; db = { integration: [{ platform: "tiktok", status: "disabled" }], accounts: [], dests: [], media: [{ id: MEDIA }] }; _resetLimits(); }
globalThis.fetch = async (input, init = {}) => {
  const url = String(input), method = init.method || "GET"; calls.push(`${method} ${url}`);
  const R = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("/auth/v1/user")) { const t = init.headers.Authorization.slice(7); return tokens[t] ? R({ id: tokens[t], email: `${t}@x.id` }) : R({}, 401); }
  if (url.includes("/auth/v1/token?grant_type=password")) { const b = JSON.parse(init.body); return b.password === "benar-benar-benar" ? R({ access_token: "emp", refresh_token: "r", user: { id: U_EMP, email: b.email } }) : R({ error: "x" }, 400); }
  if (url.includes("/rest/v1/profiles?id=eq.")) return R([profiles[url.match(/eq\.([0-9a-f-]{36})/)[1]]].filter(Boolean));
  if (url.includes("/rest/v1/integration_settings")) return R(db.integration);
  if (url.includes("/rest/v1/social_accounts")) return R(db.accounts);
  if (url.includes("/rest/v1/media_assets")) return R(db.media);
  if (url.includes("/rest/v1/audit_logs")) return R([], 201);
  if (url.includes("/rest/v1/post_destinations") && method === "GET") return R(db.dests);
  if (url.includes("/rest/v1/post_destinations") && method === "PATCH") {
    const id = url.match(/id=eq\.([^&]+)/)?.[1], row = db.dests.find(x => x.id === id);
    if (row && (!url.includes("status=eq.queued") || row.status === "queued")) {
      Object.assign(row, JSON.parse(init.body || "{}"));
      return R(init.headers?.Prefer === "return=representation" ? [row] : []);
    }
    return R([]);
  }
  if (url.includes("/rest/v1/")) return R([]);
  return R({}, 404);
};
const env = { PUBLIC_ORIGIN: "https://socialhub.example.com", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SECRET_KEY: "sec", MEDIA_SIGNING_SECRET: "s", STATE_SECRET: "st",
  PUBLISH_QUEUE: { send: async () => {} } };
const call = (path, { method = "GET", token, body } = {}) => worker.fetch(new Request(`https://app.test${path}`, { method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body && method !== "GET" ? JSON.stringify(body) : undefined }), env, {});

test("health tidak butuh login & tidak membocorkan secret", async () => { reset();
  const r = await call("/api/health"); assert.equal(r.status, 200); const t = await r.text(); assert.ok(!t.includes(env.SUPABASE_SECRET_KEY + "x") && !t.includes('"sec"')); assert.equal(JSON.parse(t).ok, true); });
test("tanpa token -> 401", async () => { reset(); assert.equal((await call("/api/me")).status, 401); });
test("token tidak valid -> 401", async () => { reset(); assert.equal((await call("/api/me", { token: "salah" })).status, 401); });
test("akun nonaktif -> 403", async () => { reset(); assert.equal((await call("/api/me", { token: "off" })).status, 403); });
test("employee tidak bisa akses endpoint admin (semua) -> 403", async () => { reset();
  for (const [m, p] of [["GET", "/api/admin/users"], ["GET", "/api/admin/stats"], ["GET", "/api/admin/audit"], ["GET", "/api/admin/integrations"], ["GET", "/api/admin/accounts"],
    ["POST", "/api/admin/users"], ["PATCH", `/api/admin/users/${U_OFF}/status`], ["PUT", "/api/admin/integrations/tiktok"]])
    assert.equal((await call(p, { method: m, token: "emp", body: {} })).status, 403, `${m} ${p}`); });
test("admin boleh melihat daftar pengguna", async () => { reset(); assert.equal((await call("/api/admin/users", { token: "adm" })).status, 200); });
test("admin tidak bisa menonaktifkan diri sendiri", async () => { reset();
  assert.equal((await call(`/api/admin/users/${U_ADMIN}/status`, { method: "PATCH", token: "adm", body: { active: false } })).status, 400); });
test("login salah -> 401, 5x gagal -> 429", async () => { reset(); let last;
  for (let i = 0; i < 6; i++) last = await call("/api/auth/login", { method: "POST", body: { email: "a@b.id", password: "salah" } });
  assert.equal(last.status, 429); });
test("login benar mengembalikan sesi", async () => { reset();
  const r = await call("/api/auth/login", { method: "POST", body: { email: "emp@x.id", password: "benar-benar-benar" } }); assert.equal(r.status, 200); assert.ok((await r.json()).session.access_token); });
test("buat posting: validasi platform kosong/tak dikenal -> 400", async () => { reset();
  assert.equal((await call("/api/posts", { method: "POST", token: "emp", body: { platforms: [], media_asset_id: MEDIA } })).status, 400);
  assert.equal((await call("/api/posts", { method: "POST", token: "emp", body: { platforms: ["x"], media_asset_id: MEDIA } })).status, 400); });
test("buat posting ke platform yang belum diaktifkan -> 409 (tidak ada status palsu)", async () => { reset();
  const r = await call("/api/posts", { method: "POST", token: "emp", body: { platforms: ["tiktok"], media_asset_id: MEDIA, caption: "hai" } });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, "PLATFORM_NOT_AVAILABLE");
  assert.ok(!calls.some(c => c.startsWith("POST") && c.includes("/rest/v1/posts"))); });
test("buat posting: caption terlalu panjang untuk Threads -> 400", async () => { reset();
  assert.equal((await call("/api/posts", { method: "POST", token: "emp", body: { platforms: ["threads"], media_asset_id: MEDIA, caption: "a".repeat(501) } })).status, 400); });
test("upload: MIME bukan video ditolak", async () => { reset();
  assert.equal((await call("/api/uploads", { method: "POST", token: "emp", body: { filename: "a.exe", mime_type: "application/x-msdownload", size_bytes: 10 } })).status, 400);
  assert.equal((await call("/api/uploads", { method: "POST", token: "emp", body: { filename: "a.mp4", mime_type: "video/mp4", size_bytes: 999999999999 } })).status, 400); });
test("media bertanda tangan: tanpa/foto token palsu ditolak", async () => { reset();
  assert.equal((await call(`/api/media/${MEDIA}`)).status, 403); assert.equal((await call(`/api/media/${MEDIA}?t=abc.def`)).status, 403); });
test("connect OAuth ditolak bila integrasi belum diaktifkan admin", async () => { reset();
  assert.equal((await call("/api/social/tiktok/connect", { token: "emp" })).status, 409); });
test("callback OAuth dengan state palsu diarahkan dengan error", async () => { reset();
  const r = await worker.fetch(new Request("https://app.test/api/oauth/tiktok/callback?code=x&state=palsu"), env, {});
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /oauth=invalid_state/); });
test("crypto: AES-GCM roundtrip & state HMAC", async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  assert.equal(await decryptText(await encryptText("rahasia", key), key), "rahasia");
  const t = await signPayload("k", { a: 1, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await verifyPayload("k", t)).a, 1); assert.equal(await verifyPayload("lain", t), null);
  assert.equal(await verifyPayload("k", await signPayload("k", { exp: 1 })), null); });
test("sanitizeError menyembunyikan token", () => assert.ok(!sanitizeError("gagal access_token=abcdefghijklmnop123").includes("abcdefghij")));
test("backoff eksponensial dibatasi", () => { assert.deepEqual([1, 2, 3, 4, 5].map(backoffSeconds), [30, 60, 120, 240, 480]); assert.equal(backoffSeconds(20), 3600); });

// Antrean: logika retry/idempotensi memakai adapter MOCK (jelas simulasi)
test("antrean: sudah published -> dilewati (tidak publikasi ganda)", async () => { reset();
  db.dests = [{ id: "d", status: "published", post_id: "p" }]; _setAdapterResolver(() => { throw new Error("tidak boleh dipanggil"); });
  assert.equal(await processDestination(env, "d", "https://app.test", null), "skipped"); _setAdapterResolver(null); });
test("antrean: akun tidak terhubung -> gagal permanen dengan pesan jelas", async () => { reset();
  db.dests = [{ id: "d", status: "queued", post_id: "p", user_id: U_EMP, platform: "tiktok", attempts: 0, posts: {} }];
  _setAdapterResolver(() => ({ publish: async () => ({}) }));
  assert.equal(await processDestination(env, "d", "https://app.test", null), "failed");
  assert.ok(calls.some(c => c.startsWith("PATCH") && c.includes("post_destinations"))); _setAdapterResolver(null); });
test("adapter asli menolak publish (belum diverifikasi), tidak pura-pura berhasil", async () => {
  const { adapters } = await import("../src/providers/index.js");
  for (const a of Object.values(adapters)) await assert.rejects(() => a.publish({}), e => e.code === "ADAPTER_NOT_VERIFIED" && e.permanent); });

test("callback OAuth mengarahkan ke halaman perantara untuk kembali ke APK", async () => { reset();
  const r = await worker.fetch(new Request("https://app.test/api/oauth/tiktok/callback?code=x&state=palsu"), env, {});
  assert.match(r.headers.get("location"), /^https:\/\/socialhub\.example\.com\/oauth-done\.html\?/); });

test("JSON API menolak array dan nilai primitif", async () => {
  for (const body of ["[]", "null", "123", '"teks"']) {
    await assert.rejects(() => readJson(new Request("https://app.test/api", { method: "POST", body })),
      e => e.status === 400);
  }
});
test("antrean memakai atomic claim sehingga dua consumer tidak memproses destination yang sama", async () => { reset();
  db.dests = [{ id: "race", status: "queued", post_id: "p", user_id: U_EMP, platform: "tiktok", attempts: 0, posts: {} }];
  _setAdapterResolver(() => ({ publish: async () => ({}) }));
  const results = await Promise.all([
    processDestination(env, "race", null, null),
    processDestination(env, "race", null, null)
  ]);
  assert.equal(results.filter(x => x === "failed").length, 1);
  assert.equal(results.filter(x => x === "skipped").length, 1);
  _setAdapterResolver(null);
});

test("endpoint reset password membutuhkan sesi dan menerima password baru yang kuat", async () => { reset();
  const r = await call("/api/auth/password", { method: "POST", token: "emp", body: { password: "password-baru-aman-2026" } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});
