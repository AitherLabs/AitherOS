import fs   from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { safeResolve, WORKSPACE, fmtBytes } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function globMatch(pattern: string, dir: string): Promise<string[]> {
  // Simple recursive glob — supports * and ** wildcards
  const parts  = pattern.split('/');
  const isGlob = (s: string) => s.includes('*') || s.includes('?');

  async function walk(base: string, parts: string[]): Promise<string[]> {
    if (parts.length === 0) return [base];
    const [head, ...rest] = parts;

    if (head === '**') {
      const entries: Dirent[] = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      const results: string[] = [];
      for (const e of entries) {
        const full = path.join(base, e.name);
        if (e.isDirectory()) results.push(...await walk(full, parts));
        if (!isGlob(rest[0] ?? '') || matchGlob(e.name, rest[0] ?? '*'))
          results.push(...await walk(full, rest));
      }
      return results;
    }

    if (isGlob(head)) {
      const entries: Dirent[] = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      const results: string[] = [];
      for (const e of entries) {
        if (matchGlob(e.name, head)) {
          const full = path.join(base, e.name);
          results.push(...await walk(full, rest));
        }
      }
      return results;
    }

    return walk(path.join(base, head), rest);
  }

  const matches = await walk(dir, parts);
  return matches.filter(m => m !== dir);
}

function matchGlob(name: string, pattern: string): boolean {
  const re = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(re, 'i').test(name);
}

