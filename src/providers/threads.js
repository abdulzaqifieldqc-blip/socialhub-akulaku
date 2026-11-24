import { postForm, getJson, notVerified, addSeconds } from "./base.js";
// STATUS: kerangka OAuth Threads API. BELUM diuji dengan app resmi.
export default {
  id: "threads",
  defaultScopes: ["threads_basic", "threads_content_publish"],
  limits: { maxBytes: 100 * 1024 * 1024, mimes: ["video/mp4", "video/quicktime"], maxCaption: 500 },
  authUrl: ({ clientId, redirectUri, state, scopes }) =>
    "https://threads.net/oauth/authorize?" + new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope: scopes.join(","), response_type: "code", state }),
  async exchangeCode({ code, clientId, clientSecret, redirectUri }) {
    const s = await postForm("https://graph.threads.net/oauth/access_token", {
      client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const l = await getJson("https://graph.threads.net/access_token?" + new URLSearchParams({
      grant_type: "th_exchange_token", client_secret: clientSecret, access_token: s.access_token }));
    return { accessToken: l.access_token, refreshToken: null, providerUserId: String(s.user_id),
      username: null, scopes: [], expiresAt: addSeconds(l.expires_in) };
  },
  async refresh({ accessToken }) {
    const l = await getJson("https://graph.threads.net/refresh_access_token?" + new URLSearchParams({
      grant_type: "th_refresh_token", access_token: accessToken }));
    return { accessToken: l.access_token, refreshToken: null, expiresAt: addSeconds(l.expires_in) };
  },
  async publish() { notVerified("Threads"); }
};
