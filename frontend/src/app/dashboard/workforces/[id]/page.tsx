'use client';

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCoins,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconExternalLink,
  IconFolder,
  IconKey,
  IconLink,
  IconLinkOff,
  IconLoader2,
  IconPaperclip,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconTool,
  IconTrash,
  IconX
} from '@tabler/icons-react';

const BRIEF_INTERVAL_OPTIONS = [
  { value: 0,    label: 'Manual only' },
  { value: 30,   label: 'Every 30 min' },
  { value: 60,   label: 'Every hour' },
  { value: 120,  label: 'Every 2 hours' },
  { value: 240,  label: 'Every 4 hours' },
  { value: 480,  label: 'Every 8 hours' },
  { value: 1440, label: 'Every 24 hours' },
];
import api, { Agent, AgentChat, Approval, Credential, Execution, ExecutionMode, KanbanTask, KnowledgeEntry, MCPServer, MCPToolDefinition, Project, Workforce, WorkspaceFileEntry } from '@/lib/api';
import { AvatarUpload } from '@/components/avatar-upload';
import { EntityAvatar } from '@/components/entity-avatar';
import { KanbanBoard } from '@/components/kanban-board';

// Per-server credential hints: what each MCP server's tools typically need via get_secret()
type CredHint = { service: string; key: string; label: string };
const SERVER_CREDENTIAL_HINTS: Record<string, CredHint[]> = {
  'Aither-Tools': [
    { service: 'github',    key: 'token',      label: 'GitHub personal access token — for git_clone and private repos' },
    { service: 'gitlab',    key: 'token',      label: 'GitLab personal access token — for private GitLab repos' },
    { service: 'npm',       key: 'token',      label: 'npm auth token — for publishing packages' },
  ],
  'GitHub Tools': [
    { service: 'github',    key: 'token',      label: 'GitHub personal access token' },
  ],
  'GitLab Tools': [
    { service: 'gitlab',    key: 'token',      label: 'GitLab personal access token' },
  ],
  'Slack Tools': [
    { service: 'slack',     key: 'bot_token',  label: 'Slack bot token (xoxb-…)' },
  ],
  'Jira Tools': [
    { service: 'jira',      key: 'api_key',    label: 'Jira API key' },
    { service: 'jira',      key: 'email',      label: 'Jira account email' },
    { service: 'jira',      key: 'url',        label: 'Jira instance URL' },
  ],
};

// Derive credential hints from a server's env vars (for servers not in the static map).
// Skips internal AITHER_* vars and already-set non-empty values.
function envVarCredHints(name: string, envVars: Record<string, string> = {}): CredHint[] {
  const hints: CredHint[] = [];
  const credPatterns = ['TOKEN', 'API_KEY', 'SECRET', 'PASSWORD'];
  for (const [k, v] of Object.entries(envVars)) {
    if (k.startsWith('AITHER_')) continue;
    if (v && v !== '') continue; // already configured
    if (credPatterns.some(p => k.includes(p))) {
      const svc = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = k.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      hints.push({ service: svc, key, label: `${k} — required by ${name}` });
    }
  }
  return hints;
}

const statusColors: Record<string, { color: string; bg: string; border: string }> = {
  draft: { color: '#FFBF47', bg: '#FFBF4715', border: '#FFBF4730' },
  planning: { color: '#14FFF7', bg: '#14FFF715', border: '#14FFF730' },
  executing: { color: '#9A66FF', bg: '#9A66FF15', border: '#9A66FF30' },
  completed: { color: '#56D090', bg: '#56D09015', border: '#56D09030' },
  failed: { color: '#EF4444', bg: '#EF444415', border: '#EF444430' },
  halted: { color: '#FFBF47', bg: '#FFBF4715', border: '#FFBF4730' },
  active: { color: '#56D090', bg: '#56D09015', border: '#56D09030' }
};

const execStatusColors: Record<string, { color: string; label: string }> = {
  running: { color: '#9A66FF', label: 'Running' },
  completed: { color: '#56D090', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  halted: { color: '#FFBF47', label: 'Halted' },
  pending_approval: { color: '#FFBF47', label: 'Awaiting Approval' },
  awaiting_approval: { color: '#56D090', label: 'Awaiting Approval' },
  planning: { color: '#14FFF7', label: 'Planning' }
};

const strategyInfo: Record<string, { label: string; desc: string; color: string }> = {
  simple: { label: 'Simple', desc: 'Single prompt, direct response', color: '#56D090' },
  react: { label: 'ReAct', desc: 'Thought → Action → Observation loop', color: '#9A66FF' },
  function_call: { label: 'Function Call', desc: 'OpenAI-style tool use', color: '#14FFF7' }
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatTime(s: number): string {
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`;
  if (s >= 60) return `${(s / 60).toFixed(0)}m`;
  return `${s}s`;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type WorkforceChatRole = 'user' | 'assistant' | 'error';

type WorkforceChatInputMode = 'text' | 'media';

interface WorkforceChatToolCall {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface WorkforceChatMeta {
  workforceId: string;
  inputMode?: WorkforceChatInputMode;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  taskTitle?: string;
  knowledgeId?: string;
  knowledgeTitle?: string;
  executionId?: string;
  executionTitle?: string;
  filename?: string;
  prompt?: string;
}

interface WorkforceChatMessage {
  id: string;
  role: WorkforceChatRole;
  content: string;
  createdAt: string;
  toolCalls?: WorkforceChatToolCall[];
  images?: string[];
  meta?: WorkforceChatMeta;
}

interface WorkforceChatGroup {
  id: string;
  role: WorkforceChatRole;
  createdAt: string;
  messages: WorkforceChatMessage[];
}

type WorkforceChatActivityStatus = 'pending' | 'running' | 'done' | 'error';

interface WorkforceChatActivityStep {
  key: string;
  label: string;
  status: WorkforceChatActivityStatus;
  detail?: string;
}

const WORKFORCE_CHAT_SCOPE_PREFIX = '[WFCHAT]';
const CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000;
const CHAT_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;

function isMediaModelType(modelType?: string): boolean {
  const normalized = (modelType || '').trim().toLowerCase();
  return normalized === 'image' || normalized === 'video' || normalized === 'audio';
}

function sanitizeMediaFilenameInput(name: string): string {
  const raw = (name || '').trim();
  if (!raw) return '';

  const base = raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  const safe = base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!safe) return '';
  return /\.[a-zA-Z0-9]+$/.test(safe) ? safe : `${safe}.png`;
}

function encodeWorkforceChatContent(content: string, meta: WorkforceChatMeta): string {
  return `${WORKFORCE_CHAT_SCOPE_PREFIX}${JSON.stringify(meta)}\n${content}`;
}

function decodeWorkforceChatContent(raw: string): { content: string; meta?: WorkforceChatMeta } {
  if (!raw.startsWith(WORKFORCE_CHAT_SCOPE_PREFIX)) {
    return { content: raw };
  }

  const payload = raw.slice(WORKFORCE_CHAT_SCOPE_PREFIX.length);
  const newlineIdx = payload.indexOf('\n');
  if (newlineIdx < 0) {
    return { content: payload };
  }

  const header = payload.slice(0, newlineIdx);
  const body = payload.slice(newlineIdx + 1);
  try {
    const parsed = JSON.parse(header) as WorkforceChatMeta;
    return { content: body, meta: parsed };
  } catch {
    return { content: body || raw };
  }
}

function toChatDayKey(date: string): string {
  const dt = new Date(date);
  return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
}

function formatChatDayLabel(date: string): string {
  const target = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(target, today)) return 'Today';
  if (sameDay(target, yesterday)) return 'Yesterday';
  return target.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildWorkforceChatGroups(messages: WorkforceChatMessage[]): WorkforceChatGroup[] {
  const groups: WorkforceChatGroup[] = [];

  for (const message of messages) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup) {
      groups.push({ id: message.id, role: message.role, createdAt: message.createdAt, messages: [message] });
      continue;
    }

    const sameRole = lastGroup.role === message.role;
    const sameDay = toChatDayKey(lastGroup.createdAt) === toChatDayKey(message.createdAt);
    const closeInTime = Math.abs(new Date(message.createdAt).getTime() - new Date(lastGroup.createdAt).getTime()) <= CHAT_GROUP_WINDOW_MS;
    const canMerge = sameRole && sameDay && closeInTime && message.role !== 'error';

    if (!canMerge) {
      groups.push({ id: message.id, role: message.role, createdAt: message.createdAt, messages: [message] });
      continue;
    }

    lastGroup.messages.push(message);
    lastGroup.createdAt = message.createdAt;
  }

  return groups;
}

function mapAgentChatToWorkforceMessage(chat: AgentChat, workforceId: string): WorkforceChatMessage | null {
  const parsed = decodeWorkforceChatContent(chat.content || '');
  if (!parsed.meta || parsed.meta.workforceId !== workforceId) {
    return null;
  }

  const toolCalls: WorkforceChatToolCall[] = Array.isArray(chat.tool_calls)
    ? chat.tool_calls.map((tc) => ({
        name: tc?.name || 'tool',
        args: (tc?.args || {}) as Record<string, unknown>,
        result: typeof tc?.result === 'string' ? tc.result : JSON.stringify(tc?.result || {})
      }))
    : [];

  const content = parsed.content || '';
  const role: WorkforceChatRole = chat.role === 'assistant' || chat.role === 'error' ? chat.role : 'user';
  const images = extractChatImages(content, toolCalls);

  return {
    id: chat.id,
    role,
    content,
    createdAt: chat.created_at,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    images: images.length > 0 ? images : undefined,
    meta: parsed.meta
  };
}

function extractAgentChatListPayload(raw: unknown): AgentChat[] {
  if (Array.isArray(raw)) return raw as AgentChat[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).data)) {
    return (raw as any).data as AgentChat[];
  }
  return [];
}

function unwrapDebugPayload(raw: any): any {
  if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object') {
    if ('content' in raw.data || 'tool_calls' in raw.data || 'tokens_used' in raw.data) {
      return raw.data;
    }
  }
  return raw;
}

function summarizeToolResult(result?: string): string {
  const text = (result || '').trim();
  if (!text) return 'No output.';
  const compact = text.replace(/\s+/g, ' ');
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}

function formatToolPayload(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildAssistantContent(payload: any, toolCalls: WorkforceChatToolCall[]): string {
  const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
  if (content) return content;

  if (toolCalls.length > 0) {
    const lines = toolCalls.map((tc) => `- ${tc.name}: ${summarizeToolResult(tc.result)}`);
    return ['I completed tool actions but the model returned no final text.', ...lines].join('\n');
  }

  if (typeof payload?.reasoning === 'string' && payload.reasoning.trim()) {
    return payload.reasoning.trim();
  }

  return 'No textual answer was returned. Please retry with a more explicit question.';
}

function AuthenticatedImage({
  src,
  alt,
  className,
  accessToken
}: {
  src: string;
  alt: string;
  className?: string;
  accessToken?: string;
}) {
  const [blobUrl, setBlobUrl] = useState('');

  useEffect(() => {
    const target = (src || '').trim();
    if (!target || /^(data:|blob:)/i.test(target)) {
      setBlobUrl(target);
      return;
    }

    const controller = new AbortController();
    let objectUrl = '';

    fetch(target, {
      method: 'GET',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      credentials: 'include',
      signal: controller.signal
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Load workforce media image failed:', err);
        setBlobUrl('');
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, accessToken]);

  return <img src={blobUrl || src} alt={alt} className={className} loading='lazy' />;
}

function resolveWorkforceChatImageUrl(raw: string, workforceId?: string): string {
  const resolved = resolveChatMediaUrl(raw);
  if (!resolved) return '';
  if (/^(data:|blob:)/i.test(resolved)) return resolved;

  const wfID = (workforceId || '').trim();
  if (!wfID) return resolved;

  const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
  const fileEndpointBase = `/api/workforces/${wfID}/files?path=`;

  const toProxy = (relativePath: string) => {
    const clean = relativePath.replace(/^\/+/, '');
    if (!clean) return resolved;
    return `${fileEndpointBase}${encodeURIComponent(clean)}`;
  };

  const toProxyFromWorkforceFilesUrl = (value: string): string | null => {
    try {
      const parsed = new URL(value, 'http://localhost');
      if (!/^\/api\/(?:v1\/)?workforces\/[^/]+\/files$/i.test(parsed.pathname)) {
        return null;
      }
      const requestedPath = parsed.searchParams.get('path') || '';
      const normalized = tryNormalizeToWorkspaceRelative(requestedPath);
      return normalized ? toProxy(normalized) : null;
    } catch {
      return null;
    }
  };

  const tryNormalizeToWorkspaceRelative = (pathLike: string): string | null => {
    const clean = pathLike.replace(/^\/+/, '');
    if (!clean) return null;

    const lower = clean.toLowerCase();
    const generatedIdx = lower.lastIndexOf('generated/');
    if (generatedIdx >= 0) {
      return clean.slice(generatedIdx);
    }

    if (clean.startsWith('uploads/') || clean.startsWith('api/')) {
      return null;
    }

    if (clean.startsWith('generated/')) {
      return clean;
    }

    if (!clean.includes('/') && CHAT_IMAGE_EXT_RE.test(clean)) {
      return `generated/${clean}`;
    }

    if (CHAT_IMAGE_EXT_RE.test(clean)) {
      const parts = clean.split('/').filter(Boolean);
      const basename = parts[parts.length - 1];
      if (basename) return `generated/${basename}`;
    }

    return clean;
  };

  if (/^https?:\/\//i.test(resolved)) {
    const proxiedFromLegacy = toProxyFromWorkforceFilesUrl(resolved);
    if (proxiedFromLegacy) return proxiedFromLegacy;

    try {
      const parsed = new URL(resolved);
      const normalized = tryNormalizeToWorkspaceRelative(parsed.pathname);
      if (normalized) return toProxy(normalized);
    } catch {
      return resolved;
    }
    return resolved;
  }

  if (/^\/api\//i.test(resolved)) {
    const proxiedFromLegacy = toProxyFromWorkforceFilesUrl(resolved);
    if (proxiedFromLegacy) return proxiedFromLegacy;
    return apiBase ? `${apiBase}${resolved}` : resolved;
  }

  if (/^\/uploads\//i.test(resolved)) {
    return apiBase ? `${apiBase}${resolved}` : resolved;
  }

  let rel = resolved.replace(/^\/+/, '');
  if (!rel) return resolved;
  rel = tryNormalizeToWorkspaceRelative(rel) || rel;
  return toProxy(rel);
}

function resolveChatMediaUrl(raw: string): string {
  let trimmed = raw.trim().replace(/[),.;]+$/, '');
  if (!trimmed) return '';

  const wfRefMatch = trimmed.match(/^@\[(.+)]$/);
  if (wfRefMatch?.[1]) {
    trimmed = wfRefMatch[1].trim();
  }

  if (/^(data:|blob:|https?:\/\/)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    return apiBase ? `${apiBase}${trimmed}` : trimmed;
  }
  return trimmed;
}

function looksLikeImageRef(candidate: string): boolean {
  return (
    /^data:image\//i.test(candidate) ||
    CHAT_IMAGE_EXT_RE.test(candidate) ||
    /\/api\/v1\/(media|files)\//i.test(candidate) ||
    /\/uploads\//i.test(candidate)
  );
}

function collectImageRefs(value: unknown): string[] {
  if (value == null) return [];

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];

    const refs: string[] = [];
    const workforceRefRe = /@\[([^\]]+)]/g;
    let workforceRefMatch: RegExpExecArray | null;
    while ((workforceRefMatch = workforceRefRe.exec(text)) !== null) {
      const candidate = workforceRefMatch[1]?.trim();
      if (candidate) refs.push(candidate);
    }

    if (looksLikeImageRef(text)) {
      refs.push(text);
    }

    const markdownImageRe = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownImageRe.exec(text)) !== null) {
      refs.push(markdownMatch[1]);
    }

    const urlRe = /(https?:\/\/[^\s"'`<>]+|\/[^\s"'`<>]+)/g;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(text)) !== null) {
      const candidate = urlMatch[1];
      if (looksLikeImageRef(candidate)) refs.push(candidate);
    }

    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        refs.push(...collectImageRefs(JSON.parse(text)));
      } catch {
        // Ignore non-JSON text payloads.
      }
    }

    return refs;
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectImageRefs(entry));
  }

  if (typeof value === 'object') {
    const refs: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nested === 'string' && /(image|thumbnail|preview|url|uri|path|file)/i.test(key)) {
        refs.push(nested);
      }
      refs.push(...collectImageRefs(nested));
    }
    return refs;
  }

  return [];
}

