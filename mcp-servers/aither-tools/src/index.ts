#!/usr/bin/env node
/**
 * Aither-Tools — Official AitherOS MCP Server
 * Provides filesystem, shell, web, system, git and network capabilities
 * to all agents in an AitherOS workforce.
 *
 * Environment variables:
 *   AITHER_WORKSPACE       — absolute path to workforce workspace (required)
 *   AITHER_WORKFORCE_NAME  — workforce name (used if WORKSPACE is not set)
 *   AITHER_BRAVE_KEY       — Brave Search API key (optional, enables web search)
 *   AITHER_SEARXNG_URL     — SearXNG base URL (optional, self-hosted search)
 *   AITHER_MAX_TIMEOUT_S   — max shell command timeout in seconds (default: 300)
 *
 * © AitherLabs — https://aitheros.io
 */

import { Server }              from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE, NOTES_DIR, TOOLS_DIR, WORKFORCE_NAME, VERSION } from './config.js';

// ── Import all tool modules ───────────────────────────────────────────────────

import * as filesystem from './tools/filesystem.js';
import * as shell      from './tools/shell.js';
import * as web        from './tools/web.js';
import * as system     from './tools/system.js';
import * as workspace  from './tools/workspace.js';
import * as git        from './tools/git.js';
import * as network    from './tools/network.js';

// ── Merge all tool definitions and handlers ───────────────────────────────────

const ALL_TOOLS = [
  ...filesystem.tools,
  ...shell.tools,
  ...web.tools,
  ...system.tools,
  ...workspace.tools,
  ...git.tools,
  ...network.tools,
];

const ALL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  ...filesystem.handlers,
  ...shell.handlers,
  ...web.handlers,
  ...system.handlers,
  ...workspace.handlers,
  ...git.handlers,
  ...network.handlers,
};

// ── Bootstrap workspace directories ──────────────────────────────────────────

async function ensureWorkspaceDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(WORKSPACE,  { recursive: true }),
    fs.mkdir(NOTES_DIR,  { recursive: true }),
    fs.mkdir(TOOLS_DIR,  { recursive: true }),
  ]);
}

// ── Create and configure the MCP server ──────────────────────────────────────

const server = new Server(
  {
    name:    'aither-tools',
    version: VERSION,
  },
  {
    capabilities: { tools: {} },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS.map(t => ({
    name:        t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// Dispatch tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const handler = ALL_HANDLERS[name];
  if (!handler) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await handler(args as Record<string, unknown>);
    return {
      content: [{ type: 'text' as const, text: result }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `[${name} error] ${message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await ensureWorkspaceDirs();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio MCP protocol
  process.stderr.write(
    `[Aither-Tools v${VERSION}] Ready — workforce: ${WORKFORCE_NAME} — workspace: ${WORKSPACE} — ${ALL_TOOLS.length} tools loaded\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[Aither-Tools] Fatal: ${err}\n`);
  process.exit(1);
});
