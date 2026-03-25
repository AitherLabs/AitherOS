import { exec }   from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fmtBytes } from '../config.js';

const execAsync = promisify(exec);

async function sh(cmd: string, timeout = 10000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return (stdout || stderr).trimEnd();
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').trimEnd();
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'system_info',
    description: 'Get system information: OS, CPU, memory, disk, uptime, hostname.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'check_tool',
    description: 'Check whether a CLI tool or binary is installed, its path and version.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Tool name (e.g. nmap, python3, curl, ffmpeg)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'install_package',
    description:
      'Install a package using a system package manager. ' +
      'Supports: apt, pip3, npm, cargo, gem, go. ' +
      'Auto-detects manager if not specified.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name:    { type: 'string', description: 'Package name to install' },
        manager: { type: 'string', description: 'Package manager to use', enum: ['apt','pip3','npm','cargo','gem','go'] },
        version: { type: 'string', description: 'Specific version (e.g. "==1.2.3" for pip, "@1.2.3" for npm)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_processes',
    description: 'List running processes. Optionally filter by name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'string', description: 'Filter processes by name (substring match)' },
        limit:  { type: 'number', description: 'Max processes to return (default: 30)' },
      },
      required: [],
    },
  },
  {
    name: 'kill_process',
    description: 'Send a signal to a process by PID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pid:    { type: 'number', description: 'Process ID' },
        signal: { type: 'string', description: 'Signal to send (default: SIGTERM)', enum: ['SIGTERM','SIGKILL','SIGHUP','SIGINT','SIGSTOP','SIGCONT'] },
      },
      required: ['pid'],
    },
  },
  {
    name: 'disk_usage',
    description: 'Show disk usage for a path or the overall filesystem.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to check (defaults to workspace)' },
      },
      required: [],
    },
  },
  {
    name: 'get_environment',
    description: 'List environment variables available to the agent process. Optionally filter by prefix.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prefix: { type: 'string', description: 'Only show variables starting with this prefix (e.g. "PATH", "AITHER")' },
      },
      required: [],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async system_info(_args) {
    const cpus   = os.cpus();
    const memFree = os.freemem();
    const memTotal = os.totalmem();
    const uptimeSec = os.uptime();
    const days  = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins  = Math.floor((uptimeSec % 3600) / 60);
    const dfOut = await sh('df -h / 2>/dev/null | tail -1');

    return [
      `Hostname:   ${os.hostname()}`,
      `OS:         ${os.type()} ${os.release()} (${os.arch()})`,
      `CPU:        ${cpus[0]?.model || 'unknown'} × ${cpus.length} cores`,
      `Memory:     ${fmtBytes(memFree)} free / ${fmtBytes(memTotal)} total`,
      `Uptime:     ${days}d ${hours}h ${mins}m`,
      `Disk (/):   ${dfOut || 'n/a'}`,
      `Node.js:    ${process.version}`,
      `PID:        ${process.pid}`,
    ].join('\n');
  },

  async check_tool(args) {
    const name = args.name as string;
    const location = await sh(`which ${name}`);
    if (!location || location.startsWith('which:') || location.includes('not found')) {
      return `✗ ${name} — not installed`;
    }
    // Try common version flags
    let version = '';
    for (const flag of ['--version', '-version', '-V', 'version', '--help']) {
      const out = await sh(`${name} ${flag} 2>&1 | head -3`);
      if (out && !out.toLowerCase().includes('unknown') && !out.startsWith('✗')) {
        version = out.split('\n')[0].trim();
        break;
      }
    }
    return [`✓ ${name}`, `   Path:    ${location}`, version ? `   Version: ${version}` : ''].filter(Boolean).join('\n');
  },

  async install_package(args) {
    const name    = args.name as string;
    const manager = args.manager as string | undefined;
    const version = (args.version as string) || '';

    // Auto-detect if not specified
    const mgr = manager || await (async () => {
      if ((await sh('which apt-get')).startsWith('/')) return 'apt';
      if ((await sh('which pip3')).startsWith('/')) return 'pip3';
      if ((await sh('which npm')).startsWith('/')) return 'npm';
      return 'pip3';
    })();

    let cmd: string;
    switch (mgr) {
      case 'apt':
      case 'apt-get':
        cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y ${name}${version ? `=${version}` : ''}`;
        break;
      case 'pip3':
      case 'pip':
        cmd = `pip3 install -q ${name}${version}`;
        break;
      case 'npm':
        cmd = `npm install -g ${name}${version ? `@${version.replace(/^[@=]/, '')}` : ''}`;
        break;
      case 'cargo':
        cmd = `cargo install ${name}${version ? ` --version ${version}` : ''}`;
        break;
      case 'gem':
        cmd = `gem install ${name}${version ? ` -v ${version}` : ''}`;
        break;
      case 'go':
        cmd = `go install ${name}${version ? `@${version}` : '@latest'}`;
        break;
      default:
        return `Unknown package manager: ${mgr}`;
    }

    const out = await sh(cmd, 120000);
    return `[${mgr}] install ${name}\n${out}`;
  },

  async list_processes(args) {
    const filter = args.filter as string | undefined;
    const limit  = (args.limit as number) || 30;
    let cmd = `ps aux --sort=-%cpu 2>/dev/null || ps aux`;
    const out = await sh(cmd);
    let lines = out.split('\n').filter(Boolean);
    const header = lines[0];
    let procs    = lines.slice(1);
    if (filter) procs = procs.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
    procs = procs.slice(0, limit);
    return [header, ...procs].join('\n');
  },

  async kill_process(args) {
    const pid    = args.pid as number;
    const signal = (args.signal as string) || 'SIGTERM';
    try {
      process.kill(pid, signal);
      return `Signal ${signal} sent to PID ${pid}`;
    } catch (e: any) {
      return `Failed to kill PID ${pid}: ${e.message}`;
    }
  },

  async disk_usage(args) {
    const target = (args.path as string) || '/';
    const out    = await sh(`df -h ${target} && du -sh ${target} 2>/dev/null | head -1`);
    return out || 'Unable to get disk usage';
  },

  async get_environment(args) {
    const prefix = args.prefix as string | undefined;
    const env    = process.env;
    const entries = Object.entries(env)
      .filter(([k]) => !prefix || k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => {
        // Mask sensitive values
        if (/key|secret|token|password|pass|pwd|auth|credential/i.test(k)) {
          return `${k}=****`;
        }
        return `${k}=${v}`;
      });
    return entries.join('\n') || '(no matching variables)';
  },
};
