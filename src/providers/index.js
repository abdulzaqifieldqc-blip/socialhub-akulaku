import tiktok from "./tiktok.js"; import instagram from "./instagram.js";
import facebook from "./facebook.js"; import threads from "./threads.js";
export const adapters = { tiktok, instagram, facebook, threads };
export const getAdapter = (p) => adapters[p] || null;
