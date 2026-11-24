// SocialHub Akulaku — frontend (tanpa framework, tanpa inline script/style; kompatibel CSP ketat)
const $app = document.getElementById("app"), $toast = document.getElementById("toast");
const PLAT = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", threads: "Threads" };
const STATUS = { draft: "Draft", queued: "Antre", pending: "Menunggu", processing: "Diproses", published: "Terbit", failed: "Gagal", cancelled: "Dibatalkan",
  partial: "Sebagian", blocked: "Diblokir", needs_reconnect: "Hubungkan ulang", connected: "Terhubung", disconnected: "Belum terhubung", expired: "Kedaluwarsa",
  enabled: "Aktif", disabled: "Nonaktif", configured: "Dikonfigurasi", under_review: "Dalam review", approved: "Disetujui" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const fmt = (d) => d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
let me = null;
const toast = (m) => { $toast.textContent = m; $toast.classList.add("show"); setTimeout(() => $toast.classList.remove("show"), 3200); };

// ---------- API ----------
async function refresh() {
  const rt = store.get("sh_rt"); if (!rt) return false;
  const r = await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) });
  if (!r.ok) return false;
  const d = await r.json(); store.set("sh_at", d.session.access_token); store.set("sh_rt", d.session.refresh_token); return true;
}
async function api(path, { method = "GET", body, retry = true } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(store.get("sh_at") ? { Authorization: `Bearer ${store.get("sh_at")}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("Tidak ada koneksi internet. Periksa jaringan Anda."); }
  if (res.status === 401 && retry && await refresh()) return api(path, { method, body, retry: false });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logoutLocal(); throw new Error(data.error || "Sesi berakhir."); }
  if (!res.ok) throw Object.assign(new Error(data.error || "Terjadi kesalahan."), { code: data.code });
  return data;
}
const logoutLocal = () => { store.del("sh_at"); store.del("sh_rt"); me = null; };

// ---------- Layout ----------
const isAdmin = () => me && ["admin", "owner"].includes(me.role);
function shell(inner, route) {
  const nav = isAdmin() ? [["#/admin", "📊", "Ringkasan"], ["#/admin/employees", "👥", "Karyawan"], ["#/admin/pubs", "📋", "Publikasi"], ["#/admin/more", "⚙️", "Lainnya"]]
    : [["#/", "🏠", "Beranda"], ["#/new", "➕", "Posting"], ["#/history", "🕘", "Riwayat"], ["#/accounts", "🔗", "Akun"]];
  $app.innerHTML = `<header class="top"><img src="/emblem.png" alt=""><div class="t">Social<b>Hub</b> Akulaku</div><div class="sp"></div><button id="lo">Keluar</button></header>
  <main>${inner}</main><nav class="nav">${nav.map(([h, i, l]) => `<a href="${h}" class="${route === h || (h !== "#/" && h !== "#/admin" && route.startsWith(h)) ? "on" : ""}"><i>${i}</i>${l}</a>`).join("")}</nav>`;
  document.getElementById("lo").onclick = async () => { try { await api("/api/auth/logout", { method: "POST" }); } catch {} logoutLocal(); location.hash = "#/login"; render(); };
}
const loading = () => `<div class="loader">Memuat…</div>`;

// ---------- Login ----------
function loginView(mode = "login") {
  $app.innerHTML = `<div class="hero"><img src="/logo.png" alt="SocialHub Akulaku — One App. All Your Socials."></div>
  <div class="auth"><div class="card"><h2>${mode === "login" ? "Masuk" : "Reset password"}</h2>
  <form id="f"><label>Email<input id="em" type="email" required autocomplete="email" inputmode="email"></label>
  ${mode === "login" ? `<label>Password<input id="pw" type="password" required autocomplete="current-password"></label>` : ""}
  <button class="btn red wide mt" id="go">${mode === "login" ? "Masuk" : "Kirim tautan reset"}</button><p id="m" class="msg"></p></form>
  <p class="small"><a href="#" id="sw">${mode === "login" ? "Lupa password?" : "Kembali ke login"}</a></p>
  <p class="small muted">Akun karyawan dibuat oleh admin. Hubungi admin bila belum punya akun.</p></div></div>`;
  document.getElementById("sw").onclick = (e) => { e.preventDefault(); loginView(mode === "login" ? "forgot" : "login"); };
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault(); const m = document.getElementById("m"), b = document.getElementById("go"); b.disabled = true; m.className = "msg"; m.textContent = "Memproses…";
    try {
      if (mode === "login") {
        const d = await api("/api/auth/login", { method: "POST", body: { email: document.getElementById("em").value, password: document.getElementById("pw").value }, retry: false });
        store.set("sh_at", d.session.access_token); store.set("sh_rt", d.session.refresh_token); me = d.user; location.hash = isAdmin() ? "#/admin" : "#/"; render();
      } else { const d = await api("/api/auth/forgot", { method: "POST", body: { email: document.getElementById("em").value } }); m.className = "msg ok"; m.textContent = d.message; b.disabled = false; }
    } catch (err) { m.className = "msg err"; m.textContent = err.message; b.disabled = false; }
  };
}

// ---------- Karyawan ----------
async function homeView() {
  shell(loading(), "#/");
  const d = await api("/api/dashboard"), t = d.totals;
  const conn = d.accounts.filter(a => a.status === "connected").length;
  shell(`<h1>Halo, ${esc(me.full_name || me.email)}</h1><p class="muted">Ringkasan aktivitas publikasi Anda.</p>
  <div class="grid g4"><div class="stat"><span>Total posting</span><strong>${t.total}</strong></div><div class="stat"><span>Berhasil</span><strong>${t.published}</strong></div>
  <div class="stat"><span>Dalam antrean</span><strong>${t.queued}</strong></div><div class="stat red"><span>Gagal</span><strong>${t.failed}</strong></div></div>
  <div class="card mt"><div class="row"><div class="grow"><b>${conn} akun terhubung</b><div class="muted small">dari 4 platform</div></div><a class="btn ghost sm" href="#/accounts">Hubungkan akun</a></div>
  <a class="btn red wide" href="#/new">+ Buat posting</a></div>
  <div class="card"><h2>Aktivitas terbaru</h2>${d.recent.length ? d.recent.map(r => `<div class="row"><div class="grow"><b>${esc(PLAT[r.platform])}</b><div class="muted small">${fmt(r.published_at || r.created_at)}${r.error_message ? " · " + esc(r.error_message) : ""}</div></div>${pill(r.status)}</div>`).join("") : `<p class="muted">Belum ada aktivitas.</p>`}</div>`, "#/");
}

async function accountsView() {
  shell(loading(), "#/accounts");
  const d = await api("/api/social-accounts");
  shell(`<h1>Akun media sosial</h1><p class="muted">Hubungkan akun milik Anda sendiri lewat login resmi platform. Aplikasi tidak pernah meminta password media sosial Anda.</p>
  <div class="card">${d.accounts.map(a => `<div class="row"><div class="grow"><b>${esc(PLAT[a.platform])}</b><div class="muted small">${a.username ? "@" + esc(a.username) : a.status === "connected" ? "Terhubung" : a.available ? "Siap dihubungkan" : "Belum tersedia — menunggu aktivasi admin"}</div></div>${pill(a.status)}
  ${a.status === "connected" ? `<button class="btn ghost sm" data-dc="${a.platform}">Putuskan</button>` : `<button class="btn sm" data-cn="${a.platform}" ${a.available ? "" : "disabled"}>Hubungkan</button>`}</div>`).join("")}</div>`, "#/accounts");
  document.querySelectorAll("[data-cn]").forEach(b => b.onclick = async () => { try { const r = await api(`/api/social/${b.dataset.cn}/connect`); location.href = r.url; } catch (e) { toast(e.message); } });
  document.querySelectorAll("[data-dc]").forEach(b => b.onclick = async () => { if (!confirm(`Putuskan akun ${PLAT[b.dataset.dc]}?`)) return; try { await api(`/api/social-accounts/${b.dataset.dc}`, { method: "DELETE" }); toast("Akun diputuskan."); accountsView(); } catch (e) { toast(e.message); } });
}

async function newPostView() {
  shell(loading(), "#/new");
  const d = await api("/api/social-accounts");
  shell(`<h1>Buat posting</h1><p class="muted">Video MP4/MOV, maksimal 100 MB.</p><div class="card"><form id="pf">
  <label>Video<input id="file" type="file" accept="video/mp4,video/quicktime" required></label>
  <label>Caption<textarea id="cap" rows="4" maxlength="2200" placeholder="Tulis caption…"></textarea></label><div class="muted small" id="cnt">0 karakter</div>
  <label>Platform tujuan</label>${d.accounts.map(a => { const ok = a.available && a.status === "connected"; return `<label class="plat ${ok ? "" : "off"}"><input type="checkbox" name="pl" value="${a.platform}" ${ok ? "" : "disabled"}><span class="grow"><b>${esc(PLAT[a.platform])}</b><span class="muted small blk">${ok ? "Siap" : !a.available ? "Belum tersedia (menunggu aktivasi admin)" : "Hubungkan akun dulu"}</span></span></label>`; }).join("")}
  <label>Waktu publikasi</label><select id="when"><option value="now">Sekarang</option><option value="sched">Jadwalkan</option></select>
  <input id="sched" type="datetime-local" class="hidden"><div id="sum" class="card hidden"></div><div class="progress hidden" id="pg"><div></div></div>
  <button class="btn red wide mt" id="go">Lihat ringkasan</button><p id="m" class="msg"></p></form></div>`, "#/new");
  const $ = (id) => document.getElementById(id); let step = 0;
  $("cap").oninput = () => $("cnt").textContent = `${$("cap").value.length} karakter`;
  $("when").onchange = () => $("sched").classList.toggle("hidden", $("when").value !== "sched");
  $("pf").onsubmit = async (e) => {
    e.preventDefault(); const m = $("m"); m.className = "msg"; m.textContent = "";
    const f = $("file").files[0], pl = [...document.querySelectorAll("[name=pl]:checked")].map(x => x.value);
    if (!f) return; if (!pl.length) { m.className = "msg err"; m.textContent = "Pilih minimal satu platform."; return; }
    if (f.size > 100 * 1048576) { m.className = "msg err"; m.textContent = "Ukuran video melebihi 100 MB."; return; }
    const sched = $("when").value === "sched" ? $("sched").value : "";
    if ($("when").value === "sched" && !sched) { m.className = "msg err"; m.textContent = "Pilih tanggal dan jam."; return; }
    if (step === 0) {
      $("sum").classList.remove("hidden"); $("sum").innerHTML = `<b>Ringkasan</b><p>${esc(f.name)} (${(f.size / 1048576).toFixed(1)} MB)</p><p>Platform: ${pl.map(p => esc(PLAT[p])).join(", ")}</p><p>Waktu: ${sched ? fmt(sched) : "Sekarang"}</p><p class="muted small">${esc($("cap").value || "(tanpa caption)")}</p>`;
      $("go").textContent = "Kirim ke antrean"; step = 1; return;
    }
    $("go").disabled = true; $("pg").classList.remove("hidden");
    try {
      const mime = f.type === "video/quicktime" ? "video/quicktime" : "video/mp4";
      const init = await api("/api/uploads", { method: "POST", body: { filename: f.name, mime_type: mime, size_bytes: f.size } });
      await new Promise((ok, bad) => {
        const x = new XMLHttpRequest(); x.open("PUT", init.upload_url); x.setRequestHeader("Authorization", `Bearer ${store.get("sh_at")}`);
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) $("pg").firstElementChild.style.width = `${Math.round(ev.loaded / ev.total * 100)}%`; };
        x.onload = () => x.status < 300 ? ok() : bad(new Error(JSON.parse(x.responseText || "{}").error || "Upload gagal."));
        x.onerror = () => bad(new Error("Upload terputus. Periksa koneksi.")); x.send(f);
      });
      const r = await api("/api/posts", { method: "POST", body: { media_asset_id: init.id, caption: $("cap").value, platforms: pl, scheduled_at: sched ? new Date(sched).toISOString() : null } });
      toast(r.message); location.hash = "#/history";
    } catch (err) { m.className = "msg err"; m.textContent = err.message; $("go").disabled = false; }
  };
}

async function historyView() {
  shell(loading(), "#/history");
  const d = await api("/api/posts");
  shell(`<h1>Riwayat publikasi</h1><div class="card">${d.posts.length ? d.posts.map(p => `<div class="row top-al"><div class="grow"><b>${esc((p.caption || "(tanpa caption)").slice(0, 80))}</b><div class="muted small">${fmt(p.scheduled_at || p.created_at)}</div>
  <div>${(p.post_destinations || []).map(x => `<div class="small">${esc(PLAT[x.platform])} ${pill(x.status)} ${x.error_message ? `<span class="muted">${esc(x.error_message)}</span>` : ""}</div>`).join("")}</div></div>
  ${["queued"].includes(p.status) ? `<button class="btn ghost sm" data-cx="${esc(p.id)}">Batalkan</button>` : pill(p.status)}</div>`).join("") : `<p class="muted">Belum ada publikasi.</p>`}</div>`, "#/history");
  document.querySelectorAll("[data-cx]").forEach(b => b.onclick = async () => { try { await api(`/api/posts/${b.dataset.cx}/cancel`, { method: "POST" }); toast("Dibatalkan."); historyView(); } catch (e) { toast(e.message); } });
}

// ---------- Admin ----------
let usersCache = [];
const uname = (id) => { const u = usersCache.find(x => x.id === id); return u ? (u.full_name || u.email) : (id ? id.slice(0, 8) : "sistem"); };
const adminTabs = (on) => `<div class="tabs">${[["#/admin/pubs", "Publikasi"], ["#/admin/accounts", "Akun sosial"], ["#/admin/audit", "Audit"], ["#/admin/integrations", "Integrasi"]].map(([h, l]) => `<a href="${h}" class="${h === on ? "on" : ""}">${l}</a>`).join("")}</div>`;

async function adminHome() {
  shell(loading(), "#/admin");
  const s = await api("/api/admin/stats"), days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() + 7 * 3600000 - i * 86400000).toISOString().slice(0, 10));   // hari dalam WIB
  const max = Math.max(1, ...days.map(d => s.daily[d] || 0));
  shell(`<h1>Dashboard admin</h1><div class="grid g4"><div class="stat"><span>Total karyawan</span><strong>${s.employees.total}</strong></div><div class="stat"><span>Aktif</span><strong>${s.employees.active}</strong></div>
  <div class="stat"><span>Nonaktif</span><strong>${s.employees.inactive}</strong></div><div class="stat"><span>Akun sosial terhubung</span><strong>${s.social_accounts_connected}</strong></div>
  <div class="stat"><span>Total publikasi</span><strong>${s.publications.total}</strong></div><div class="stat"><span>Berhasil</span><strong>${s.publications.published}</strong></div>
  <div class="stat red"><span>Gagal</span><strong>${s.publications.failed}</strong></div><div class="stat"><span>Dalam antrean</span><strong>${s.publications.queued}</strong></div></div>
  <div class="card mt"><h2>Publikasi 14 hari terakhir</h2><div class="bars" id="bars">${days.map(d => `<div class="${s.daily[d] ? "" : "z"}" data-v="${s.daily[d] || 0}" title="${d}: ${s.daily[d] || 0}"></div>`).join("")}</div>
  <div class="barlbl">${days.map(d => `<span>${d.slice(8)}</span>`).join("")}</div></div>
  <div class="card"><h2>Per platform</h2>${Object.keys(PLAT).map(p => { const x = s.by_platform[p] || { total: 0, published: 0, failed: 0 }; return `<div class="row"><b class="grow">${esc(PLAT[p])}</b><span class="small muted">${x.total} total · ${x.published} berhasil · ${x.failed} gagal</span></div>`; }).join("")}</div>`, "#/admin");
  document.querySelectorAll("#bars div").forEach(b => b.style.height = `${Math.max(2, Number(b.dataset.v) / max * 100)}%`);
}

async function employeesView() {
  shell(loading(), "#/admin/employees");
  const render2 = async (q = "") => {
    const d = await api(`/api/admin/users?q=${encodeURIComponent(q)}`); if (!q) usersCache = d.users;
    document.getElementById("ul").innerHTML = d.users.map(u => `<div class="row"><div class="grow"><b>${esc(u.full_name || "(tanpa nama)")}</b><div class="muted small">${esc(u.email || "")} · ${esc(u.role)}</div></div>${pill(u.is_active ? "enabled" : "disabled")}
    ${u.id !== me.id ? `<button class="btn ghost sm" data-u="${esc(u.id)}" data-a="${!u.is_active}">${u.is_active ? "Nonaktifkan" : "Aktifkan"}</button>` : ""}</div>`).join("") || `<p class="muted">Tidak ada data.</p>`;
    document.querySelectorAll("[data-u]").forEach(b => b.onclick = async () => { if (b.dataset.a === "false" && !confirm("Nonaktifkan karyawan ini? Histori publikasinya tetap tersimpan.")) return;
      try { await api(`/api/admin/users/${b.dataset.u}/status`, { method: "PATCH", body: { active: b.dataset.a === "true" } }); toast("Status diperbarui."); render2(q); } catch (e) { toast(e.message); } });
  };
  shell(`<h1>Karyawan</h1><div class="card"><input id="q" type="search" placeholder="Cari nama atau email…"><div id="ul"></div></div>
  <div class="card"><h2>Tambah karyawan</h2><form id="nf"><label>Nama lengkap<input id="nn" required></label><label>Email<input id="ne" type="email" required></label>
  <label>Password awal (min. 12 karakter)<input id="np" type="text" minlength="12" required autocomplete="off"></label><button class="btn red wide" class="mt">Buat akun</button><p id="nm" class="msg"></p></form>
  <p class="small muted">Sampaikan password awal lewat jalur aman; karyawan dapat menggantinya lewat "Lupa password".</p></div>`, "#/admin/employees");
  await render2(); let tm; document.getElementById("q").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => render2(e.target.value), 300); };
  document.getElementById("nf").onsubmit = async (e) => { e.preventDefault(); const m = document.getElementById("nm"); m.className = "msg"; m.textContent = "Memproses…";
    try { await api("/api/admin/users", { method: "POST", body: { full_name: document.getElementById("nn").value, email: document.getElementById("ne").value, password: document.getElementById("np").value } });
      m.className = "msg ok"; m.textContent = "Karyawan dibuat."; employeesView(); } catch (err) { m.className = "msg err"; m.textContent = err.message; } };
}

async function pubsView() {
  shell(loading(), "#/admin/pubs");
  if (!usersCache.length) usersCache = (await api("/api/admin/users")).users;
  shell(`<h1>Aktivitas publikasi</h1>${adminTabs("#/admin/pubs")}<div class="card"><div class="filters">
  <select id="fp"><option value="">Semua platform</option>${Object.entries(PLAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
  <select id="fs"><option value="">Semua status</option>${["queued", "processing", "published", "failed", "cancelled"].map(s => `<option value="${s}">${STATUS[s]}</option>`).join("")}</select>
  <select id="fu" class="full"><option value="">Semua karyawan</option>${usersCache.map(u => `<option value="${esc(u.id)}">${esc(u.full_name || u.email)}</option>`).join("")}</select>
  <input id="ff" type="date"><input id="ft" type="date"><button class="btn sm full" id="fb">Terapkan filter</button></div></div><div class="card" id="pl"></div>`, "#/admin/pubs");
  const load = async () => {
    const g = (id) => document.getElementById(id).value, q = new URLSearchParams();
    if (g("fp")) q.set("platform", g("fp")); if (g("fs")) q.set("status", g("fs")); if (g("fu")) q.set("user_id", g("fu"));
    if (g("ff")) q.set("from", new Date(g("ff")).toISOString()); if (g("ft")) q.set("to", new Date(g("ft") + "T23:59:59").toISOString());
    const d = await api(`/api/admin/publications?${q}`);
    document.getElementById("pl").innerHTML = d.items.length ? d.items.map(r => `<div class="row"><div class="grow"><b>${esc(uname(r.user_id))}</b> · ${esc(PLAT[r.platform])}<div class="muted small">${fmt(r.published_at || r.created_at)}${r.error_message ? " · " + esc(r.error_message) : ""}</div></div>${pill(r.status)}</div>`).join("") : `<p class="muted">Tidak ada data.</p>`;
  };
  document.getElementById("fb").onclick = () => load().catch(e => toast(e.message)); await load();
}

async function adminAccountsView() {
  shell(loading(), "#/admin/accounts"); if (!usersCache.length) usersCache = (await api("/api/admin/users")).users;
  const d = await api("/api/admin/accounts");
  shell(`<h1>Akun sosial terhubung</h1>${adminTabs("#/admin/accounts")}<div class="card">${d.accounts.map(a => `<div class="row"><div class="grow"><b>${esc(uname(a.user_id))}</b> · ${esc(PLAT[a.platform])}<div class="muted small">${a.username ? "@" + esc(a.username) + " · " : ""}terhubung ${fmt(a.connected_at)}</div></div>${pill(a.status)}</div>`).join("") || `<p class="muted">Belum ada akun terhubung.</p>`}</div>`, "#/admin/accounts");
}
async function auditView() {
  shell(loading(), "#/admin/audit"); if (!usersCache.length) usersCache = (await api("/api/admin/users")).users;
  const d = await api("/api/admin/audit");
  shell(`<h1>Audit log</h1>${adminTabs("#/admin/audit")}<div class="card">${d.logs.map(l => `<div class="row"><div class="grow"><b>${esc(l.action)}</b><div class="muted small">${fmt(l.created_at)} · oleh ${esc(uname(l.actor_user_id))}${l.target_user_id ? " → " + esc(uname(l.target_user_id)) : ""}</div></div></div>`).join("") || `<p class="muted">Belum ada log.</p>`}</div>`, "#/admin/audit");
}
async function integrationsView() {
  shell(loading(), "#/admin/integrations");
  const d = await api("/api/admin/integrations");
  shell(`<h1>Integrasi Developer</h1>${adminTabs("#/admin/integrations")}<p class="muted small">Client Secret tidak disimpan di sini. Pasang sebagai Secret di Cloudflare (nama: TIKTOK_CLIENT_SECRET, dst.). Mengisi ID dan Secret saja belum berarti platform bisa memposting: tiap platform butuh app review/izin. Aktifkan hanya setelah disetujui dan diuji.</p>
  ${d.integrations.map(i => `<div class="card"><div class="row"><b class="grow">${esc(PLAT[i.platform])}</b>${pill(i.status)}</div><form data-p="${esc(i.platform)}">
  <label>Client ID / App ID<input name="client_id" value="${esc(i.client_id || "")}" autocomplete="off"></label><label>Redirect URI (HTTPS)<input name="redirect_uri" value="${esc(i.redirect_uri || "")}"></label>
  <label>Webhook URL (opsional)<input name="webhook_url" value="${esc(i.webhook_url || "")}"></label><label>Scope (pisahkan koma)<input name="scopes" value="${esc((i.scopes || []).join(","))}"></label>
  <label>Environment<select name="environment">${["sandbox", "production"].map(v => `<option ${i.environment === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
  <label>Status verifikasi app<input name="app_review_status" value="${esc(i.app_review_status || "")}" placeholder="mis. menunggu review"></label>
  <label>Status integrasi<select name="status">${["disabled", "configured", "under_review", "approved", "enabled"].map(v => `<option value="${v}" ${i.status === v ? "selected" : ""}>${STATUS[v]}</option>`).join("")}</select></label>
  <p class="small">Client Secret: ${i.client_secret_configured ? "✅ terpasang di server" : "❌ belum dipasang"}</p><button class="btn sm">Simpan</button></form></div>`).join("")}`, "#/admin/integrations");
  document.querySelectorAll("form[data-p]").forEach(f => f.onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f));
    v.scopes = String(v.scopes || "").split(",").map(s => s.trim()).filter(Boolean);
    try { await api(`/api/admin/integrations/${f.dataset.p}`, { method: "PUT", body: v }); toast("Tersimpan."); integrationsView(); } catch (err) { toast(err.message); } });
}
function moreView() {
  shell(`<h1>Menu admin</h1><div class="card"><div class="row"><a class="grow" href="#/admin/accounts"><b>Akun sosial terhubung</b></a></div><div class="row"><a class="grow" href="#/admin/audit"><b>Audit log</b></a></div>
  <div class="row"><a class="grow" href="#/admin/integrations"><b>Integrasi Developer</b></a></div></div>`, "#/admin/more");
}

// ---------- Router ----------
const routes = { "#/": homeView, "#/new": newPostView, "#/history": historyView, "#/accounts": accountsView, "#/admin": adminHome, "#/admin/employees": employeesView,
  "#/admin/pubs": pubsView, "#/admin/accounts": adminAccountsView, "#/admin/audit": auditView, "#/admin/integrations": integrationsView, "#/admin/more": moreView };
async function render() {
  try {
    if (!store.get("sh_at") && !store.get("sh_rt")) return loginView();
    if (!me) { try { me = (await api("/api/me")).user; } catch { return loginView(); } }
    let h = location.hash || "#/";
    if (h === "#/login") { location.hash = isAdmin() ? "#/admin" : "#/"; return; }
    if (h === "#/" && isAdmin()) h = "#/admin";
    if (h.startsWith("#/admin") && !isAdmin()) h = "#/";
    if (!isAdmin() && !["#/", "#/new", "#/history", "#/accounts"].includes(h)) h = "#/";
    const fn = routes[h] || (isAdmin() ? adminHome : homeView);
    await fn();
    const p = new URLSearchParams(location.search);
    if (p.get("connected")) { toast(`${PLAT[p.get("connected")] || "Akun"} berhasil terhubung.`); history.replaceState(null, "", "/"); }
    else if (p.get("oauth")) { toast(p.get("oauth") === "denied" ? "Koneksi dibatalkan." : "Koneksi gagal. Coba lagi atau hubungi admin."); history.replaceState(null, "", "/"); }
  } catch (e) { toast(e.message || "Terjadi kesalahan."); }
}
addEventListener("hashchange", render);
render();
