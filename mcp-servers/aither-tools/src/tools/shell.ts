import { exec, execFile, spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs                     from 'node:fs/promises';
import path                   from 'node:path';
import os                     from 'node:os';
import { promisify }          from 'node:util';
import { WORKSPACE, MAX_TIMEOUT_S, safeResolve } from '../config.js';

const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Security ──────────────────────────────────────────────────────────────────

// Paths that agents must never be able to read or traverse.
const BLOCKED_PATH_PREFIXES = [
  '/etc/',
  '/root/',
  '/home/',
  '/proc/',
  '/sys/',
  '/run/',
  '/var/log/',
  '/var/run/',
  '/usr/local/etc/',
  '/.env',
];

// Env var names that must never be forwarded to child processes.
const BLOCKED_ENV_KEYS = /^(AITHER_API_TOKEN|SERVICE_TOKEN|DATABASE_URL|POSTGRES_|REDIS_URL|SECRET|PASSWORD|PRIVATE_KEY|AWS_|OPENAI_API_KEY|ANTHROPIC_API_KEY)/i;

/** Build a clean env for child processes — strips sensitive vars, keeps PATH and locale. */
function safeChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!BLOCKED_ENV_KEYS.test(k) && v !== undefined) safe[k] = v;
  }
  // Always pass extra (agent-supplied) env vars, but never let them override blocked keys.
  for (const [k, v] of Object.entries(extra)) {
    if (!BLOCKED_ENV_KEYS.test(k)) safe[k] = v;
  }
  return safe;
}

/** Check whether a shell command contains references to blocked paths.
 *
 * Defense-in-depth only — not a proper sandbox. For real isolation use Docker/seccomp.
 * Normalizes the command string before checking to catch common bypass attempts:
 *   - Removes shell quoting tricks: '', "", $'...'
 *   - Strips ANSI/backslash escapes within paths
 *   - Catches variable-assignment + direct use patterns
 */
function assertCommandSafe(command: string): void {
  // Build a normalized version for pattern matching while keeping original for error messages.
  // Strip common quoting escape tricks used to break string prefix matches.
  const normalized = command
    .replace(/['"]/g, '')           // strip single/double quotes
    .replace(/\\\s/g, '')           // strip backslash-space
    .replace(/\$'\S*'/g, '')        // strip $'...' ANSI-C quoting
    .replace(/\s+/g, ' ');          // collapse whitespace

  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (command.includes(prefix) || normalized.includes(prefix)) {
      throw new Error(
        `Command blocked: references restricted path '${prefix}'. ` +
        `Agents may only access the workforce workspace and allowed directories.`
      );
    }
  }

  // Block attempts to cd to a restricted directory then use relative paths.
  // e.g. "cd / && cat etc/passwd" or "cd /etc; ls"
  if (/\bcd\s+\/\s*[;&|]/.test(command)) {
    throw new Error(
      `Command blocked: 'cd /' followed by a chained command is not permitted.`
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ShellExecResult = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  error?: string;
};

type OutputFormat = 'json' | 'text';

function outputFormat(args: Record<string, unknown>): OutputFormat {
  const raw = String(args.format ?? '').toLowerCase();
  return raw === 'text' ? 'text' : 'json';
}

function respond(format: OutputFormat, payload: unknown, text: string): string {
  return format === 'json' ? JSON.stringify(payload, null, 2) : text;
}

function renderShellText(result: ShellExecResult): string {
  const out: string[] = [];
  if (result.stdout) out.push(result.stdout.trimEnd());
  if (result.stderr) out.push(`${out.length ? '' : ''}[stderr]\n${result.stderr.trimEnd()}`);
  if (result.timed_out) out.push('[timeout]');
  if (!result.timed_out && result.exit_code !== null && result.exit_code !== 0) out.push(`[exit code ${result.exit_code}]`);
  if (result.error && out.length === 0) out.push(`[error] ${result.error}`);
  return out.join('\n').trimEnd() || '(no output)';
}

async function runInShellDetailed(
  command: string,
  cwd: string,
  timeoutS: number,
  env?: Record<string, string>
): Promise<ShellExecResult> {
  assertCommandSafe(command);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout:  timeoutS * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      env: safeChildEnv(env),
      shell: '/bin/bash',
    });
    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exit_code: 0,
      timed_out: false,
    };
  } catch (err: any) {
    if (err.killed || err.signal === 'SIGTERM') {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exit_code: null,
        timed_out: true,
        error: `timeout after ${timeoutS}s`,
      };
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exit_code: typeof err.code === 'number' ? err.code : null,
      timed_out: false,
      error: err.message,
    };
  }
}

