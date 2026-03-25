import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WORKSPACE, NOTES_DIR, WORKFORCE_NAME, fmtBytes, safeResolve } from '../config.js';

const execAsync = promisify(exec);

async function sh(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
    return (stdout || stderr).trimEnd();
  } catch (e: any) { return (e.stdout || e.stderr || e.message || '').trimEnd(); }
}

// ── Tree builder ──────────────────────────────────────────────────────────────

async function buildTree(dir: string, depth: number, maxDepth: number, prefix = ''): Promise<string[]> {
  if (depth > maxDepth) return [`${prefix}...`];
  let entries: Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return [`${prefix}(unreadable)`]; }

  entries = entries
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e       = entries[i];
    const isLast  = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPfx   = isLast ? '    ' : '│   ';

    if (e.isDirectory()) {
      lines.push(`${prefix}${connector}📁 ${e.name}/`);
      lines.push(...await buildTree(path.join(dir, e.name), depth + 1, maxDepth, prefix + nextPfx));
    } else {
      let extra = '';
      try {
        const s = await fs.stat(path.join(dir, e.name));
        extra = ` (${fmtBytes(s.size)})`;
      } catch { /* skip */ }
      lines.push(`${prefix}${connector}📄 ${e.name}${extra}`);
    }
  }
  return lines;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'workspace_overview',
    description:
      'Get an overview of the current workforce workspace: path, size, file count, and recent activity.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'workspace_tree',
    description: 'Show the workspace directory tree up to a given depth.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        depth: { type: 'number', description: 'Max depth to display (default: 3)' },
        path:  { type: 'string', description: 'Subdirectory to tree (defaults to workspace root)' },
      },
      required: [],
    },
  },
  {
    name: 'notes_read',
    description:
      'Read the persistent notes file for this workforce. ' +
      'Notes survive across executions — use them for accumulated knowledge and observations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'Notes file name (default: notes.md)' },
      },
      required: [],
    },
  },
  {
    name: 'notes_write',
    description:
      'Write or append to the persistent notes file for this workforce. ' +
      'Append mode is recommended to preserve prior entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'Content to write' },
        file:    { type: 'string', description: 'Notes file name (default: notes.md)' },
        append:  { type: 'boolean', description: 'Append to existing file (default: true)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'workspace_search',
    description: 'Full-text search across all files in the workspace (wrapper around grep -r).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query:   { type: 'string',  description: 'Text or regex to search for' },
        case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default: false)' },
        include: { type: 'string',  description: 'File glob to restrict search (e.g. "*.py")' },
      },
      required: ['query'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async workspace_overview(_args) {
    await fs.mkdir(WORKSPACE, { recursive: true });
    await fs.mkdir(NOTES_DIR,  { recursive: true });

    // Count files and compute total size
    const countOut = await sh(`find ${WORKSPACE} -type f 2>/dev/null | wc -l`);
    const sizeOut  = await sh(`du -sh ${WORKSPACE} 2>/dev/null | cut -f1`);

    // Recent files
    const recentOut = await sh(`find ${WORKSPACE} -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -5 | awk '{print $2}'`);
    const recentFiles = recentOut
      .split('\n')
      .filter(Boolean)
      .map(f => `  • ${path.relative(WORKSPACE, f)}`);

    // Notes file exists?
    const notesPath  = path.join(NOTES_DIR, 'notes.md');
    const notesExist = await fs.stat(notesPath).then(() => true).catch(() => false);

    return [
      `Workforce:  ${WORKFORCE_NAME}`,
      `Workspace:  ${WORKSPACE}`,
      `Files:      ${countOut.trim() || '0'}`,
      `Size:       ${sizeOut.trim() || '0'}`,
      recentFiles.length ? `\nRecent files:\n${recentFiles.join('\n')}` : '',
      `\nNotes:      ${notesExist ? notesPath : '(no notes yet)'}`,
    ].filter(Boolean).join('\n');
  },

  async workspace_tree(args) {
    const maxDepth = (args.depth as number) || 3;
    const base     = args.path ? safeResolve(args.path as string) : WORKSPACE;
    await fs.mkdir(base, { recursive: true });
    const rel   = path.relative(WORKSPACE, base) || '.';
    const lines = [`📁 ${rel}/`, ...await buildTree(base, 1, maxDepth)];
    return lines.join('\n');
  },

  async notes_read(args) {
    await fs.mkdir(NOTES_DIR, { recursive: true });
    const file = path.join(NOTES_DIR, (args.file as string) || 'notes.md');
    try {
      const content = await fs.readFile(file, 'utf8');
      return content || '(notes file is empty)';
    } catch {
      return '(no notes file yet — use notes_write to create one)';
    }
  },

  async notes_write(args) {
    await fs.mkdir(NOTES_DIR, { recursive: true });
    const file    = path.join(NOTES_DIR, (args.file as string) || 'notes.md');
    const content = args.content as string;
    const append  = args.append !== false;
    if (append) {
      const ts = new Date().toISOString();
      await fs.appendFile(file, `\n\n---\n<!-- ${ts} -->\n${content}`, 'utf8');
    } else {
      await fs.writeFile(file, content, 'utf8');
    }
    return `Notes ${append ? 'appended' : 'written'} to ${path.relative(NOTES_DIR, file)}`;
  },

  async workspace_search(args) {
    const query   = args.query as string;
    const flags   = args.case_sensitive ? '' : '-i';
    const include = args.include ? `--include="${args.include}"` : '';
    const cmd     = `grep -r ${flags} ${include} --line-number --max-count=5 -m 100 "${query.replace(/"/g, '\\"')}" ${WORKSPACE} 2>/dev/null | head -100`;
    const out     = await sh(cmd);
    if (!out) return 'No matches found.';
    // Make paths relative
    return out.split('\n').map(l => l.replace(WORKSPACE + '/', '')).join('\n');
  },
};
