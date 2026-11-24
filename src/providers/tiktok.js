import { postForm, notVerified, addSeconds } from "./base.js";
// STATUS: kerangka OAuth sesuai dokumentasi TikTok for Developers. BELUM diuji dengan app resmi.
export default {
  id: "tiktok",
  defaultScopes: ["user.info.basic", "video.publish", "video.upload"],
  limits: { maxBytes: 100 * 1024 * 1024, mimes: ["video/mp4", "video/quicktime"], maxCaption: 2200 },
  authUrl: ({ clientId, redirectUri, state, scopes }) =>
    "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({
      client_key: clientId, scope: scopes.join(","), response_type: "code", redirect_uri: redirectUri, state }),
  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const d = await postForm("https://open.tiktokapis.com/v2/oauth/token/", {
      client_key: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
    return { accessToken: d.access_token, refreshToken: d.refresh_token, providerUserId: d.open_id,
      username: null, scopes: String(d.scope || "").split(","), expiresAt: addSeconds(d.expires_in) };
  },
  async refresh({ refreshToken, clientId, clientSecret }) {
    const d = await postForm("https://open.tiktokapis.com/v2/oauth/token/", {
      client_key: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
    return { accessToken: d.access_token, refreshToken: d.refresh_token || refreshToken, expiresAt: addSeconds(d.expires_in) };
  },
  async publish() { notVerified("TikTok"); }   // Content Posting API memerlukan app review/audit TikTok
};
