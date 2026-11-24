const q = location.search.replace(/[^\w=&%.?\-]/g, "");   // hanya karakter aman (connected, oauth, platform)
const deep = "socialhub://oauth" + q;
document.getElementById("app").href = deep;
document.getElementById("web").href = "/" + q;
if (/Android/i.test(navigator.userAgent)) setTimeout(() => { location.href = deep; }, 300);
else location.replace("/" + q);
