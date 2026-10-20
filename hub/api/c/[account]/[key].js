// Same MCP endpoint with the account and key in the path:
//   https://<hub>/api/c/<name>/<key>
// claude.ai's connector setup can lose ?query links, so the hub hands out this form.
import { hubFromEnv, mcpApi, vercel } from '../../../lib/api.js';

export default function handler(req, res) {
  const [, account = '', key = ''] = /\/api\/c\/([^/?]+)\/([^/?]+)/.exec(req.url) || [];
  return vercel(req, res, (r) => mcpApi({ ...r, query: { account: decodeURIComponent(account), key: decodeURIComponent(key) }, hub: hubFromEnv() }));
}
