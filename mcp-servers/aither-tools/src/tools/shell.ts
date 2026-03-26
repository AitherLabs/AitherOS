import { exec, execFile }     from 'node:child_process';
import fs                     from 'node:fs/promises';
import path                   from 'node:path';
import os                     from 'node:os';
import { promisify }          from 'node:util';
import { WORKSPACE, MAX_TIMEOUT_S, safeResolve } from '../config.js';

const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runInShell(
  command: string,
  cwd: string,
  timeoutS: number,
  env?: Record<string, string>
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout:  timeoutS * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      env: { ...process.env, ...env },
      shell: '/bin/bash',
    });
    let out = '';
    if (stdout) out += stdout;
    if (stderr) out += (out ? '\n[stderr]\n' : '[stderr]\n') + stderr;
    return out.trimEnd() || '(no output)';
  } catch (err: any) {
    if (err.killed || err.signal === 'SIGTERM') return `[timeout after ${timeoutS}s]`;
    const out: string[] = [];
    if (err.stdout) out.push(err.stdout);
    if (err.stderr) out.push(err.stderr);
    if (err.code !== undefined) out.push(`[exit code ${err.code}]`);
    return out.join('\n').trimEnd() || `[error] ${err.message}`;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'run_command',
    description:
      'Execute a shell command. Runs in the workforce workspace by default. ' +
      'Supports pipes, redirects, and all bash features. Output is captured and returned.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        command:   { type: 'string', description: 'Shell command to execute' },
        cwd:       { type: 'string', description: 'Working directory (defaults to workspace root)' },
        timeout_s: { type: 'number', description: `Timeout in seconds (default: 60, max: ${MAX_TIMEOUT_S})` },
        env:       { type: 'object', description: 'Extra environment variables to set', additionalProperties: { type: 'string' } },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_script',
    description:
      'Run inline code as a script file. Supported: python3, bash, sh, node, ruby, perl. ' +
      'Script is written to a temp file, executed, then cleaned up. Runs in workspace dir.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        language:  { type: 'string', description: 'Script language', enum: ['python3', 'python', 'bash', 'sh', 'node', 'ruby', 'perl'] },
        code:      { type: 'string', description: 'Script source code' },
        timeout_s: { type: 'number', description: 'Timeout in seconds (default: 60)' },
        args:      { type: 'array',  description: 'Arguments to pass to the script', items: { type: 'string' } },
      },
      required: ['language', 'code'],
    },
  },
  {
    name: 'which',
    description: 'Check if a binary/command is installed and find its path. Also returns version if detectable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Command name to look up' },
      },
      required: ['name'],
    },
  },
  {
    name: 'run_background',
    description:
      'Start a long-running command in the background (detached). ' +
      'stdout/stderr are written to a log file in the workspace. ' +
      'Returns the PID and log file path.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        command:  { type: 'string', description: 'Command to run in background' },
        log_file: { type: 'string', description: 'Log file name within workspace (default: auto-generated)' },
        cwd:      { type: 'string', description: 'Working directory (defaults to workspace)' },
      },
      required: ['command'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

const LANG_EXT: Record<string, string> = {
  python3: 'py', python: 'py', bash: 'sh', sh: 'sh',
  node: 'js', ruby: 'rb', perl: 'pl',
};

const LANG_BIN: Record<string, string> = {
  python3: 'python3', python: 'python3', bash: 'bash', sh: 'sh',
  node: 'node', ruby: 'ruby', perl: 'perl',
};

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async run_command(args) {
    const rawCwd   = (args.cwd as string) || WORKSPACE;
    const cwd      = safeResolve(rawCwd);
    const timeout  = Math.min((args.timeout_s as number) || 60, MAX_TIMEOUT_S);
    const env      = (args.env as Record<string, string>) || {};
    return runInShell(args.command as string, cwd, timeout, env);
  },

  async run_script(args) {
    const lang     = args.language as string;
    const ext      = LANG_EXT[lang] || 'sh';
    const bin      = LANG_BIN[lang] || lang;
    const timeout  = Math.min((args.timeout_s as number) || 60, MAX_TIMEOUT_S);
    const extraArgs = ((args.args as string[]) || []).join(' ');

    const tmpFile  = path.join(os.tmpdir(), `aither_script_${Date.now()}.${ext}`);
    try {
      await fs.writeFile(tmpFile, args.code as string, 'utf8');
      await fs.chmod(tmpFile, 0o755);
      return await runInShell(`${bin} ${tmpFile} ${extraArgs}`, WORKSPACE, timeout);
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  },

  async which(args) {
    const name = args.name as string;
    try {
      const { stdout: binPath } = await execAsync(`which ${name}`);
      const location = binPath.trim();
      // Try to get version
      let version = '';
      for (const flag of ['--version', '-V', '-v', 'version']) {
        try {
          const { stdout, stderr } = await execAsync(`${name} ${flag} 2>&1`, { timeout: 3000 });
          const line = (stdout || stderr).split('\n')[0].trim();
          if (line) { version = line; break; }
        } catch { /* skip */ }
      }
      return [`✓ ${name} found at ${location}`, version ? `  version: ${version}` : ''].filter(Boolean).join('\n');
    } catch {
      return `✗ ${name} is not installed or not in PATH`;
    }
  },

  async run_background(args) {
    const { spawn } = await import('node:child_process');
    const rawCwd   = (args.cwd as string) || WORKSPACE;
    const cwd      = safeResolve(rawCwd);
    const logName  = (args.log_file as string) || `bg_${Date.now()}.log`;
    const logPath  = path.join(WORKSPACE, logName);

    const logFd    = await fs.open(logPath, 'a');
    const child    = spawn('/bin/bash', ['-c', args.command as string], {
      cwd,
      detached: true,
      stdio: ['ignore', logFd.fd, logFd.fd],
    });
    child.unref();
    await logFd.close();

    return [
      `Started background process.`,
      `PID:     ${child.pid}`,
      `Log:     ${logName}`,
      `Command: ${args.command}`,
    ].join('\n');
  },
};
