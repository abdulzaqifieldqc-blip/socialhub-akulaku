const form = document.getElementById("reset-form");
const message = document.getElementById("message");
const button = document.getElementById("submit");
const params = new URLSearchParams(location.hash.slice(1));
const accessToken = params.get("access_token");
const tokenType = params.get("type");
if (!accessToken || tokenType !== "recovery") {
  form.hidden = true;
  message.className = "msg err";
  message.textContent = "Tautan pemulihan tidak valid atau sudah kedaluwarsa. Minta tautan baru.";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("new-password").value;
  const confirm = document.getElementById("confirm-password").value;
  if (password.length < 12) { message.textContent = "Password minimal 12 karakter."; return; }
  if (password !== confirm) { message.textContent = "Konfirmasi password tidak sama."; return; }
  button.disabled = true;
  message.textContent = "Menyimpan password…";
  try {
    const response = await fetch("/api/auth/password", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Password gagal diperbarui.");
    form.hidden = true;
    message.className = "msg ok";
    message.textContent = "Password berhasil diperbarui. Silakan kembali ke aplikasi dan login.";
    history.replaceState(null, "", "/reset-password.html");
  } catch (error) {
    message.className = "msg err";
    message.textContent = error.message;
    button.disabled = false;
  }
});
