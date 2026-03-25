import net    from 'node:net';
import dns    from 'node:dns/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function sh(cmd: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    return (stdout || stderr).trimEnd();
  } catch (e: any) { return (e.stdout || e.stderr || e.message || '').trimEnd(); }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'port_check',
    description: 'Check if a TCP port is open on a host. Fast single-port connectivity test.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        host:      { type: 'string', description: 'Hostname or IP address' },
        port:      { type: 'number', description: 'Port number' },
        timeout_s: { type: 'number', description: 'Timeout in seconds (default: 5)' },
      },
      required: ['host', 'port'],
    },
  },
  {
    name: 'dns_lookup',
    description: 'Perform a DNS lookup. Supports A, AAAA, MX, TXT, NS, CNAME, SOA records.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostname:    { type: 'string', description: 'Hostname to look up' },
        record_type: {
          type: 'string',
          description: 'DNS record type (default: A)',
          enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ANY'],
        },
      },
      required: ['hostname'],
    },
  },
  {
    name: 'reverse_dns',
    description: 'Perform a reverse DNS lookup (PTR record) for an IP address.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip: { type: 'string', description: 'IP address to look up' },
      },
      required: ['ip'],
    },
  },
  {
    name: 'whois',
    description: 'Run a WHOIS lookup for a domain or IP address. Requires whois to be installed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: 'Domain name or IP address' },
      },
      required: ['target'],
    },
  },
  {
    name: 'http_check',
    description:
      'Send a HEAD request to a URL and return status code, response headers, and timing. ' +
      'Useful for quickly checking if an endpoint is alive without fetching the body.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url:      { type: 'string', description: 'URL to check' },
        headers:  { type: 'object', description: 'Custom request headers', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
    },
  },
  {
    name: 'ip_info',
    description:
      'Get geolocation and ASN info for an IP address or your current public IP. ' +
      'Uses ip-api.com (no key required).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip: { type: 'string', description: 'IP address (leave empty to look up your public IP)' },
      },
      required: [],
    },
  },
  {
    name: 'traceroute',
    description: 'Run a traceroute to a host to map the network path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        host:     { type: 'string', description: 'Target hostname or IP' },
        max_hops: { type: 'number', description: 'Maximum hops (default: 20)' },
      },
      required: ['host'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async port_check(args) {
    const host    = args.host as string;
    const port    = args.port as number;
    const timeout = ((args.timeout_s as number) || 5) * 1000;
    const start   = Date.now();

    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(timeout);
      sock.on('connect', () => {
        const ms = Date.now() - start;
        sock.destroy();
        resolve(`✓ ${host}:${port} — OPEN (${ms}ms)`);
      });
      sock.on('timeout', () => {
        sock.destroy();
        resolve(`✗ ${host}:${port} — TIMEOUT (>${args.timeout_s ?? 5}s)`);
      });
      sock.on('error', (e) => {
        resolve(`✗ ${host}:${port} — CLOSED/REFUSED (${e.message})`);
      });
      sock.connect(port, host);
    });
  },

  async dns_lookup(args) {
    const hostname = args.hostname as string;
    const type     = ((args.record_type as string) || 'A').toUpperCase();

    try {
      let records: unknown;
      switch (type) {
        case 'A':     records = await dns.resolve4(hostname); break;
        case 'AAAA':  records = await dns.resolve6(hostname); break;
        case 'MX':    records = await dns.resolveMx(hostname); break;
        case 'TXT':   records = await dns.resolveTxt(hostname); break;
        case 'NS':    records = await dns.resolveNs(hostname); break;
        case 'CNAME': records = await dns.resolveCname(hostname); break;
        case 'SOA':   records = await dns.resolveSoa(hostname); break;
        case 'PTR':   records = await dns.resolvePtr(hostname); break;
        case 'SRV':   records = await dns.resolveSrv(hostname); break;
        case 'ANY':   records = await dns.resolveAny(hostname); break;
        default:      return `Unsupported record type: ${type}`;
      }
      return `${type} records for ${hostname}:\n${JSON.stringify(records, null, 2)}`;
    } catch (e: any) {
      return `DNS lookup failed: ${e.message}`;
    }
  },

  async reverse_dns(args) {
    const ip = args.ip as string;
    try {
      const hostnames = await dns.reverse(ip);
      return `PTR records for ${ip}:\n${hostnames.join('\n')}`;
    } catch (e: any) {
      return `Reverse DNS failed for ${ip}: ${e.message}`;
    }
  },

  async whois(args) {
    const target = args.target as string;
    // Check whois is available
    const whoisPath = await sh('which whois');
    if (!whoisPath || !whoisPath.startsWith('/')) {
      // Fallback: use curl with a WHOIS-over-HTTP service
      const out = await sh(`curl -s "https://who.is/whois/${encodeURIComponent(target)}" 2>/dev/null | head -80`);
      return out || 'whois not installed and fallback failed. Install with: apt-get install whois';
    }
    return sh(`whois ${target}`, 20000);
  },

  async http_check(args) {
    const url       = args.url as string;
    const hdrs      = (args.headers as Record<string, string>) || {};
    const headerStr = Object.entries(hdrs).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
    const cmd       = `curl -s -o /dev/null -D - -m 10 -A "AitherOS/1.0" ${headerStr} -I "${url}" 2>&1 | head -30`;
    return sh(cmd);
  },

  async ip_info(args) {
    const ip  = (args.ip as string) || '';
    const url = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,query`;
    const out = await sh(`curl -s --max-time 10 "${url}" 2>/dev/null`);
    try {
      const data = JSON.parse(out);
      if (data.status === 'fail') return `Lookup failed: ${data.message}`;
      return [
        `IP:      ${data.query}`,
        `Country: ${data.country}`,
        `Region:  ${data.regionName}`,
        `City:    ${data.city}`,
        `ISP:     ${data.isp}`,
        `Org:     ${data.org}`,
        `ASN:     ${data.as}`,
      ].join('\n');
    } catch {
      return out || 'Failed to get IP info';
    }
  },

  async traceroute(args) {
    const host    = args.host as string;
    const maxHops = (args.max_hops as number) || 20;
    // Try traceroute, then tracepath as fallback
    const tr  = await sh('which traceroute');
    const cmd = tr.startsWith('/') ? `traceroute -m ${maxHops} ${host}` : `tracepath -m ${maxHops} ${host}`;
    return sh(cmd, 60000);
  },
};
