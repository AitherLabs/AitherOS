import { exec }    from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs   from 'node:fs/promises';
import { WORKSPACE, safeResolve } from '../config.js';

const execAsync = promisify(exec);

async function git(args: string, cwd: string, timeoutMs = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // never prompt for credentials
    });
    return (stdout || stderr).trimEnd() || '(no output)';
  } catch (e: any) {
    return (e.stdout || e.stderr || e.message || '').trimEnd();
  }
}

function resolveRepoDir(dir?: unknown): string {
  if (!dir) return WORKSPACE;
  return safeResolve(dir as string);
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'git_clone',
    description: 'Clone a git repository into the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url:    { type: 'string', description: 'Repository URL (https or ssh)' },
        dir:    { type: 'string', description: 'Destination directory name within workspace (auto-detected from URL if omitted)' },
        depth:  { type: 'number', description: 'Shallow clone depth (1 = latest commit only, faster)' },
        branch: { type: 'string', description: 'Branch or tag to clone' },
      },
      required: ['url'],
    },
  },
  {
    name: 'git_status',
    description: 'Show git status of a repository in the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string', description: 'Repository directory (defaults to workspace root)' },
      },
      required: [],
    },
  },
  {
    name: 'git_log',
    description: 'Show recent commit history of a repository.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dir:    { type: 'string', description: 'Repository directory (defaults to workspace root)' },
        limit:  { type: 'number', description: 'Number of commits to show (default: 20)' },
        format: { type: 'string', description: 'Log format: oneline (default), short, full', enum: ['oneline', 'short', 'full'] },
        file:   { type: 'string', description: 'Show log only for a specific file' },
      },
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: 'Show changes in a repository (working tree, staged, or between commits).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dir:    { type: 'string',  description: 'Repository directory' },
        staged: { type: 'boolean', description: 'Show staged changes (default: false = working tree)' },
        ref:    { type: 'string',  description: 'Compare against a commit/branch (e.g. "HEAD~1", "main")' },
        file:   { type: 'string',  description: 'Diff a specific file only' },
      },
      required: [],
    },
  },
  {
    name: 'git_command',
    description:
      'Run any git command in a repository directory. ' +
      'E.g. "fetch --all", "checkout -b feature/x", "stash", "tag v1.0". ' +
      'Credentials prompting is disabled (use HTTPS token URLs or SSH keys).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        args:    { type: 'string', description: 'Git subcommand and flags (e.g. "fetch origin main")' },
        dir:     { type: 'string', description: 'Repository directory (defaults to workspace root)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 60)' },
      },
      required: ['args'],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage files and create a commit in a workspace repository.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Commit message' },
        dir:     { type: 'string', description: 'Repository directory' },
        files:   { type: 'array',  description: 'Files to stage (defaults to all changed: "git add -A")', items: { type: 'string' } },
        author:  { type: 'string', description: 'Author string (e.g. "Agent Name <agent@aitheros.io>")' },
      },
      required: ['message'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async git_clone(args) {
    const url    = args.url as string;
    const dir    = (args.dir as string) || path.basename(url, '.git');
    const dest   = safeResolve(dir);
    const depth  = args.depth ? `--depth ${args.depth}` : '';
    const branch = args.branch ? `-b ${args.branch}` : '';
    await fs.mkdir(WORKSPACE, { recursive: true });
    const result = await git(`clone ${depth} ${branch} ${url} ${dest}`, WORKSPACE, 120000);
    return result;
  },

  async git_status(args) {
    const cwd = resolveRepoDir(args.dir);
    const out = await git('status', cwd);
    return out;
  },

  async git_log(args) {
    const cwd    = resolveRepoDir(args.dir);
    const limit  = (args.limit as number) || 20;
    const fmt    = (args.format as string) || 'oneline';
    const file   = args.file ? `-- ${args.file}` : '';
    const fmtArg = fmt === 'oneline' ? '--oneline' : `--format="${fmt}"`;
    return git(`log ${fmtArg} -n ${limit} ${file}`, cwd);
  },

  async git_diff(args) {
    const cwd    = resolveRepoDir(args.dir);
    const staged = args.staged ? '--cached' : '';
    const ref    = args.ref ? args.ref : '';
    const file   = args.file ? `-- ${args.file}` : '';
    return git(`diff ${staged} ${ref} ${file}`, cwd);
  },

  async git_command(args) {
    const cwd     = resolveRepoDir(args.dir);
    const timeout = ((args.timeout as number) || 60) * 1000;
    return git(args.args as string, cwd, timeout);
  },

  async git_commit(args) {
    const cwd    = resolveRepoDir(args.dir);
    const files  = args.files as string[] | undefined;
    const author = args.author as string | undefined;
    const msg    = args.message as string;

    const stageCmd = files?.length
      ? `add ${files.map(f => `"${f}"`).join(' ')}`
      : 'add -A';
    await git(stageCmd, cwd);

    const authorArg = author ? `--author="${author}"` : '';
    return git(`commit ${authorArg} -m "${msg.replace(/"/g, '\\"')}"`, cwd);
  },
};
