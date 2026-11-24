import { postForm, getJson, notVerified, addSeconds } from "./base.js";
// STATUS: kerangka OAuth Instagram API with Instagram Login. BELUM diuji dengan app resmi. Hanya akun profesional.
export default {
  id: "instagram",
  defaultScopes: ["instagram_business_basic", "instagram_business_content_publish"],
  limits: { maxBytes: 100 * 1024 * 1024, mimes: ["video/mp4", "video/quicktime"], maxCaption: 2200 },
  authUrl: ({ clientId, redirectUri, state, scopes }) =>
    "https://www.instagram.com/oauth/authorize?" + new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(","), state }),
  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const s = await postForm("https://api.instagram.com/oauth/access_token", {
      client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const l = await getJson("https://graph.instagram.com/access_token?" + new URLSearchParams({
      grant_type: "ig_exchange_token", client_secret: clientSecret, access_token: s.access_token }));
    return { accessToken: l.access_token, refreshToken: null, providerUserId: String(s.user_id),
      username: null, scopes: [].concat(s.permissions || []), expiresAt: addSeconds(l.expires_in) };
  },
  async refresh({ accessToken }) {
    const l = await getJson("https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({
      grant_type: "ig_refresh_token", access_token: accessToken }));
    return { accessToken: l.access_token, refreshToken: null, expiresAt: addSeconds(l.expires_in) };
  },
  async publish() { notVerified("Instagram"); }
};
