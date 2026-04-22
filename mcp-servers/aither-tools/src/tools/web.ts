import https     from 'node:https';
import http      from 'node:http';
import fs        from 'node:fs/promises';
import path      from 'node:path';
import { createWriteStream } from 'node:fs';
import { load as cheerioLoad } from 'cheerio';
import { safeResolve, WORKSPACE, BRAVE_API_KEY, SEARXNG_URL, EXA_API_KEY, fmtBytes } from '../config.js';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function httpGet(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers, timeout: timeoutMs }, (res) => {
      // Follow redirects (up to 5)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, headers, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status:  res.statusCode || 0,
        headers: res.headers as Record<string, string>,
        body:    Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

async function httpRaw(
  method: string, url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 15000
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = url.startsWith('https') ? https : http;
    const opts   = {
      method,
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.pathname + parsed.search,
      headers:  {
        'User-Agent': 'Mozilla/5.0 (compatible; AitherOS/1.0)',
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
      timeout:  timeoutMs,
    };
    const req = mod.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status:  res.statusCode || 0,
        headers: res.headers as Record<string, string>,
        body:    Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── HTML → readable text ──────────────────────────────────────────────────────

function htmlToText(html: string, maxLen = 8000): string {
  const $ = cheerioLoad(html);

  // Strip noise
  $('script, style, nav, footer, header, aside, .nav, .menu, .sidebar, .cookie, .advertisement, .popup, .modal').remove();
  $('[style*="display:none"], [style*="display: none"], [hidden]').remove();

  // Prefer main content area
  const main = $('main, article, [role="main"], .content, .post-content, .entry-content, .article-body, #content, #main').first();
  const root = main.length ? main : $('body');

  const lines: string[] = [];

  root.find('h1,h2,h3,h4,h5,h6,p,li,pre,code,blockquote,table,tr,td,th').each((_, el) => {
    const tag  = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if      (tag === 'h1')                lines.push(`\n# ${text}`);
    else if (tag === 'h2')                lines.push(`\n## ${text}`);
    else if (tag === 'h3')                lines.push(`\n### ${text}`);
    else if (['h4','h5','h6'].includes(tag)) lines.push(`\n#### ${text}`);
    else if (tag === 'p')                 lines.push(text);
    else if (tag === 'li')                lines.push(`• ${text}`);
    else if (['pre','code'].includes(tag)) lines.push(`\`\`\`\n${text}\n\`\`\``);
    else if (tag === 'blockquote')        lines.push(`> ${text}`);
    else if (['td','th'].includes(tag))   lines.push(`| ${text}`);
  });

  const result = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + `\n\n...(truncated at ${maxLen} chars)`;
}

// ── Web search providers ──────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url:   string;
  snippet: string;
}

interface ExaResult {
  id?:            string;
  title?:         string;
  url?:           string;
  publishedDate?: string | null;
  author?:        string | null;
  text?:          string;
  highlights?:    string[];
  summary?:       string;
}

interface ExaResponse {
  requestId?: string;
  results:    ExaResult[];
}

export interface ExaSearchOptions {
  type?:               'auto' | 'neural' | 'fast';
  category?:           string;
  numResults?:         number;
  includeDomains?:     string[];
  excludeDomains?:     string[];
  startPublishedDate?: string;
  endPublishedDate?:   string;
  userLocation?:       string;
  contents?: {
    text?:       boolean | { maxCharacters?: number };
    highlights?: boolean | { numSentences?: number; highlightsPerUrl?: number };
    summary?:   boolean | { query?: string };
  };
}

export function pickExaSnippet(r: ExaResult, maxLen = 300): string {
  if (r.highlights && r.highlights.length) {
    const joined = r.highlights.join(' … ').replace(/\s+/g, ' ').trim();
    return joined.length > maxLen ? joined.slice(0, maxLen) + '…' : joined;
  }
  if (r.summary) {
    const s = r.summary.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  }
  if (r.text) {
    const t = r.text.replace(/\s+/g, ' ').trim();
    return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
  }
  return '';
}

export function buildExaRequest(query: string, opts: ExaSearchOptions = {}, apiKey = ''): {
  headers: Record<string, string>;
  body:    Record<string, unknown>;
} {
  const body: Record<string, unknown> = {
    query,
    type:       opts.type       ?? 'auto',
    numResults: opts.numResults ?? 10,
  };
  if (opts.category)           body.category           = opts.category;
  if (opts.includeDomains)     body.includeDomains     = opts.includeDomains;
  if (opts.excludeDomains)     body.excludeDomains     = opts.excludeDomains;
  if (opts.startPublishedDate) body.startPublishedDate = opts.startPublishedDate;
  if (opts.endPublishedDate)   body.endPublishedDate   = opts.endPublishedDate;
  if (opts.userLocation)       body.userLocation       = opts.userLocation;
  body.contents = opts.contents ?? { highlights: true, text: { maxCharacters: 500 } };

  return {
    headers: {
      'Content-Type':      'application/json',
      'Accept':            'application/json',
      'x-api-key':         apiKey,
      'x-exa-integration': 'aitheros',
    },
    body,
  };
}

export async function callExaSearch(
  query: string,
  opts: ExaSearchOptions = {},
  apiKey: string = EXA_API_KEY,
): Promise<ExaResponse> {
  const { headers, body } = buildExaRequest(query, opts, apiKey);
  const res = await httpRaw('POST', 'https://api.exa.ai/search', headers, JSON.stringify(body), 20000);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Exa API HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }
  const parsed = JSON.parse(res.body) as ExaResponse;
  return { requestId: parsed.requestId, results: parsed.results ?? [] };
}

async function searchExa(query: string, count: number): Promise<SearchResult[]> {
  const { results } = await callExaSearch(query, {
    type:       'auto',
    numResults: count,
    contents:   { highlights: true, text: { maxCharacters: 500 } },
  });
  return results.map((r) => ({
    title:   r.title || '',
    url:     r.url   || '',
    snippet: pickExaSnippet(r),
  }));
}

async function searchBrave(query: string, count: number): Promise<SearchResult[]> {
  const res = await httpGet(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY },
  );
  const data = JSON.parse(res.body);
  return (data?.web?.results || []).map((r: any) => ({
    title:   r.title || '',
    url:     r.url   || '',
    snippet: r.description || r.snippet || '',
  }));
}

