import fs   from 'node:fs/promises';
import path from 'node:path';
import { WORKFORCE_ID, API_URL, safeResolve } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postKnowledge(title: string, content: string): Promise<string> {
  if (!WORKFORCE_ID) {
    throw new Error('AITHER_WORKFORCE_ID is not set — knowledge tools unavailable');
  }

  const url = `${API_URL}/api/v1/workforces/${WORKFORCE_ID}/knowledge`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title, content }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Knowledge API returned ${res.status}: ${body}`);
  }

  const entry = await res.json() as { id: string; title: string };
  return `Saved to knowledge base — id: ${entry.id}, title: "${entry.title}"`;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'knowledge_add',
    description:
      'Save a piece of text directly into the workforce knowledge base. ' +
      'Use this to preserve important findings, summaries, decisions, or any ' +
      'information that future agents or executions should be able to recall.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title:   { type: 'string', description: 'Short descriptive title for this knowledge entry' },
        content: { type: 'string', description: 'The content to store (markdown supported)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'knowledge_ingest_file',
    description:
      'Read a file from the workspace and add its contents to the workforce knowledge base. ' +
      'Useful for ingesting generated .md files, reports, summaries, or any workspace artifact ' +
      'so it becomes searchable memory for future executions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file (relative to workspace or absolute within allowed roots)' },
        title:     { type: 'string', description: 'Optional title override — defaults to the filename' },
      },
      required: ['file_path'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async knowledge_add(args) {
    const content = (args.content as string).trim();
    const title   = ((args.title as string) || '').trim();
    if (!content) throw new Error('content is required');
    return postKnowledge(title, content);
  },

  async knowledge_ingest_file(args) {
    const filePath = safeResolve(args.file_path as string);
    const content  = await fs.readFile(filePath, 'utf8');
    const title    = ((args.title as string) || '').trim() || path.basename(filePath);
    if (!content.trim()) throw new Error(`File is empty: ${filePath}`);
    return postKnowledge(title, content);
  },

};
