import fs   from 'node:fs/promises';
import path from 'node:path';
import { WORKFORCE_ID, API_URL, safeResolve, apiHeaders } from '../config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postKnowledge(title: string, content: string): Promise<string> {
  if (!WORKFORCE_ID) {
    throw new Error('AITHER_WORKFORCE_ID is not set — knowledge tools unavailable');
  }

  const url = `${API_URL}/api/v1/workforces/${WORKFORCE_ID}/knowledge`;
  const res = await fetch(url, {
    method:  'POST',
    headers: apiHeaders(),
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
    name: 'knowledge_search',
    description:
      'Search the workforce knowledge base using semantic similarity (RAG). ' +
      'Returns the most relevant entries matching your query. Use this to actively ' +
      'recall past findings, decisions, summaries, or any information previously saved ' +
      'by you or your teammates across all executions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query:    { type: 'string',  description: 'Natural language search query' },
        limit:    { type: 'number',  description: 'Max results to return (default: 5, max: 20)' },
      },
      required: ['query'],
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

  async knowledge_search(args) {
    if (!WORKFORCE_ID) throw new Error('AITHER_WORKFORCE_ID is not set — knowledge tools unavailable');
    const query = (args.query as string).trim();
    if (!query) throw new Error('query is required');
    const limit = Math.min(Math.max(1, (args.limit as number) || 5), 20);

    const url = `${API_URL}/api/v1/workforces/${WORKFORCE_ID}/knowledge/search`;
    const res = await fetch(url, {
      method:  'POST',
      headers: apiHeaders(),
      body:    JSON.stringify({ query, limit }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Knowledge search returned ${res.status}: ${body}`);
    }

    const entries = await res.json() as Array<{ title: string; content: string; similarity?: number }>;
    if (!entries || entries.length === 0) return 'No relevant knowledge entries found for that query.';

    return entries.map((e, i) => {
      const sim = e.similarity != null ? ` (relevance: ${(e.similarity * 100).toFixed(0)}%)` : '';
      return `### ${i + 1}. ${e.title || 'Untitled'}${sim}\n${e.content}`;
    }).join('\n\n---\n\n');
  },

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