async function searchSearxng(query: string, count: number): Promise<SearchResult[]> {
  const res = await httpGet(
    `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&results=${count}`,
  );
  const data = JSON.parse(res.body);
  return (data?.results || []).slice(0, count).map((r: any) => ({
    title:   r.title   || '',
    url:     r.url     || '',
    snippet: r.content || '',
  }));
}

async function searchDDG(query: string, count: number): Promise<SearchResult[]> {
  // DuckDuckGo HTML scraper fallback
  const res = await httpGet(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { 'User-Agent': 'Mozilla/5.0 (compatible; AitherOS/1.0)' },
  );
  const $       = cheerioLoad(res.body);
  const results: SearchResult[] = [];
  $('.result').slice(0, count).each((_, el) => {
    const title   = $('.result__title', el).text().trim();
    const href    = $('.result__url', el).text().trim();
    const snippet = $('.result__snippet', el).text().trim();
    if (title) results.push({ title, url: href ? `https://${href}` : '', snippet });
  });
  return results;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'web_search',
    description:
      'Search the web. Uses Exa if AITHER_EXA_KEY is set, ' +
      'Brave Search if AITHER_BRAVE_KEY is set, ' +
      'SearXNG if AITHER_SEARXNG_URL is set, otherwise DuckDuckGo. ' +
      'Returns titles, URLs and snippets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query:       { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default: 10, max: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'exa_search',
    description:
      'AI-powered web search via Exa (requires AITHER_EXA_KEY). ' +
      'Exposes Exa-specific features: neural/auto/fast search types, content modes ' +
      '(highlights, full text, AI summary), domain filters, date-range filters, ' +
      'and category search (company, research paper, news, personal site, ' +
      'financial report, people). Useful when you need semantic retrieval, ' +
      'site-restricted search, or ranked content snippets rather than raw links.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query:            { type: 'string', description: 'Search query' },
        type:             { type: 'string', description: 'Search type: auto (default), neural, fast', enum: ['auto', 'neural', 'fast'] },
        num_results:      { type: 'number', description: 'Number of results (default: 10, max: 25)' },
        category:         { type: 'string', description: 'Optional Exa category', enum: ['company', 'research paper', 'news', 'personal site', 'financial report', 'people'] },
        include_domains:  { type: 'array', items: { type: 'string' }, description: 'Restrict results to these domains' },
        exclude_domains:  { type: 'array', items: { type: 'string' }, description: 'Exclude these domains' },
        start_published:  { type: 'string', description: 'ISO 8601 earliest publish date (e.g. 2024-01-01)' },
        end_published:    { type: 'string', description: 'ISO 8601 latest publish date' },
        user_location:    { type: 'string', description: 'Two-letter ISO country code for geo-relevance' },
        content:          { type: 'string', description: 'Content mode: highlights (default), text, summary, full (text+highlights+summary)', enum: ['highlights', 'text', 'summary', 'full'] },
        summary_query:    { type: 'string', description: 'Optional query to focus the AI summary on a specific question' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch a URL and return its content. ' +
      'Format "text" strips HTML tags and returns readable text. ' +
      'Format "html" returns raw HTML. ' +
      'Format "json" parses and pretty-prints JSON.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url:        { type: 'string', description: 'URL to fetch' },
        format:     { type: 'string', description: 'Output format: text (default), html, json', enum: ['text', 'html', 'json'] },
        max_length: { type: 'number', description: 'Max chars to return (default: 8000)' },
        headers:    { type: 'object', description: 'Custom request headers', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
    },
  },
  {
    name: 'download_file',
    description: 'Download a file from a URL and save it to the workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url:       { type: 'string', description: 'URL to download' },
        dest_path: { type: 'string', description: 'Destination path in workspace (filename auto-detected if omitted)' },
        headers:   { type: 'object', description: 'Custom request headers', additionalProperties: { type: 'string' } },
      },
      required: ['url'],
    },
  },
  {
    name: 'http_request',
    description:
      'Make a raw HTTP request (GET, POST, PUT, PATCH, DELETE, HEAD). ' +
      'Useful for API calls, webhooks, testing endpoints.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        method:  { type: 'string', description: 'HTTP method', enum: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] },
        url:     { type: 'string', description: 'Request URL' },
        headers: { type: 'object', description: 'Request headers', additionalProperties: { type: 'string' } },
        body:    { type: 'string', description: 'Request body (JSON string or raw text)' },
        timeout_s: { type: 'number', description: 'Timeout in seconds (default: 15)' },
      },
      required: ['method', 'url'],
    },
  },
  {
    name: 'check_url',
    description: 'Check if a URL is reachable (HEAD request). Returns status code, headers and response time.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url:       { type: 'string', description: 'URL to check' },
        follow_redirects: { type: 'boolean', description: 'Follow redirects (default: true)' },
      },
      required: ['url'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async web_search(args) {
    const query = args.query as string;
    const count = Math.min((args.num_results as number) || 10, 20);

    let results: SearchResult[];
    let provider: string;

    if (EXA_API_KEY) {
      results  = await searchExa(query, count);
      provider = 'Exa';
    } else if (BRAVE_API_KEY) {
      results  = await searchBrave(query, count);
      provider = 'Brave Search';
    } else if (SEARXNG_URL) {
      results  = await searchSearxng(query, count);
      provider = 'SearXNG';
    } else {
      results  = await searchDDG(query, count);
      provider = 'DuckDuckGo';
    }

    if (!results.length) return 'No results found.';
    const lines = [`Search: "${query}" via ${provider} (${results.length} results)\n`];
    results.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}`);
      if (r.url)     lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
    });
    return lines.join('\n');
  },

  async exa_search(args) {
    if (!EXA_API_KEY) {
      return 'Exa search is not configured. Set AITHER_EXA_KEY to an Exa API key (https://dashboard.exa.ai/api-keys).';
    }

    const query = args.query as string;
    const count = Math.min((args.num_results as number) || 10, 25);
    const mode  = (args.content as string) || 'highlights';

    let contents: ExaSearchOptions['contents'];
    if (mode === 'text') {
      contents = { text: { maxCharacters: 1000 } };
    } else if (mode === 'summary') {
      contents = args.summary_query
        ? { summary: { query: args.summary_query as string } }
        : { summary: true };
    } else if (mode === 'full') {
      contents = {
        text:       { maxCharacters: 1000 },
        highlights: true,
        summary:    args.summary_query ? { query: args.summary_query as string } : true,
      };
    } else {
      contents = { highlights: true, text: { maxCharacters: 500 } };
    }

    const { results, requestId } = await callExaSearch(query, {
      type:               (args.type as ExaSearchOptions['type']) || 'auto',
      numResults:         count,
      category:           args.category as string | undefined,
      includeDomains:     args.include_domains as string[] | undefined,
      excludeDomains:     args.exclude_domains as string[] | undefined,
      startPublishedDate: args.start_published as string | undefined,
      endPublishedDate:   args.end_published   as string | undefined,
      userLocation:       args.user_location   as string | undefined,
      contents,
    });

    if (!results.length) return `No results found for "${query}".`;

    const header = requestId
      ? `Exa search: "${query}" (${results.length} results, req ${requestId})\n`
      : `Exa search: "${query}" (${results.length} results)\n`;
    const lines: string[] = [header];

    results.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title || '(untitled)'}`);
      if (r.url)           lines.push(`   ${r.url}`);
      if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
      if (r.author)        lines.push(`   Author: ${r.author}`);

      if (mode === 'full') {
        if (r.highlights?.length) lines.push(`   Highlights: ${r.highlights.join(' … ')}`);
        if (r.summary)            lines.push(`   Summary: ${r.summary.replace(/\s+/g, ' ').trim()}`);
        if (r.text)               lines.push(`   Text: ${r.text.slice(0, 500).replace(/\s+/g, ' ').trim()}${r.text.length > 500 ? '…' : ''}`);
      } else {
        const snippet = pickExaSnippet(r, 500);
        if (snippet) lines.push(`   ${snippet}`);
      }
    });

    return lines.join('\n');
  },

  async fetch_url(args) {
    const url     = args.url as string;
    const format  = (args.format as string) || 'text';
    const maxLen  = (args.max_length as number) || 8000;
    const headers = (args.headers as Record<string, string>) || {};

    const res = await httpGet(url, {
      'User-Agent': 'Mozilla/5.0 (compatible; AitherOS/1.0)',
      ...headers,
    });

    if (res.status < 200 || res.status >= 400) {
      return `HTTP ${res.status} — ${res.body.slice(0, 500)}`;
    }

    if (format === 'json') {
      try {
        return JSON.stringify(JSON.parse(res.body), null, 2).slice(0, maxLen);
      } catch {
        return res.body.slice(0, maxLen);
      }
    }
    if (format === 'html') return res.body.slice(0, maxLen);
    return htmlToText(res.body, maxLen);
  },

  async download_file(args) {
    const url     = args.url as string;
    const headers = (args.headers as Record<string, string>) || {};

    // Determine filename
    let filename = (args.dest_path as string) || path.basename(new URL(url).pathname) || `download_${Date.now()}`;
    if (!filename) filename = `download_${Date.now()}`;
    const destPath = safeResolve(filename);
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'AitherOS/1.0', ...headers } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          handlers.download_file({ ...args, url: res.headers.location }).then(resolve).catch(reject);
          return;
        }
        const stream = createWriteStream(destPath);
        res.pipe(stream);
        stream.on('finish', async () => {
          const stat = await fs.stat(destPath);
          resolve(`Downloaded ${fmtBytes(stat.size)} → ${path.relative(WORKSPACE, destPath)}`);
        });
        stream.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    });
  },

  async http_request(args) {
    const method    = (args.method as string).toUpperCase();
    const timeout   = ((args.timeout_s as number) || 15) * 1000;
    const headers   = (args.headers as Record<string, string>) || {};
    const body      = args.body as string | undefined;

    if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const start = Date.now();
    const res   = await httpRaw(method, args.url as string, headers, body, timeout);
    const ms    = Date.now() - start;

    const lines = [`HTTP ${res.status} (${ms}ms)`];
    const relevantHeaders = ['content-type','content-length','location','x-request-id','server'];
    for (const h of relevantHeaders) {
      if (res.headers[h]) lines.push(`${h}: ${res.headers[h]}`);
    }
    lines.push('');
    lines.push(res.body.length > 4000 ? res.body.slice(0, 4000) + '\n...(truncated)' : res.body);
    return lines.join('\n');
  },

  async check_url(args) {
    const url   = args.url as string;
    const start = Date.now();
    try {
      const mod = url.startsWith('https') ? https : http;
      const result = await new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
        const req = mod.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
          res.resume();
          resolve({ status: res.statusCode || 0, headers: res.headers as Record<string, string> });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      const ms = Date.now() - start;
      return [
        `Status: ${result.status} (${ms}ms)`,
        `Server: ${result.headers['server'] || 'unknown'}`,
        `Content-Type: ${result.headers['content-type'] || 'unknown'}`,
        result.headers['location'] ? `Redirect: ${result.headers['location']}` : '',
      ].filter(Boolean).join('\n');
    } catch (err: any) {
      return `Unreachable: ${err.message}`;
    }
  },
};
