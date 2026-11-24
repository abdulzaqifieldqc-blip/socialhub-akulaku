// Server uji lokal: file statis + Worker dengan Supabase PALSU. Hanya untuk melihat tampilan; BUKAN data nyata.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import worker from "../src/worker.js";
const A = "11111111-1111-4111-8111-111111111111", E = "22222222-2222-4222-8222-222222222222";
const prof = { [A]: { id: A, full_name: "Admin Akulaku", role: "admin", is_active: true, email: "admin@x.id" }, [E]: { id: E, full_name: "Budi Karyawan", role: "employee", is_active: true, email: "budi@x.id" } };
const tok = { adm: A, emp: E };
const now = new Date().toISOString();
const dest = [{ id: "d1", post_id: "p1", user_id: E, platform: "tiktok", status: "published", published_at: now, created_at: now }, { id: "d2", post_id: "p1", user_id: E, platform: "instagram", status: "failed", error_message: "Akun belum terhubung.", created_at: now }];
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const R = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...h } });
  if (u.includes("/auth/v1/user")) { const t = init.headers.Authorization.slice(7); return tok[t] ? R({ id: tok[t], email: prof[tok[t]].email }) : R({}, 401); }
  if (u.includes("/rest/v1/profiles?id=eq.")) return R([prof[u.match(/eq\.([0-9a-f-]{36})/)[1]]]);
  if (u.includes("/rest/v1/profiles")) return R(Object.values(prof));
  if (init.method === "HEAD") return new Response(null, { headers: { "content-range": "0-0/7" } });
  if (u.includes("/rest/v1/integration_settings")) return R(["tiktok", "instagram", "facebook", "threads"].map(p => ({ platform: p, status: p === "tiktok" ? "enabled" : "disabled", scopes: [], environment: "sandbox" })));
  if (u.includes("/rest/v1/social_accounts")) return R([{ id: "s1", user_id: E, platform: "tiktok", username: "budi", status: "connected", connected_at: now }]);
  if (u.includes("/rest/v1/post_destinations")) return R(dest);
  if (u.includes("/rest/v1/posts")) return R([{ id: "p1", caption: "Promo akhir tahun Akulaku", status: "partial", created_at: now, post_destinations: dest }]);
  if (u.includes("/rest/v1/audit_logs")) return R([{ id: "1", action: "login", actor_user_id: E, created_at: now }]);
  return R([]);
};
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SUPABASE_SECRET_KEY: "sec", TIKTOK_CLIENT_SECRET: "x" };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, "http://localhost:8787");
  if (url.pathname.startsWith("/api/")) {
    const body = ["GET", "HEAD"].includes(rq.method) ? undefined : await new Promise(r => { let b = ""; rq.on("data", c => b += c); rq.on("end", () => r(b)); });
    const r = await worker.fetch(new Request(url, { method: rq.method, headers: rq.headers, body }), env, {});
    rs.writeHead(r.status, Object.fromEntries(r.headers)); return rs.end(Buffer.from(await r.arrayBuffer()));
  }
  let f = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end(); }
  let data = fs.readFileSync(f);
  if (f.endsWith("index.html") && url.searchParams.get("as")) data = Buffer.from(data.toString().replace("</head>", `<script>localStorage.sh_at="${url.searchParams.get("as")}"</script></head>`));
  rs.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); rs.end(data);
}).listen(8787, () => console.log("dev server on 8787"));
