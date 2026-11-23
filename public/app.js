let token = localStorage.getItem("sh_token") || "";
let mode = "login";
const $ = (id) => document.getElementById(id);
const api = async (path, options={}) => {
  const res = await fetch(path, { ...options, headers: {
    "Content-Type":"application/json",
    ...(token ? {Authorization:`Bearer ${token}`} : {}),
    ...(options.headers || {})
  }});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
};
document.querySelectorAll("[data-tab]").forEach(btn => btn.onclick = () => {
  mode = btn.dataset.tab;
  document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===btn));
  $("nameWrap").classList.toggle("hidden",mode!=="register");
  $("authTitle").textContent = mode==="login" ? "Selamat datang" : "Buat akun karyawan";
  $("authSubmit").textContent = mode==="login" ? "Masuk ke Social Hub" : "Daftar sekarang";
});
$("authForm").onsubmit = async e => {
  e.preventDefault(); $("authMessage").textContent="Memproses...";
  try {
    const body = {email:$("email").value,password:$("password").value};
    if(mode==="register") body.name=$("name").value;
    const data=await api(`/api/auth/${mode==="login"?"login":"register"}`,{method:"POST",body:JSON.stringify(body)});
    token=data.session?.access_token||data.token; localStorage.setItem("sh_token",token); await showApp();
  } catch(err){$("authMessage").textContent=err.message;}
};
$("logout").onclick=()=>{token="";localStorage.removeItem("sh_token");$("appView").classList.add("hidden");$("authView").classList.remove("hidden");$("who").textContent="";};
$("refresh").onclick=loadData;
$("postForm").onsubmit=async e=>{
  e.preventDefault(); $("postMessage").textContent="Memasukkan ke antrean...";
  const requestedPlatforms=[...document.querySelectorAll(".checks input:checked")].map(x=>x.value);
  try{
    const data=await api("/api/posts",{method:"POST",body:JSON.stringify({
      caption:$("caption").value,mediaUrl:$("mediaUrl").value||null,mediaType:$("mediaType").value||null,requestedPlatforms
    })});
    $("postMessage").textContent=data.message; $("postForm").reset(); await loadData();
  }catch(err){$("postMessage").textContent=err.message;}
};
async function showApp(){
  try{
    const data=await api("/api/me");
    $("authView").classList.add("hidden");$("appView").classList.remove("hidden");
    $("who").textContent=data.user.email;$("greeting").textContent=`Halo, ${(data.user.full_name || data.user.email)}`;
    $("adminPanel").classList.toggle("hidden",!["owner","admin"].includes(data.user.role));
    await loadData();
  }catch(err){token="";localStorage.removeItem("sh_token");$("authMessage").textContent=err.message||"Sesi tidak valid. Silakan masuk kembali.";}
}
async function loadData(){
  try{
    const [a,p]=await Promise.all([api("/api/social-accounts"),api("/api/posts")]);
    $("accounts").innerHTML=a.accounts.map(x=>`<div class="account"><strong>${x.platform}</strong><span class="pill ${x.connection_status==="connected"?"ok":""}">${x.connection_status==="connected"?"Terhubung":"Belum terhubung"}</span></div>`).join("");
    $("historyList").innerHTML=p.posts.length?p.posts.map(x=>`<div class="history-item"><strong>Posting #${x.id}</strong><div class="muted">${new Date(x.created_at).toLocaleString("id-ID")} · ${x.status}</div><div class="result-tags">${(x.results||[]).map(r=>`<span>${r.platform}: ${r.status}</span>`).join("")}</div></div>`).join(""):'<p class="muted">Belum ada publikasi.</p>';
    $("totalPosts").textContent=p.posts.length;
    $("publishedPosts").textContent=p.posts.filter(x=>x.status==="published").length;
    $("queuedPosts").textContent=p.posts.filter(x=>x.status==="queued"||x.status==="processing").length;
    if(!$("adminPanel").classList.contains("hidden")) await loadAdmin();
  }catch(e){console.error(e);}
}
async function loadAdmin(){
  try{
    const data=await api("/api/admin/users");
    $("userList").innerHTML=data.users.map(u=>`<div class="user-row"><span><b>${escapeHtml(u.name)}</b><br><small>${escapeHtml(u.email)} · ${u.role}</small></span><button class="ghost" data-user="${u.id}" data-active="${!u.is_active}">${u.is_active?"Nonaktifkan":"Aktifkan"}</button></div>`).join("");
    document.querySelectorAll("[data-user]").forEach(b=>b.onclick=async()=>{
      await api(`/api/admin/users/${b.dataset.user}/status`,{method:"PATCH",body:JSON.stringify({active:b.dataset.active==="true"})});await loadAdmin();
    });
  }catch(e){$("userList").textContent=e.message;}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
if(token) showApp();
