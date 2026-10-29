// Decide whether a TCP peer may set X-Forwarded-For. Only proxies on our own Docker network
// (printedrobotics_web: our Caddy via the published loopback port, or another project's edge
// proxy attached to that network) and loopback are trusted. Anyone else's X-Forwarded-For is
// ignored, so a client cannot pick its own rate-limit key.
import { networkInterfaces } from 'node:os';

type Cidr = { net: number; mask: number };

function ipv4ToInt(ip: string): number | null {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip.trim());
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;
}

export function parseCidr(s: string): Cidr | null {
  const [ip, bits = '32'] = s.trim().split('/');
  const n = ipv4ToInt(ip ?? '');
  const b = Number(bits);
  if (n == null || !Number.isInteger(b) || b < 0 || b > 32) return null;
  const mask = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
  return { net: (n & mask) >>> 0, mask };
}

/** The container's own IPv4 subnets (the Docker networks it is attached to). */
export function localSubnets(): Cidr[] {
  const out: Cidr[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const c = parseCidr(a.cidr ?? `${a.address}/32`);
      if (c) out.push(c);
    }
  }
  return out;
}

/** TRUST_PROXY_CIDRS (comma list) overrides the auto-detected local subnets. */
export function trustedCidrs(env: NodeJS.ProcessEnv = process.env): Cidr[] {
  const raw = env.TRUST_PROXY_CIDRS;
  const list = raw ? raw.split(',').map(parseCidr).filter((c): c is Cidr => c != null) : localSubnets();
  return [...list, { net: 0x7f000000, mask: 0xff000000 }];
}

export function isTrustedPeer(addr: string | undefined, cidrs: Cidr[]): boolean {
  if (!addr) return false;
  if (addr === '::1') return true;
  const n = ipv4ToInt(addr);
  if (n == null) return false;
  return cidrs.some((c) => ((n & c.mask) >>> 0) === c.net);
}