function extractChatImages(content: string, toolCalls: WorkforceChatToolCall[] = []): string[] {
  const raw = [
    ...collectImageRefs(content),
    ...toolCalls.flatMap((tc) => collectImageRefs(tc.result || '')),
    ...toolCalls.flatMap((tc) => collectImageRefs(tc.args || {}))
  ];

  const seen = new Set<string>();
  const images: string[] = [];
  for (const ref of raw) {
    const resolved = resolveChatMediaUrl(ref);
    if (!resolved || !looksLikeImageRef(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    images.push(resolved);
  }
  return images;
}

const KB_SOURCE_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  execution_result: { color: '#9A66FF', bg: '#9A66FF15', border: '#9A66FF30', label: 'Result' },
  agent_message:   { color: '#56D090', bg: '#56D09015', border: '#56D09030', label: 'Agent msg' },
  manual:          { color: '#14FFF7', bg: '#14FFF715', border: '#14FFF730', label: 'Manual' },
  tool_result:     { color: '#FFBF47', bg: '#FFBF4715', border: '#FFBF4730', label: 'Tool' },
};

function KnowledgeCard({
  entry,
  onDelete,
}: {
  entry: KnowledgeEntry;
  onDelete: (id: string) => void;
}) {
  const style = KB_SOURCE_STYLE[entry.source_type] ?? KB_SOURCE_STYLE.agent_message;
  const agentName = entry.metadata?.agent_name as string | undefined;
  return (
    <div className='group rounded-lg border border-border/40 bg-background/50 p-3 hover:border-border/70 transition-colors'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <p className='text-xs font-medium leading-tight'>{entry.title || 'Untitled'}</p>
            <Badge
              variant='outline'
              className='text-[9px] shrink-0'
              style={{ backgroundColor: style.bg, borderColor: style.border, color: style.color }}
            >
              {style.label}
            </Badge>
            {!entry.embedding && (
              <Badge variant='outline' className='text-[9px] shrink-0' style={{ backgroundColor: '#FFBF4710', borderColor: '#FFBF4730', color: '#FFBF47' }}>
                no embedding
              </Badge>
            )}
          </div>
          <p className='mt-1.5 text-[10px] text-muted-foreground line-clamp-3 leading-relaxed'>
            {(entry.content || '').slice(0, 300)}
          </p>
          <div className='mt-1.5 flex items-center gap-3'>
            <span className='text-[9px] text-muted-foreground/60'>{timeAgo(entry.created_at)}</span>
            {agentName && (
              <span className='text-[9px] text-muted-foreground/60'>by {agentName}</span>
            )}
            {entry.execution_id && (
              <a
                href={`/dashboard/executions/${entry.execution_id}`}
                className='text-[9px] text-[#9A66FF]/70 hover:text-[#9A66FF] transition-colors flex items-center gap-0.5'
              >
                <IconLink className='h-2.5 w-2.5' />
                View execution
              </a>
            )}
          </div>
        </div>
        <Button
          variant='ghost'
          size='sm'
          className='h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-400 shrink-0'
          onClick={() => onDelete(entry.id)}
        >
          <IconTrash className='h-3 w-3' />
        </Button>
      </div>
    </div>
  );
}

export default function WorkforceDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const wfId = params.id as string;

  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Credential quick-add in launch dialog
  const [quickCredService, setQuickCredService] = useState('');       // dropdown value ('__custom__' when custom)
  const [quickCredServiceText, setQuickCredServiceText] = useState(''); // text when custom service
  const [quickCredKey, setQuickCredKey] = useState('');               // dropdown/input value ('__custom__' when custom)
  const [quickCredKeyText, setQuickCredKeyText] = useState('');       // text when custom key
  const [quickCredValue, setQuickCredValue] = useState('');
  const [quickCredSaving, setQuickCredSaving] = useState(false);

  // Dialogs
  const [execOpen, setExecOpen] = useState(false);
  const [execObjective, setExecObjective] = useState('');
  const [execRunning, setExecRunning] = useState(false);
  const [execMode, setExecMode] = useState<ExecutionMode>('all_agents');
  const [execSingleAgentId, setExecSingleAgentId] = useState('');
  const [preflight, setPreflight] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    objective: '',
    avatar_url: '',
    budget_tokens: 0,
    budget_time_s: 0,
    agent_ids: [] as string[],
    leader_agent_id: '' as string,
    docker_image: '' as string
  });

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [allMcpServers, setAllMcpServers] = useState<MCPServer[]>([]);
  const [agentPerms, setAgentPerms] = useState<Record<string, Record<string, string[]>>>({});
  const [mcpLoading, setMcpLoading] = useState(false);
  const [discoveringMcp, setDiscoveringMcp] = useState<string | null>(null);

  // Knowledge state
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [kbAddOpen, setKbAddOpen] = useState(false);
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState<KnowledgeEntry[] | null>(null);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSourceFilter, setKbSourceFilter] = useState<string>('all');
  const [kbShowAll, setKbShowAll] = useState(false);

  // Approvals state
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [approvalsLoading, setApprovalsLoading] = useState(false);

  // Tasks (for quick workforce chat context)
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[]>([]);

  // Workforce quick chat state
  const [chatAgentId, setChatAgentId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatByAgent, setChatByAgent] = useState<Record<string, WorkforceChatMessage[]>>({});
  const [chatProjectId, setChatProjectId] = useState('');
  const [chatTaskId, setChatTaskId] = useState('');
  const [chatKnowledgeId, setChatKnowledgeId] = useState('');
  const [chatExecutionId, setChatExecutionId] = useState('');
  const [chatMediaPrompt, setChatMediaPrompt] = useState('');
  const [chatFilename, setChatFilename] = useState('');
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatLoadedByAgent, setChatLoadedByAgent] = useState<Record<string, boolean>>({});
  const [chatActivity, setChatActivity] = useState<WorkforceChatActivityStep[]>([]);
  const [showAllChatHistory, setShowAllChatHistory] = useState(false);
  const [chatAttachedFiles, setChatAttachedFiles] = useState<string[]>([]);
  const [chatFileSearch, setChatFileSearch] = useState('');
  const [chatFilePickerOpen, setChatFilePickerOpen] = useState(false);
  const [chatWorkspaceFiles, setChatWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [chatWorkspaceFilesLoading, setChatWorkspaceFilesLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatHistoryFetchingRef = useRef<Record<string, boolean>>({});

  // Workspace provisioning
  const [provisioning, setProvisioning] = useState(false);

  // Credentials state
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credService, setCredService] = useState('');
  const [credKey, setCredKey] = useState('');
  const [credValue, setCredValue] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [credShowValue, setCredShowValue] = useState(false);
  const [credError, setCredError] = useState('');

  // Projects + briefs state
  const [projects, setProjects] = useState<Project[]>([]);
  const [briefExpanded, setBriefExpanded] = useState<Record<string, boolean>>({});
  const [briefEditing, setBriefEditing] = useState<Record<string, boolean>>({});
  const [briefDraft, setBriefDraft] = useState<Record<string, string>>({});
  const [briefIntervalDraft, setBriefIntervalDraft] = useState<Record<string, number>>({});
  const [briefSaving, setBriefSaving] = useState<Record<string, boolean>>({});
  const [briefRefreshing, setBriefRefreshing] = useState<Record<string, boolean>>({});

  // Kanban tasks are managed inside <KanbanBoard />

  const loadData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes] = await Promise.all([
        api.getWorkforce(wfId),
        api.listAgents()
      ]);
      const wf = wfRes.data;
      if (!wf) return;
      setWorkforce(wf);
      setAllAgents(agRes.data || []);

      // Resolve agents
      const agMap: Record<string, Agent> = {};
      for (const a of agRes.data || []) agMap[a.id] = a;
      const resolved = (wf.agent_ids || []).map((id) => agMap[id]).filter(Boolean);
      setAgents(resolved);

      // Load executions
      try {
        const exRes = await api.listExecutions(wfId);
        const execs = (exRes.data || []).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setExecutions(execs);
      } catch {
        setExecutions([]);
      }

      // Load MCP data
      try {
        const [wfMcpRes, allMcpRes] = await Promise.all([
          api.listWorkforceMCPServers(wfId),
          api.listMCPServers()
        ]);
        const wfMcpData = wfMcpRes.data || [];
        const allMcpData = allMcpRes.data || [];
        setMcpServers(wfMcpData);
        setAllMcpServers(allMcpData);

        // Load agent permissions for all (agent × server) pairs in parallel
        const pairs = wfMcpData.flatMap(srv => resolved.map(ag => ({ agId: ag.id, srvId: srv.id })));
        const results = await Promise.allSettled(pairs.map(({ agId, srvId }) => api.getAgentTools(agId, srvId)));
        const perms: Record<string, Record<string, string[]>> = {};
        pairs.forEach(({ agId, srvId }, i) => {
          const r = results[i];
          if (r.status === 'fulfilled') {
            if (!perms[agId]) perms[agId] = {};
            perms[agId][srvId] = r.value.data || [];
          }
        });
        setAgentPerms(perms);
      } catch {
        setMcpServers([]);
        setAllMcpServers([]);
      }

      // Load knowledge data
      try {
        const kbRes = await api.listKnowledge(wfId);
        setKnowledgeEntries(kbRes.data?.entries ?? []);
        setKnowledgeCount(kbRes.data?.total ?? 0);
      } catch {
        setKnowledgeEntries([]);
        setKnowledgeCount(0);
      }

      // Load approvals
      try {
        const [appRes, pendingRes] = await Promise.all([
          api.listApprovals(wfId),
          api.countPendingApprovals(wfId)
        ]);
        setApprovals(appRes.data || []);
        setPendingApprovalCount(pendingRes.data?.count || 0);
      } catch {
        setApprovals([]);
        setPendingApprovalCount(0);
      }

      // Load credentials
      try {
        const credsRes = await api.listCredentials(wfId);
        setCredentials(credsRes.data || []);
      } catch {
        setCredentials([]);
      }

      // Load projects
      try {
        const projRes = await api.listProjects(wfId);
        setProjects(projRes.data || []);
      } catch {
        setProjects([]);
      }

      // Load kanban tasks (quick chat contextual selector)
      try {
        const taskRes = await api.listKanbanTasks(wfId);
        setKanbanTasks(taskRes.data || []);
      } catch {
        setKanbanTasks([]);
      }
    } catch (err) {
      console.error('Failed to load workforce:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session, wfId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (agents.length === 0) {
      setChatAgentId('');
      return;
    }
    setChatAgentId((prev) => (prev && agents.some((a) => a.id === prev) ? prev : agents[0].id));
  }, [agents]);

  useEffect(() => {
    if (!chatTaskId) return;
    const taskStillVisible = kanbanTasks.some((task) => task.id === chatTaskId && (!chatProjectId || task.project_id === chatProjectId));
    if (!taskStillVisible) setChatTaskId('');
  }, [chatTaskId, chatProjectId, kanbanTasks]);

  useEffect(() => {
    setChatInput('');
    setChatMediaPrompt('');
    setChatFilename('');
    setChatError('');
    setChatActivity([]);
    setShowAllChatHistory(false);
  }, [chatAgentId]);

  useEffect(() => {
    if (!chatAgentId || !workforce?.id || !session?.accessToken) return;
    if (chatLoadedByAgent[chatAgentId]) return;
    if (chatHistoryFetchingRef.current[chatAgentId]) return;

    let cancelled = false;
    chatHistoryFetchingRef.current[chatAgentId] = true;
    setChatHistoryLoading(true);

    api.setToken(session.accessToken);
    api
      .listAgentChats(chatAgentId)
      .then((res) => {
        if (cancelled) return;
        const persisted = extractAgentChatListPayload(res.data)
          .map((entry) => mapAgentChatToWorkforceMessage(entry, workforce.id))
          .filter((entry): entry is WorkforceChatMessage => Boolean(entry));
        setChatByAgent((prev) => ({ ...prev, [chatAgentId]: persisted }));
        setChatLoadedByAgent((prev) => ({ ...prev, [chatAgentId]: true }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Load workforce chat history failed:', err);
      })
      .finally(() => {
        chatHistoryFetchingRef.current[chatAgentId] = false;
        if (!cancelled) setChatHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatAgentId, session?.accessToken, workforce?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatByAgent, chatAgentId]);

  useEffect(() => {
    if (!chatFilePickerOpen || !workforce?.id) return;
    if (chatWorkspaceFiles.length > 0) return; // already loaded
    setChatWorkspaceFilesLoading(true);
    api.listWorkspaceFiles(workforce.id)
      .then(res => setChatWorkspaceFiles(res.data || []))
      .catch(() => setChatWorkspaceFiles([]))
      .finally(() => setChatWorkspaceFilesLoading(false));
  }, [chatFilePickerOpen, workforce?.id]);

  function openEdit() {
    if (!workforce) return;
    setEditForm({
      name: workforce.name,
      description: workforce.description,
      objective: workforce.objective,
      avatar_url: workforce.avatar_url || '',
      budget_tokens: workforce.budget_tokens,
      budget_time_s: workforce.budget_time_s,
      agent_ids: workforce.agent_ids || [],
      leader_agent_id: workforce.leader_agent_id || '',
      docker_image: workforce.docker_image || ''
    });
    setEditOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateWorkforce(wfId, editForm);
      setEditOpen(false);
      await loadData();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteWorkforce(wfId);
      router.push('/dashboard/workforces');
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function runPreflight() {
    setPreflightLoading(true);
    setPreflight(null);
    try {
      const res = await api.preflightWorkforce(wfId);
      if (res.data) setPreflight(res.data);
    } catch { /* ignore */ } finally {
      setPreflightLoading(false);
    }
  }

  async function handleQuickAddCred() {
    const svc = (quickCredService === '__custom__' ? quickCredServiceText : quickCredService).trim().toLowerCase();
    const key = (quickCredKey === '__custom__' ? quickCredKeyText : quickCredKey).trim().toLowerCase();
    if (!svc || !key || !quickCredValue.trim()) return;
    setQuickCredSaving(true);
    try {
      const res = await api.upsertCredential(wfId, { service: svc, key_name: key, value: quickCredValue });
      if (res.data) {
        setCredentials(prev => {
          const idx = prev.findIndex(c => c.service === res.data!.service && c.key_name === res.data!.key_name);
          return idx >= 0 ? prev.map((c, i) => (i === idx ? res.data! : c)) : [...prev, res.data!];
        });
      }
      setQuickCredService('');
      setQuickCredServiceText('');
      setQuickCredKey('');
      setQuickCredKeyText('');
      setQuickCredValue('');
      runPreflight();
    } catch (err) {
      console.error('Quick add credential failed:', err);
    } finally {
      setQuickCredSaving(false);
    }
  }

  async function handleStartExec() {
    if (!execObjective.trim()) return;
    if (execMode === 'single_agent' && !execSingleAgentId) return;
    setExecRunning(true);
    try {
      const res = await api.startExecution(
        wfId,
        execObjective,
        undefined,
        undefined,
        execMode,
        execMode === 'single_agent' ? execSingleAgentId : undefined
      );
      setExecOpen(false);
      setExecObjective('');
      setExecMode('all_agents');
      setExecSingleAgentId('');
      setPreflight(null);
      if (res.data?.id) {
        router.push(`/dashboard/executions/${res.data.id}`);
      }
    } catch (err) {
      console.error('Start execution failed:', err);
    } finally {
      setExecRunning(false);
    }
  }

  async function handleAttachMCP(serverId: string) {
    setMcpLoading(true);
    try {
      await api.attachMCPServer(wfId, serverId);
      await loadData();
    } catch (err) {
      console.error('Attach MCP failed:', err);
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleDetachMCP(serverId: string) {
    setMcpLoading(true);
    try {
      await api.detachMCPServer(wfId, serverId);
      await loadData();
    } catch (err) {
      console.error('Detach MCP failed:', err);
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleGrantAllTools(agentId: string, serverId: string) {
    try {
      await api.setAgentTools(agentId, serverId, []);
      await loadData();
    } catch (err) {
      console.error('Grant tools failed:', err);
    }
  }

  async function handleRevokeTools(agentId: string, serverId: string) {
    try {
      await api.removeAgentTools(agentId, serverId);
      await loadData();
    } catch (err) {
      console.error('Revoke tools failed:', err);
    }
  }

  async function handleDiscoverMCPTools(serverId: string) {
    setDiscoveringMcp(serverId);
    try {
      await api.discoverMCPTools(serverId);
      await loadData();
    } catch (err) {
      console.error('Discover tools failed:', err);
    } finally {
      setDiscoveringMcp(null);
    }
  }

  async function handleAddKnowledge() {
    if (!kbContent.trim()) return;
    setKbLoading(true);
    try {
      await api.createKnowledge(wfId, { title: kbTitle, content: kbContent });
      setKbTitle('');
      setKbContent('');
      setKbAddOpen(false);
      await loadData();
    } catch (err) {
      console.error('Add knowledge failed:', err);
    } finally {
      setKbLoading(false);
    }
  }

  async function handleDeleteKnowledge(entryId: string) {
    try {
      await api.deleteKnowledge(wfId, entryId);
      setKnowledgeEntries((prev) => prev.filter((e) => e.id !== entryId));
      setKnowledgeCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Delete knowledge failed:', err);
    }
  }

  async function handleResolveApproval(approvalId: string, approved: boolean) {
    setApprovalsLoading(true);
    try {
      await api.resolveApproval(approvalId, {
        approved,
        reviewer_notes: '',
        resolved_by: 'operator'
      });
      await loadData();
    } catch (err) {
      console.error('Resolve approval failed:', err);
    } finally {
      setApprovalsLoading(false);
    }
  }

  async function handleSearchKnowledge() {
    if (!kbSearchQuery.trim()) {
      setKbSearchResults(null);
      return;
    }
    setKbLoading(true);
    try {
      const res = await api.searchKnowledge(wfId, kbSearchQuery, 5);
      setKbSearchResults(res.data || []);
    } catch (err) {
      console.error('Search knowledge failed:', err);
    } finally {
      setKbLoading(false);
    }
  }

  async function handleSendWorkforceChat() {
    if (!workforce || !chatAgentId || chatLoading) return;

    const selectedAgent = agents.find((a) => a.id === chatAgentId);
    if (!selectedAgent) return;

    const mediaMode = isMediaModelType(selectedAgent.model_type);
    const mediaPrompt = chatMediaPrompt.trim();
    const filename = sanitizeMediaFilenameInput(chatFilename);
    const plainMessage = chatInput.trim();

    if (mediaMode) {
      if (!mediaPrompt || !filename) {
        setChatError('Prompt and filename are required for media generator models.');
        return;
      }
    } else if (!plainMessage) {
      return;
    }

    const selectedProject = projects.find((p) => p.id === chatProjectId);
    const selectedTask = kanbanTasks.find((t) => t.id === chatTaskId);
    const selectedKnowledge = knowledgeEntries.find((k) => k.id === chatKnowledgeId);
    const selectedExecution = executions.find((e) => e.id === chatExecutionId);

    const rawMessage = mediaMode
      ? `Prompt: ${mediaPrompt}\nFilename: ${filename}`
      : plainMessage;

    const agentID = chatAgentId;
    const previous = chatByAgent[agentID] || [];
    const history = previous
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    const chatMeta: WorkforceChatMeta = {
      workforceId: workforce.id,
      inputMode: mediaMode ? 'media' : 'text',
      projectId: selectedProject?.id,
      projectName: selectedProject?.name,
      taskId: selectedTask?.id,
      taskTitle: selectedTask?.title,
      knowledgeId: selectedKnowledge?.id,
      knowledgeTitle: selectedKnowledge?.title || selectedKnowledge?.id,
      executionId: selectedExecution?.id,
      executionTitle: selectedExecution?.title || selectedExecution?.objective,
      filename: filename || undefined,
      prompt: mediaPrompt || undefined
    };

    const requestStartedAt = Date.now();
    const upsertActivityStep = (
      key: string,
      label: string,
      status: WorkforceChatActivityStatus,
      detail?: string
    ) => {
      setChatActivity((prev) => {
        const existingIdx = prev.findIndex((step) => step.key === key);
        if (existingIdx < 0) return [...prev, { key, label, status, detail }];
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], label, status, detail };
        return next;
      });
    };

    setChatActivity([
      { key: 'persist_user', label: 'Saving your message', status: 'running' },
      { key: 'agent_run', label: 'Running agent model/tools', status: 'pending' },
      { key: 'persist_assistant', label: 'Saving assistant response', status: 'pending' }
    ]);

    // Fetch any attached workspace file contents
    let attachedFileBlock = '';
    if (!mediaMode && chatAttachedFiles.length > 0) {
      const apiBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
      const token = session?.accessToken as string | undefined;
      const fileResults = await Promise.all(
        chatAttachedFiles.map(async (relPath) => {
          try {
            const url = `${apiBase}/api/v1/workforces/${workforce.id}/files?path=${encodeURIComponent(relPath)}`;
            const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
            if (!res.ok) return `### ${relPath}\n[failed to load]`;
            const text = await res.text();
            const ext = relPath.split('.').pop()?.toLowerCase() || '';
            return `### ${relPath}\n\`\`\`${ext}\n${text.slice(0, 8000)}\n\`\`\``;
          } catch {
            return `### ${relPath}\n[error reading file]`;
          }
        })
      );
      attachedFileBlock = `\n\n## Attached Files\n${fileResults.join('\n\n')}`;
    }

    const contextLines = [
      `workforce=${workforce.name} (${workforce.id})`,
      selectedProject ? `project=${selectedProject.name}` : '',
      selectedTask ? `task=${selectedTask.title}` : '',
      selectedKnowledge ? `knowledge=${selectedKnowledge.title || selectedKnowledge.id}` : '',
      selectedExecution ? `past_execution=${selectedExecution.title || selectedExecution.objective}` : '',
      mediaMode && filename ? `preferred_filename=${filename}` : '',
      chatAttachedFiles.length > 0 ? `attached_files=${chatAttachedFiles.join(', ')}` : ''
    ].filter(Boolean);

    const requestBlock = mediaMode
      ? [
          'Media request:',
          `- prompt: ${mediaPrompt}`,
          `- filename: ${filename}`,
          '- constraint: generate only one asset and return its output path'
        ].join('\n')
      : [
          'User request:',
          plainMessage,
          '',
          'Response style:',
          '- return plain natural language',
          '- do not return tool/debug JSON payloads'
        ].join('\n');

    const contextualMessage = contextLines.length > 0
      ? `Context:\n- ${contextLines.join('\n- ')}\n\n${requestBlock}${attachedFileBlock}`
      : `${requestBlock}${attachedFileBlock}`;

    const mediaRelativePath = mediaMode ? `generated/${filename}` : '';
    const mediaOutputPath = mediaMode ? mediaRelativePath : '';

    const debugMessage = mediaMode
      ? JSON.stringify({
          prompt: mediaPrompt,
          output_path: mediaOutputPath,
          aspect_ratio: '1:1'
        })
      : contextualMessage;

    const chatInputs: Record<string, string> = {
      workforce_id: workforce.id,
      workforce_name: workforce.name,
      request_mode: mediaMode ? 'media_asset_generation' : 'workforce_chat'
    };
    if (selectedProject) {
      chatInputs.project = selectedProject.name;
      chatInputs.project_id = selectedProject.id;
    }
    if (selectedTask) {
      chatInputs.task = selectedTask.title;
      chatInputs.task_id = selectedTask.id;
    }
    if (selectedKnowledge) {
      chatInputs.knowledge = (selectedKnowledge.content || '').slice(0, 1200);
      chatInputs.knowledge_id = selectedKnowledge.id;
    }
    if (selectedExecution) {
      chatInputs.past_execution = selectedExecution.title || selectedExecution.objective || '';
      chatInputs.past_execution_id = selectedExecution.id;
    }
    if (mediaMode) {
      chatInputs.prompt = mediaPrompt;
      chatInputs.output_filename = filename;
      chatInputs.output_path = mediaOutputPath;
      chatInputs.media_only = 'true';
    }

    const userMsg: WorkforceChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: rawMessage,
      createdAt: new Date().toISOString(),
      meta: chatMeta
    };

    if (mediaMode) {
      setChatMediaPrompt('');
      setChatFilename('');
    } else {
      setChatInput('');
      setChatAttachedFiles([]);
      setChatFilePickerOpen(false);
    }
    setChatError('');
    setChatLoading(true);
    setChatLoadedByAgent((prev) => ({ ...prev, [agentID]: true }));
    setChatByAgent((prevState) => ({
      ...prevState,
      [agentID]: [...(prevState[agentID] || []), userMsg]
    }));

    try {
      await api.createAgentChat(agentID, {
        role: 'user',
        content: encodeWorkforceChatContent(rawMessage, chatMeta)
      });
      upsertActivityStep('persist_user', 'Saving your message', 'done');
    } catch (err) {
      console.error('Persist workforce user chat failed:', err);
      upsertActivityStep('persist_user', 'Saving your message', 'error', 'Could not persist user message, continuing in-memory.');
    }

    let hadChatError = false;
    try {
      upsertActivityStep('agent_run', 'Running agent model/tools', 'running');
      const res = await api.debugAgent(agentID, debugMessage, chatInputs, history);
      const payload = unwrapDebugPayload(res.data);
      const toolCalls: WorkforceChatToolCall[] = Array.isArray(payload?.tool_calls)
        ? payload.tool_calls.map((tc: any) => ({
            name: tc?.name || 'tool',
            args: (tc?.args || {}) as Record<string, unknown>,
            result: typeof tc?.result === 'string' ? tc.result : JSON.stringify(tc?.result || {})
          }))
        : [];
      const content = buildAssistantContent(payload, toolCalls);
      const images = extractChatImages(content, toolCalls);
      const elapsedSec = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000));
      const toolInfo = toolCalls.length > 0
        ? `${toolCalls.length} tool call${toolCalls.length > 1 ? 's' : ''} completed`
        : 'Model answer ready';
      upsertActivityStep('agent_run', 'Running agent model/tools', 'done', `${toolInfo} in ${elapsedSec}s`);

      const assistantMsg: WorkforceChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        images: images.length > 0 ? images : undefined,
        meta: chatMeta
      };

      setChatByAgent((prevState) => ({
        ...prevState,
        [agentID]: [...(prevState[agentID] || []), assistantMsg]
      }));

      try {
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'running');
        await api.createAgentChat(agentID, {
          role: 'assistant',
          content: encodeWorkforceChatContent(content, chatMeta),
          tool_calls: toolCalls.map((tc) => ({
            name: tc.name,
            args: (tc.args || {}) as Record<string, any>,
            result: tc.result || ''
          }))
        });
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'done');
      } catch (err) {
        console.error('Persist workforce assistant chat failed:', err);
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'error', 'Assistant reply shown, but persistence failed.');
      }
    } catch (err: any) {
      hadChatError = true;
      const elapsedSec = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000));
      const rawMessage = err?.message || 'Failed to send message';
      const message = /failed to fetch/i.test(rawMessage) && elapsedSec >= 90
        ? `Request timed out after ${elapsedSec}s while waiting for the agent response. Try a shorter request or retry.`
        : rawMessage;
      setChatError(message);
      upsertActivityStep('agent_run', 'Running agent model/tools', 'error', message);
      const errorMsg = `Error: ${message}`;

      setChatByAgent((prevState) => ({
        ...prevState,
        [agentID]: [
          ...(prevState[agentID] || []),
          {
            id: `error-${Date.now()}`,
            role: 'error',
            content: errorMsg,
            createdAt: new Date().toISOString(),
            meta: chatMeta
          }
        ]
      }));

      try {
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'running');
        await api.createAgentChat(agentID, {
          role: 'error',
          content: encodeWorkforceChatContent(errorMsg, chatMeta)
        });
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'done');
      } catch (persistErr) {
        console.error('Persist workforce error chat failed:', persistErr);
        upsertActivityStep('persist_assistant', 'Saving assistant response', 'error', 'Could not persist error message.');
      }
    } finally {
      setChatLoading(false);
      if (!hadChatError) {
        window.setTimeout(() => setChatActivity([]), 6000);
      }
    }
  }

  function handleWorkforceChatKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendWorkforceChat();
    }
  }

  if (loading) {
    return (
      <div className='flex h-[80vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  if (!workforce) {
    return (
      <div className='flex h-[80vh] flex-col items-center justify-center gap-4'>
        <p className='text-muted-foreground'>Workforce not found.</p>
        <Button variant='outline' onClick={() => router.push('/dashboard/workforces')}>
          <IconArrowLeft className='mr-2 h-4 w-4' /> Back
        </Button>
      </div>
    );
  }

  const sc = statusColors[workforce.status] || statusColors.draft;
  const selectedChatAgent = agents.find((a) => a.id === chatAgentId) || null;
  const chatAgentIsMedia = isMediaModelType(selectedChatAgent?.model_type);
  const activeChatMessages = chatAgentId ? (chatByAgent[chatAgentId] || []) : [];
  const groupedChatMessages = buildWorkforceChatGroups(activeChatMessages);
  const shouldAutoCollapseChatHistory = groupedChatMessages.length > 1;
  const visibleGroupedChatMessages = shouldAutoCollapseChatHistory && !showAllChatHistory
    ? groupedChatMessages.slice(-1)
    : groupedChatMessages;
  const hiddenChatGroupCount = shouldAutoCollapseChatHistory
    ? groupedChatMessages.length - visibleGroupedChatMessages.length
    : 0;
  const selectedChatProject = projects.find((p) => p.id === chatProjectId) || null;
  const selectedChatTask = kanbanTasks.find((t) => t.id === chatTaskId) || null;
  const selectedChatKnowledge = knowledgeEntries.find((k) => k.id === chatKnowledgeId) || null;
  const selectedChatExecution = executions.find((e) => e.id === chatExecutionId) || null;
  const chatComposerAttachments = [
    selectedChatProject ? `Project: ${selectedChatProject.name}` : '',
    selectedChatTask ? `Task: ${selectedChatTask.title}` : '',
    selectedChatKnowledge ? `Knowledge: ${selectedChatKnowledge.title || selectedChatKnowledge.id.slice(0, 8)}` : '',
    selectedChatExecution ? `Past execution: ${selectedChatExecution.title || selectedChatExecution.objective}` : ''
  ].filter(Boolean);
  const canSendChatMessage = chatAgentIsMedia
    ? !!chatMediaPrompt.trim() && !!chatFilename.trim() && !chatLoading
    : !!chatInput.trim() && !chatLoading;
  const visibleChatTasks = chatProjectId
    ? kanbanTasks.filter((task) => task.project_id === chatProjectId)
    : kanbanTasks;
  const unifiedFeed: Array<
    | { kind: 'approval'; createdAt: string; approval: Approval }
    | { kind: 'execution'; createdAt: string; execution: Execution }
  > = [
    ...approvals.map((approval) => ({ kind: 'approval' as const, createdAt: approval.created_at, approval })),
    ...executions.map((execution) => ({ kind: 'execution' as const, createdAt: execution.created_at, execution }))
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Top Bar */}
      <div className='flex items-center justify-between border-b border-border/50 px-6 py-3'>
        <div className='flex items-center gap-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => router.push('/dashboard/workforces')}
            className='h-8 w-8'
          >
            <IconArrowLeft className='h-4 w-4' />
          </Button>
          <EntityAvatar
            icon={workforce.icon || '👥'}
            color={workforce.color || '#9A66FF'}
            avatarUrl={workforce.avatar_url}
            size='sm'
          />
          <div>
            <h1 className='text-sm font-semibold'>{workforce.name}</h1>
            <p className='text-xs text-muted-foreground'>
              {agents.length} agent{agents.length !== 1 ? 's' : ''} · {executions.length} execution{executions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Badge
            variant='outline'
            className='ml-1 text-[10px]'
            style={{ backgroundColor: sc.bg, borderColor: sc.border, color: sc.color }}
          >
            {workforce.status}
          </Badge>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={() => { setRefreshing(true); loadData(); }}
          >
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => router.push(`/dashboard/workforces/${wfId}/knowledge`)}
          >
            <IconBrain className='mr-1 h-3.5 w-3.5 text-[#9A66FF]' /> Knowledge
          </Button>
          <Button variant='outline' size='sm' onClick={openEdit}>
            <IconPencil className='mr-1 h-3.5 w-3.5' /> Edit
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='text-red-400 hover:text-red-400'
            onClick={() => setDeleteOpen(true)}
          >
            <IconTrash className='mr-1 h-3.5 w-3.5' /> Delete
          </Button>
          <Button
            size='sm'
            className='bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'
            onClick={() => {
              setExecObjective(workforce.objective);
              setExecOpen(true);
            }}
          >
            <IconPlayerPlay className='mr-1 h-3.5 w-3.5' /> Launch
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <ScrollArea className='flex-1'>
        <div className='mx-auto max-w-6xl space-y-8 p-6'>

          {/* Objective & Budget */}
          <div className='grid gap-6 lg:grid-cols-[1fr_300px]'>
            <div className='rounded-xl border border-border/50 bg-[#9A66FF]/5 p-5'>
              <h3 className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Mission Objective
              </h3>
              <p className='whitespace-pre-wrap text-sm leading-relaxed text-[#EAEAEA]/90'>
                {workforce.objective}
              </p>
              {workforce.description && (
                <p className='mt-3 text-xs text-muted-foreground'>
                  {workforce.description}
                </p>
              )}
            </div>
            <div className='space-y-3'>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFBF47]/15'>
                    <IconCoins className='h-5 w-5 text-[#FFBF47]' />
                  </div>
                  <div>
                    <p className='text-lg font-semibold'>{formatTokens(workforce.budget_tokens)}</p>
                    <p className='text-xs text-muted-foreground'>Token budget</p>
                  </div>
                </CardContent>
              </Card>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[#14FFF7]/15'>
                    <IconClock className='h-5 w-5 text-[#14FFF7]' />
                  </div>
                  <div>
                    <p className='text-lg font-semibold'>{formatTime(workforce.budget_time_s)}</p>
                    <p className='text-xs text-muted-foreground'>Time budget</p>
                  </div>
                </CardContent>
              </Card>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#9A66FF]/15'>
                    <IconFolder className='h-5 w-5 text-[#9A66FF]' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    {workforce.workspace_path ? (
                      <p className='truncate font-mono text-xs text-foreground' title={workforce.workspace_path}>
                        {workforce.workspace_path}
                      </p>
                    ) : (
                      <p className='text-xs text-muted-foreground'>Not provisioned</p>
                    )}
                    <p className='text-xs text-muted-foreground'>Workspace</p>
                  </div>
                  {!workforce.workspace_path && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='flex-shrink-0 border-[#9A66FF]/40 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                      disabled={provisioning}
                      onClick={async () => {
                        setProvisioning(true);
                        try {
                          await api.provisionWorkspace(wfId);
                          const res = await api.getWorkforce(wfId);
                          if (res.data) setWorkforce(res.data);
                        } finally {
                          setProvisioning(false);
                        }
                      }}
                    >
                      {provisioning ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Provision'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator />

          {/* ── Task Board ─────────────────────────────────────── */}
          <KanbanBoard
            workforceId={wfId}
            agents={agents}
            workforce={workforce}
            onWorkforceUpdate={setWorkforce}
          />

          <Separator />

          {/* ── Projects & Briefs ───────────────────────────────── */}
          {projects.length > 0 && (
            <div>
              <div className='mb-3 flex items-center justify-between'>
                <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                  Projects
                </h3>
                <button
                  onClick={() => router.push('/dashboard/projects')}
                  className='flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors'
                >
                  <IconExternalLink className='h-3 w-3' />
                  Manage all
                </button>
              </div>
              <div className='space-y-3'>
                {projects.map(proj => {
                  const isExpanded = briefExpanded[proj.id] ?? false;
                  const isEditing = briefEditing[proj.id] ?? false;
                  const isRefreshing = briefRefreshing[proj.id] ?? false;
                  const isSaving = briefSaving[proj.id] ?? false;
                  const intervalLabel = BRIEF_INTERVAL_OPTIONS.find(o => o.value === proj.brief_interval_m)?.label ?? `Every ${proj.brief_interval_m} min`;

                  async function saveBrief() {
                    setBriefSaving(s => ({ ...s, [proj.id]: true }));
                    try {
                      const res = await api.updateProject(proj.id, {
                        brief: briefDraft[proj.id] ?? proj.brief,
                        brief_interval_m: briefIntervalDraft[proj.id] ?? proj.brief_interval_m,
                      });
                      if (res.data) setProjects(prev => prev.map(p => p.id === proj.id ? res.data! : p));
                      setBriefEditing(s => ({ ...s, [proj.id]: false }));
                    } finally {
                      setBriefSaving(s => ({ ...s, [proj.id]: false }));
                    }
                  }

                  async function refreshBrief() {
                    setBriefRefreshing(s => ({ ...s, [proj.id]: true }));
                    try {
                      const res = await api.refreshProjectBrief(proj.id);
                      if (res.data) {
                        setProjects(prev => prev.map(p => p.id === proj.id ? res.data! : p));
                        setBriefDraft(s => ({ ...s, [proj.id]: res.data!.brief }));
                      }
                    } finally {
                      setBriefRefreshing(s => ({ ...s, [proj.id]: false }));
                    }
                  }

                  return (
                    <div key={proj.id} className='rounded-xl border border-border/40 bg-background/60 overflow-hidden'>
                      {/* Project header */}
                      <div className='flex items-center justify-between px-4 py-3 border-b border-border/30'>
                        <div className='flex items-center gap-3 min-w-0'>
                          <button
                            onClick={() => setBriefExpanded(s => ({ ...s, [proj.id]: !isExpanded }))}
                            className='flex items-center gap-2 min-w-0'
                          >
                            {isExpanded
                              ? <IconChevronUp className='h-3.5 w-3.5 shrink-0 text-muted-foreground/50' />
                              : <IconChevronDown className='h-3.5 w-3.5 shrink-0 text-muted-foreground/50' />
                            }
                            <span className='text-xl shrink-0'>{proj.icon}</span>
                            <span className='font-semibold text-sm truncate'>{proj.name}</span>
                          </button>
                          <div className='flex items-center gap-1.5 shrink-0'>
                            <span
                              className='rounded px-1.5 py-0.5 text-[10px] font-medium'
                              style={{ background: '#9A66FF18', color: '#9A66FF' }}
                            >
                              {intervalLabel}
                            </span>
                            {proj.brief_updated_at && (
                              <span className='text-[10px] text-muted-foreground/40 hidden sm:inline'>
                                updated {timeAgo(proj.brief_updated_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className='flex items-center gap-1.5 shrink-0'>
                          {!isEditing && (
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 px-2 text-xs border-[#9A66FF]/30 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                              onClick={refreshBrief}
                              disabled={isRefreshing}
                            >
                              {isRefreshing
                                ? <IconLoader2 className='h-3 w-3 animate-spin mr-1' />
                                : <IconRefresh className='h-3 w-3 mr-1' />
                              }
                              {isRefreshing ? 'Refreshing…' : 'AI Refresh'}
                            </Button>
                          )}
                          {isEditing ? (
                            <>
                              <Button size='sm' variant='outline' className='h-7 px-2 text-xs'
                                onClick={() => setBriefEditing(s => ({ ...s, [proj.id]: false }))}>
                                Cancel
                              </Button>
                              <Button size='sm' className='h-7 px-2 text-xs bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                                onClick={saveBrief} disabled={isSaving}>
                                {isSaving ? <IconLoader2 className='h-3 w-3 animate-spin mr-1' /> : <IconCheck className='h-3 w-3 mr-1' />}
                                Save
                              </Button>
                            </>
                          ) : (
                            <Button size='sm' variant='outline' className='h-7 px-2 text-xs'
                              onClick={() => {
                                setBriefDraft(s => ({ ...s, [proj.id]: proj.brief }));
                                setBriefIntervalDraft(s => ({ ...s, [proj.id]: proj.brief_interval_m }));
                                setBriefEditing(s => ({ ...s, [proj.id]: true }));
                                setBriefExpanded(s => ({ ...s, [proj.id]: true }));
                              }}>
                              <IconEdit className='h-3 w-3 mr-1' />
                              Edit
                            </Button>
                          )}
                          <button
                            onClick={() => router.push(`/dashboard/projects/${proj.id}`)}
                            className='p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors'
                            title='Open full project page'
                          >
                            <IconExternalLink className='h-3.5 w-3.5' />
                          </button>
                        </div>
                      </div>

                      {/* Brief body */}
                      {isExpanded && (
                        <div className='px-4 py-3'>
                          {isEditing ? (
                            <div className='space-y-3'>
                              <textarea
                                value={briefDraft[proj.id] ?? proj.brief}
                                onChange={e => setBriefDraft(s => ({ ...s, [proj.id]: e.target.value }))}
                                rows={14}
                                className='w-full rounded-md border border-border/50 bg-background/80 p-3 font-mono text-xs leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                                placeholder={`# ${proj.name}\n\n## Objective\n...\n\n## Current Status\n...\n\n## What's Working\n...\n\n## Next Steps\n...`}
                              />
                              <div className='flex items-center gap-3'>
                                <span className='text-xs text-muted-foreground shrink-0'>Auto-refresh interval</span>
                                <select
                                  value={briefIntervalDraft[proj.id] ?? proj.brief_interval_m}
                                  onChange={e => setBriefIntervalDraft(s => ({ ...s, [proj.id]: Number(e.target.value) }))}
                                  className='rounded-md border border-border/50 bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                                >
                                  {BRIEF_INTERVAL_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                <span className='text-[10px] text-muted-foreground/50'>
                                  Written by the team lead after each execution
                                </span>
                              </div>
                            </div>
                          ) : proj.brief ? (
                            <pre className='whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/80 max-h-80 overflow-y-auto'>
                              {proj.brief}
                            </pre>
                          ) : (
                            <div className='flex flex-col items-center justify-center py-8 gap-2 text-center'>
                              <p className='text-sm text-muted-foreground/50'>No brief yet.</p>
                              <p className='text-xs text-muted-foreground/40'>
                                Click <span className='text-[#9A66FF]'>AI Refresh</span> to generate from execution history, or <span className='text-foreground/60'>Edit</span> to write manually.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Separator />

          {/* Agent Team Topology */}
          <div>
            <h3 className='mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
              Agent Team
            </h3>

            {/* Visual Agent Flow */}
            <div className='mb-6 rounded-xl border border-border/40 bg-[#0A0D11]/40 p-6'>
              <div className='flex items-center justify-center gap-3'>
                {/* Orchestrator node */}
                <div className='flex flex-col items-center'>
                  <div className='flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#14FFF7]/40 bg-[#14FFF7]/10 text-2xl'>
                    🎯
                  </div>
                  <span className='mt-1.5 text-[10px] font-medium text-[#14FFF7]'>
                    Orchestrator
                  </span>
                </div>

                {/* Connection lines */}
                <div className='flex flex-col items-center gap-1'>
                  {agents.map((_, i) => (
                    <div
                      key={i}
                      className='h-[2px] w-12'
                      style={{
                        background: `linear-gradient(90deg, #14FFF740, ${agents[i]?.color || '#9A66FF'}40)`
                      }}
                    />
                  ))}
                  {agents.length === 0 && <div className='h-[2px] w-12 bg-border/30' />}
                </div>

                {/* Agent nodes */}
                <div className='flex flex-col gap-3'>
                  {agents.map((agent) => {
                    const si = strategyInfo[agent.strategy] || strategyInfo.simple;
                    return (
                      <div
                        key={agent.id}
                        className='flex items-center gap-3 rounded-xl border border-border/40 bg-background/60 px-4 py-3 transition-colors hover:border-[#9A66FF]/40 cursor-pointer'
                        onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                      >
                        <EntityAvatar
                          icon={agent.icon}
                          color={agent.color}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='lg'
                        />
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-semibold' style={{ color: agent.color }}>
                              {agent.name}
                            </span>
                            <Badge
                              variant='outline'
                              className='text-[9px]'
                              style={{
                                borderColor: si.color + '30',
                                color: si.color,
                                backgroundColor: si.color + '10'
                              }}
                            >
                              {si.label}
                            </Badge>
                          </div>
                          <div className='flex items-center gap-2 text-[10px] text-muted-foreground'>
                            <span className='font-mono'>{agent.model}</span>
                            {(agent.model_type === 'image' || agent.model_type === 'video' || agent.model_type === 'audio') && (
                              <span className='rounded px-1 py-0.5 text-[8px] font-black tracking-widest uppercase' style={{ background: '#9A66FF22', color: '#9A66FF', border: '1px solid #9A66FF44' }}>
                                {agent.model_type}
                              </span>
                            )}
                            <span className='text-border'>·</span>
                            <span>max {agent.max_iterations} iters</span>
                            {agent.tools?.length > 0 && (
                              <>
                                <span className='text-border'>·</span>
                                <span>{agent.tools.length} tool{agent.tools.length !== 1 ? 's' : ''}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <IconArrowRight className='h-4 w-4 text-muted-foreground/30' />
                      </div>
                    );
                  })}
                </div>

                {/* Connection to result */}
                <div className='flex flex-col items-center gap-1'>
                  {agents.map((agent, i) => (
                    <div
                      key={i}
                      className='h-[2px] w-12'
                      style={{
                        background: `linear-gradient(90deg, ${agent.color}40, #56D09040)`
                      }}
                    />
                  ))}
                  {agents.length === 0 && <div className='h-[2px] w-12 bg-border/30' />}
                </div>

                {/* Result node */}
                <div className='flex flex-col items-center'>
                  <div className='flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#56D090]/40 bg-[#56D090]/10 text-2xl'>
                    ⚡
                  </div>
                  <span className='mt-1.5 text-[10px] font-medium text-[#56D090]'>
                    Result
                  </span>
                </div>
              </div>
            </div>

            {/* Agent Detail Cards */}
            <div className='grid gap-4 md:grid-cols-2'>
              {agents.map((agent) => {
                const si = strategyInfo[agent.strategy] || strategyInfo.simple;
                return (
                  <Card
                    key={agent.id}
                    className='cursor-pointer border-border/50 transition-colors hover:border-[#9A66FF]/40'
                    onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                  >
                    <CardHeader className='pb-2'>
                      <div className='flex items-start gap-3'>
                        <EntityAvatar
                          icon={agent.icon}
                          color={agent.color}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='lg'
                        />
                        <div className='flex-1 min-w-0'>
                          <CardTitle className='text-base' style={{ color: agent.color }}>
                            {agent.name}
                          </CardTitle>
                          <p className='mt-0.5 text-xs text-muted-foreground line-clamp-2'>
                            {agent.description}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      <div className='grid grid-cols-3 gap-3'>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Strategy</p>
                          <p className='text-xs font-medium' style={{ color: si.color }}>
                            {si.label}
                          </p>
                        </div>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Model</p>
                          <p className='truncate font-mono text-xs'>{agent.model}</p>
                        </div>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Max Iters</p>
                          <p className='text-xs font-medium'>{agent.max_iterations}</p>
                        </div>
                      </div>
                      {/* Variables & Tools */}
                      <div className='flex flex-wrap gap-1.5'>
                        {agent.variables?.map((v) => (
                          <Badge key={v.name} variant='secondary' className='font-mono text-[10px]'>
                            {'{{' + v.name + '}}'}
                          </Badge>
                        ))}
                        {agent.tools?.map((tool) => (
                          <Badge
                            key={tool}
                            variant='outline'
                            className='border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[10px] text-[#14FFF7]'
                          >
                            {tool}
                          </Badge>
                        ))}
                      </div>
                      {/* System prompt preview */}
                      {agent.system_prompt && (
                        <div className='rounded-lg border border-border/30 bg-[#0A0D11]/40 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground mb-1'>System Prompt</p>
                          <p className='font-mono text-[10px] leading-relaxed text-[#EAEAEA]/60 line-clamp-3'>
                            {agent.system_prompt}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Workforce Quick Chat */}
          <div>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                <IconRobot className='mr-1 inline h-4 w-4' />
                Workforce Chat
              </h3>
              <span className='text-[10px] text-muted-foreground/70'>Quick tasks without planning/execution pipeline</span>
            </div>

            <div className='grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]'>
              <div className='rounded-xl border border-border/40 bg-[#0A0D11]/35 p-2'>
                <p className='mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Agents</p>
                {agents.length === 0 ? (
                  <p className='px-2 py-3 text-xs text-muted-foreground/60'>Add agents to this workforce to start chatting.</p>
                ) : (
                  <div className='space-y-1'>
                    {agents.map((agent) => {
                      const active = agent.id === chatAgentId;
                      return (
                        <button
                          key={agent.id}
                          type='button'
                          onClick={() => {
                            setChatAgentId(agent.id);
                            setChatError('');
                          }}
                          className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            active
                              ? 'border-[#9A66FF]/50 bg-[#9A66FF]/12'
                              : 'border-border/30 bg-background/50 hover:bg-muted/25'
                          }`}
                        >
                          <div className='flex items-center gap-2'>
                            <EntityAvatar
                              icon={agent.icon}
                              color={agent.color}
                              avatarUrl={agent.avatar_url}
                              name={agent.name}
                              size='xs'
                            />
                            <div className='min-w-0'>
                              <p className='truncate text-xs font-medium' style={{ color: active ? agent.color : undefined }}>
                                {agent.name}
                              </p>
                              <p className='truncate text-[10px] text-muted-foreground/70'>{agent.model}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className='flex min-h-[720px] flex-col overflow-hidden rounded-xl border border-border/40 bg-background/40 lg:min-h-[780px]'>
                <div className='space-y-2 border-b border-border/35 bg-[#0A0D11]/25 p-3'>
                  <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-4'>
                    <div>
                      <Label className='text-[10px] text-muted-foreground/80'>Project</Label>
                      <select
                        value={chatProjectId}
                        onChange={(e) => setChatProjectId(e.target.value)}
                        className='mt-1 w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                      >
                        <option value=''>None</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className='text-[10px] text-muted-foreground/80'>Task</Label>
                      <select
                        value={chatTaskId}
                        onChange={(e) => setChatTaskId(e.target.value)}
                        className='mt-1 w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                      >
                        <option value=''>None</option>
                        {visibleChatTasks.map((task) => (
                          <option key={task.id} value={task.id}>{task.title}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className='text-[10px] text-muted-foreground/80'>Knowledge</Label>
                      <select
                        value={chatKnowledgeId}
                        onChange={(e) => setChatKnowledgeId(e.target.value)}
                        className='mt-1 w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                      >
                        <option value=''>None</option>
                        {knowledgeEntries.slice(0, 50).map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.title || entry.id.slice(0, 8)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className='text-[10px] text-muted-foreground/80'>Past execution</Label>
                      <select
                        value={chatExecutionId}
                        onChange={(e) => setChatExecutionId(e.target.value)}
                        className='mt-1 w-full rounded-md border border-border/40 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                      >
                        <option value=''>None</option>
                        {executions.slice(0, 50).map((exec) => (
                          <option key={exec.id} value={exec.id}>{exec.title || exec.objective}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className='rounded-lg border border-border/30 bg-background/40 px-2.5 py-2 space-y-2'>
                    <div className='flex items-center justify-between'>
                      <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Context attachments</p>
                      {!chatAgentIsMedia && (
                        <button
                          onClick={() => setChatFilePickerOpen(p => !p)}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${chatFilePickerOpen ? 'bg-[#9A66FF]/20 text-[#9A66FF]' : 'text-muted-foreground/60 hover:text-muted-foreground'}`}
                        >
                          <IconPaperclip className='h-3 w-3' />
                          {chatAttachedFiles.length > 0 ? `${chatAttachedFiles.length} file${chatAttachedFiles.length > 1 ? 's' : ''}` : 'Attach files'}
                        </button>
                      )}
                    </div>

                    {/* Context badges */}
                    {(chatComposerAttachments.length > 0 || chatAttachedFiles.length > 0) ? (
                      <div className='flex flex-wrap gap-1.5'>
                        {chatComposerAttachments.map((label) => (
                          <span key={label} className='rounded-md border border-[#14FFF7]/25 bg-[#14FFF7]/10 px-2 py-0.5 text-[10px] text-[#14FFF7]'>
                            {label}
                          </span>
                        ))}
                        {chatAttachedFiles.map((p) => (
                          <span key={p} className='flex items-center gap-1 rounded-md border border-[#9A66FF]/30 bg-[#9A66FF]/10 px-2 py-0.5 text-[10px] font-mono text-[#9A66FF]'>
                            {p.split('/').pop()}
                            <button onClick={() => setChatAttachedFiles(prev => prev.filter(x => x !== p))} className='opacity-60 hover:opacity-100'>
                              <IconX className='h-2.5 w-2.5' />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className='text-[10px] text-muted-foreground/60'>No context selected. Add project/task/knowledge/execution or attach workspace files.</p>
                    )}

                    {/* File picker panel */}
                    {chatFilePickerOpen && !chatAgentIsMedia && (
                      <div className='space-y-1.5 pt-1'>
                        <div className='relative'>
                          <IconSearch className='absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50' />
                          <input
                            placeholder='Search workspace files…'
                            value={chatFileSearch}
                            onChange={e => setChatFileSearch(e.target.value)}
                            className='w-full rounded border border-border/40 bg-background/60 py-1 pl-6 pr-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                          />
                        </div>
                        <div className='max-h-36 overflow-y-auto rounded border border-border/30 bg-background/40'>
                          {chatWorkspaceFilesLoading ? (
                            <div className='flex items-center justify-center py-3'>
                              <IconLoader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground/50' />
                            </div>
                          ) : chatWorkspaceFiles.filter(f => !chatFileSearch || f.path.toLowerCase().includes(chatFileSearch.toLowerCase())).length === 0 ? (
                            <p className='py-3 text-center text-[11px] text-muted-foreground/40'>
                              {chatWorkspaceFiles.length === 0 ? 'No workspace files found' : 'No matches'}
                            </p>
                          ) : (
                            chatWorkspaceFiles
                              .filter(f => !chatFileSearch || f.path.toLowerCase().includes(chatFileSearch.toLowerCase()))
                              .map(f => {
                                const selected = chatAttachedFiles.includes(f.path);
                                return (
                                  <button
                                    key={f.path}
                                    type='button'
                                    onClick={() => setChatAttachedFiles(prev => selected ? prev.filter(x => x !== f.path) : [...prev, f.path])}
                                    className={`flex w-full items-center gap-2 border-b border-border/20 px-2.5 py-1.5 text-left text-[11px] transition-colors last:border-0 ${selected ? 'bg-[#9A66FF]/10 text-[#9A66FF]' : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'}`}
                                  >
                                    <span className={`h-3 w-3 flex-shrink-0 rounded border text-center text-[8px] leading-[11px] ${selected ? 'border-[#9A66FF] bg-[#9A66FF] text-white' : 'border-border/60'}`}>
                                      {selected ? '✓' : ''}
                                    </span>
                                    <span className='flex-1 truncate font-mono'>{f.path}</span>
                                    <span className='flex-shrink-0 text-[9px] opacity-40'>{f.ext}</span>
                                  </button>
                                );
                              })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <ScrollArea className='flex-1 p-3'>
                  <div className='space-y-3'>
                    {chatHistoryLoading && activeChatMessages.length === 0 && (
                      <div className='flex justify-center'>
                        <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-xs text-muted-foreground'>
                          <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                          Loading conversation history…
                        </div>
                      </div>
                    )}

                    {activeChatMessages.length === 0 && !chatHistoryLoading && (
                      <div className='flex min-h-44 flex-col items-center justify-center gap-2 text-center'>
                        <div className='rounded-lg border border-border/40 bg-background/50 px-3 py-1 text-[10px] text-muted-foreground/70'>
                          {selectedChatAgent
                            ? `Chatting as ${selectedChatAgent.name} in ${workforce.name}`
                            : 'Select an agent to start'}
                        </div>
                        <p className='text-xs text-muted-foreground/60'>
                          Great for quick tests, direct asks, or media prompts without planning.
                        </p>
                      </div>
                    )}

                    {shouldAutoCollapseChatHistory && (
                      <div className='flex items-center justify-between rounded-lg border border-border/30 bg-background/50 px-2.5 py-1.5'>
                        <p className='text-[10px] text-muted-foreground/80'>
                          Showing latest response only.
                        </p>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 px-2 text-[10px]'
                          onClick={() => setShowAllChatHistory((prev) => !prev)}
                        >
                          {showAllChatHistory
                            ? 'Collapse older messages'
                            : `Show ${hiddenChatGroupCount} older message${hiddenChatGroupCount === 1 ? '' : 's'}`}
                        </Button>
                      </div>
                    )}

                    {visibleGroupedChatMessages.map((group, groupIdx) => {
                      const prevGroup = visibleGroupedChatMessages[groupIdx - 1];
                      const showDateSeparator = !prevGroup || toChatDayKey(prevGroup.createdAt) !== toChatDayKey(group.createdAt);
                      const isUser = group.role === 'user';
                      const isError = group.role === 'error';

                      return (
                        <div key={group.id} className='space-y-2'>
                          {showDateSeparator && (
                            <div className='flex items-center gap-2 py-1'>
                              <div className='h-px flex-1 bg-border/40' />
                              <span className='rounded-full border border-border/40 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground/70'>
                                {formatChatDayLabel(group.createdAt)}
                              </span>
                              <div className='h-px flex-1 bg-border/40' />
                            </div>
                          )}

                          <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-xs ${
                              isUser
                                ? 'rounded-tr-sm border border-[#9A66FF]/30 bg-[#9A66FF]/18'
                                : isError
                                  ? 'border border-red-500/30 bg-red-500/10 text-red-300'
                                  : 'rounded-tl-sm border border-border/40 bg-background/70'
                            }`}>
                              {!isUser && !isError && selectedChatAgent && (
                                <div className='mb-1.5 flex items-center justify-between gap-2'>
                                  <div className='flex items-center gap-1.5'>
                                    <EntityAvatar
                                      icon={selectedChatAgent.icon}
                                      color={selectedChatAgent.color}
                                      avatarUrl={selectedChatAgent.avatar_url}
                                      name={selectedChatAgent.name}
                                      size='xs'
                                    />
                                    <span className='text-[10px] font-semibold' style={{ color: selectedChatAgent.color }}>
                                      {selectedChatAgent.name}
                                    </span>
                                  </div>
                                  <span className='text-[9px] text-muted-foreground/60'>
                                    {new Date(group.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              )}

                              <div className='space-y-2'>
                                {group.messages.map((msg, idx) => {
                                  const metaTags = [
                                    msg.meta?.projectName ? `Project · ${msg.meta.projectName}` : '',
                                    msg.meta?.taskTitle ? `Task · ${msg.meta.taskTitle}` : '',
                                    msg.meta?.knowledgeTitle ? `Knowledge · ${msg.meta.knowledgeTitle}` : '',
                                    msg.meta?.executionTitle ? `Past execution · ${msg.meta.executionTitle}` : '',
                                    msg.meta?.inputMode === 'media' ? 'Media request' : '',
                                    msg.meta?.filename ? `Filename · ${msg.meta.filename}` : ''
                                  ].filter(Boolean);

                                  return (
                                    <div key={msg.id} className={idx > 0 ? 'border-t border-border/20 pt-2' : ''}>
                                      {metaTags.length > 0 && (
                                        <div className='mb-1.5 flex flex-wrap gap-1'>
                                          {metaTags.map((tag) => (
                                            <span
                                              key={`${msg.id}-${tag}`}
                                              className='rounded-md border border-border/40 bg-background/50 px-1.5 py-0.5 text-[9px] text-muted-foreground/85'
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                                        <div className='mb-1.5 space-y-1'>
                                          <div className='flex flex-wrap gap-1'>
                                            {msg.toolCalls.map((toolCall, toolIdx) => (
                                              <Badge
                                                key={`${msg.id}-tool-${toolIdx}`}
                                                variant='outline'
                                                className='border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[9px] text-[#14FFF7]'
                                              >
                                                {toolCall.name}
                                              </Badge>
                                            ))}
                                          </div>
                                          <div className='space-y-1'>
                                            {msg.toolCalls.map((toolCall, toolIdx) => {
                                              const argsText = formatToolPayload(toolCall.args || {});
                                              const resultText = summarizeToolResult(toolCall.result || '');
                                              return (
                                                <details
                                                  key={`${msg.id}-tool-detail-${toolIdx}`}
                                                  className='rounded-md border border-border/40 bg-background/50 px-2 py-1 text-[10px]'
                                                >
                                                  <summary className='cursor-pointer list-none text-[10px] text-muted-foreground/90'>
                                                    {toolCall.name} details
                                                  </summary>
                                                  <div className='mt-1 space-y-1 text-[10px]'>
                                                    {argsText && argsText !== '{}' && (
                                                      <div>
                                                        <p className='mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70'>Args</p>
                                                        <pre className='max-h-24 overflow-auto whitespace-pre-wrap rounded border border-border/30 bg-background/80 p-1 font-mono text-[9px]'>
                                                          {argsText}
                                                        </pre>
                                                      </div>
                                                    )}
                                                    {resultText && (
                                                      <div>
                                                        <p className='mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70'>Result</p>
                                                        <p className='whitespace-pre-wrap break-words'>{resultText}</p>
                                                      </div>
                                                    )}
                                                  </div>
                                                </details>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}

                                      <p className='whitespace-pre-wrap break-words leading-relaxed'>{msg.content}</p>

                                      {msg.images && msg.images.length > 0 && (
                                        <div className='mt-2 grid gap-2 sm:grid-cols-2'>
                                          {msg.images.map((imgUrl, imageIdx) => {
                                            const resolvedImageUrl = resolveWorkforceChatImageUrl(
                                              imgUrl,
                                              msg.meta?.workforceId || workforce.id
                                            );
                                            return (
                                            <a
                                              key={`${msg.id}-img-${imageIdx}`}
                                              href={resolvedImageUrl}
                                              target='_blank'
                                              rel='noreferrer'
                                              className='group overflow-hidden rounded-lg border border-border/40 bg-[#0A0D11]/60'
                                            >
                                              <AuthenticatedImage
                                                src={resolvedImageUrl}
                                                alt='Generated media output'
                                                className='h-56 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] lg:h-64'
                                                accessToken={session?.accessToken as string | undefined}
                                              />
                                            </a>
                                            );
                                          })}
                                        </div>
                                      )}

                                      <p className='mt-1 text-right text-[9px] text-muted-foreground/50'>
                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(chatLoading || chatActivity.length > 0) && (
                      <div className='flex justify-start'>
                        <div className='w-full max-w-[92%] rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs'>
                          <div className='mb-1 flex items-center gap-2 text-[10px] text-muted-foreground/80'>
                            <IconBrain className='h-3.5 w-3.5 text-[#9A66FF]' />
                            Agent activity
                          </div>
                          <div className='space-y-1'>
                            {chatActivity.map((step) => (
                              <div key={step.key} className='flex items-start gap-2 text-[10px] text-muted-foreground/90'>
                                {step.status === 'running' ? (
                                  <IconLoader2 className='mt-0.5 h-3 w-3 animate-spin text-[#9A66FF]' />
                                ) : step.status === 'done' ? (
                                  <IconCheck className='mt-0.5 h-3 w-3 text-[#56D090]' />
                                ) : step.status === 'error' ? (
                                  <IconX className='mt-0.5 h-3 w-3 text-red-400' />
                                ) : (
                                  <IconClock className='mt-0.5 h-3 w-3 text-muted-foreground/70' />
                                )}
                                <div className='min-w-0'>
                                  <p>{step.label}</p>
                                  {step.detail && (
                                    <p className='text-[9px] text-muted-foreground/70'>{step.detail}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                            {chatLoading && chatActivity.length === 0 && (
                              <div className='flex items-center gap-2 text-muted-foreground'>
                                <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                                Thinking…
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>

                <div className='border-t border-border/35 p-3'>
                  {chatError && (
                    <p className='mb-2 text-xs text-red-400'>{chatError}</p>
                  )}
                  <div className='mb-2 flex flex-wrap gap-1.5'>
                    {chatComposerAttachments.map((label) => (
                      <span
                        key={`composer-${label}`}
                        className='rounded-md border border-border/40 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground/90'
                      >
                        {label}
                      </span>
                    ))}
                    {chatAgentIsMedia && (
                      <span className='rounded-md border border-[#56D090]/30 bg-[#56D090]/12 px-2 py-0.5 text-[10px] text-[#56D090]'>
                        Media mode · prompt + filename required
                      </span>
                    )}
                    {chatComposerAttachments.length === 0 && !chatAgentIsMedia && (
                      <span className='text-[10px] text-muted-foreground/60'>No context attached</span>
                    )}
                  </div>

                  <div className='flex flex-col gap-2'>
                    {chatAgentIsMedia ? (
                      <>
                        <Textarea
                          value={chatMediaPrompt}
                          onChange={(e) => setChatMediaPrompt(e.target.value)}
                          placeholder='Prompt: describe the image to generate'
                          rows={3}
                          className='min-h-[80px] resize-none text-xs'
                        />
                        <Input
                          value={chatFilename}
                          onChange={(e) => setChatFilename(e.target.value)}
                          placeholder='Filename: output-image.png'
                          className='h-9 text-xs'
                        />
                      </>
                    ) : (
                      <Textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleWorkforceChatKeyDown}
                        placeholder='Message selected agent in this workforce context...'
                        rows={3}
                        className='min-h-[70px] resize-none text-xs'
                      />
                    )}

                    <div className='flex items-center justify-between gap-2'>
                      <p className='text-[10px] text-muted-foreground/60'>
                        {chatAgentIsMedia
                          ? 'Only prompt + filename are accepted for media generators.'
                          : 'Press Enter to send. Shift+Enter for a new line.'}
                      </p>
                      <Button
                        size='sm'
                        className='h-9 shrink-0 bg-[#56D090] px-3 text-[#0A0D11] hover:bg-[#56D090]/90'
                        disabled={!chatAgentId || !canSendChatMessage}
                        onClick={handleSendWorkforceChat}
                      >
                        {chatLoading ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconArrowRight className='mr-1 h-4 w-4' />}
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* MCP Tools */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                <IconTool className='mr-1 inline h-4 w-4' />
                MCP Tools
              </h3>
              {mcpLoading && <IconLoader2 className='h-4 w-4 animate-spin text-muted-foreground' />}
            </div>

            {/* Attached MCP Servers */}
            {mcpServers.length > 0 ? (
              <div className='space-y-3'>
                {mcpServers.map((srv) => (
                  <Card key={srv.id} className='border-border/50'>
                    <CardHeader className='pb-2'>
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-2'>
                          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[#14FFF7]/10 overflow-hidden'>
                            {srv.icon && (srv.icon.startsWith('/') || srv.icon.startsWith('http')) ? (
                              <img src={srv.icon} alt={srv.name} className='h-5 w-5 object-contain' />
                            ) : srv.icon ? (
                              <span className='text-base leading-none'>{srv.icon}</span>
                            ) : (
                              <IconTool className='h-4 w-4 text-[#14FFF7]' />
                            )}
                          </div>
                          <div>
                            <CardTitle className='text-sm'>{srv.name}</CardTitle>
                            <p className='text-[10px] text-muted-foreground'>
                              {srv.transport} · {srv.tools?.length || 0} tools
                            </p>
                          </div>
                        </div>
                        <div className='flex gap-1'>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-xs text-muted-foreground hover:text-foreground'
                            disabled={discoveringMcp === srv.id}
                            onClick={() => handleDiscoverMCPTools(srv.id)}
                            title='Re-run tool discovery'
                          >
                            {discoveringMcp === srv.id
                              ? <IconLoader2 className='h-3 w-3 animate-spin' />
                              : <IconRefresh className='h-3 w-3' />}
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-xs text-red-400 hover:text-red-400'
                            onClick={() => handleDetachMCP(srv.id)}
                          >
                            <IconLinkOff className='mr-1 h-3 w-3' /> Detach
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      {/* Per-agent access */}
                      <div className='space-y-2'>
                        <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                          Agent Access
                        </p>
                        {agents.map((agent) => {
                          const perms = agentPerms[agent.id]?.[srv.id];
                          const hasAccess = perms && perms.length > 0;
                          const hasAll = hasAccess && perms.some((p: string) => p === '');
                          return (
                            <div
                              key={agent.id}
                              className='flex items-center justify-between rounded-lg border border-border/30 px-3 py-2'
                            >
                              <div className='flex items-center gap-2'>
                                <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} name={agent.name} size='xs' />
                                <span className='text-xs font-medium' style={{ color: agent.color }}>
                                  {agent.name}
                                </span>
                                {hasAccess && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#56D090]/30 bg-[#56D090]/10 text-[9px] text-[#56D090]'
                                  >
                                    {hasAll ? 'All tools' : `${perms.length} tool${perms.length !== 1 ? 's' : ''}`}
                                  </Badge>
                                )}
                              </div>
                              <div className='flex gap-1'>
                                {hasAccess ? (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 text-[10px] text-red-400 hover:text-red-400'
                                    onClick={() => handleRevokeTools(agent.id, srv.id)}
                                  >
                                    Revoke
                                  </Button>
                                ) : (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 text-[10px] text-[#56D090] hover:text-[#56D090]'
                                    onClick={() => handleGrantAllTools(agent.id, srv.id)}
                                  >
                                    Grant All
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tool list preview */}
                      {srv.tools && srv.tools.length > 0 && (
                        <div className='space-y-1'>
                          <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                            Available Tools
                          </p>
                          <div className='flex flex-wrap gap-1'>
                            {srv.tools.map((tool) => (
                              <Badge
                                key={tool.name}
                                variant='outline'
                                className='border-border/50 text-[9px]'
                                title={tool.description}
                              >
                                {tool.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No MCP servers attached. Add one to give agents tools.
                </p>
              </div>
            )}

            {/* Available servers to attach */}
            {(() => {
              const attachedIds = new Set(mcpServers.map((s) => s.id));
              const available = allMcpServers.filter((s) => !attachedIds.has(s.id) && s.is_enabled && s.name !== 'Aither-Tools');
              if (available.length === 0) return null;
              return (
                <div className='mt-3'>
                  <p className='mb-2 text-[10px] font-semibold uppercase text-muted-foreground'>
                    Available Servers
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {available.map((srv) => (
                      <Button
                        key={srv.id}
                        variant='outline'
                        size='sm'
                        className='text-xs'
                        onClick={() => handleAttachMCP(srv.id)}
                        disabled={mcpLoading}
                      >
                        <IconLink className='mr-1 h-3 w-3' />
                        {srv.name}
                        {srv.tools && srv.tools.length > 0 && (
                          <span className='ml-1 text-muted-foreground'>
                            ({srv.tools.length} tools)
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <Separator />

          {/* Knowledge Base */}
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Knowledge Base
                {knowledgeCount > 0 && (
                  <span className='ml-2 text-[10px] font-normal text-muted-foreground/70'>
                    ({knowledgeCount} entries)
                  </span>
                )}
              </h3>
              <div className='flex items-center gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-xs'
                  onClick={async () => {
                    if (session?.accessToken) api.setToken(session.accessToken);
                    const kbRes = await api.listKnowledge(wfId);
                    setKnowledgeEntries(kbRes.data?.entries ?? []);
                    setKnowledgeCount(kbRes.data?.total ?? 0);
                  }}
                >
                  <IconRefresh className='h-3 w-3' />
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-xs'
                  onClick={() => setKbAddOpen(true)}
                >
                  <IconPlus className='mr-1 h-3 w-3' /> Add
                </Button>
              </div>
            </div>

            {/* Search + source filter */}
            <div className='mb-3 space-y-2'>
              <div className='flex gap-2'>
                <Input
                  placeholder='Search knowledge base...'
                  value={kbSearchQuery}
                  onChange={(e) => {
                    setKbSearchQuery(e.target.value);
                    if (!e.target.value.trim()) setKbSearchResults(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchKnowledge()}
                  className='h-8 text-xs'
                />
                <Button
                  size='sm'
                  variant='outline'
                  className='h-8 text-xs'
                  onClick={handleSearchKnowledge}
                  disabled={kbLoading}
                >
                  {kbLoading ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Search'}
                </Button>
              </div>
              {kbSearchResults === null && knowledgeEntries.length > 0 && (
                <div className='flex flex-wrap gap-1'>
                  {(['all', 'execution_result', 'agent_message', 'manual'] as const).map((type) => {
                    const labels: Record<string, string> = {
                      all: 'All',
                      execution_result: 'Results',
                      agent_message: 'Agent msgs',
                      manual: 'Manual',
                    };
                    const active = kbSourceFilter === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setKbSourceFilter(type)}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          active
                            ? 'bg-[#9A66FF] text-white'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {labels[type]}
                        {type === 'all' && ` (${knowledgeEntries.length})`}
                        {type !== 'all' && ` (${knowledgeEntries.filter((e) => e.source_type === type).length})`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Search Results */}
            {kbSearchResults !== null && (
              <div className='mb-3 space-y-2'>
                <div className='flex items-center justify-between'>
                  <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                    Search Results ({kbSearchResults.length})
                  </p>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-6 text-[10px]'
                    onClick={() => { setKbSearchResults(null); setKbSearchQuery(''); }}
                  >
                    Clear
                  </Button>
                </div>
                {kbSearchResults.length === 0 ? (
                  <p className='text-xs text-muted-foreground'>No matching entries found.</p>
                ) : (
                  kbSearchResults.map((entry) => (
                    <KnowledgeCard
                      key={entry.id}
                      entry={entry}
                      onDelete={handleDeleteKnowledge}
                    />
                  ))
                )}
              </div>
            )}

            {/* Knowledge Entries List */}
            {kbSearchResults === null && (() => {
              const filtered = kbSourceFilter === 'all'
                ? knowledgeEntries
                : knowledgeEntries.filter((e) => e.source_type === kbSourceFilter);
              const visible = kbShowAll ? filtered : filtered.slice(0, 15);
              return filtered.length === 0 ? (
                <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                  <p className='text-xs text-muted-foreground'>
                    {knowledgeEntries.length === 0
                      ? 'No knowledge entries yet. Auto-created from executions.'
                      : 'No entries match this filter.'}
                  </p>
                </div>
              ) : (
                <div className='space-y-2'>
                  {visible.map((entry) => (
                    <KnowledgeCard
                      key={entry.id}
                      entry={entry}
                      onDelete={handleDeleteKnowledge}
                    />
                  ))}
                  {filtered.length > 15 && (
                    <button
                      onClick={() => setKbShowAll((v) => !v)}
                      className='w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors'
                    >
                      {kbShowAll
                        ? 'Show less'
                        : `Show all ${filtered.length} entries`}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Add Knowledge Dialog */}
            <Dialog open={kbAddOpen} onOpenChange={setKbAddOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Knowledge</DialogTitle>
                  <DialogDescription>
                    Add manual knowledge to this workforce. Agents will use it via RAG during executions.
                  </DialogDescription>
                </DialogHeader>
                <div className='space-y-3'>
                  <div className='space-y-2'>
                    <Label>Title</Label>
                    <Input
                      value={kbTitle}
                      onChange={(e) => setKbTitle(e.target.value)}
                      placeholder='Brief title for this knowledge entry'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Content</Label>
                    <Textarea
                      value={kbContent}
                      onChange={(e) => setKbContent(e.target.value)}
                      placeholder='Knowledge content (facts, procedures, context...)'
                      rows={6}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant='outline' onClick={() => setKbAddOpen(false)}>Cancel</Button>
                  <Button
                    onClick={handleAddKnowledge}
                    disabled={kbLoading || !kbContent.trim()}
                    className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  >
                    {kbLoading ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlus className='mr-1 h-4 w-4' />}
                    {kbLoading ? 'Embedding...' : 'Add'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Separator />

          {/* ── Credentials ──────────────────────────────────────── */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                  Credentials
                </h3>
                <span className='rounded-full bg-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                  {credentials.length} stored
                </span>
              </div>
            </div>

            {/* Smart checklist: what each attached server needs */}
            {(() => {
              const storedSet = new Set(credentials.map(c => `${c.service}/${c.key_name}`));
              const serverHints = mcpServers
                .map(s => ({
                  server: s,
                  hints: SERVER_CREDENTIAL_HINTS[s.name] ?? envVarCredHints(s.name, s.env_vars),
                }))
                .filter(({ hints }) => hints.length > 0);

              if (serverHints.length === 0) return null;

              return (
                <div className='mb-4 rounded-xl border border-border/40 bg-[#0A0D11]/60 overflow-hidden'>
                  <div className='px-4 py-3 border-b border-border/30 flex items-center gap-2'>
                    <IconKey className='h-3.5 w-3.5 text-muted-foreground/60' />
                    <span className='text-xs font-semibold text-muted-foreground flex-1'>Detected requirements from attached servers</span>
                    <span className='text-[10px] text-muted-foreground/50'>
                      Agents call <code className='text-[#14FFF7]'>get_secret(service, key)</code> at runtime
                    </span>
                  </div>
                  <div className='divide-y divide-border/20'>
                    {serverHints.map(({ server, hints }) => (
                      <div key={server.id} className='px-4 py-3 space-y-1.5'>
                        <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2'>{server.name}</p>
                        {hints.map(hint => {
                          const stored = storedSet.has(`${hint.service}/${hint.key}`);
                          const isEditing = credService === hint.service && credKey === hint.key;
                          return (
                            <div
                              key={`${hint.service}/${hint.key}`}
                              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${isEditing ? 'bg-[#9A66FF]/10 border border-[#9A66FF]/30' : 'bg-card/40 border border-border/20'}`}
                            >
                              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${stored ? 'bg-[#56D090]/15' : 'bg-[#FFBF47]/10'}`}>
                                {stored
                                  ? <IconCheck className='h-3.5 w-3.5 text-[#56D090]' />
                                  : <IconKey className='h-3 w-3 text-[#FFBF47]' />
                                }
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='flex items-center gap-2'>
                                  <span className={`font-mono text-xs font-semibold ${stored ? 'text-[#56D090]' : 'text-foreground'}`}>
                                    {hint.service}
                                  </span>
                                  <span className='text-muted-foreground/40 text-xs'>/</span>
                                  <span className={`font-mono text-xs ${stored ? 'text-[#56D090]/80' : 'text-foreground/80'}`}>
                                    {hint.key}
                                  </span>
                                  {stored && <span className='text-[10px] text-[#56D090]/60'>stored ✓</span>}
                                </div>
                                <p className='text-[10px] text-muted-foreground/50 truncate mt-0.5'>{hint.label}</p>
                              </div>
                              {!stored && (
                                <Button
                                  variant='outline'
                                  size='sm'
                                  className='h-6 px-3 text-[11px] border-[#9A66FF]/40 text-[#9A66FF] hover:bg-[#9A66FF]/10 shrink-0'
                                  onClick={() => {
                                    setCredService(hint.service);
                                    setCredKey(hint.key);
                                    setCredValue('');
                                    setCredShowValue(false);
                                  }}
                                >
                                  Add
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Add credential form */}
            <div className='mb-4 rounded-xl border border-border/40 bg-[#0A0D11]/60 p-4'>
              <p className='mb-3 text-xs text-muted-foreground'>
                {credService
                  ? <>Adding <span className='font-mono text-foreground'>{credService} / {credKey}</span> — paste the value below:</>
                  : 'Add a credential manually, or click "Add" on a detected requirement above:'
                }
              </p>
              <div className='space-y-2'>
                {/* Row 1: service + key */}
                <div className='flex gap-2'>
                  <Input
                    placeholder='service  (e.g. devto)'
                    value={credService}
                    onChange={e => setCredService(e.target.value)}
                    className='h-8 text-xs font-mono'
                  />
                  <Input
                    placeholder='key  (e.g. api_key)'
                    value={credKey}
                    onChange={e => setCredKey(e.target.value)}
                    className='h-8 text-xs font-mono'
                  />
                </div>
                {/* Row 2: value + save */}
                <div className='flex gap-2'>
                  <div className='relative flex-1'>
                    <Input
                      id='cred-value-input'
                      type={credShowValue ? 'text' : 'password'}
                      placeholder='Secret value'
                      value={credValue}
                      onChange={e => setCredValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !credSaving && credService.trim() && credKey.trim() && credValue.trim())
                          document.getElementById('cred-save-btn')?.click();
                      }}
                      className='h-8 pr-8 text-xs font-mono'
                    />
                    <button
                      type='button'
                      onClick={() => setCredShowValue(v => !v)}
                      className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                    >
                      {credShowValue ? <IconEyeOff className='h-3.5 w-3.5' /> : <IconEye className='h-3.5 w-3.5' />}
                    </button>
                  </div>
                  <Button
                    id='cred-save-btn'
                    size='sm'
                    className='h-8 shrink-0 bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                    disabled={!credService.trim() || !credKey.trim() || !credValue.trim() || credSaving}
                    onClick={async () => {
                      if (session?.accessToken) api.setToken(session.accessToken);
                      setCredSaving(true);
                      setCredError('');
                      try {
                        const res = await api.upsertCredential(wfId, {
                          service: credService.trim().toLowerCase(),
                          key_name: credKey.trim().toLowerCase(),
                          value: credValue,
                        });
                        if (res.data) {
                          setCredentials(prev => {
                            const filtered = prev.filter(c => !(c.service === res.data!.service && c.key_name === res.data!.key_name));
                            return [...filtered, res.data!].sort((a, b) => a.service.localeCompare(b.service) || a.key_name.localeCompare(b.key_name));
                          });
                          setCredService('');
                          setCredKey('');
                          setCredValue('');
                        }
                      } catch (err: any) {
                        setCredError(err.message || 'Failed to save credential');
                      } finally {
                        setCredSaving(false);
                      }
                    }}
                  >
                    {credSaving ? <IconLoader2 className='h-3.5 w-3.5 animate-spin' /> : <IconKey className='h-3.5 w-3.5' />}
                    <span className='ml-1'>Save</span>
                  </Button>
                </div>
              </div>
              {credError && (
                <p className='mt-2 text-xs text-red-400'>{credError}</p>
              )}
            </div>

            {/* Stored credentials grouped by service */}
            {credentials.length > 0 ? (() => {
              const grouped: Record<string, Credential[]> = {};
              for (const c of credentials) {
                if (!grouped[c.service]) grouped[c.service] = [];
                grouped[c.service].push(c);
              }
              return (
                <div className='space-y-2'>
                  {Object.entries(grouped).map(([service, keys]) => (
                    <div key={service} className='rounded-lg border border-border/30 bg-card/50'>
                      <div className='flex items-center gap-2 border-b border-border/30 px-3 py-2'>
                        <div className='flex h-5 w-5 items-center justify-center rounded bg-[#9A66FF]/15'>
                          <IconKey className='h-3 w-3 text-[#9A66FF]' />
                        </div>
                        <span className='text-xs font-semibold text-[#9A66FF]'>{service}</span>
                        <span className='text-[10px] text-muted-foreground'>{keys.length} key{keys.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className='divide-y divide-border/20'>
                        {keys.map(cred => (
                          <div key={cred.id} className='flex items-center justify-between px-3 py-2'>
                            <div className='flex items-center gap-3'>
                              <span className='font-mono text-xs text-foreground'>{cred.key_name}</span>
                              <span className='font-mono text-xs tracking-widest text-muted-foreground'>••••••••</span>
                            </div>
                            <button
                              onClick={async () => {
                                await api.deleteCredential(wfId, cred.service, cred.key_name);
                                setCredentials(prev => prev.filter(c => c.id !== cred.id));
                              }}
                              className='rounded p-1 text-muted-foreground hover:text-destructive'
                            >
                              <IconTrash className='h-3.5 w-3.5' />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })() : (
              <div className='flex h-16 items-center justify-center rounded-lg border border-dashed border-border/30'>
                <p className='text-xs text-muted-foreground/50'>No credentials stored yet</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Execution Feed (Approvals + Executions) */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Execution Feed
                {pendingApprovalCount > 0 && (
                  <Badge className='ml-2 text-[9px]' style={{ backgroundColor: '#FFBF47', color: '#0A0D11' }}>
                    {pendingApprovalCount} pending approvals
                  </Badge>
                )}
              </h3>
              <Button
                size='sm'
                variant='ghost'
                className='text-xs'
                onClick={() => {
                  setExecObjective(workforce.objective);
                  setExecOpen(true);
                }}
              >
                <IconPlayerPlay className='mr-1 h-3 w-3' /> New
              </Button>
            </div>

            {unifiedFeed.length === 0 ? (
              <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No approvals or executions yet. Launch one to get started.
                </p>
              </div>
            ) : (
              <div className='space-y-2'>
                {unifiedFeed.slice(0, 30).map((entry) => {
                  if (entry.kind === 'approval') {
                    const approval = entry.approval;
                    const isPending = approval.status === 'pending';
                    const isApproved = approval.status === 'approved';
                    const statusColor = isPending ? '#FFBF47' : isApproved ? '#56D090' : '#EF4444';
                    const statusLabel = isPending ? 'Pending' : isApproved ? 'Approved' : approval.status === 'rejected' ? 'Rejected' : approval.status;

                    return (
                      <div
                        key={`approval-${approval.id}`}
                        className='rounded-lg border border-border/40 bg-background/50 p-3'
                        style={isPending ? { borderColor: '#FFBF4740' } : undefined}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <Badge variant='outline' className='text-[9px]' style={{
                                backgroundColor: '#9A66FF15',
                                borderColor: '#9A66FF30',
                                color: '#9A66FF'
                              }}>
                                Approval
                              </Badge>
                              <p className='text-xs font-medium'>{approval.title || 'Untitled'}</p>
                              <Badge variant='outline' className='text-[9px]' style={{
                                backgroundColor: statusColor + '15',
                                borderColor: statusColor + '30',
                                color: statusColor
                              }}>
                                {statusLabel}
                              </Badge>
                            </div>
                            {approval.description && (
                              <p className='mt-1 text-[10px] text-muted-foreground line-clamp-2'>
                                {approval.description}
                              </p>
                            )}
                            <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground/60'>
                              <span>by {approval.requested_by}</span>
                              <span>{timeAgo(approval.created_at)}</span>
                              <span>action: {(approval.action_type || '').replace('_', ' ')}</span>
                              {approval.execution_id && (
                                <button
                                  className='text-[#9A66FF] hover:text-[#9A66FF]/80'
                                  onClick={() => router.push(`/dashboard/executions/${approval.execution_id}`)}
                                >
                                  view execution
                                </button>
                              )}
                            </div>
                            {approval.reviewer_notes && (
                              <p className='mt-1 text-[10px] italic text-muted-foreground'>
                                &quot;{approval.reviewer_notes}&quot;
                              </p>
                            )}
                          </div>
                          {isPending && (
                            <div className='flex shrink-0 gap-1'>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 px-2 text-[10px] text-[#56D090] hover:bg-[#56D090]/10 hover:text-[#56D090]'
                                disabled={approvalsLoading}
                                onClick={() => handleResolveApproval(approval.id, true)}
                              >
                                Approve
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                className='h-7 px-2 text-[10px] text-[#EF4444] hover:bg-[#EF4444]/10 hover:text-[#EF4444]'
                                disabled={approvalsLoading}
                                onClick={() => handleResolveApproval(approval.id, false)}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const exec = entry.execution;
                  const es = execStatusColors[exec.status] || { color: '#888', label: exec.status };
                  return (
                    <div
                      key={`execution-${exec.id}`}
                      className='flex cursor-pointer items-center gap-4 rounded-lg border border-border/40 bg-background/50 px-4 py-3 transition-colors hover:border-[#9A66FF]/40'
                      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                    >
                      <div className='flex h-9 w-9 items-center justify-center rounded-lg' style={{ backgroundColor: es.color + '15' }}>
                        <IconBolt className='h-4 w-4' style={{ color: es.color }} />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='mb-0.5 flex items-center gap-2'>
                          <Badge variant='outline' className='text-[9px]' style={{
                            backgroundColor: '#14FFF715',
                            borderColor: '#14FFF730',
                            color: '#14FFF7'
                          }}>
                            Execution
                          </Badge>
                          <p className='text-sm line-clamp-1'>{exec.title || exec.objective}</p>
                        </div>
                        <div className='mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground'>
                          <span>{formatTokens(exec.tokens_used)} tokens</span>
                          <span className='text-border'>·</span>
                          <span>{exec.iterations} iter{exec.iterations !== 1 ? 's' : ''}</span>
                          <span className='text-border'>·</span>
                          <span>{timeAgo(exec.created_at)}</span>
                        </div>
                      </div>
                      <Badge
                        variant='outline'
                        className='shrink-0 text-[10px]'
                        style={{
                          backgroundColor: es.color + '15',
                          borderColor: es.color + '30',
                          color: es.color
                        }}
                      >
                        {es.label}
                      </Badge>
                    </div>
                  );
                })}
                {unifiedFeed.length > 30 && (
                  <p className='text-center text-[10px] text-muted-foreground'>
                    Showing 30 of {unifiedFeed.length} items
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      </ScrollArea>

      {/* Start Execution Dialog */}
      <Dialog open={execOpen} onOpenChange={(v) => {
        setExecOpen(v);
        if (v) {
          runPreflight();
          if (!execSingleAgentId && agents.length > 0) {
            setExecSingleAgentId(agents[0].id);
          }
        } else {
          setPreflight(null);
          setExecMode('all_agents');
          setExecSingleAgentId('');
        }
      }}>
        <DialogContent className='max-w-lg max-h-[90vh] flex flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle className='flex items-center gap-2'>
              <IconPlayerPlay className='h-5 w-5 text-[#56D090]' />
              Launch Execution
            </DialogTitle>
            <DialogDescription>
              Define the objective for {workforce.name}.
            </DialogDescription>
          </DialogHeader>
          <div className='overflow-y-auto flex-1 min-h-0 space-y-4 py-1'>
            <div className='space-y-2'>
              <Label>Objective</Label>
              <Textarea
                value={execObjective}
                onChange={(e) => setExecObjective(e.target.value)}
                placeholder='What should this workforce accomplish?'
                rows={4}
              />
              <p className='text-xs text-muted-foreground'>Team: {agents.map((a) => `${a.icon} ${a.name}`).join(', ')}</p>
            </div>

            <div className='space-y-2'>
              <Label>Execution mode</Label>
              <div className='grid grid-cols-2 gap-2'>
                <button
                  type='button'
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    execMode === 'all_agents'
                      ? 'border-[#9A66FF]/50 bg-[#9A66FF]/10 text-[#9A66FF]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => setExecMode('all_agents')}
                >
                  <p className='font-semibold'>All agents</p>
                  <p className='mt-0.5 text-[10px] opacity-80'>Collaborative planning + approval</p>
                </button>
                <button
                  type='button'
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    execMode === 'single_agent'
                      ? 'border-[#56D090]/50 bg-[#56D090]/10 text-[#56D090]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => {
                    setExecMode('single_agent');
                    if (!execSingleAgentId && agents.length > 0) setExecSingleAgentId(agents[0].id);
                  }}
                >
                  <p className='font-semibold'>Single agent (simple)</p>
                  <p className='mt-0.5 text-[10px] opacity-80'>No approval gate, direct execution</p>
                </button>
              </div>
              {execMode === 'single_agent' && (
                <div className='space-y-1.5 rounded-md border border-[#56D090]/20 bg-[#56D090]/5 p-2.5'>
                  <Label className='text-[11px] text-[#56D090]'>Agent</Label>
                  <select
                    value={execSingleAgentId}
                    onChange={(e) => setExecSingleAgentId(e.target.value)}
                    className='w-full rounded border border-border/50 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#56D090]'
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Pre-flight checks */}
            <div className='rounded-lg border border-border/40 overflow-hidden'>
              <div className='flex items-center gap-2 px-3 py-2 bg-muted/10 border-b border-border/30'>
                <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1'>Pre-flight Check</span>
                <button
                  onClick={runPreflight}
                  disabled={preflightLoading}
                  className='flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors'
                >
                  {preflightLoading
                    ? <IconLoader2 className='h-3 w-3 animate-spin' />
                    : <IconRefresh className='h-3 w-3' />}
                  {preflightLoading ? 'Checking…' : 'Re-run'}
                </button>
                {preflight && (
                  <span className={`text-[10px] font-bold ${preflight.ok ? 'text-[#56D090]' : 'text-red-400'}`}>
                    {preflight.ok ? '✓ Ready' : '✗ Issues found'}
                  </span>
                )}
              </div>
              <div className='divide-y divide-border/20'>
                {preflightLoading && !preflight && (
                  <p className='px-3 py-2 text-[11px] text-muted-foreground/50'>Running checks…</p>
                )}
                {preflight?.checks.map((c, i) => (
                  <div key={i} className='flex items-start gap-2 px-3 py-2'>
                    <span className={`mt-0.5 text-[11px] font-bold shrink-0 ${c.ok ? 'text-[#56D090]' : 'text-red-400'}`}>
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <div className='min-w-0'>
                      <p className='text-[11px] font-medium text-foreground/80'>{c.name}</p>
                      <p className='text-[10px] text-muted-foreground/60'>{c.detail}</p>
                    </div>
                  </div>
                ))}
                {!preflight && !preflightLoading && (
                  <p className='px-3 py-2 text-[11px] text-muted-foreground/40'>Click Re-run to validate configuration</p>
                )}
              </div>
            </div>

            {/* ── Credentials ── */}
            {(() => {
              // Compute per-server hints + resolve stored status
              const storedSet = new Set(credentials.map(c => `${c.service}/${c.key_name}`));
              const serverHints = mcpServers
                .filter(s => s.name !== 'Aither-Tools' || true) // include all
                .map(s => ({
                  server: s,
                  hints: SERVER_CREDENTIAL_HINTS[s.name] ?? envVarCredHints(s.name, s.env_vars ?? {}),
                }))
                .filter(({ hints }) => hints.length > 0);
              const allHints = serverHints.flatMap(({ hints }) => hints);
              const missingCount = allHints.filter(h => !storedSet.has(`${h.service}/${h.key}`)).length;

              return (
                <div className='rounded-lg border border-border/40 overflow-hidden'>
                  <div className='flex items-center gap-2 px-3 py-2 bg-muted/10 border-b border-border/30'>
                    <IconKey className='h-3.5 w-3.5 text-muted-foreground/60' />
                    <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1'>Credentials</span>
                    {missingCount > 0 && (
                      <span className='text-[10px] text-[#FFBF47]'>{missingCount} missing</span>
                    )}
                    {missingCount === 0 && credentials.length > 0 && (
                      <span className='text-[10px] text-[#56D090]'>all set</span>
                    )}
                    <span className='text-[10px] text-muted-foreground/50 ml-1'>{credentials.length} stored</span>
                  </div>

                  {/* Per-server credential checklist */}
                  {serverHints.length > 0 && (
                    <div className='divide-y divide-border/20 border-b border-border/30'>
                      {serverHints.map(({ server, hints }) => (
                        <div key={server.id} className='px-3 py-2 space-y-1'>
                          <p className='text-[10px] font-semibold text-muted-foreground/70 mb-1'>{server.name}</p>
                          {hints.map(hint => {
                            const stored = storedSet.has(`${hint.service}/${hint.key}`);
                            const isActive = quickCredService === hint.service && quickCredKey === hint.key;
                            return (
                              <div
                                key={`${hint.service}/${hint.key}`}
                                className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${isActive ? 'bg-[#9A66FF]/10 border border-[#9A66FF]/30' : 'hover:bg-muted/10'}`}
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${stored ? 'bg-[#56D090]/15' : 'bg-[#FFBF47]/15'}`}>
                                  {stored
                                    ? <IconCheck className='h-2.5 w-2.5 text-[#56D090]' />
                                    : <IconKey className='h-2.5 w-2.5 text-[#FFBF47]' />
                                  }
                                </div>
                                <div className='flex-1 min-w-0'>
                                  <span className={`text-[11px] font-mono font-semibold ${stored ? 'text-[#56D090]' : 'text-foreground'}`}>
                                    {hint.service} / {hint.key}
                                  </span>
                                  <p className='text-[9px] text-muted-foreground/50 truncate'>{hint.label}</p>
                                </div>
                                {!stored && (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-5 px-2 text-[10px] text-[#9A66FF] hover:bg-[#9A66FF]/10 shrink-0'
                                    onClick={() => {
                                      setQuickCredService(hint.service);
                                      setQuickCredServiceText('');
                                      setQuickCredKey(hint.key);
                                      setQuickCredKeyText('');
                                      setQuickCredValue('');
                                    }}
                                  >
                                    Add
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick-add form */}
                  <div className='p-3 space-y-2'>
                    {(quickCredService || serverHints.length === 0) && (
                      <p className='text-[10px] text-muted-foreground/50'>
                        {quickCredService
                          ? <>Adding <span className='font-mono text-foreground'>{quickCredService} / {quickCredKey || '…'}</span> — enter the value:</>
                          : 'Add a credential your agents will need:'}
                      </p>
                    )}
                    {!quickCredService && serverHints.length > 0 && (
                      <p className='text-[10px] text-muted-foreground/40'>Click "Add" above to fill in a credential, or enter one manually:</p>
                    )}
                    <div className='flex gap-1.5'>
                      <Input
                        value={quickCredService}
                        onChange={e => { setQuickCredService(e.target.value); setQuickCredServiceText(''); }}
                        placeholder='service (e.g. github)'
                        className='h-7 flex-1 text-[11px] font-mono'
                      />
                      <Input
                        value={quickCredKey}
                        onChange={e => { setQuickCredKey(e.target.value); setQuickCredKeyText(''); }}
                        placeholder='key (e.g. token)'
                        className='h-7 flex-1 text-[11px] font-mono'
                      />
                    </div>
                    <div className='flex gap-1.5'>
                      <Input
                        type='password'
                        value={quickCredValue}
                        onChange={e => setQuickCredValue(e.target.value)}
                        placeholder='Value / secret'
                        className='h-7 flex-1 text-[11px] font-mono'
                        onKeyDown={e => e.key === 'Enter' && handleQuickAddCred()}
                      />
                      <Button
                        size='sm'
                        className='h-7 px-3 text-[11px]'
                        onClick={handleQuickAddCred}
                        disabled={
                          quickCredSaving ||
                          !(quickCredService === '__custom__' ? quickCredServiceText.trim() : quickCredService.trim()) ||
                          !(quickCredKey === '__custom__' ? quickCredKeyText.trim() : quickCredKey.trim()) ||
                          !quickCredValue.trim()
                        }
                      >
                        {quickCredSaving ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Save'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter className='shrink-0'>
            <Button variant='outline' onClick={() => setExecOpen(false)}>Cancel</Button>
            <Button
              onClick={handleStartExec}
              disabled={execRunning || !execObjective.trim() || (execMode === 'single_agent' && !execSingleAgentId)}
              className='bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'
            >
              {execRunning ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlayerPlay className='mr-1 h-4 w-4' />}
              {execRunning ? 'Starting...' : 'Launch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className='max-w-2xl max-h-[90vh] flex flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle>Edit Workforce</DialogTitle>
          </DialogHeader>
          <ScrollArea className='flex-1 min-h-0 pr-4'>
            <div className='space-y-4 py-2'>
              <div className='flex items-start gap-4'>
                <div className='space-y-1'>
                  <Label className='text-xs text-muted-foreground'>Cover Image</Label>
                  <AvatarUpload
                    currentUrl={editForm.avatar_url}
                    size='md'
                    onUploaded={(url) => setEditForm({ ...editForm, avatar_url: url })}
                  />
                </div>
                <div className='flex-1 space-y-2'>
                  <Label>Name</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
              </div>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label>Token Budget</Label>
                  <Input type='number' value={editForm.budget_tokens} onChange={(e) => setEditForm({ ...editForm, budget_tokens: parseInt(e.target.value) || 0 })} />
                </div>
                <div className='space-y-2'>
                  <Label>Time (sec)</Label>
                  <Input type='number' value={editForm.budget_time_s} onChange={(e) => setEditForm({ ...editForm, budget_time_s: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div className='space-y-2'>
                <Label>Description</Label>
                <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} />
              </div>
              <div className='space-y-2'>
                <Label>Objective</Label>
                <Textarea value={editForm.objective} onChange={(e) => setEditForm({ ...editForm, objective: e.target.value })} rows={3} />
              </div>
              <div className='space-y-2'>
                <Label>Execution Environment</Label>
                <Input
                  value={editForm.docker_image}
                  onChange={(e) => setEditForm({ ...editForm, docker_image: e.target.value })}
                  placeholder='e.g. kalilinux/kali-rolling, python:3.12, ubuntu:22.04'
                />
                <p className='text-[10px] text-muted-foreground'>
                  Optional Docker image. When set, agents run inside a container with this image — packages and state persist across all tool calls.
                </p>
              </div>
              <div className='space-y-2'>
                <Label>Agents</Label>
                <div className='grid grid-cols-2 gap-2 rounded-lg border border-border/50 p-3'>
                  {allAgents.map((agent) => (
                    <label key={agent.id} className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50'>
                      <input
                        type='checkbox'
                        checked={editForm.agent_ids.includes(agent.id)}
                        onChange={() => {
                          setEditForm((prev) => ({
                            ...prev,
                            agent_ids: prev.agent_ids.includes(agent.id)
                              ? prev.agent_ids.filter((id) => id !== agent.id)
                              : [...prev.agent_ids, agent.id]
                          }));
                        }}
                        className='accent-[#9A66FF]'
                      />
                      <span className='text-sm'>{agent.icon}</span>
                      <span className='text-sm'>{agent.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editForm.agent_ids.length > 0 && (
                <div className='space-y-2'>
                  <Label className='flex items-center gap-1.5'>
                    Team Leader
                    <span className='text-[10px] font-normal text-muted-foreground'>(handles summaries & org tasks)</span>
                  </Label>
                  <div className='grid grid-cols-2 gap-2 rounded-lg border border-border/50 p-3'>
                    {editForm.agent_ids.map((aid) => {
                      const a = allAgents.find((ag) => ag.id === aid);
                      if (!a) return null;
                      const isLeader = editForm.leader_agent_id === a.id;
                      return (
                        <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                          isLeader ? 'bg-[#9A66FF]/10 ring-1 ring-[#9A66FF]/40' : 'hover:bg-accent/50'
                        }`}>
                          <input
                            type='radio'
                            name='leader_agent_id'
                            checked={isLeader}
                            onChange={() => setEditForm((prev) => ({ ...prev, leader_agent_id: a.id }))}
                            className='accent-[#9A66FF]'
                          />
                          <span className='text-sm'>{a.icon}</span>
                          <span className='text-sm'>{a.name}</span>
                          {isLeader && <span className='ml-auto text-[10px] text-[#9A66FF] font-semibold'>Leader</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className='shrink-0'>
            <Button variant='outline' onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'>
              {saving ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconDeviceFloppy className='mr-1 h-4 w-4' />}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workforce</DialogTitle>
            <DialogDescription>
              Delete <span className='font-semibold'>{workforce.name}</span>? Agents won't be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant='destructive' onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
