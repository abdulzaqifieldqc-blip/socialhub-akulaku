import { getJson, notVerified, addSeconds } from "./base.js";
// STATUS: kerangka Meta OAuth untuk Facebook Pages. BELUM diuji. Versi Graph API: env META_GRAPH_VERSION.
export default {
  id: "facebook",
  defaultScopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
  limits: { maxBytes: 100 * 1024 * 1024, mimes: ["video/mp4", "video/quicktime"], maxCaption: 5000 },
  authUrl: ({ clientId, redirectUri, state, scopes, env }) =>
    `https://www.facebook.com/${env.META_GRAPH_VERSION || "v21.0"}/dialog/oauth?` + new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, state, scope: scopes.join(","), response_type: "code" }),
  async exchangeCode({ code, clientId, clientSecret, redirectUri, env }) {
    const v = env.META_GRAPH_VERSION || "v21.0";
    const s = await getJson(`https://graph.facebook.com/${v}/oauth/access_token?` + new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }));
    const l = await getJson(`https://graph.facebook.com/${v}/oauth/access_token?` + new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: clientId, client_secret: clientSecret, fb_exchange_token: s.access_token }));
    const me = await getJson(`https://graph.facebook.com/${v}/me?fields=id,name&access_token=${encodeURIComponent(l.access_token)}`);
    return { accessToken: l.access_token, refreshToken: null, providerUserId: me.id, username: me.name,
      scopes: [], expiresAt: addSeconds(l.expires_in) };
  },
  async refresh() { return null; },   // long-lived token: sambungkan ulang saat kedaluwarsa
  async publish() { notVerified("Facebook"); }
};
