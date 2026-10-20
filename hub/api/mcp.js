// Remote MCP endpoint for agents on every account. See lib/mcp.js.
import { hubFromEnv, mcpApi, vercel } from '../lib/api.js';

export default function handler(req, res) {
  return vercel(req, res, (r) => mcpApi({ ...r, hub: hubFromEnv() }));
}
