/**
 * The phone link to the PC helper (public/pc-helper/dop_pc.py), shared by the site and the
 * account function: the helper's public address is a Cloudflare quick tunnel, and the
 * pairing code it prints guards it.
 */

/** The helper's public addresses are its Cloudflare quick tunnels; nothing else is accepted from a link. */
export const PC_TUNNEL_RE = /^https:\/\/[a-z0-9-]{1,80}\.trycloudflare\.com$/;

/** A pairing code as dop_pc.py makes it (ABCD-1234-EF56), upper-cased; null if malformed. */
export function pairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c) ? c : null;
}

/** The link the PC's Settings page shows as a QR code: the site with ?pc=<address>&pcCode=<code>. */
export function pcLinkUrl(site: string, address: string, code: string): string {
  const u = new URL(site);
  u.search = '';
  u.hash = '#/settings';
  u.searchParams.set('pc', address);
  u.searchParams.set('pcCode', code);
  return u.toString();
}

/** The address and code in such a link, or null when it carries none (or a bad one). */
export function pcLinkOf(href: string): { address: string; code: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const address = (u.searchParams.get('pc') ?? '').replace(/\/+$/, '');
  const code = pairingCode(u.searchParams.get('pcCode'));
  return code && PC_TUNNEL_RE.test(address) ? { address, code } : null;
}
