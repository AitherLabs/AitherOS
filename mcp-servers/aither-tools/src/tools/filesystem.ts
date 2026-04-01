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

type OutputFormat = 'json' | 'text';

function outputFormat(args: Record<string, unknown>): OutputFormat {
  const raw = String(args.format ?? '').toLowerCase();
  return raw === 'text' ? 'text' : 'json';
}

function respond(format: OutputFormat, payload: unknown, text: string): string {
  return format === 'json' ? JSON.stringify(payload, null, 2) : text;
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
        format:   { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:      { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:  { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:    { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:      { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:  { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:           { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format: { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format: { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format:    { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format: { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
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
        format: { type: 'string', description: 'Output format: json (default) or text', enum: ['json', 'text'] },
      },
      required: ['src', 'dst'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async read_file(args) {
    const format = outputFormat(args);
    const resolved  = safeResolve(args.path as string);
    const encoding  = (args.encoding as BufferEncoding) || 'utf8';
    const content   = await fs.readFile(resolved, encoding);
    const rel = path.relative(WORKSPACE, resolved);
    if (args.start_line !== undefined || args.end_line !== undefined) {
      const lines = (content as string).split('\n');
      const start = (args.start_line as number ?? 1) - 1;
      const end   = args.end_line as number ?? lines.length;
      const sliced = lines.slice(start, end).join('\n');
      return respond(
        format,
        {
          ok: true,
          action: 'read_file',
          path: rel,
          encoding,
          start_line: start + 1,
          end_line: end,
          content: sliced,
        },
        sliced,
      );
    }
    return respond(
      format,
      {
        ok: true,
        action: 'read_file',
        path: rel,
        encoding,
        content: content as string,
      },
      content as string,
    );
  },

  async write_file(args) {
    const format = outputFormat(args);
    const resolved    = safeResolve(args.path as string);
    const createDirs  = args.create_dirs !== false;
    if (createDirs) await fs.mkdir(path.dirname(resolved), { recursive: true });
    const encoding = (args.encoding as BufferEncoding) || 'utf8';
    await fs.writeFile(resolved, args.content as string, encoding);
    const stat = await fs.stat(resolved);
    const rel = path.relative(WORKSPACE, resolved);
    return respond(
      format,
      { ok: true, action: 'write_file', path: rel, bytes: stat.size, size_human: fmtBytes(stat.size), encoding },
      `Written ${fmtBytes(stat.size)} to ${rel}`,
    );
  },

  async append_to_file(args) {
    const format = outputFormat(args);
    const resolved = safeResolve(args.path as string);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const prefix = args.newline !== false ? '\n' : '';
    await fs.appendFile(resolved, prefix + (args.content as string), 'utf8');
    const rel = path.relative(WORKSPACE, resolved);
    return respond(
      format,
      { ok: true, action: 'append_to_file', path: rel, prepended_newline: args.newline !== false },
      `Appended to ${rel}`,
    );
  },

  async patch_file(args) {
    const format = outputFormat(args);
    const resolved = safeResolve(args.path as string);
    let content    = await fs.readFile(resolved, 'utf8');
    const oldText  = args.old_text as string;
    const newText  = args.new_text as string;
    if (!content.includes(oldText)) {
      return respond(
        format,
        { ok: false, action: 'patch_file', path: path.relative(WORKSPACE, resolved), error: 'text not found' },
        `ERROR: text not found in ${args.path}`,
      );
    }
    content = args.all
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    await fs.writeFile(resolved, content, 'utf8');
    const rel = path.relative(WORKSPACE, resolved);
    return respond(
      format,
      { ok: true, action: 'patch_file', path: rel, replace_all: !!args.all },
      `Patched ${rel}`,
    );
  },

  async list_directory(args) {
    const format = outputFormat(args);
    const base     = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const entries  = await fs.readdir(base, { withFileTypes: true });
    const filtered = args.show_hidden ? entries : entries.filter(e => !e.name.startsWith('.'));

    const payloadItems: Array<Record<string, unknown>> = [];
    const lines: string[] = [];
    for (const e of filtered) {
      const full  = path.join(base, e.name);
      let label = e.name;
      const row: Record<string, unknown> = {
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      };
      if (args.show_stats) {
        try {
          const s = await fs.stat(full);
          row.modified_at = s.mtime.toISOString();
          if (!e.isDirectory()) {
            row.bytes = s.size;
            row.size_human = fmtBytes(s.size);
            label += `  (${fmtBytes(s.size)}, ${s.mtime.toISOString().slice(0, 10)})`;
          }
        } catch { /* skip */ }
      }
      payloadItems.push(row);
      lines.push(label);
    }
    return respond(
      format,
      {
        ok: true,
        action: 'list_directory',
        path: path.relative(WORKSPACE, base) || '.',
        count: payloadItems.length,
        entries: payloadItems,
      },
      lines.length ? lines.join('\n') : '(empty directory)',
    );
  },

  async search_files(args) {
    const format = outputFormat(args);
    const base    = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const matches = await globMatch(args.pattern as string, base);
    const relMatches = matches.map(m => path.relative(WORKSPACE, m));
    return respond(
      format,
      {
        ok: true,
        action: 'search_files',
        pattern: args.pattern as string,
        path: path.relative(WORKSPACE, base) || '.',
        count: relMatches.length,
        matches: relMatches,
      },
      relMatches.length ? relMatches.join('\n') : 'No files matched.',
    );
  },

  async grep_files(args) {
    const format = outputFormat(args);
    const base       = args.path ? safeResolve(args.path as string) : WORKSPACE;
    const flags      = args.case_insensitive ? 'i' : '';
    const maxResults = (args.max_results as number) || 100;
    const pattern    = new RegExp(args.pattern as string, flags);
    const results    = await grepRecursive(base, pattern, maxResults);
    if (!results.length) {
      return respond(
        format,
        {
          ok: true,
          action: 'grep_files',
          pattern: args.pattern as string,
          path: path.relative(WORKSPACE, base) || '.',
          count: 0,
          matches: [],
        },
        'No matches found.',
      );
    }

    const parsedMatches = results.map((entry) => {
      const first = entry.indexOf(':');
      const second = entry.indexOf(':', first + 1);
      if (first < 0 || second < 0) return { raw: entry };
      return {
        file: entry.slice(0, first),
        line: Number(entry.slice(first + 1, second)),
        text: entry.slice(second + 2),
      };
    });
    const truncated  = results.length >= maxResults ? `\n(truncated at ${maxResults} results)` : '';
    return respond(
      format,
      {
        ok: true,
        action: 'grep_files',
        pattern: args.pattern as string,
        path: path.relative(WORKSPACE, base) || '.',
        count: results.length,
        max_results: maxResults,
        truncated: results.length >= maxResults,
        matches: parsedMatches,
      },
      results.join('\n') + truncated,
    );
  },

  async get_file_info(args) {
    const format = outputFormat(args);
    const resolved = safeResolve(args.path as string);
    const stat     = await fs.stat(resolved);
    const rel      = path.relative(WORKSPACE, resolved);
    const text = [
      `Path:      ${rel}`,
      `Type:      ${stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file'}`,
      `Size:      ${fmtBytes(stat.size)}`,
      `Modified:  ${stat.mtime.toISOString()}`,
      `Created:   ${stat.birthtime.toISOString()}`,
      `Mode:      ${(stat.mode & 0o777).toString(8)}`,
    ].join('\n');
    return respond(
      format,
      {
        ok: true,
        action: 'get_file_info',
        path: rel,
        type: stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file',
        bytes: stat.size,
        size_human: fmtBytes(stat.size),
        modified_at: stat.mtime.toISOString(),
        created_at: stat.birthtime.toISOString(),
        mode: (stat.mode & 0o777).toString(8),
      },
      text,
    );
  },

  async create_directory(args) {
    const format = outputFormat(args);
    const resolved = safeResolve(args.path as string);
    await fs.mkdir(resolved, { recursive: true });
    const rel = path.relative(WORKSPACE, resolved);
    return respond(
      format,
      { ok: true, action: 'create_directory', path: rel },
      `Directory created: ${rel}`,
    );
  },

  async delete_path(args) {
    const format = outputFormat(args);
    const resolved = safeResolve(args.path as string);
    await fs.rm(resolved, { recursive: !!args.recursive, force: true });
    const rel = path.relative(WORKSPACE, resolved);
    return respond(
      format,
      { ok: true, action: 'delete_path', path: rel, recursive: !!args.recursive },
      `Deleted: ${rel}`,
    );
  },

  async move_path(args) {
    const format = outputFormat(args);
    const src = safeResolve(args.src as string);
    const dst = safeResolve(args.dst as string);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    const srcRel = path.relative(WORKSPACE, src);
    const dstRel = path.relative(WORKSPACE, dst);
    return respond(
      format,
      { ok: true, action: 'move_path', src: srcRel, dst: dstRel },
      `Moved: ${srcRel} → ${dstRel}`,
    );
  },

  async copy_path(args) {
    const format = outputFormat(args);
    const src = safeResolve(args.src as string);
    const dst = safeResolve(args.dst as string);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.cp(src, dst, { recursive: true });
    const srcRel = path.relative(WORKSPACE, src);
    const dstRel = path.relative(WORKSPACE, dst);
    return respond(
      format,
      { ok: true, action: 'copy_path', src: srcRel, dst: dstRel },
      `Copied: ${srcRel} → ${dstRel}`,
    );
  },
};
