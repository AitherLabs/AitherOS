import path from 'node:path';

const workforceName = process.env.AITHER_WORKFORCE_NAME || 'default';
const rawWorkspace  = process.env.AITHER_WORKSPACE;

export const WORKSPACE = rawWorkspace
  ? path.resolve(rawWorkspace)
  : path.resolve(`/opt/AitherOS/workforces/${workforceName}/workspace`);

const workforceRoot = rawWorkspace
  ? path.resolve(rawWorkspace, '..')
  : path.resolve(`/opt/AitherOS/workforces/${workforceName}`);

export const NOTES_DIR      = path.join(workforceRoot, 'notes');
export const TOOLS_DIR      = path.join(workforceRoot, 'tools');
export const WORKFORCE_NAME = workforceName;
export const VERSION        = '1.0.0';

export const MAX_TIMEOUT_S  = parseInt(process.env.AITHER_MAX_TIMEOUT_S  || '300', 10);
export const BRAVE_API_KEY  = process.env.AITHER_BRAVE_KEY   || '';
export const SEARXNG_URL    = process.env.AITHER_SEARXNG_URL || '';
export const WORKFORCE_ID   = process.env.AITHER_WORKFORCE_ID || '';
export const API_URL        = process.env.AITHER_API_URL      || 'http://127.0.0.1:8080';

const ALLOWED_ROOTS = [WORKSPACE, NOTES_DIR, TOOLS_DIR];

/** Resolve a user-supplied path and assert it stays within allowed roots. */
export function safeResolve(inputPath: string, base: string = WORKSPACE): string {
  const resolved = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(base, inputPath);

  const ok = ALLOWED_ROOTS.some(
    r => resolved === r || resolved.startsWith(r + path.sep)
  );

  if (!ok) {
    throw new Error(
      `Path traversal blocked: '${inputPath}' resolves to '${resolved}' ` +
      `which is outside workspace. Allowed: ${ALLOWED_ROOTS.join(', ')}`
    );
  }
  return resolved;
}

/** Format bytes to human-readable string. */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
