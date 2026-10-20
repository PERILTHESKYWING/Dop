// Page API (password protected). See lib/api.js.
import { hubFromEnv, pageApi, vercel } from '../lib/api.js';

export default function handler(req, res) {
  return vercel(req, res, (r) => pageApi({ ...r, hub: hubFromEnv(), password: process.env.HUB_PASSWORD }));
}