// ── Persistent shell sessions ─────────────────────────────────────────────────
// One long-running bash process per workspace path. Subsequent run_command
// calls reuse the same process so cd, exports, and installed packages persist.

interface ShellSession {
  proc: ChildProcessWithoutNullStreams;
  lastUsed: number;
  queue: Array<() => void>;
  running: boolean;
  stdoutBuf: string;
  stderrBuf: string;
}

const shellSessions = new Map<string, ShellSession>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, s] of shellSessions) {
    if (s.lastUsed < cutoff) {
      try { s.proc.kill(); } catch { /* */ }
      shellSessions.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getOrCreateSession(workspacePath: string): ShellSession {
  const existing = shellSessions.get(workspacePath);
  if (existing && existing.proc.exitCode === null) return existing;

  const proc = nodeSpawn('/bin/bash', ['--norc', '--noprofile'], {
    cwd: workspacePath,
    env: safeChildEnv(),
    stdio: 'pipe',
  });

  const session: ShellSession = {
    proc,
    lastUsed: Date.now(),
    queue: [],
    running: false,
    stdoutBuf: '',
    stderrBuf: '',
  };

  proc.stdout.on('data', (d: Buffer) => { session.stdoutBuf += d.toString(); });
  proc.stderr.on('data', (d: Buffer) => { session.stderrBuf += d.toString(); });
  proc.on('exit', () => { shellSessions.delete(workspacePath); });

  shellSessions.set(workspacePath, session);
  return session;
}

function runInSession(session: ShellSession, command: string, timeoutMs: number): Promise<ShellExecResult> {
  return new Promise<ShellExecResult>((resolve) => {
    const task = () => {
      session.lastUsed = Date.now();
      const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const sentinel = `__AITHER_${sid}`;
      const wrapped = `(${command})\n__ec__=$?\nprintf '\\n${sentinel}_%s\\n' "$__ec__"\n`;

      session.stdoutBuf = '';
      session.stderrBuf = '';

      const sentinelRe = new RegExp(`\n${sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\n`);

      const timer = setTimeout(() => {
        try { session.proc.stdin!.write('\x03'); } catch { /* */ }
        const out = session.stdoutBuf;
        const err = session.stderrBuf;
        session.stdoutBuf = '';
        session.stderrBuf = '';
        resolve({ stdout: out, stderr: err, exit_code: null, timed_out: true, error: `timeout after ${timeoutMs / 1000}s` });
        session.running = false;
        drainQueue(session);
      }, timeoutMs);

      const poll = setInterval(() => {
        const match = sentinelRe.exec(session.stdoutBuf);
        if (!match) return;
        clearInterval(poll);
        clearTimeout(timer);
        const sentinelStart = session.stdoutBuf.indexOf('\n' + sentinel);
        const stdout = session.stdoutBuf.slice(0, sentinelStart);
        const exitCode = parseInt(match[1], 10);
        session.stdoutBuf = session.stdoutBuf.slice(match.index + match[0].length);
        const stderr = session.stderrBuf;
        session.stderrBuf = '';
        resolve({ stdout, stderr, exit_code: exitCode, timed_out: false });
        session.running = false;
        drainQueue(session);
      }, 20);

      session.proc.stdin!.write(wrapped);
    };
    session.queue.push(task);
    if (!session.running) drainQueue(session);
  });
}

function drainQueue(session: ShellSession) {
  const next = session.queue.shift();
  if (!next) return;
  session.running = true;
  next();
}

// ── Docker exec mode ──────────────────────────────────────────────────────────
// When <workspace>/.aither_container exists, run commands via docker exec
// in the persistent container. cwd is tracked via /workspace/.aither_cwd.

async function getDockerContainer(workspacePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(workspacePath, '.aither_container'), 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function runInDocker(
  container: string,
  command: string,
  cwdArg: string | undefined,
  timeoutMs: number,
): Promise<ShellExecResult> {
  let effectiveCwd = '/workspace';
  if (cwdArg) {
    effectiveCwd = cwdArg.startsWith('/') ? cwdArg : `/workspace/${cwdArg}`;
  } else {
    try {
      const saved = await fs.readFile(path.join(WORKSPACE, '.aither_cwd'), 'utf8');
      if (saved.trim()) effectiveCwd = saved.trim();
    } catch { /* use default */ }
  }

  const wrapped = [
    `cd '${effectiveCwd}' 2>/dev/null || cd /workspace`,
    command,
    `echo $PWD > /workspace/.aither_cwd`,
  ].join(' && ');

  const dockerCmd = `docker exec ${container} bash -c ${JSON.stringify(wrapped)}`;
  return runInShellDetailed(dockerCmd, WORKSPACE, timeoutMs / 1000);
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
        format:    { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:    { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format: { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:   { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
    const format = outputFormat(args);
    const rawCwd   = args.cwd as string | undefined;
    const cwd      = rawCwd ? safeResolve(rawCwd) : WORKSPACE;
    const timeout  = Math.min((args.timeout_s as number) || 60, MAX_TIMEOUT_S);
    const env      = (args.env as Record<string, string>) || {};
    const command  = args.command as string;

    assertCommandSafe(command);

    const envPrefix = Object.entries(env)
      .filter(([k]) => !BLOCKED_ENV_KEYS.test(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    const fullCommand = envPrefix ? `${envPrefix} ${command}` : command;

    const container = await getDockerContainer(WORKSPACE);
    let result: ShellExecResult;
    if (container) {
      result = await runInDocker(container, fullCommand, rawCwd, timeout * 1000);
    } else {
      const session = getOrCreateSession(WORKSPACE);
      const cmdWithCwd = rawCwd && cwd !== WORKSPACE ? `cd '${cwd}' && ${fullCommand}` : fullCommand;
      result = await runInSession(session, cmdWithCwd, timeout * 1000);
    }

    return respond(
      format,
      {
        ok: !result.timed_out && result.exit_code === 0,
        action: 'run_command',
        command: args.command,
        cwd: rawCwd || '.',
        timeout_s: timeout,
        ...result,
      },
      renderShellText(result),
    );
  },

  async run_script(args) {
    const format = outputFormat(args);
    const lang     = args.language as string;
    const ext      = LANG_EXT[lang] || 'sh';
    const bin      = LANG_BIN[lang] || lang;
    const timeout  = Math.min((args.timeout_s as number) || 60, MAX_TIMEOUT_S);
    const extraArgs = ((args.args as string[]) || []).join(' ');
    const code     = args.code as string;

    // Check script contents for blocked paths too.
    assertCommandSafe(code);

    const tmpFile  = path.join(os.tmpdir(), `aither_script_${Date.now()}.${ext}`);
    try {
      await fs.writeFile(tmpFile, code, 'utf8');
      await fs.chmod(tmpFile, 0o755);
      const result = await runInShellDetailed(`${bin} ${tmpFile} ${extraArgs}`, WORKSPACE, timeout);
      return respond(
        format,
        {
          ok: !result.timed_out && result.exit_code === 0,
          action: 'run_script',
          language: lang,
          timeout_s: timeout,
          ...result,
        },
        renderShellText(result),
      );
    } finally {
      await fs.rm(tmpFile, { force: true });
    }
  },

  async which(args) {
    const format = outputFormat(args);
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
      return respond(
        format,
        { ok: true, action: 'which', name, found: true, path: location, version: version || null },
        [`${name} found at ${location}`, version ? `version: ${version}` : ''].filter(Boolean).join('\n'),
      );
    } catch {
      return respond(
        format,
        { ok: false, action: 'which', name, found: false },
        `${name} is not installed or not in PATH`,
      );
    }
  },

  async run_background(args) {
    const format = outputFormat(args);
    const { spawn } = await import('node:child_process');
    const rawCwd   = (args.cwd as string) || WORKSPACE;
    const cwd      = safeResolve(rawCwd);
    const command  = args.command as string;
    assertCommandSafe(command);
    const logName  = (args.log_file as string) || `bg_${Date.now()}.log`;
    const logPath  = safeResolve(path.join(WORKSPACE, logName));

    const logFd    = await fs.open(logPath, 'a');
    const child    = spawn('/bin/bash', ['-c', command], {
      cwd,
      detached: true,
      env: safeChildEnv(),
      stdio: ['ignore', logFd.fd, logFd.fd],
    });
    child.unref();
    await logFd.close();

    return respond(
      format,
      {
        ok: true,
        action: 'run_background',
        pid: child.pid,
        log_file: logName,
        cwd: path.relative(WORKSPACE, cwd) || '.',
        command: args.command,
      },
      [
        `Started background process.`,
        `PID:     ${child.pid}`,
        `Log:     ${logName}`,
        `Command: ${args.command}`,
      ].join('\n'),
    );
  },
};