async function grepRecursive(
  dir: string,
  pattern: RegExp,
  maxResults = 200
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string) {
    if (results.length >= maxResults) return;
    let entries: Dirent[];
    try { entries = await fs.readdir(current, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      if (results.length >= maxResults) break;
      const full = path.join(current, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      try {
        const content = await fs.readFile(full, 'utf8');
        const lines   = content.split('\n');
        lines.forEach((line, i) => {
          if (results.length < maxResults && pattern.test(line)) {
            const rel = path.relative(dir, full);
            results.push(`${rel}:${i + 1}: ${line.trimEnd()}`);
          }
        });
      } catch { /* binary or unreadable — skip */ }
    }
  }

  await walk(dir);
  return results;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:     { type: 'string', description: 'File path (relative to workspace or absolute within it)' },
        encoding: { type: 'string', description: 'Encoding: utf8 (default), base64, hex', enum: ['utf8', 'base64', 'hex'] },
        start_line: { type: 'number', description: 'First line to return (1-based, optional)' },
        end_line:   { type: 'number', description: 'Last line to return (1-based, optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the workspace. Creates parent directories automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:        { type: 'string', description: 'File path (relative to workspace)' },
        content:     { type: 'string', description: 'Content to write' },
        encoding:    { type: 'string', description: 'Encoding: utf8 (default) or base64', enum: ['utf8', 'base64'] },
        create_dirs: { type: 'boolean', description: 'Create parent directories if missing (default: true)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append_to_file',
    description: 'Append text to an existing file (or create it if it does not exist).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:    { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to append' },
        newline: { type: 'boolean', description: 'Prepend a newline before content (default: true)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description: 'Find and replace text in a file. Useful for targeted edits without rewriting the whole file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:      { type: 'string',  description: 'File path' },
        old_text:  { type: 'string',  description: 'Exact text to find' },
        new_text:  { type: 'string',  description: 'Replacement text' },
        all:       { type: 'boolean', description: 'Replace all occurrences (default: false, replaces first only)' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a given path in the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:        { type: 'string',  description: 'Directory path (defaults to workspace root)' },
        show_hidden: { type: 'boolean', description: 'Include hidden files (dot-files)' },
        show_stats:  { type: 'boolean', description: 'Include file size and modification time' },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: 'Find files matching a glob pattern in the workspace (e.g. "**/*.py", "reports/*.md").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path:    { type: 'string', description: 'Search root (defaults to workspace root)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_files',
    description: 'Search file contents for a pattern, recursively. Returns file path, line number, and matched line.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pattern:          { type: 'string',  description: 'Search pattern (regex supported)' },
        path:             { type: 'string',  description: 'Search root (defaults to workspace)' },
        case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
        max_results:      { type: 'number',  description: 'Maximum results to return (default: 100)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Get metadata about a file or directory: size, type, permissions, timestamps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File or directory path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and parents) in the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path to create' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_path',
    description: 'Delete a file or directory from the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path:      { type: 'string',  description: 'Path to delete' },
        recursive: { type: 'boolean', description: 'Delete directory and all contents (required for non-empty dirs)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_path',
    description: 'Move or rename a file or directory within the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        src: { type: 'string', description: 'Source path' },
        dst: { type: 'string', description: 'Destination path' },
      },
      required: ['src', 'dst'],
    },
  },
  {
    name: 'copy_path',
    description: 'Copy a file or directory within the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        src: { type: 'string', description: 'Source path' },
        dst: { type: 'string', description: 'Destination path' },
      },
      required: ['src', 'dst'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async read_file(args) {
    const resolved  = safeResolve(args.path as string);
    const encoding  = (args.encoding as BufferEncoding) || 'utf8';
    const content   = await fs.readFile(resolved, encoding);
    if (args.start_line !== undefined || args.end_line !== undefined) {
      const lines = (content as string).split('\n');
      const start = (args.start_line as number ?? 1) - 1;
      const end   = args.end_line as number ?? lines.length;
      return lines.slice(start, end).join('\n');
    }
    return content as string;
  },

  async write_file(args) {
    const resolved    = safeResolve(args.path as string);
    const createDirs  = args.create_dirs !== false;
    if (createDirs) await fs.mkdir(path.dirname(resolved), { recursive: true });
    const encoding = (args.encoding as BufferEncoding) || 'utf8';
    await fs.writeFile(resolved, args.content as string, encoding);
    const stat = await fs.stat(resolved);
    return `Written ${fmtBytes(stat.size)} to ${path.relative(WORKSPACE, resolved)}`;
  },

  async append_to_file(args) {
    const resolved = safeResolve(args.path as string);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const prefix = args.newline !== false ? '\n' : '';
    await fs.appendFile(resolved, prefix + (args.content as string), 'utf8');
    return `Appended to ${path.relative(WORKSPACE, resolved)}`;
  },

  async patch_file(args) {
    const resolved = safeResolve(args.path as string);
    let content    = await fs.readFile(resolved, 'utf8');
    const oldText  = args.old_text as string;
    const newText  = args.new_text as string;
    if (!content.includes(oldText)) return `ERROR: text not found in ${args.path}`;
    content = args.all
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    await fs.writeFile(resolved, content, 'utf8');
    return `Patched ${path.relative(WORKSPACE, resolved)}`;
  },

  async list_directory(args) {
    const base     = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const entries  = await fs.readdir(base, { withFileTypes: true });
    const filtered = args.show_hidden ? entries : entries.filter(e => !e.name.startsWith('.'));

    const lines: string[] = [];
    for (const e of filtered) {
      const full  = path.join(base, e.name);
      const icon  = e.isDirectory() ? '📁' : '📄';
      let   label = `${icon} ${e.name}`;
      if (args.show_stats) {
        try {
          const s = await fs.stat(full);
          label += e.isDirectory() ? '' : `  (${fmtBytes(s.size)}, ${s.mtime.toISOString().slice(0, 10)})`;
        } catch { /* skip */ }
      }
      lines.push(label);
    }
    return lines.length ? lines.join('\n') : '(empty directory)';
  },

  async search_files(args) {
    const base    = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const matches = await globMatch(args.pattern as string, base);
    if (!matches.length) return 'No files matched.';
    return matches.map(m => path.relative(WORKSPACE, m)).join('\n');
  },

  async grep_files(args) {
    const base       = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const flags      = args.case_insensitive ? 'i' : '';
    const maxResults = (args.max_results as number) || 100;
    const pattern    = new RegExp(args.pattern as string, flags);
    const results    = await grepRecursive(base, pattern, maxResults);
    if (!results.length) return 'No matches found.';
    const truncated  = results.length >= maxResults ? `\n(truncated at ${maxResults} results)` : '';
    return results.join('\n') + truncated;
  },

  async get_file_info(args) {
    const resolved = safeResolve(args.path as string);
    const stat     = await fs.stat(resolved);
    const rel      = path.relative(WORKSPACE, resolved);
    return [
      `Path:      ${rel}`,
      `Type:      ${stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file'}`,
      `Size:      ${fmtBytes(stat.size)}`,
      `Modified:  ${stat.mtime.toISOString()}`,
      `Created:   ${stat.birthtime.toISOString()}`,
      `Mode:      ${(stat.mode & 0o777).toString(8)}`,
    ].join('\n');
  },

  async create_directory(args) {
    const resolved = safeResolve(args.path as string);
    await fs.mkdir(resolved, { recursive: true });
    return `Directory created: ${path.relative(WORKSPACE, resolved)}`;
  },

  async delete_path(args) {
    const resolved = safeResolve(args.path as string);
    await fs.rm(resolved, { recursive: !!args.recursive, force: true });
    return `Deleted: ${path.relative(WORKSPACE, resolved)}`;
  },

  async move_path(args) {
    const src = safeResolve(args.src as string);
    const dst = safeResolve(args.dst as string);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return `Moved: ${path.relative(WORKSPACE, src)} → ${path.relative(WORKSPACE, dst)}`;
  },

  async copy_path(args) {
    const src = safeResolve(args.src as string);
    const dst = safeResolve(args.dst as string);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.cp(src, dst, { recursive: true });
    return `Copied: ${path.relative(WORKSPACE, src)} → ${path.relative(WORKSPACE, dst)}`;
  },
};
