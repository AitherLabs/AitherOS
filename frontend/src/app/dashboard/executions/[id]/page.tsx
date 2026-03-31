'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFolder,
  IconHandStop,
  IconKey,
  IconLoader2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconRobot,
  IconTrash,
  IconSend,
  IconTool,
  IconWorldUpload,
  IconX
} from '@tabler/icons-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import api, { Agent, ChatReply, DeliveryAction, DeliveryFile, Execution, ExecutionEvent, ExecutionQA, ExecutionSubtask, Message, ToolCallRecord, Workforce } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';
import { AvatarUpload } from '@/components/avatar-upload';
import { Input } from '@/components/ui/input';

const execStatusColors: Record<string, string> = {
  running: 'bg-[#9A66FF]/20 text-[#9A66FF] border-[#9A66FF]/30',
  completed: 'bg-[#56D090]/20 text-[#56D090] border-[#56D090]/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  halted: 'bg-[#FFBF47]/20 text-[#FFBF47] border-[#FFBF47]/30',
  pending_approval: 'bg-[#FFBF47]/20 text-[#FFBF47] border-[#FFBF47]/30',
  awaiting_approval: 'bg-[#56D090]/20 text-[#56D090] border-[#56D090]/30',
  planning: 'bg-[#14FFF7]/20 text-[#14FFF7] border-[#14FFF7]/30'
};

const subtaskStatusConfig: Record<string, { color: string; icon: string; label: string }> = {
  pending:    { color: '#6B7280', icon: '○', label: 'Pending' },
  running:    { color: '#9A66FF', icon: '◎', label: 'Running' },
  done:       { color: '#56D090', icon: '✓', label: 'Done' },
  blocked:    { color: '#FF6B6B', icon: '✗', label: 'Blocked' },
  needs_help: { color: '#FFBF47', icon: '?', label: 'Needs Help' }
};

const eventTypeConfig: Record<string, { dot: string; label: string }> = {
  subtask_started:   { dot: '#9A66FF', label: 'Subtask' },
  subtask_done:      { dot: '#56D090', label: 'Done' },
  agent_handoff:     { dot: '#14FFF7', label: 'Handoff' },
  human_intervened:  { dot: '#FFBF47', label: 'Intervene' },
  human_required:    { dot: '#FFBF47', label: 'Waiting' },
  tool_call:         { dot: '#9A66FF', label: 'Tool' },
  agent_error:       { dot: '#FF6B6B', label: 'Error' },
  agent_completed:   { dot: '#56D090', label: 'Agent' },
  agent_thinking:    { dot: '#14FFF7', label: 'Think' },
  execution_started: { dot: '#9A66FF', label: 'Start' },
  execution_done:    { dot: '#56D090', label: 'Done' },
  execution_halted:  { dot: '#FFBF47', label: 'Halt' },
  plan_proposed:        { dot: '#14FFF7', label: 'Plan' },
  plan_approved:        { dot: '#56D090', label: 'Approved' },
  discussion_started:   { dot: '#9A66FF', label: 'Discussion' },
  discussion_turn:      { dot: '#B794F4', label: 'Discussion' },
  discussion_consensus: { dot: '#56D090', label: 'Consensus' },
  peer_consultation:    { dot: '#14FFF7', label: 'Peer Ask' },
  review_started:       { dot: '#F59E0B', label: 'Review' },
  review_complete:      { dot: '#56D090', label: 'Review' },
  execution_titled:     { dot: '#9A66FF', label: 'Named' },
};

const eventTypeDetailConfig: Record<string, { title: string; summary: string; action?: string }> = {
  execution_started: {
    title: 'Execution Started',
    summary: 'The orchestrator started (or resumed) running the approved plan.'
  },
  execution_done: {
    title: 'Execution Completed',
    summary: 'All subtasks finished or the run completed successfully.'
  },
  execution_halted: {
    title: 'Execution Halted',
    summary: 'Execution stopped before completion.',
    action: 'Review the reason and either intervene with guidance or resume after adjusting inputs.'
  },
  subtask_started: {
    title: 'Subtask Started',
    summary: 'An agent began working on a specific subtask.'
  },
  subtask_done: {
    title: 'Subtask Completed',
    summary: 'An agent reported this subtask as complete.'
  },
  human_required: {
    title: 'Human Input Required',
    summary: 'The agent cannot continue without operator help.',
    action: 'Use Send Message or credential injection to unblock this step.'
  },
  human_intervened: {
    title: 'Operator Intervention',
    summary: 'A human instruction was injected into the execution flow.'
  },
  agent_handoff: {
    title: 'Agent Handoff',
    summary: 'Output from one subtask was handed to a downstream agent.'
  },
  tool_call: {
    title: 'Tool Call',
    summary: 'An agent invoked a tool and optionally received a result.'
  },
  peer_consultation: {
    title: 'Peer Consultation',
    summary: 'An agent asked another agent for targeted guidance.'
  },
  plan_proposed: {
    title: 'Plan Proposed',
    summary: 'A strategy and execution plan were generated for approval.'
  },
  plan_approved: {
    title: 'Plan Approved',
    summary: 'The proposed plan was approved and execution can proceed.'
  },
  discussion_started: {
    title: 'Discussion Started',
    summary: 'Multi-agent discussion began to form a plan or consensus.'
  },
  discussion_turn: {
    title: 'Discussion Turn',
    summary: 'One participant contributed to the team discussion.'
  },
  discussion_consensus: {
    title: 'Consensus Reached',
    summary: 'Discussion converged to a shared decision.'
  },
  review_started: {
    title: 'Review Started',
    summary: 'A review phase started to validate execution outputs.'
  },
  review_complete: {
    title: 'Review Complete',
    summary: 'The review phase finished.'
  },
  agent_error: {
    title: 'Agent Error',
    summary: 'The agent encountered an error while reasoning or using tools.',
    action: 'Inspect details, then intervene with corrected instructions or credentials.'
  }
};

function humanizeEventType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatEventDataKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Returns the relative path within the workforce workspace if `value` is an
// absolute path under that workspace root, otherwise null.
function extractWorkspaceRelPath(value: string, workspacePath: string): string | null {
  const prefix = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const rel = trimmed.slice(prefix.length);
  // Only treat it as a plain path if there are no newlines (not embedded in prose)
  if (!rel || rel.includes('\n')) return null;
  return rel;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const TEXT_EXTS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'csv', 'log', 'sh', 'py', 'js', 'ts',
  'go', 'html', 'xml', 'toml', 'conf', 'cfg', 'ini', 'env', 'rs', 'rb', 'java',
]);

const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({ children }) => <h1 className='text-xl font-bold text-[#EAEAEA] mt-5 mb-3 pb-1 border-b border-border/30'>{children}</h1>,
  h2: ({ children }) => <h2 className='text-lg font-semibold text-[#EAEAEA] mt-4 mb-2'>{children}</h2>,
  h3: ({ children }) => <h3 className='text-base font-semibold text-[#EAEAEA]/90 mt-3 mb-1.5'>{children}</h3>,
  h4: ({ children }) => <h4 className='text-sm font-semibold text-[#EAEAEA]/85 mt-3 mb-1'>{children}</h4>,
  p: ({ children }) => <p className='text-sm text-[#EAEAEA]/80 leading-relaxed mb-3'>{children}</p>,
  ul: ({ children }) => <ul className='list-disc pl-5 text-sm text-[#EAEAEA]/80 mb-3 space-y-1'>{children}</ul>,
  ol: ({ children }) => <ol className='list-decimal pl-5 text-sm text-[#EAEAEA]/80 mb-3 space-y-1'>{children}</ol>,
  li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
  blockquote: ({ children }) => <blockquote className='border-l-2 border-[#9A66FF]/50 pl-3 my-3 italic text-[#EAEAEA]/60'>{children}</blockquote>,
  a: ({ href, children }) => <a href={href} className='text-[#9A66FF] hover:underline' target='_blank' rel='noreferrer'>{children}</a>,
  strong: ({ children }) => <strong className='font-semibold text-[#EAEAEA]'>{children}</strong>,
  em: ({ children }) => <em className='italic text-[#EAEAEA]/75'>{children}</em>,
  hr: () => <hr className='border-border/30 my-4' />,
  pre: ({ children }) => <pre className='mb-3 rounded-lg bg-black/30 border border-border/20 p-3 overflow-x-auto'>{children}</pre>,
  code: ({ children, className }) => {
    const isBlock = !!className?.startsWith('language-');
    return isBlock
      ? <code className='text-xs font-mono text-[#EAEAEA]/85 leading-relaxed'>{children}</code>
      : <code className='bg-muted/40 rounded px-1.5 py-0.5 text-xs font-mono text-[#9A66FF]/85'>{children}</code>;
  },
  table: ({ children }) => <div className='overflow-x-auto mb-3'><table className='w-full text-xs border-collapse'>{children}</table></div>,
  thead: ({ children }) => <thead className='bg-muted/20'>{children}</thead>,
  th: ({ children }) => <th className='text-left p-2 border border-border/30 text-[#EAEAEA]/70 font-semibold'>{children}</th>,
  td: ({ children }) => <td className='p-2 border border-border/30 text-[#EAEAEA]/75'>{children}</td>,
  tr: ({ children }) => <tr className='even:bg-muted/10'>{children}</tr>,
};

function WorkspaceFilePath({ relPath, workforceId, displayText }: { relPath: string; workforceId: string; displayText?: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const ext = relPath.split('.').pop()?.toLowerCase() || '';
  const isImage = IMAGE_EXTS.has(ext);
  const canPreview = isImage || TEXT_EXTS.has(ext);
  const fileUrl = `/api/workforces/${workforceId}/files?path=${encodeURIComponent(relPath)}`;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canPreview) return;
    setOpen(true);
    if (!isImage && content === null && !loading) {
      setLoading(true);
      setFetchError(null);
      fetch(fileUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return res.text();
        })
        .then((text) => { setContent(text); setLoading(false); })
        .catch((err) => { setFetchError(err.message || 'Failed to load file'); setLoading(false); });
    }
  }

  function renderContent() {
    if (isImage) {
      return (
        <div className='flex items-center justify-center p-4'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl} alt={relPath} className='max-w-full max-h-[60vh] object-contain rounded' />
        </div>
      );
    }
    if (loading) return <div className='p-4 text-xs text-muted-foreground/60'>Loading…</div>;
    if (fetchError) return <div className='p-4 text-xs text-red-400/80'>{fetchError}</div>;
    if (content === null) return null;

    if (ext === 'md') {
      return (
        <div className='p-5'>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content}</ReactMarkdown>
        </div>
      );
    }
    if (ext === 'json') {
      let pretty = content;
      try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* use raw */ }
      return <pre className='p-4 text-xs font-mono text-[#EAEAEA]/80 leading-relaxed whitespace-pre-wrap break-all'>{pretty}</pre>;
    }
    return <pre className='p-4 text-xs font-mono text-[#EAEAEA]/80 leading-relaxed whitespace-pre-wrap break-all'>{content}</pre>;
  }

  return (
    <>
      <span
        className={displayText
          ? `font-mono ${canPreview ? 'text-[#9A66FF] cursor-pointer hover:underline underline-offset-2' : ''}`
          : `font-mono text-xs break-all ${canPreview ? 'text-[#9A66FF] cursor-pointer hover:underline decoration-[#9A66FF]/40' : 'text-[#EAEAEA]/80'}`}
        onClick={canPreview ? handleClick : undefined}
        title={canPreview ? 'Click to preview' : undefined}
      >
        {displayText ?? `/workspace/${relPath}`}
      </span>
      {canPreview && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className='max-w-3xl flex flex-col'>
            <DialogHeader>
              <DialogTitle className='text-sm font-mono truncate text-[#9A66FF]/90'>/workspace/{relPath}</DialogTitle>
            </DialogHeader>
            {isImage ? (
              renderContent()
            ) : (
              <ScrollArea className='h-[65vh] rounded border border-border/20'>
                {renderContent()}
              </ScrollArea>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Matches relative file paths that appear inline in prose (e.g. "content/report.md").
// Requires a known extension; tolerates hyphens, dots, underscores and slashes.
const INLINE_FILE_REGEX = /(?:[\w.\-]+\/)*[\w.\-]+\.(?:md|txt|json|yaml|yml|png|jpg|jpeg|gif|webp|svg|bmp|py|ts|js|go|sh|csv|html|xml|toml|log|rs|rb|java|env|conf|cfg|ini)/g;

function TextWithFilePaths({
  text,
  workforceId,
  className,
}: {
  text: string;
  workforceId?: string;
  className?: string;
}) {
  if (!workforceId || !text) return <span className={className}>{text}</span>;

  const parts: Array<{ kind: 'text' | 'file'; value: string }> = [];
  let lastIndex = 0;
  INLINE_FILE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FILE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    parts.push({ kind: 'file', value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: 'text', value: text.slice(lastIndex) });

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === 'file'
          ? <WorkspaceFilePath key={i} relPath={p.value} workforceId={workforceId} displayText={p.value} />
          : <React.Fragment key={i}>{p.value}</React.Fragment>
      )}
    </span>
  );
}

function formatEventDataValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type CredentialHint = { service: string; key: string };

function inferServiceFromKey(key: string): string {
  const clean = key.trim().toUpperCase();
  if (!clean) return '';
  const known: Record<string, string> = {
    GITHUB: 'github',
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    STRIPE: 'stripe',
    AWS: 'aws',
    DOCKER: 'docker'
  };
  const prefix = clean.split('_')[0];
  return known[prefix] || prefix.toLowerCase();
}

function detectCredentialHint(text: string): CredentialHint | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const envMatch = trimmed.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*(?:TOKEN|API_KEY|ACCESS_TOKEN|SECRET_KEY|SECRET|PASSWORD|PAT|KEY))\b/);
  if (envMatch) {
    const key = envMatch[1];
    return { service: inferServiceFromKey(key), key };
  }

  const pairMatch = trimmed.match(/service\s*[:=]\s*([a-z0-9._-]+)[\s,;]+key(?:_name)?\s*[:=]\s*([A-Za-z0-9_]+)/i);
  if (pairMatch) {
    return {
      service: pairMatch[1].toLowerCase(),
      key: pairMatch[2].toUpperCase()
    };
  }

  const asksForCredential = /(token|api[\s_-]?key|credential|secret|access[\s_-]?key|pat|password|auth)/i.test(trimmed);
  if (!asksForCredential) return null;

  const providerFallbacks: Array<{ re: RegExp; service: string; key: string }> = [
    { re: /\bgithub\b/i, service: 'github', key: 'GITHUB_TOKEN' },
    { re: /\bopenai\b/i, service: 'openai', key: 'OPENAI_API_KEY' },
    { re: /\banthropic\b/i, service: 'anthropic', key: 'ANTHROPIC_API_KEY' },
    { re: /\bstripe\b/i, service: 'stripe', key: 'STRIPE_SECRET_KEY' },
    { re: /\baws\b/i, service: 'aws', key: 'AWS_ACCESS_KEY_ID' },
    { re: /\bdocker\b/i, service: 'docker', key: 'DOCKER_TOKEN' }
  ];
  for (const hint of providerFallbacks) {
    if (hint.re.test(trimmed)) return { service: hint.service, key: hint.key };
  }

  return null;
}

function PipelinePlanPanel({ plan, agentsMap }: { plan: ExecutionSubtask[]; agentsMap: Record<string, Agent> }) {
  if (!plan || plan.length === 0) return null;
  return (
    <div className='mb-6 rounded-xl border border-border/40 bg-background/40 overflow-hidden'>
      <div className='border-b border-border/30 px-4 py-2.5 flex items-center gap-2'>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Execution Plan</span>
        <span className='ml-auto text-[10px] text-muted-foreground/50'>{plan.filter(s => s.status === 'done').length}/{plan.length} done</span>
      </div>
      <div className='p-3 space-y-1.5'>
        {plan.map((subtask, i) => {
          const cfg = subtaskStatusConfig[subtask.status] || subtaskStatusConfig.pending;
          const agent = agentsMap[subtask.agent_id];
          return (
            <div key={subtask.id}
              className='flex items-start gap-3 rounded-lg border border-border/20 bg-background/30 px-3 py-2.5 transition-colors'
              style={{ borderLeftColor: cfg.color + '60', borderLeftWidth: 3 }}>
              {/* Step number + status icon */}
              <div className='flex flex-col items-center gap-0.5 shrink-0 mt-0.5'>
                <span className='font-mono text-[10px] text-muted-foreground/50'>#{subtask.id}</span>
                <span className='text-sm leading-none' style={{ color: cfg.color }}>{cfg.icon}</span>
              </div>
              {/* Content */}
              <div className='flex-1 min-w-0'>
                <div className='flex items-center gap-2 mb-0.5'>
                  <EntityAvatar icon={agent?.icon || '🤖'} color={agent?.color || '#9A66FF'} avatarUrl={agent?.avatar_url} name={agent?.name} size='xs' />
                  <span className='text-[11px] font-semibold truncate' style={{ color: agent?.color || '#9A66FF' }}>
                    {subtask.agent_name}
                  </span>
                  <span className='ml-auto text-[10px] px-1.5 py-0.5 rounded-full border'
                    style={{ color: cfg.color, borderColor: cfg.color + '40', backgroundColor: cfg.color + '10' }}>
                    {cfg.label}
                  </span>
                </div>
                <p className='text-[11px] leading-relaxed text-muted-foreground/80 line-clamp-2'>{subtask.subtask}</p>
                {subtask.depends_on.length > 0 && (
                  <p className='mt-0.5 text-[10px] text-muted-foreground/40'>depends on: {subtask.depends_on.join(', ')}</p>
                )}
                {subtask.status === 'done' && subtask.output && (
                  <p className='mt-1 text-[10px] text-[#56D090]/70 line-clamp-1'>✓ {subtask.output.slice(0, 100)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Service badge colour map ──────────────────────────────────────────────────
const SERVICE_COLORS: Record<string, string> = {
  'Bluesky':   '#0085FF',
  'Dev.to':    '#3B49DF',
  'GitHub':    '#6E40C9',
  'YouTube':   '#FF0000',
  'X/Twitter': '#000000',
  'Facebook':  '#1877F2',
  'Instagram': '#E1306C',
  'LinkedIn':  '#0A66C2',
  'Discord':   '#5865F2',
  'Slack':     '#4A154B',
  'Reddit':    '#FF4500',
  'Medium':    '#000000',
  'Hashnode':  '#2962FF',
  'Substack':  '#FF6719',
  'WordPress': '#21759B',
  'SendGrid':  '#1A82E2',
  'Resend':    '#000000',
  'Mailgun':   '#F06B25',
  'Git':       '#F05032',
  'npm':       '#CB3837',
  'Docker':    '#2496ED',
  'Cargo':     '#DEA584',
  'PyPI':      '#3775A9',
};

function DeliverablesSummary({ report, workforceId }: { report: { files: DeliveryFile[]; actions: DeliveryAction[] }; workforceId: string }) {
  const extIconMap: Record<string, string> = {
    md: '📄', txt: '📄', json: '📋', csv: '📊', html: '🌐', css: '🎨',
    js: '⚙️', ts: '⚙️', py: '🐍', sh: '⚙️', yaml: '📋', yml: '📋',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp4: '🎬', mov: '🎬', avi: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', ogg: '🎵',
    pdf: '📕', zip: '📦', tar: '📦', gz: '📦',
  };

  return (
    <div className='rounded-xl border border-[#9A66FF]/30 bg-[#9A66FF]/5 p-4 space-y-4'>
      <div className='flex items-center gap-2'>
        <span className='text-base'>📦</span>
        <span className='text-xs font-semibold uppercase tracking-wider text-[#9A66FF]'>Deliverables</span>
        {report.files.length > 0 && (
          <span className='ml-auto text-[10px] text-[#EAEAEA]/40'>{report.files.length} file{report.files.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* External actions */}
      {report.actions.length > 0 && (
        <div className='space-y-1.5'>
          <p className='text-[10px] font-semibold uppercase tracking-wider text-[#EAEAEA]/40'>External Actions</p>
          <div className='flex flex-col gap-1.5'>
            {report.actions.map((action, i) => {
              const color = SERVICE_COLORS[action.service] ?? '#9A66FF';
              return (
                <div key={i} className='flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2'>
                  <IconWorldUpload className='h-3.5 w-3.5 shrink-0' style={{ color }} />
                  <div className='min-w-0 flex-1'>
                    <span className='text-xs font-medium' style={{ color }}>{action.service}</span>
                    <span className='mx-1.5 text-[#EAEAEA]/30'>·</span>
                    <span className='text-xs text-[#EAEAEA]/70'>{action.description}</span>
                  </div>
                  {action.url && (
                    <a
                      href={action.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      onClick={e => e.stopPropagation()}
                      className='shrink-0 text-[#EAEAEA]/30 hover:text-[#EAEAEA]/70 transition-colors'
                      title={action.url}
                    >
                      <IconExternalLink className='h-3 w-3' />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Files */}
      {report.files.length > 0 && (
        <div className='space-y-1.5'>
          {report.actions.length > 0 && (
            <p className='text-[10px] font-semibold uppercase tracking-wider text-[#EAEAEA]/40'>Files</p>
          )}
          <div className='grid grid-cols-1 gap-1.5'>
            {report.files.map((f, i) => {
              const icon = extIconMap[f.ext] ?? '📄';
              const sizeStr = f.size_bytes > 0
                ? f.size_bytes < 1024 ? `${f.size_bytes} B`
                  : f.size_bytes < 1024 * 1024 ? `${(f.size_bytes / 1024).toFixed(1)} KB`
                  : `${(f.size_bytes / (1024 * 1024)).toFixed(1)} MB`
                : '';
              const fileName = f.path.split('/').pop() ?? f.path;
              return (
                <div key={i} className='flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2'>
                  <span className='text-sm shrink-0'>{icon}</span>
                  <div className='min-w-0 flex-1 flex items-center gap-2'>
                    <WorkspaceFilePath relPath={f.path} workforceId={workforceId} displayText={fileName} />
                    {f.path.includes('/') && (
                      <span className='text-[10px] text-[#EAEAEA]/30 truncate'>{f.path.split('/').slice(0, -1).join('/')}/</span>
                    )}
                  </div>
                  {sizeStr && (
                    <span className='text-[10px] text-[#EAEAEA]/40 shrink-0 tabular-nums'>{sizeStr}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DiscussionPanel({ agents, discussionMessages, isPlanning, leaderAgentId }: {
  agents: Agent[];
  discussionMessages: Message[];
  isPlanning: boolean;
  leaderAgentId?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const chatMsgs = discussionMessages.filter(m => m.role === 'assistant');
  return (
    <div className='rounded-xl border border-[#9A66FF]/30 bg-background/30 overflow-hidden'>
      <button
        className='w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/30 hover:bg-muted/5 transition-colors'
        onClick={() => setExpanded(v => !v)}
      >
        <span className='text-sm'>💬</span>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Team Discussion</span>
        {isPlanning && (
          <div className='ml-auto flex items-center gap-1.5 text-[11px] text-[#9A66FF]'>
            <span className='h-1.5 w-1.5 rounded-full bg-[#9A66FF] animate-pulse' />
            Discussing…
          </div>
        )}
        {!isPlanning && chatMsgs.length > 0 && (
          <span className='ml-auto text-[10px] text-[#56D090]'>✓ consensus reached</span>
        )}
        {!isPlanning && (
          <IconChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
        )}
      </button>

      {expanded && (
        <>
          {/* Participant badges */}
          {agents.length > 0 && (
            <div className='flex flex-wrap gap-2 p-3 border-b border-border/20 bg-muted/5'>
              {agents.map(agent => {
                const isLeader = agent.id === leaderAgentId;
                const hasSpoken = chatMsgs.some(m => m.agent_id === agent.id);
                return (
                  <div key={agent.id}
                    className='flex flex-col items-center gap-1 rounded-xl border bg-background/50 px-3 py-2 min-w-[68px] flex-1 max-w-[120px] transition-all'
                    style={{ borderColor: (agent.color || '#9A66FF') + (hasSpoken ? '60' : '20') }}>
                    <div className='relative'>
                      <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} size='xs' />
                      {isLeader && <span className='absolute -top-1.5 -right-1 text-[10px]'>★</span>}
                    </div>
                    <span className='text-[10px] font-semibold text-center truncate w-full' style={{ color: agent.color || '#9A66FF' }}>
                      {agent.name}
                    </span>
                    <span className='text-[9px] text-muted-foreground/45'>
                      {isLeader ? (hasSpoken ? 'decided' : 'leading') : hasSpoken ? 'contributed' : 'pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Chat bubbles */}
          <div className='divide-y divide-border/10 max-h-96 overflow-y-auto'>
            {chatMsgs.length === 0 ? (
              <div className='flex items-center justify-center gap-2.5 py-8 text-xs text-muted-foreground/40'>
                <ThinkingDots color='#9A66FF' />
                <span>Team is discussing the approach…</span>
              </div>
            ) : (
              chatMsgs.map((msg, idx) => {
                const agent = agents.find(a => a.id === msg.agent_id);
                const isLeader = msg.agent_id === leaderAgentId;
                const isSynthesis = isLeader && idx === chatMsgs.length - 1 && !isPlanning;
                // Strip code-fenced blocks then bare JSON plan blobs
                let cleanContent = msg.content
                  .replace(/```json\n[\s\S]*?\n```/g, '')
                  .replace(/```[\s\S]*?```/g, '')
                  .trim();
                const jsonStart = cleanContent.indexOf('{');
                const hasPlanJson = jsonStart >= 0 && cleanContent.includes('"plan"') && cleanContent.includes('"subtask"');
                const textBeforeJson = hasPlanJson ? cleanContent.slice(0, jsonStart).trim() : cleanContent;
                return (
                  <div key={msg.id} className='flex items-start gap-3 px-4 py-3'>
                    <div className='shrink-0 mt-0.5'>
                      <EntityAvatar icon={agent?.icon || '🤖'} color={agent?.color || '#9A66FF'} avatarUrl={agent?.avatar_url} size='xs' />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-baseline gap-2 mb-1.5'>
                        <span className='text-xs font-semibold' style={{ color: agent?.color || '#9A66FF' }}>
                          {msg.agent_name || agent?.name}{isLeader ? ' ★' : ''}
                        </span>
                        {isSynthesis && (
                          <span className='rounded-full border border-[#56D090]/40 bg-[#56D090]/10 px-1.5 py-0.5 text-[9px] text-[#56D090]'>plan decided</span>
                        )}
                        <span className='ml-auto font-mono text-[10px] text-muted-foreground/25'>
                          {msg.tokens_output > 0 ? `${formatTokens(msg.tokens_output)} tok` : ''}
                        </span>
                      </div>
                      <div className='rounded-lg bg-muted/10 px-3 py-2 text-xs leading-relaxed text-[#EAEAEA]/80 whitespace-pre-wrap border-l-2'
                        style={{ borderLeftColor: (agent?.color || '#9A66FF') + (isLeader ? 'A0' : '50') }}>
                        {textBeforeJson || (!hasPlanJson ? '(synthesizing plan…)' : null)}
                        {hasPlanJson && (
                          <span className='inline-flex items-center gap-1 rounded-full border border-[#56D090]/30 bg-[#56D090]/10 px-2 py-0.5 font-mono text-[9px] text-[#56D090]'>
                            ✓ plan ready — see strategy panel
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {isPlanning && chatMsgs.length > 0 && (
              <div className='flex items-center gap-3 px-4 py-3'>
                <ThinkingDots color='#9A66FF' />
                <span className='text-xs text-muted-foreground/40'>Discussion continuing…</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewPanel({ agents, messages, leaderAgentId, workforceId }: { agents: Agent[]; messages: Message[]; leaderAgentId?: string; workforceId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const reviewMsgs = messages.filter(m => m.phase === 'review');
  const leaderResponse = reviewMsgs.find(m => m.role === 'assistant');
  if (!leaderResponse) return null;

  const leaderAgent = agents.find(a => a.id === leaderAgentId) || agents.find(a => a.id === leaderResponse.agent_id);

  // Parse structured signal from leader response
  let verdict: 'passed' | 'revision' | 'unknown' = 'unknown';
  let summary = '';
  let highlights: string[] = [];
  let issues: string[] = [];
  try {
    const content = leaderResponse.content;
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sig = JSON.parse(content.slice(start, end + 1));
      verdict = sig.status === 'review_passed' ? 'passed' : sig.status === 'review_needs_revision' ? 'revision' : 'unknown';
      summary = sig.summary || '';
      highlights = Array.isArray(sig.highlights) ? sig.highlights : [];
      issues = Array.isArray(sig.issues) ? sig.issues : [];
    }
  } catch { /* show raw content */ }

  const verdictColor = verdict === 'passed' ? '#56D090' : verdict === 'revision' ? '#FFBF47' : '#9A66FF';
  const verdictLabel = verdict === 'passed' ? '✓ Passed' : verdict === 'revision' ? '⚠ Needs Revision' : 'Reviewed';

  return (
    <div className='rounded-xl border overflow-hidden' style={{ borderColor: verdictColor + '30' }}>
      <button
        className='w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/30 hover:bg-muted/5 transition-colors'
        style={{ borderBottomColor: verdictColor + '20' }}
        onClick={() => setExpanded(v => !v)}
      >
        <span className='text-sm'>🔎</span>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Leader Review</span>
        {leaderAgent && (
          <span className='text-[10px] font-medium' style={{ color: leaderAgent.color || verdictColor }}>
            {leaderAgent.name}
          </span>
        )}
        <span className='ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold border'
          style={{ color: verdictColor, borderColor: verdictColor + '40', backgroundColor: verdictColor + '15' }}>
          {verdictLabel}
        </span>
        <IconChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className='p-4 space-y-3'>
          {summary && (
            <p className='text-[12px] leading-relaxed text-[#EAEAEA]/80'>
              <TextWithFilePaths text={summary} workforceId={workforceId} />
            </p>
          )}
          {highlights.length > 0 && (
            <div className='space-y-1'>
              <p className='text-[10px] font-semibold text-[#56D090]/70 uppercase tracking-wider'>Strengths</p>
              {highlights.map((h, i) => (
                <div key={i} className='flex items-start gap-2 text-[11px] text-[#EAEAEA]/65'>
                  <span className='mt-0.5 text-[#56D090]'>+</span>
                  <TextWithFilePaths text={h} workforceId={workforceId} />
                </div>
              ))}
            </div>
          )}
          {issues.length > 0 && (
            <div className='space-y-1'>
              <p className='text-[10px] font-semibold text-[#FFBF47]/70 uppercase tracking-wider'>Issues</p>
              {issues.map((issue, i) => (
                <div key={i} className='flex items-start gap-2 text-[11px] text-[#EAEAEA]/65'>
                  <span className='mt-0.5 text-[#FFBF47]'>!</span>
                  <TextWithFilePaths text={issue} workforceId={workforceId} />
                </div>
              ))}
            </div>
          )}
          {!summary && !highlights.length && !issues.length && (
            <p className='text-[11px] text-muted-foreground/50 whitespace-pre-wrap'>
              <TextWithFilePaths text={leaderResponse.content} workforceId={workforceId} />
            </p>
          )}
          <p className='text-[10px] text-muted-foreground/30'>{new Date(leaderResponse.created_at).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

const PHASE_META: Record<string, { label: string; shortLabel: string; color: string; icon: string }> = {
  discussion:       { label: 'Pre-Exec · Team Discussion', shortLabel: 'Discussion', color: '#9A66FF', icon: '💬' },
  peer_consultation:{ label: 'Mid-Exec · Peer Asks',       shortLabel: 'Peer Asks',  color: '#14FFF7', icon: '🔄' },
  review:           { label: 'Post-Exec · Leader Review',  shortLabel: 'Review',     color: '#F59E0B', icon: '🔎' },
};

function InteractionsPanel({
  agents,
  discussionMessages,
  allMessages,
  reviewMessages,
  leaderAgentId,
}: {
  agents: Agent[];
  discussionMessages: Message[];
  allMessages: Message[];
  reviewMessages: Message[];
  leaderAgentId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);

  const agentMap = useMemo(() => Object.fromEntries(agents.map(a => [a.id, a])), [agents]);

  const peerMsgs = allMessages.filter(m => m.phase === 'peer_consultation');

  const sections = useMemo(() => [
    { phase: 'discussion',        msgs: discussionMessages.filter(m => m.role === 'assistant') },
    { phase: 'peer_consultation', msgs: peerMsgs },
    { phase: 'review',            msgs: reviewMessages.filter(m => m.role === 'assistant') },
  ].filter(s => s.msgs.length > 0), [discussionMessages, peerMsgs, reviewMessages]);

  const totalCount = sections.reduce((s, sec) => s + sec.msgs.length, 0);

  return (
    <div className='border-b border-border/50 shrink-0'>
      <button
        onClick={() => setOpen(v => !v)}
        className='w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/5 transition-colors'
      >
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 text-left'>
          Agent Interactions
        </span>
        {totalCount > 0 ? (
          <span className='rounded-full bg-[#9A66FF]/15 px-1.5 py-0.5 text-[9px] font-bold text-[#9A66FF]'>
            {totalCount}
          </span>
        ) : (
          <span className='text-[9px] text-muted-foreground/30'>none yet</span>
        )}
        <IconChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && (
        <div className='max-h-64 overflow-y-auto divide-y divide-border/20'>
          {sections.length === 0 && (
            <p className='px-3 py-3 text-[10px] text-muted-foreground/40'>
              Interactions will appear here once agents begin discussing, consulting peers, or reviewing results.
            </p>
          )}
          {sections.map(section => {
            const meta = PHASE_META[section.phase];
            return (
              <div key={section.phase}>
                {/* Phase header */}
                <div className='flex items-center gap-1.5 px-3 py-1 bg-background/60 sticky top-0 backdrop-blur-sm z-10'>
                  <span className='text-[9px]'>{meta.icon}</span>
                  <span className='text-[9px] font-semibold uppercase tracking-wider' style={{ color: meta.color }}>
                    {meta.shortLabel}
                  </span>
                  <span className='ml-auto text-[8px] text-muted-foreground/30'>{section.msgs.length}</span>
                </div>

                {/* Messages */}
                {section.msgs.map(msg => {
                  const agent = agentMap[msg.agent_id || ''];
                  const isLeader = msg.agent_id === leaderAgentId;
                  const color = agent?.color || meta.color;
                  const avatarSrc = agent?.avatar_url;
                  const icon = agent?.icon || '🤖';
                  const name = msg.agent_name || agent?.name || 'Agent';
                  const isExpanded = expandedMsg === msg.id;

                  const cleanContent = msg.content
                    .replace(/```[\s\S]*?```/g, '[code block]')
                    .replace(/\{[\s\S]{0,200}\}/g, '[json]')
                    .replace(/\n+/g, ' ')
                    .trim();

                  const isPeerQuestion = msg.phase === 'peer_consultation' && msg.role === 'user';
                  const roleLabel = isPeerQuestion ? 'asked' : section.phase === 'review' ? 'review' : 'said';

                  return (
                    <button
                      key={msg.id}
                      onClick={() => setExpandedMsg(isExpanded ? null : msg.id)}
                      className='w-full flex items-start gap-2 px-2.5 py-2 hover:bg-muted/10 transition-colors text-left'
                    >
                      {/* Avatar */}
                      <div
                        className='mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full flex items-center justify-center overflow-hidden text-[11px]'
                        style={{ backgroundColor: color + '22', border: `1.5px solid ${color}50` }}
                      >
                        {avatarSrc ? (
                          <img src={resolveImg(avatarSrc)} alt={name} className='h-full w-full object-cover' />
                        ) : (
                          <span>{icon}</span>
                        )}
                      </div>

                      {/* Content */}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1 mb-0.5'>
                          <span className='text-[9px] font-semibold truncate max-w-[80px]' style={{ color }}>
                            {name}{isLeader ? ' ★' : ''}
                          </span>
                          <span className='text-[8px] text-muted-foreground/35 shrink-0'>{roleLabel}</span>
                          <span className='ml-auto shrink-0 text-[8px] text-muted-foreground/30'>
                            {timeAgo(msg.created_at)}
                          </span>
                        </div>
                        <p className={`text-[10px] leading-relaxed text-muted-foreground/60 break-words ${isExpanded ? '' : 'line-clamp-2'}`}>
                          {cleanContent || msg.content.slice(0, 200)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PeerExchangesPanel({ agents, messages }: { agents: Agent[]; messages: Message[] }) {
  const [expanded, setExpanded] = useState(false);
  const peerMsgs = messages.filter(m => m.phase === 'peer_consultation');
  if (peerMsgs.length === 0) return null;

  // Group into Q&A pairs: 'user' role = question, next 'assistant' = answer
  const pairs: { question: Message; answer?: Message; peerAgent?: Agent; callerName: string }[] = [];
  for (let i = 0; i < peerMsgs.length; i++) {
    const m = peerMsgs[i];
    if (m.role !== 'user') continue;
    const callerMatch = m.content.match(/^\[from (.+?)\]:/);
    const callerName = callerMatch ? callerMatch[1] : 'Agent';
    const answer = peerMsgs[i + 1]?.role === 'assistant' ? peerMsgs[i + 1] : undefined;
    const peerAgent = agents.find(a => a.id === m.agent_id);
    pairs.push({ question: m, answer, peerAgent, callerName });
    if (answer) i++;
  }

  return (
    <div className='rounded-xl border border-[#14FFF7]/20 bg-background/30 overflow-hidden'>
      <button
        className='w-full flex items-center gap-2 px-4 py-2.5 border-b border-border/30 hover:bg-muted/5 transition-colors'
        onClick={() => setExpanded(v => !v)}
      >
        <span className='text-sm'>🔗</span>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Peer Exchanges</span>
        <span className='ml-auto text-[10px] text-[#14FFF7]/70'>{pairs.length} consultation{pairs.length !== 1 ? 's' : ''}</span>
        <IconChevronDown className={`h-3 w-3 text-muted-foreground/40 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className='divide-y divide-border/10 max-h-80 overflow-y-auto'>
          {pairs.map((pair) => (
            <div key={pair.question.id} className='p-3 space-y-2'>
              {/* Question */}
              <div className='flex items-start gap-2'>
                <span className='mt-0.5 shrink-0 rounded-full border border-[#14FFF7]/30 bg-[#14FFF7]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#14FFF7]'>
                  asked
                </span>
                <div className='flex-1 min-w-0'>
                  <span className='text-[10px] font-semibold text-muted-foreground/60'>{pair.callerName} → {pair.peerAgent?.name || 'peer'}</span>
                  <p className='text-[11px] leading-relaxed text-[#EAEAEA]/70 mt-0.5'>
                    {pair.question.content.replace(/^\[from .+?\]:\s*/, '')}
                  </p>
                </div>
              </div>
              {/* Answer */}
              {pair.answer && (
                <div className='flex items-start gap-2 pl-2'>
                  <span className='mt-0.5 shrink-0 rounded-full border border-[#56D090]/30 bg-[#56D090]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#56D090]'>
                    replied
                  </span>
                  <div className='flex-1 min-w-0'>
                    <span className='text-[10px] font-semibold' style={{ color: pair.peerAgent?.color || '#56D090' }}>
                      {pair.peerAgent?.name || 'peer'}
                    </span>
                    <p className='text-[11px] leading-relaxed text-[#EAEAEA]/70 mt-0.5'>{pair.answer.content}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanningRoomPanel({ agents, messages, isPlanning }: { agents: Agent[]; messages: Message[]; isPlanning: boolean }) {
  const planMsgs = messages.filter(m => m.iteration === 0 && m.role === 'assistant' && m.phase !== 'discussion');
  return (
    <div className='rounded-xl border border-[#9A66FF]/20 bg-background/30 overflow-hidden'>
      {/* Header */}
      <div className='flex items-center gap-2 px-4 py-2.5 border-b border-border/30'>
        <span className='text-sm'>🎯</span>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Strategy Session</span>
        {isPlanning && (
          <div className='ml-auto flex items-center gap-1.5 text-[11px] text-[#14FFF7]'>
            <span className='h-1.5 w-1.5 rounded-full bg-[#14FFF7] animate-pulse' />
            Planning…
          </div>
        )}
        {!isPlanning && planMsgs.length > 0 && (
          <span className='ml-auto text-[10px] text-[#56D090]'>✓ {planMsgs.length} agent{planMsgs.length !== 1 ? 's' : ''} contributed</span>
        )}
      </div>

      {/* Agent mosaic — video-tile grid */}
      {agents.length > 0 && (
        <div className='flex flex-wrap gap-2 p-3 border-b border-border/20 bg-muted/5'>
          {agents.map(agent => {
            const hasSpoken = planMsgs.some(m => m.agent_id === agent.id);
            const isActive = isPlanning && !hasSpoken;
            return (
              <div key={agent.id}
                className='flex flex-col items-center gap-1.5 rounded-xl border bg-background/50 px-3 py-2.5 min-w-[72px] flex-1 max-w-[130px] transition-all'
                style={{ borderColor: (agent.color || '#9A66FF') + (hasSpoken ? '60' : '20') }}>
                <div className='relative'>
                  <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} size='sm' />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                    hasSpoken ? 'bg-[#56D090]' : isActive ? 'bg-[#9A66FF] animate-pulse' : 'bg-muted-foreground/20'
                  }`} />
                </div>
                <span className='text-[10px] font-semibold text-center truncate w-full' style={{ color: agent.color || '#9A66FF' }}>
                  {agent.name}
                </span>
                <span className='text-[9px] text-muted-foreground/45'>
                  {hasSpoken ? 'contributed' : isActive ? 'thinking…' : 'pending'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Chat stream */}
      <div className='divide-y divide-border/10'>
        {planMsgs.length === 0 ? (
          <div className='flex items-center justify-center gap-2.5 py-8 text-xs text-muted-foreground/40'>
            <ThinkingDots color='#9A66FF' />
            <span>Agents are formulating their strategies…</span>
          </div>
        ) : (
          planMsgs.map((msg) => {
            const agent = agents.find(a => a.id === msg.agent_id);
            const displayContent = isPlanning
              ? msg.content
              : summarizeStrategyForDisplay(msg.content, msg.agent_name || agent?.name || 'Agent');
            return (
              <div key={msg.id} className='flex items-start gap-3 px-4 py-3.5'>
                <div className='shrink-0 mt-0.5'>
                  <EntityAvatar icon={agent?.icon || '🤖'} color={agent?.color || '#9A66FF'} avatarUrl={agent?.avatar_url} size='xs' />
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-baseline gap-2 mb-1.5'>
                    <span className='text-xs font-semibold' style={{ color: agent?.color || '#9A66FF' }}>
                      {msg.agent_name || agent?.name}
                    </span>
                    <span className='text-[10px] text-muted-foreground/35'>{timeAgo(msg.created_at)}</span>
                    {msg.tokens_output > 0 && (
                      <span className='ml-auto font-mono text-[10px] text-muted-foreground/25'>{formatTokens(msg.tokens_output)} tok</span>
                    )}
                  </div>
                  <div className='rounded-lg bg-muted/10 px-3 py-2.5 text-xs leading-relaxed text-[#EAEAEA]/80 whitespace-pre-wrap border-l-2'
                    style={{ borderLeftColor: (agent?.color || '#9A66FF') + '60' }}>
                    {displayContent}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {isPlanning && planMsgs.length > 0 && planMsgs.length < agents.length && (
          <div className='flex items-center gap-3 px-4 py-3'>
            <ThinkingDots color='#9A66FF' />
            <span className='text-xs text-muted-foreground/40'>Next agent is thinking…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function toSingleSentence(text: string, maxLen = 180): string {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return '';

  const sentenceBoundary = cleaned.search(/[.!?](\s|$)/);
  let sentence = sentenceBoundary >= 0 ? cleaned.slice(0, sentenceBoundary + 1) : cleaned;

  if (sentence.length > maxLen) {
    sentence = `${sentence.slice(0, maxLen).trimEnd()}…`;
  }
  return sentence;
}

function extractStrategyPayload(raw: string): { speakerHint?: string; payload: string } {
  const trimmed = raw.trim();
  const prefixed = trimmed.match(/^\[([^\]]+)\]\s*:\s*([\s\S]*)$/);
  if (!prefixed) return { payload: trimmed };

  return {
    speakerHint: prefixed[1].replace(/\(.*?\)/g, '').trim(),
    payload: prefixed[2].trim()
  };
}

function parseJsonCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const maybeJson = fenced ? fenced[1].trim() : trimmed;
  if (!(maybeJson.startsWith('{') || maybeJson.startsWith('['))) return null;

  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function parsePlanStepsFromStrategy(strategy: string): Array<Record<string, unknown>> | null {
  const { payload } = extractStrategyPayload(strategy);
  const parsed = parseJsonCandidate(payload) ?? parseJsonCandidate(strategy);
  if (!parsed) return null;

  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    );
  }

  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { plan?: unknown }).plan)) {
    return ((parsed as { plan: unknown[] }).plan).filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
    );
  }

  return null;
}

function formatDecisionSentence(agentName: string, detail: string): string {
  const subject = normalizeWhitespace(agentName) || 'Agent';
  const short = toSingleSentence(detail, 170).replace(/[.!?…]+$/, '');
  if (!short) return `${subject} decided on the next step.`;

  const lowerSubject = subject.toLowerCase();
  if (short.toLowerCase().startsWith(lowerSubject)) {
    return /[.!?]$/.test(short) ? short : `${short}.`;
  }

  if (/^decided\b/i.test(short)) {
    return `${subject} ${short}${/[.!?]$/.test(short) ? '' : '.'}`;
  }

  if (/^(to|that)\b/i.test(short)) {
    return `${subject} decided ${short}${/[.!?]$/.test(short) ? '' : '.'}`;
  }

  return `${subject} decided to ${short.charAt(0).toLowerCase()}${short.slice(1)}.`;
}

function summarizeStrategyForDisplay(raw: string, preferredSpeaker: string): string {
  const extracted = extractStrategyPayload(raw);
  const speaker = normalizeWhitespace(preferredSpeaker) || extracted.speakerHint || 'Agent';
  const steps = parsePlanStepsFromStrategy(raw);

  if (steps && steps.length > 0) {
    const speakerLower = speaker.toLowerCase();
    const matchingStep =
      steps.find((step) => {
        const stepAgent = typeof step.agent_name === 'string' ? step.agent_name.toLowerCase() : '';
        return stepAgent && (speakerLower.includes(stepAgent) || stepAgent.includes(speakerLower));
      }) || steps[0];

    const stepSummaryCandidates = [
      matchingStep.subtask,
      matchingStep.task,
      matchingStep.summary,
      matchingStep.objective
    ];

    for (const candidate of stepSummaryCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return formatDecisionSentence(speaker, candidate);
      }
    }
  }

  const parsed = parseJsonCandidate(extracted.payload) ?? parseJsonCandidate(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const textCandidates = [obj.summary, obj.decision, obj.strategy, obj.content];
    for (const candidate of textCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return formatDecisionSentence(speaker, candidate);
      }
    }
  }

  return formatDecisionSentence(speaker, extracted.payload || raw);
}

type CompletionSignal = {
  status?: string;
  summary?: string;
  details: Record<string, unknown>;
};

function parseCompletionSignalFromContent(content: string): CompletionSignal | null {
  const fromStructured = parseJsonCandidate(content);

  let parsed: unknown = fromStructured;
  if (!parsed) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(content.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!('status' in obj) && !('summary' in obj)) return null;

  return {
    status: typeof obj.status === 'string' ? obj.status : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    details: obj
  };
}

function humanizeCompletionStatus(status?: string): string {
  const normalized = (status || '').toLowerCase();
  if (!normalized) return 'Task update received.';
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'done') {
    return 'Task completed successfully.';
  }
  if (normalized === 'needs_help' || normalized === 'blocked') {
    return 'Task is blocked and needs your input.';
  }
  if (normalized === 'running' || normalized === 'in_progress') {
    return 'Task is in progress.';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Task failed and needs attention.';
  }
  return `Task status: ${normalized.replace(/_/g, ' ')}.`;
}

function describeToolActivity(toolName: string): string {
  const tool = toolName.toLowerCase();
  if (/(search_web|read_url_content|browser|crawl|scrape|serp)/.test(tool)) return 'is searching the web';
  if (/(write_to_file|apply_patch|write_file|edit_notebook)/.test(tool)) return 'is writing files';
  if (/(run_command|shell|bash|execute)/.test(tool)) return 'is executing commands';
  if (/(read_file|list_dir|find_by_name|grep_search|code_search)/.test(tool)) return 'is inspecting project files';
  if (/(list_secrets|get_secret)/.test(tool)) return 'is checking credentials';
  return `is using ${toolName.replace(/_/g, ' ')}`;
}

function summarizeAgentActivityFromEvent(ev: LiveEvent, agentName: string): string | null {
  if (ev.type === 'tool_call') {
    const tool = typeof ev.data?.tool === 'string' ? ev.data.tool : '';
    if (!tool) return `${agentName} is using a tool.`;
    return `${agentName} ${describeToolActivity(tool)}.`;
  }

  if (ev.type === 'subtask_started') {
    const subtask = typeof ev.data?.subtask === 'string' ? ev.data.subtask : '';
    if (!subtask) return `${agentName} is working on the current subtask.`;
    const oneLiner = toSingleSentence(subtask, 110).replace(/[.!?…]+$/, '');
    return `${agentName} is working on ${oneLiner.charAt(0).toLowerCase()}${oneLiner.slice(1)}.`;
  }

  if (ev.type === 'human_required') {
    return `${agentName} is waiting for your input.`;
  }

  if (ev.type === 'subtask_done') {
    return `${agentName} completed a subtask.`;
  }

  return null;
}

function parseStrategy(strategy: string): { name: string; content: string }[] {
  if (!strategy) return [];
  const sections: { name: string; content: string }[] = [];
  const parts = strategy.split(/(?=^## )/m);
  for (const part of parts) {
    const match = part.match(/^## (.+?)\n([\s\S]*)/);
    if (match) sections.push({ name: match[1].trim(), content: match[2].trim() });
  }
  return sections.length > 0 ? sections : [{ name: 'Strategy', content: strategy.trim() }];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
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

interface LiveEvent {
  id: string;
  type: string;
  agent_name?: string;
  content: string;
  data?: Record<string, any>;
  timestamp: Date;
  isNew?: boolean;
}

// EventDetailBody renders structured extra info for the dialog — things that
// are NOT already shown as ev.content in the dialog header. Returns null if
// there's nothing additional to display.
function EventDetailBody({ ev, dot, workforceId, workspacePath }: { ev: LiveEvent; dot: string; workforceId?: string; workspacePath?: string }) {
  const d = ev.data;

  let specific: React.ReactNode = null;

  if (ev.type === 'tool_call') {
    const tool = d?.tool as string | undefined;
    const args = d?.args as Record<string, any> | undefined;
    const resultLen = d?.result_length as number | undefined;
    const round = d?.round as number | undefined;
    specific = (
      <div className='space-y-3'>
        {tool && (
          <div className='flex items-center gap-2 flex-wrap'>
            <code className='rounded bg-muted/40 px-2 py-1 text-xs font-mono' style={{ color: dot }}>{tool}</code>
            {round != null && <span className='text-xs text-muted-foreground/50'>round {round}</span>}
            {resultLen != null && <span className='ml-auto text-xs text-muted-foreground/40'>{resultLen.toLocaleString()} chars returned</span>}
          </div>
        )}
        {args && Object.keys(args).length > 0 && (
          <div className='rounded-lg bg-muted/20 p-3 space-y-2'>
            <span className='text-[10px] font-semibold uppercase text-muted-foreground/50'>Arguments</span>
            {Object.entries(args).map(([k, v]) => {
              const strVal = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
              const relPath = workspacePath && workforceId ? extractWorkspaceRelPath(strVal, workspacePath) : null;
              return (
                <div key={k} className='space-y-0.5'>
                  <span className='text-[10px] text-muted-foreground/50'>{k}</span>
                  {relPath ? (
                    <div className='bg-muted/20 rounded p-2'>
                      <WorkspaceFilePath relPath={relPath} workforceId={workforceId!} />
                    </div>
                  ) : (
                    <pre className='whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-[#EAEAEA]/80 bg-muted/20 rounded p-2'>
                      {strVal}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  } else if (ev.type === 'discussion_turn') {
    const content = d?.content as string | undefined;
    if (content) {
      specific = (
        <div className='rounded-lg bg-muted/10 p-3 border border-border/20'>
          <span className='text-[10px] font-semibold uppercase text-muted-foreground/40 block mb-1.5'>Full Message</span>
          <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/85'>{content}</p>
        </div>
      );
    }
  } else if (ev.type === 'plan_proposed') {
    const plan = d?.plan as string | undefined;
    const strategy = d?.strategy as string | undefined;
    if (plan) {
      specific = (
        <div className='space-y-2'>
          {strategy && <span className='text-[10px] font-semibold uppercase text-muted-foreground/40'>Strategy</span>}
          {strategy && <p className='text-sm text-[#EAEAEA]/75 whitespace-pre-wrap break-words'>{strategy}</p>}
          <pre className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/85 bg-muted/10 rounded p-3 border border-border/20'>{plan}</pre>
        </div>
      );
    }
  } else if (ev.type === 'discussion_started') {
    const agents = d?.agents as string[] | undefined;
    const leader = d?.leader as string | undefined;
    if (agents?.length) {
      specific = (
        <div className='space-y-1.5'>
          {leader && <div className='text-xs text-muted-foreground/60'>Leader: <span style={{ color: dot }}>{leader}</span></div>}
          <div className='flex flex-wrap gap-1.5'>
            {agents.map(a => (
              <span key={a} className='rounded bg-muted/30 px-2 py-0.5 text-xs text-[#EAEAEA]/70'>{a}</span>
            ))}
          </div>
        </div>
      );
    }
  } else if (ev.type === 'subtask_started' || ev.type === 'subtask_done') {
    const tokens = d?.tokens as number | undefined;
    if (tokens != null) {
      specific = <span className='text-xs text-muted-foreground/50'>{tokens.toLocaleString()} tokens used</span>;
    }
  } else if (ev.type === 'peer_consultation') {
    const peer = d?.peer as string | undefined;
    const question = d?.question as string | undefined;
    if (question) {
      specific = (
        <div className='space-y-1.5'>
          {peer && <div className='text-[10px] font-semibold uppercase text-muted-foreground/40'>Asking {peer}</div>}
          <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/85'>{question}</p>
        </div>
      );
    }
  }

  const metadataEntries = Object.entries(d || {}).filter(([k, v]) => {
    if (v == null || v === '') return false;
    // These are already rendered in dedicated sections above.
    if (k === 'args' || k === 'content' || k === 'plan' || k === 'strategy') return false;
    return true;
  });

  const metadata = metadataEntries.length > 0 ? (
    <div className='rounded-lg border border-border/20 bg-muted/10 p-3 space-y-2'>
      <span className='text-[10px] font-semibold uppercase text-muted-foreground/50'>Event Data</span>
      {metadataEntries.map(([k, v]) => {
        const value = formatEventDataValue(v);
        const relPath = workspacePath && workforceId ? extractWorkspaceRelPath(value, workspacePath) : null;
        const isMultiline = !relPath && (value.includes('\n') || value.length > 90);
        return (
          <div key={k} className='space-y-0.5'>
            <span className='text-[10px] text-muted-foreground/50'>{formatEventDataKey(k)}</span>
            {relPath ? (
              <div className='bg-muted/20 rounded p-2'>
                <WorkspaceFilePath relPath={relPath} workforceId={workforceId!} />
              </div>
            ) : isMultiline ? (
              <pre className='whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-[#EAEAEA]/80 bg-muted/20 rounded p-2'>
                {value}
              </pre>
            ) : (
              <p className='text-xs text-[#EAEAEA]/80 break-words'>{value}</p>
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  if (!specific && !metadata) return null;
  return <div className='space-y-3'>{specific}{metadata}</div>;
}

// ThinkingEventCard renders an agent_thinking event as a "thought bubble" —
// visually distinct from action events, with italic text and expandable content.
function ThinkingEventCard({ ev }: { ev: LiveEvent }) {
  const [expanded, setExpanded] = useState(false);
  const content = ev.content || '';
  const lines = content.split('\n').filter(Boolean);
  const preview = lines.slice(0, 3).join('\n');
  const hasMore = lines.length > 3 || content.length > 300;

  return (
    <div className='flow-event-enter rounded-md border border-[#14FFF7]/10 bg-[#14FFF7]/[0.03] px-2.5 py-2 space-y-1'>
      <div className='flex items-center gap-1.5'>
        <span className='text-[10px]'>💭</span>
        <span className='text-[10px] font-semibold text-[#14FFF7]/60'>
          {ev.agent_name ? `${ev.agent_name}` : 'Agent'} · Reasoning
        </span>
        <span className='ml-auto text-[9px] text-muted-foreground/30'>
          {ev.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
      <p className='text-[10px] italic leading-relaxed text-[#EAEAEA]/50 whitespace-pre-wrap break-words'>
        {expanded ? content : preview}
        {!expanded && hasMore && '…'}
      </p>
      {hasMore && (
        <button
          onClick={() => setExpanded(v => !v)}
          className='text-[9px] text-[#14FFF7]/40 hover:text-[#14FFF7]/70 transition-colors'
        >
          {expanded ? 'Show less' : 'Show full reasoning'}
        </button>
      )}
    </div>
  );
}

function EventCard({ ev, dot, label, workforceId, workspacePath }: { ev: LiveEvent; dot: string; label: string; workforceId?: string; workspacePath?: string }) {
  const [open, setOpen] = useState(false);
  const hasDetail = true;
  const detailCfg = eventTypeDetailConfig[ev.type];
  const detailTitle = detailCfg?.title || humanizeEventType(ev.type);
  return (
    <>
      <div
        className={`flow-event-enter rounded-md border border-border/20 bg-background/30 ${hasDetail ? 'cursor-pointer hover:bg-background/50 transition-colors' : ''}`}
        style={{ borderLeftColor: dot + '60', borderLeftWidth: 2 }}
        onClick={() => hasDetail && setOpen(true)}
      >
        <div className='flex items-center gap-1.5 p-2'>
          <span className='h-1.5 w-1.5 rounded-full shrink-0' style={{ backgroundColor: dot }} />
          <span className='text-[10px] font-semibold truncate' style={{ color: dot }}>
            {ev.agent_name ? `${ev.agent_name} · ` : ''}{label}
          </span>
          <span className='ml-auto shrink-0 text-[9px] text-muted-foreground/35'>
            {ev.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          {hasDetail && (
            <IconArrowsMaximize className='h-2.5 w-2.5 shrink-0 text-muted-foreground/30' />
          )}
        </div>
        {/* Summary line (always visible, 2-line clamp) */}
        <p className={`px-2 pb-1.5 break-words text-[10px] leading-relaxed line-clamp-2 -mt-1 ${ev.type === 'agent_error' ? 'text-red-400/80' : 'text-muted-foreground/65'}`}>
          {ev.content}
        </p>
      </div>

      {/* Full detail dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-w-2xl max-h-[80vh] flex flex-col'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-sm'>
              <span className='h-2 w-2 rounded-full shrink-0' style={{ backgroundColor: dot }} />
              <span style={{ color: dot }}>{ev.agent_name ? `${ev.agent_name} · ` : ''}{detailTitle}</span>
              <span className='ml-auto text-[10px] font-normal text-muted-foreground/50'>
                {ev.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className='flex-1 min-h-0 pr-1'>
            <div className='space-y-3 pb-2'>
              <div className='rounded-lg border border-border/20 bg-muted/5 p-3 space-y-1.5'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Badge variant='outline' className='text-[10px] border-border/40 bg-muted/10'>
                    {humanizeEventType(ev.type)}
                  </Badge>
                  {ev.agent_name && (
                    <Badge variant='outline' className='text-[10px] border-border/40 bg-muted/10'>
                      Agent: {ev.agent_name}
                    </Badge>
                  )}
                </div>
                <p className='text-xs text-muted-foreground/70'>{detailCfg?.summary || 'Execution activity event emitted by the orchestrator.'}</p>
                {detailCfg?.action && (
                  <p className='text-xs text-[#FFBF47]/85'>Suggested action: {detailCfg.action}</p>
                )}
              </div>
              {/* Summary / status line */}
              {ev.content && (
                <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${ev.type === 'agent_error' ? 'text-red-400/80' : 'text-[#EAEAEA]/70'}`}>
                  {ev.content}
                </p>
              )}
              {/* Structured detail — extra info beyond ev.content */}
              <EventDetailBody ev={ev} dot={dot} workforceId={workforceId} workspacePath={workspacePath} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolCallBlock({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className='mt-2 rounded-lg border border-border/30 bg-muted/20'>
      <button
        onClick={() => setOpen((v) => !v)}
        className='flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground'
      >
        {open ? <IconChevronDown className='h-3 w-3' /> : <IconChevronRight className='h-3 w-3' />}
        <IconTool className='h-3 w-3 text-[#9A66FF]' />
        <span className='font-medium text-[#9A66FF]'>{calls.length} tool call{calls.length > 1 ? 's' : ''}</span>
        <span className='text-muted-foreground/60'>— {calls.map((c) => c.name).join(', ')}</span>
      </button>
      {open && (
        <div className='space-y-2 border-t border-border/20 p-3'>
          {calls.map((tc, i) => (
            <div key={i} className='rounded-md border border-border/20 bg-background/40 p-2'>
              <div className='mb-1 flex items-center gap-1.5'>
                <span className='font-mono text-[10px] font-semibold text-[#9A66FF]'>{tc.name}</span>
                {tc.args && Object.keys(tc.args).length > 0 && (
                  <span className='text-[10px] text-muted-foreground'>
                    ({Object.entries(tc.args).slice(0, 2).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`).join(', ')})
                  </span>
                )}
              </div>
              {tc.result && (
                <pre className='mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[#EAEAEA]/70'>
                  {tc.result.slice(0, 600)}{tc.result.length > 600 ? '\n...' : ''}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingDots({ color }: { color: string }) {
  return (
    <div className='flex items-center gap-1 px-1 py-0.5'>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className='h-1.5 w-1.5 rounded-full opacity-0'
          style={{
            backgroundColor: color,
            animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`
          }}
        />
      ))}
    </div>
  );
}

const API_BASE_EXEC = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';
function resolveImg(url?: string) {
  if (!url) return '';
  return url.startsWith('/') ? `${API_BASE_EXEC}${url}` : url;
}

interface AgentCallGridProps {
  agents: Agent[];
  plan: ExecutionSubtask[];
  messages: Message[];
  isRunning: boolean;
  expandedAgents: Set<string>;
  onToggleAgent: (id: string) => void;
  speechBubbles?: Record<string, string>;
}

function AgentCallGrid({ agents, plan, messages, isRunning, expandedAgents, onToggleAgent, speechBubbles }: AgentCallGridProps) {
  const doneCount = plan.filter(s => s.status === 'done').length;
  const totalCount = plan.length;

  return (
    <div className='border-b border-border/50 bg-[#0A0D11]'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2 border-b border-border/30'>
        <span className='text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50'>Agent Team</span>
        <div className='flex items-center gap-2'>
          {isRunning && (
            <span className='flex items-center gap-1 text-[9px] text-[#9A66FF]'>
              <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#9A66FF]' />
              live
            </span>
          )}
          {totalCount > 0 && (
            <span className='text-[9px] text-muted-foreground/40'>{doneCount}/{totalCount}</span>
          )}
        </div>
      </div>

      {/* Agent tiles grid */}
      <div className={`grid gap-1.5 p-2 ${agents.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {agents.map((agent) => {
          const st = plan.find(s => s.agent_id === agent.id);
          const isActive = isRunning && st?.status === 'running';
          const isDone = st?.status === 'done';
          const needsHelp = st?.status === 'needs_help';
          const isBlocked = st?.status === 'blocked';
          const isSelected = expandedAgents.has(agent.id);
          const msgCount = messages.filter(m => m.agent_id === agent.id && m.role === 'assistant').length;
          const c = agent.color || '#9A66FF';

          const statusLabel = isDone ? 'done' : isActive ? 'working…' : needsHelp ? 'needs help' : isBlocked ? 'blocked' : msgCount > 0 ? 'standby' : 'waiting';
          const statusColor = isDone ? '#56D090' : isActive ? c : needsHelp ? '#FFBF47' : isBlocked ? '#EF4444' : '#4B5563';

          return (
            <button
              key={agent.id}
              onClick={() => onToggleAgent(agent.id)}
              className={`relative flex flex-col items-center gap-2 rounded-xl p-2.5 transition-all cursor-pointer text-left overflow-hidden ${
                isActive ? 'bg-background/80' : 'bg-background/40 hover:bg-background/60'
              }`}
              style={{
                border: `1.5px solid ${isActive ? c + '80' : isSelected ? c + '50' : '#ffffff0a'}`,
                boxShadow: isActive ? `0 0 16px ${c}20, inset 0 0 20px ${c}05` : 'none'
              }}
            >
              {/* Active pulse ring */}
              {isActive && (
                <span className='pointer-events-none absolute inset-0 rounded-xl animate-ping'
                  style={{ border: `1.5px solid ${c}40` }} />
              )}

              {/* Avatar */}
              <div className='relative'>
                <EntityAvatar
                  icon={agent.icon}
                  color={agent.color}
                  avatarUrl={agent.avatar_url}
                  name={agent.name}
                  size={agents.length === 1 ? 'lg' : 'md'}
                />
                {/* Status dot */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0A0D11] ${isActive ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: statusColor }}
                />
                {/* Message badge */}
                {msgCount > 0 && (
                  <span className='absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full border border-border/50 bg-background text-[8px] font-bold'
                    style={{ color: c }}>
                    {msgCount > 9 ? '9+' : msgCount}
                  </span>
                )}
              </div>

              {/* Name + status */}
              <div className='flex w-full flex-col items-center gap-0.5 min-w-0'>
                <span className='max-w-full truncate text-[11px] font-semibold' style={{ color: c }}>
                  {agent.name}
                </span>
                <div className='flex items-center gap-1'>
                  {isActive && <ThinkingDots color={c} />}
                  {!isActive && (
                    <span className='text-[9px]' style={{ color: statusColor }}>
                      {statusLabel}
                    </span>
                  )}
                </div>
              </div>
              {/* Speech bubble snippet */}
              {speechBubbles?.[agent.id] && (
                <div
                  key={speechBubbles[agent.id]}
                  className='w-full mt-0.5 rounded-md px-1.5 py-1 bg-background/70 border border-border/30'
                  style={{ borderLeftColor: c + '50', borderLeftWidth: 2 }}
                >
                  <p className='text-[9px] leading-snug text-muted-foreground/65 line-clamp-2 italic'>
                    {speechBubbles[agent.id]}
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface AgentThreadProps {
  agent: Agent;
  messages: Message[];
  isExpanded: boolean;
  isActive: boolean;
  activityHint?: string;
  subtask?: ExecutionSubtask;
  onToggle: () => void;
}

// ── Smart message content renderer ───────────────────────────────────────────
// Detects JSON plan blobs and renders them as a readable plan list instead of
// dumping raw JSON at the user.
function MessageContent({ content, dim = false }: { content: string; dim?: boolean }) {
  const completion = useMemo(() => parseCompletionSignalFromContent(content), [content]);

  const planSteps = useMemo(() => {
    return parsePlanStepsFromStrategy(content);
  }, [content]);

  if (completion && !planSteps) {
    const statusText = completion.status ? completion.status.replace(/_/g, ' ') : 'update';
    const summary = completion.summary || humanizeCompletionStatus(completion.status);

    return (
      <div className='rounded-lg border border-[#56D090]/35 bg-[#56D090]/8 p-3'>
        <div className='mb-1 flex items-center gap-2'>
          <span className='text-xs'>✅</span>
          <span className='text-[10px] font-semibold uppercase tracking-wider text-[#56D090]'>
            {statusText}
          </span>
        </div>
        <p className={`text-sm leading-relaxed ${dim ? 'text-[#EAEAEA]/60' : 'text-[#EAEAEA]/88'}`}>
          {summary}
        </p>
      </div>
    );
  }

  if (planSteps) {
    const prefix = content.slice(0, content.indexOf('{')).trim();
    return (
      <div className='space-y-2'>
        {prefix && (
          <p className={`text-sm leading-relaxed ${dim ? 'text-[#EAEAEA]/60' : 'text-[#EAEAEA]/88'}`}>{prefix}</p>
        )}
        <div className='rounded-lg border border-[#9A66FF]/25 bg-[#9A66FF]/5 p-3 space-y-2.5'>
          <p className='font-mono text-[9px] font-bold uppercase tracking-wider text-[#9A66FF]/60'>
            Execution Plan · {planSteps.length} subtasks
          </p>
          {planSteps.map((step: any, i: number) => (
            <div key={step.id ?? i} className='flex gap-2.5'>
              <span className='mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#9A66FF]/20 font-mono text-[9px] font-bold text-[#9A66FF]'>
                {step.id ?? i + 1}
              </span>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-1.5 mb-0.5'>
                  <span className='font-mono text-[9px] font-semibold text-[#14FFF7]/80'>{step.agent_name}</span>
                  {Array.isArray(step.depends_on) && step.depends_on.length > 0 && (
                    <span className='font-mono text-[9px] text-muted-foreground/40'>after {step.depends_on.join(', ')}</span>
                  )}
                </div>
                <p className={`text-xs leading-relaxed ${dim ? 'text-[#EAEAEA]/55' : 'text-[#EAEAEA]/75'}`}>{step.subtask}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${dim ? 'text-[#EAEAEA]/60' : 'text-[#EAEAEA]/88'}`}>
      {content}
    </div>
  );
}

const AgentThread = React.forwardRef<HTMLDivElement, AgentThreadProps>(
function AgentThread({ agent, messages, isExpanded, isActive, activityHint, subtask, onToggle }, ref) {
  const [showOlderMsgs, setShowOlderMsgs] = useState(false);
  useEffect(() => { if (!isExpanded) setShowOlderMsgs(false); }, [isExpanded]);

  const agentMsgs = messages.filter(m => m.agent_id === agent.id && m.role === 'assistant' && m.iteration > 0);
  const lastMsg = agentMsgs[agentMsgs.length - 1];
  const olderMsgs = agentMsgs.slice(0, -1);
  const totalTok = agentMsgs.reduce((s, m) => s + (m.tokens_output || 0), 0);
  const statusColor =
    subtask?.status === 'done' ? '#56D090' :
    subtask?.status === 'running' ? '#9A66FF' :
    subtask?.status === 'needs_help' ? '#FFBF47' :
    subtask?.status === 'blocked' ? '#EF4444' : '#4B5563';

  return (
    <div ref={ref} className='rounded-xl border border-border/40 bg-background/40 overflow-hidden'
      style={{ borderLeftColor: statusColor + '55', borderLeftWidth: 3 }}>
      <button className='w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left'
        onClick={onToggle}>
        <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} size='sm' />
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-semibold' style={{ color: agent.color || '#9A66FF' }}>{agent.name}</span>
            {subtask && (
              <span className='text-[10px] px-1.5 py-0.5 rounded-full border'
                style={{ color: statusColor, borderColor: statusColor + '40', backgroundColor: statusColor + '12' }}>
                {subtask.status}
              </span>
            )}
            {isActive && (
              <span className='flex items-center gap-1 text-[10px] text-[#9A66FF]'>
                <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#9A66FF]' />
                {activityHint ? activityHint.replace(new RegExp(`^${agent.name}\\s+`, 'i'), '') : 'working'}
              </span>
            )}
          </div>
          {!isExpanded && isActive && activityHint && (
            <p className='mt-0.5 text-[11px] text-[#9A66FF]/80 truncate'>
              {activityHint}
            </p>
          )}
          {lastMsg && !isExpanded && !(isActive && activityHint) && (
            <p className='mt-0.5 text-[11px] text-muted-foreground/65 truncate'>
              {lastMsg.content.replace(/\n+/g, ' ').slice(0, 100)}{lastMsg.content.length > 100 ? '…' : ''}
            </p>
          )}
          {subtask && isExpanded && (
            <p className='mt-0.5 text-[11px] text-muted-foreground/50 truncate'>
              <span className='text-muted-foreground/35'>Task: </span>{subtask.subtask.slice(0, 80)}
            </p>
          )}
        </div>
        <div className='flex items-center gap-3 shrink-0'>
          {agentMsgs.length > 0 && (
            <div className='text-right'>
              <p className='text-[10px] text-muted-foreground/55'>{agentMsgs.length} msg{agentMsgs.length !== 1 ? 's' : ''}</p>
              {totalTok > 0 && <p className='text-[9px] text-muted-foreground/35'>{formatTokens(totalTok)} tok</p>}
            </div>
          )}
          <IconChevronDown className={`h-4 w-4 text-muted-foreground/40 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className='border-t border-border/30'>
          {agentMsgs.length === 0 ? (
            <div className='px-4 py-6 text-center text-xs text-muted-foreground/40'>
              {isActive ? activityHint || 'Generating response…' : 'No messages yet.'}
            </div>
          ) : (
            <div className='divide-y divide-border/20'>
              {/* Older messages toggle */}
              {olderMsgs.length > 0 && (
                <div className='flex items-center gap-1.5 bg-muted/10 px-4 py-1.5'>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowOlderMsgs(v => !v); }}
                    className='flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors'
                  >
                    <IconChevronDown className={`h-3 w-3 transition-transform duration-200 ${showOlderMsgs ? '' : '-rotate-90'}`} />
                    {showOlderMsgs ? 'Hide' : 'Show'} {olderMsgs.length} older {olderMsgs.length === 1 ? 'message' : 'messages'}
                  </button>
                </div>
              )}
              {/* Older messages (collapsed by default) */}
              {showOlderMsgs && olderMsgs.map((msg, i) => (
                <div key={msg.id || i} className='px-4 py-3 opacity-55'>
                  <div className='flex flex-wrap items-center gap-2 mb-2 font-mono text-[10px] text-muted-foreground/45'>
                    <span>iter {msg.iteration}</span>
                    {msg.tokens_output > 0 && <><span>·</span><span>{formatTokens(msg.tokens_output)} tok</span></>}
                    {msg.latency_ms > 0 && <><span>·</span><span>{msg.latency_ms < 1000 ? `${msg.latency_ms}ms` : `${(msg.latency_ms / 1000).toFixed(1)}s`}</span></>}
                    <span className='ml-auto'>{timeAgo(msg.created_at)}</span>
                  </div>
                  <MessageContent content={msg.content} dim />
                  {(msg.tool_calls?.length ?? 0) > 0 && <ToolCallBlock calls={msg.tool_calls!} />}
                </div>
              ))}
              {/* Latest message — always shown, highlighted */}
              {lastMsg && (
                <div key={lastMsg.id} className='px-4 py-3'>
                  {olderMsgs.length > 0 && (
                    <div className='mb-2 flex items-center gap-1.5'>
                      <span className='h-1.5 w-1.5 rounded-full' style={{ backgroundColor: agent.color || '#9A66FF' }} />
                      <span className='text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50'>Latest</span>
                      <span className='ml-auto font-mono text-[9px] text-muted-foreground/35'>{timeAgo(lastMsg.created_at)}</span>
                    </div>
                  )}
                  <div className='flex flex-wrap items-center gap-2 mb-2 font-mono text-[10px] text-muted-foreground/45'>
                    <span>iter {lastMsg.iteration}</span>
                    {lastMsg.model && <><span>·</span><span>{lastMsg.model}</span></>}
                    {lastMsg.tokens_output > 0 && <><span>·</span><span>{formatTokens(lastMsg.tokens_output)} tok</span></>}
                    {lastMsg.latency_ms > 0 && <><span>·</span><span>{lastMsg.latency_ms < 1000 ? `${lastMsg.latency_ms}ms` : `${(lastMsg.latency_ms / 1000).toFixed(1)}s`}</span></>}
                    {olderMsgs.length === 0 && <span className='ml-auto'>{timeAgo(lastMsg.created_at)}</span>}
                  </div>
                  <MessageContent content={lastMsg.content} />
                  {(lastMsg.tool_calls?.length ?? 0) > 0 && <ToolCallBlock calls={lastMsg.tool_calls!} />}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
AgentThread.displayName = 'AgentThread';

/* ── Markdown export ── */
function buildMarkdown(
  execution: import('@/lib/api').Execution,
  workforce: import('@/lib/api').Workforce | null,
  agents: import('@/lib/api').Agent[],
  messages: import('@/lib/api').Message[],
): string {
  const lines: string[] = [];
  const ts = (d: string) => new Date(d).toLocaleString();

  lines.push(`# ${execution.title || execution.objective}`);
  lines.push('');
  lines.push(`**Workforce:** ${workforce?.name || execution.workforce_id}`);
  lines.push(`**Status:** ${execution.status}`);
  lines.push(`**Created:** ${ts(execution.created_at)}`);
  if (execution.started_at) lines.push(`**Started:** ${ts(execution.started_at)}`);
  if (execution.ended_at)   lines.push(`**Ended:** ${ts(execution.ended_at)}`);
  if (execution.elapsed_s)  lines.push(`**Duration:** ${execution.elapsed_s}s`);
  if (execution.tokens_used) lines.push(`**Tokens used:** ${execution.tokens_used.toLocaleString()}`);
  if (agents.length) lines.push(`**Agents:** ${agents.map(a => a.name).join(', ')}`);
  lines.push('');

  lines.push('## Objective');
  lines.push('');
  lines.push(execution.objective);
  lines.push('');

  if (execution.strategy) {
    lines.push('## Strategy');
    lines.push('');
    lines.push(execution.strategy);
    lines.push('');
  }

  if ((execution.plan || []).length > 0) {
    lines.push('## Execution Plan');
    lines.push('');
    for (const s of execution.plan) {
      const statusIcon = s.status === 'done' ? '✅' : s.status === 'blocked' ? '🚫' : s.status === 'running' ? '⚡' : '⏳';
      lines.push(`### ${statusIcon} [${s.id}] ${s.agent_name}`);
      lines.push('');
      lines.push(s.subtask);
      if (s.depends_on?.length) lines.push(`*Depends on: ${s.depends_on.join(', ')}*`);
      if (s.output) {
        lines.push('');
        lines.push('**Output:**');
        lines.push('');
        lines.push(s.output);
      }
      if (s.error_msg) {
        lines.push('');
        lines.push(`**Error:** ${s.error_msg}`);
      }
      lines.push('');
    }
  }

  if (execution.result) {
    lines.push('## Final Result');
    lines.push('');
    lines.push(execution.result);
    lines.push('');
  }

  if (execution.error_message) {
    lines.push('## Error');
    lines.push('');
    lines.push(execution.error_message);
    lines.push('');
  }

  const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.phase === 'execution');
  if (assistantMsgs.length > 0) {
    lines.push('## Agent Messages');
    lines.push('');
    for (const m of assistantMsgs) {
      lines.push(`### ${m.agent_name} (iter ${m.iteration})`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Exported from AitherOS · ${new Date().toLocaleString()}*`);

  return lines.join('\n');
}

function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExecutionDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const execId = params.id as string;

  const [execution, setExecution] = useState<Execution | null>(null);
  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [discussionMessages, setDiscussionMessages] = useState<Message[]>([]);
  const [reviewMessages, setReviewMessages] = useState<Message[]>([]);
  const [agentsMap, setAgentsMap] = useState<Record<string, Agent>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [titleFlash, setTitleFlash] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Input state
  const [feedback, setFeedback] = useState('');
  const [sending, setSending] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [intervening, setIntervening] = useState(false);
  const [interveneStatus, setInterveneStatus] = useState<'idle' | 'ok' | 'err'>('idle');

  // Credential quick-inject panel (shown when agent reports needs_help)
  const [credPanelOpen, setCredPanelOpen] = useState(false);
  const [credService, setCredService] = useState('');
  const [credKey, setCredKey] = useState('');
  const [credValue, setCredValue] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [interveneErrMsg, setInterveneErrMsg] = useState('');

  // Chat
  type ChatEntry =
    | { kind: 'answer'; id: string; input: string; answer: string }
    | { kind: 'action'; id: string; input: string; loading: boolean; action?: ChatReply['action']; error?: string };
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Metadata editing
  const [metaEditOpen, setMetaEditOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaImageUrl, setMetaImageUrl] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [objOpen, setObjOpen] = useState(false);
  const [wsFilesOpen, setWsFilesOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgContainerRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const agentThreadRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const needsHelpReason = useMemo(() => {
    const waiting = (execution?.plan || []).filter(s => s.status === 'needs_help');
    for (let i = waiting.length - 1; i >= 0; i--) {
      const reason = waiting[i].error_msg?.trim();
      if (reason) return reason;
    }

    for (let i = liveEvents.length - 1; i >= 0; i--) {
      const ev = liveEvents[i];
      if (ev.type !== 'human_required') continue;
      const reason = (typeof ev.data?.reason === 'string' && ev.data.reason.trim())
        ? ev.data.reason.trim()
        : ev.content.trim();
      if (reason) return reason;
    }
    return '';
  }, [execution?.plan, liveEvents]);

  // Scan recent messages to auto-detect what credential the blocked agent needs.
  // Must stay above early returns to satisfy Rules of Hooks.
  const detectedCred = useMemo(() => {
    const needsHelp = execution?.plan?.some(s => s.status === 'needs_help');
    if (!needsHelp) return null;

    const sources: string[] = [];
    if (needsHelpReason) sources.push(needsHelpReason);

    const recentEvents = liveEvents.slice(-10);
    for (let i = recentEvents.length - 1; i >= 0; i--) {
      const ev = recentEvents[i];
      if (ev.type !== 'human_required') continue;
      if (typeof ev.data?.reason === 'string') sources.push(ev.data.reason);
      if (ev.content) sources.push(ev.content);
    }

    const recentMessages = messages.slice(-12);
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      sources.push(recentMessages[i].content);
    }

    for (const src of sources) {
      const hint = detectCredentialHint(src || '');
      if (hint) return hint;
    }

    return null;
  }, [execution?.plan, needsHelpReason, liveEvents, messages]);

  const loadData = useCallback(async () => {
    if (!session?.accessToken) return; // wait for NextAuth session to initialise
    try {
      api.setToken(session.accessToken);

      // First: fetch execution — need workforce_id before parallel calls
      const exRes = await api.getExecutionDirect(execId);
      const foundExec = exRes.data;
      if (!foundExec) return;
      setExecution(foundExec);

      // Parallel: fetch everything else at once
      const [wfResult, msgResult, discResult, revResult, qaResult, evResult, agResult] =
        await Promise.allSettled([
          foundExec.workforce_id ? api.getWorkforce(foundExec.workforce_id) : Promise.resolve(null),
          api.getMessages(execId),
          api.getDiscussionMessages(execId),
          api.getReviewMessages(execId),
          api.listExecutionQA(execId),
          api.listExecutionEvents(execId),
          api.listAgents(),
        ]);

      if (wfResult.status === 'fulfilled' && wfResult.value?.data)
        setWorkforce(wfResult.value.data);

      if (msgResult.status === 'fulfilled')
        setMessages(msgResult.value.data || []);

      if (discResult.status === 'fulfilled')
        setDiscussionMessages(discResult.value.data || []);

      if (revResult.status === 'fulfilled')
        setReviewMessages(revResult.value.data || []);

      if (qaResult.status === 'fulfilled') {
        const loaded = (qaResult.value.data || []) as ExecutionQA[];
        setChatEntries(loaded.map(qa => {
          if (qa.question.startsWith('[send] ') || qa.question.startsWith('[instruct] ')) {
            return { kind: 'action' as const, id: qa.id, input: qa.question.replace(/^\[(send|instruct)\] /, ''), loading: false, action: undefined };
          }
          return { kind: 'answer' as const, id: qa.id, input: qa.question, answer: qa.answer };
        }));
      }

      if (evResult.status === 'fulfilled') {
        const historical: LiveEvent[] = (evResult.value.data || []).map((e: ExecutionEvent) => ({
          id: e.id,
          type: e.type,
          agent_name: e.agent_name || undefined,
          content: e.message,
          data: e.data,
          timestamp: new Date(e.timestamp),
          isNew: false,
        }));
        setLiveEvents(historical);
      }

      {
        const map: Record<string, Agent> = {};

        if (wfResult.status === 'fulfilled' && wfResult.value?.data?.agents) {
          for (const a of wfResult.value.data.agents) {
            map[a.id] = a;
          }
        }

        if (agResult.status === 'fulfilled') {
          for (const a of agResult.value.data || []) {
            const existing = map[a.id];
            map[a.id] = existing
              ? {
                  ...a,
                  avatar_url: existing.avatar_url || a.avatar_url,
                  color: existing.color || a.color,
                  icon: existing.icon || a.icon,
                  name: existing.name || a.name
                }
              : a;
          }
        }

        setAgentsMap(map);
      }
    } catch (err) {
      console.error('Failed to load execution:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session, execId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-poll when active. Slows down when WS is connected (events arrive live already).
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!execution) return;
    const active = ['running', 'planning', 'awaiting_approval'].includes(execution.status);
    if (!active) return;

    const interval = wsConnected ? 8000 : 4000;

    pollRef.current = setInterval(async () => {
      try {
        // All poll requests in parallel — no sequential waterfall
        const [exRes, msgRes, discRes, revRes] = await Promise.allSettled([
          api.getExecutionDirect(execId),
          api.getMessages(execId),
          api.getDiscussionMessages(execId),
          api.getReviewMessages(execId),
        ]);
        if (exRes.status === 'fulfilled' && exRes.value.data)
          setExecution(exRes.value.data);
        if (msgRes.status === 'fulfilled')
          setMessages(msgRes.value.data || []);
        if (discRes.status === 'fulfilled')
          setDiscussionMessages(discRes.value.data || []);
        if (revRes.status === 'fulfilled')
          setReviewMessages(revRes.value.data || []);
      } catch { /* */ }
    }, interval);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [execution?.status, execId, wsConnected]);

  // WebSocket for live events
  useEffect(() => {
    if (!execId) return;
    const wsBase = process.env.NEXT_PUBLIC_WS_URL ||
      (typeof window !== 'undefined' ? window.location.origin.replace(/^http/, 'ws') : '');
    const baseUrl = `${wsBase.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/executions/${execId}`;
    const token = session?.accessToken;
    const wsUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          // Skip noise events — same filter as the backend API
          if (['iteration_done', 'system'].includes(data.type)) return;
          // Handle title assignment — update execution state live
          if (data.type === 'execution_titled' && data.data?.title) {
            setExecution(prev => prev ? { ...prev, title: data.data.title } : prev);
            setTitleFlash(true);
            setTimeout(() => setTitleFlash(false), 1800);
          }
          const evt: LiveEvent = {
            id: data.id || Math.random().toString(36).slice(2),
            type: data.type || 'event',
            agent_name: data.agent_name,
            content: data.message || data.content || JSON.stringify(data),
            data: data.data,
            timestamp: new Date(),
            isNew: true
          };
          setLiveEvents((prev) => {
            // Deduplicate: if we already loaded this event from DB, skip it
            if (prev.some(e => e.id === evt.id)) return prev;
            return [...prev, evt].slice(-200);
          });
        } catch { /* */ }
      };
      return () => { ws.close(); };
    } catch { /* */ }
  }, [execId]);

  // Auto-clear intervene status after 3s — uses effect so cleanup fires on unmount
  useEffect(() => {
    if (interveneStatus === 'idle') return;
    const t = setTimeout(() => setInterveneStatus('idle'), 3000);
    return () => clearTimeout(t);
  }, [interveneStatus]);

  // Build ordered agent list: plan order first, then by first message appearance.
  // Must be before any early returns to satisfy Rules of Hooks.
  const orderedAgents = useMemo(() => {
    if (!execution) return [];
    const planAgentIds = (execution.plan || []).map(s => s.agent_id);
    const msgAgentIds = messages.filter(m => m.role === 'assistant').map(m => m.agent_id);
    const allAgentIds = Array.from(new Set([...planAgentIds, ...msgAgentIds]));
    return allAgentIds.map(id => agentsMap[id]).filter(Boolean);
  }, [execution, messages, agentsMap]);

  // Speech bubbles: latest assistant message snippet per agent
  const speechBubbles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const msg of messages) {
      if (msg.agent_id && msg.role === 'assistant' && msg.iteration > 0) {
        const text = msg.content.replace(/```[\s\S]*?```/g, '[code]').replace(/\n+/g, ' ').trim();
        map[msg.agent_id] = text.slice(0, 90) + (text.length > 90 ? '…' : '');
      }
    }
    return map;
  }, [messages]);

  const agentActivityById = useMemo(() => {
    const byAgentName: Record<string, string> = {};
    for (const agent of orderedAgents) {
      byAgentName[normalizeWhitespace(agent.name).toLowerCase()] = agent.id;
    }

    const activity: Record<string, string> = {};
    for (let i = liveEvents.length - 1; i >= 0; i--) {
      const ev = liveEvents[i];
      const nameKey = normalizeWhitespace(ev.agent_name || '').toLowerCase();
      const agentId = byAgentName[nameKey];
      if (!agentId || activity[agentId]) continue;
      const agentName = orderedAgents.find((a) => a.id === agentId)?.name || ev.agent_name || 'Agent';
      const sentence = summarizeAgentActivityFromEvent(ev, agentName);
      if (sentence) activity[agentId] = sentence;
    }
    return activity;
  }, [liveEvents, orderedAgents]);

  const runningActivityText = useMemo(() => {
    if (!execution) return '';
    const running = (execution.plan || []).find((s) => s.status === 'running');
    if (!running) return '';
    const hint = agentActivityById[running.agent_id];
    if (hint) return hint;
    const agentName = running.agent_name || agentsMap[running.agent_id]?.name || 'An agent';
    return `${agentName} is working on the current subtask.`;
  }, [execution, agentActivityById, agentsMap]);

  // Smart auto-scroll: only follow bottom when user hasn't manually scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Auto-scroll flow events to newest
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveEvents]);

  // Reset scroll tracking when execution status changes
  useEffect(() => {
    userScrolledUpRef.current = false;
    setShowScrollBtn(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [execution?.status]);

  // Derive the set of files touched in THIS execution from tool call events.
  // Tracks the last operation per path so "wrote" overwrites "read" for the same file.
  const touchedFiles = useMemo(() => {
    const FILE_OP_TOOLS: Record<string, string> = {
      write_file:      'wrote',
      append_to_file:  'appended',
      read_file:       'read',
      read_file_lines: 'read',
      delete_file:     'deleted',
      move_file:       'moved',
      copy_file:       'copied',
    };
    // Priority order: higher index = higher priority (wins if same file touched multiple ways)
    const OP_PRIORITY: Record<string, number> = {
      read: 0, appended: 1, moved: 1, copied: 1, deleted: 2, wrote: 3,
    };

    const fileMap = new Map<string, string>(); // relPath → op

    for (const ev of liveEvents) {
      if (ev.type !== 'tool_call' || !ev.data?.args) continue;
      const args = ev.data.args as Record<string, unknown>;
      const tool = ev.data.tool as string | undefined;
      if (!tool) continue;

      const op = FILE_OP_TOOLS[tool];
      if (!op) continue;

      const paths: string[] = [];
      if (args.path) paths.push(String(args.path));
      if (args.source) paths.push(String(args.source));
      if (args.destination) paths.push(String(args.destination));

      for (const raw of paths) {
        // Normalise to workspace-relative: strip /workspace/ alias or bare filename
        let rel = raw.trim();
        if (rel.startsWith('/workspace/')) rel = rel.slice('/workspace/'.length);
        else if (rel.startsWith('./')) rel = rel.slice(2);
        if (!rel || rel === '/workspace') continue;

        const existing = fileMap.get(rel);
        if (!existing || (OP_PRIORITY[op] ?? 0) >= (OP_PRIORITY[existing] ?? 0)) {
          fileMap.set(rel, op);
        }
      }
    }

    return Array.from(fileMap.entries())
      .map(([path, op]) => ({ path, op, ext: path.split('.').pop()?.toLowerCase() ?? '' }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [liveEvents]);

  function handleMsgScroll() {
    const el = msgContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distFromBottom > 120;
    userScrolledUpRef.current = scrolledUp;
    setShowScrollBtn(scrolledUp);
  }

  function scrollToBottom() {
    userScrolledUpRef.current = false;
    setShowScrollBtn(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
  }

  async function handleApprove(withFeedback: boolean) {
    if (!execution) return;
    setSending(true);
    try {
      await api.approveExecution(
        execution.id,
        true,
        withFeedback ? feedback : ''
      );
      setFeedback('');
      await loadData();
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setSending(false);
    }
  }

  async function handleReject() {
    if (!execution) return;
    setSending(true);
    try {
      await api.approveExecution(execution.id, false, feedback);
      setFeedback('');
      await loadData();
    } catch (err) {
      console.error('Reject failed:', err);
    } finally {
      setSending(false);
    }
  }

  async function handleHalt() {
    if (!execution) return;
    try {
      await api.haltExecution(execution.id);
      await loadData();
    } catch (err) {
      console.error('Halt failed:', err);
    }
  }

  async function handleResume() {
    if (!execution) return;
    try {
      await api.resumeExecution(execution.id);
      await loadData();
    } catch (err) {
      console.error('Resume failed:', err);
    }
  }

  async function handleRerun() {
    if (!execution || !workforce) return;
    try {
      const res = await api.startExecution(workforce.id, execution.objective);
      if (res.data?.id) router.push(`/dashboard/executions/${res.data.id}`);
    } catch (err) {
      console.error('Re-run failed:', err);
    }
  }

  async function handleIntervene() {
    if (!execution || !feedback.trim()) return;
    setIntervening(true);
    setInterveneStatus('idle');
    setInterveneErrMsg('');
    try {
      await api.interveneExecution(execution.id, feedback.trim());
      setFeedback('');
      setInterveneStatus('ok');
      setTimeout(() => {
        loadData();
      }, 250);
    } catch (err: any) {
      const msg = err?.message || 'Intervention failed — execution may no longer be active';
      setInterveneStatus('err');
      setInterveneErrMsg(msg);
    } finally {
      setIntervening(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (execution?.status === 'awaiting_approval' || execution?.status === 'pending_approval') {
        if (feedback.trim()) handleApprove(true);
      } else if (execution?.status === 'running') {
        if (feedback.trim()) handleIntervene();
      }
    }
  }

  if (loading) {
    return (
      <div className='flex h-[calc(100vh-64px)] flex-col'>
        {/* Top bar skeleton */}
        <div className='flex items-center justify-between border-b border-border/50 px-6 py-3'>
          <div className='flex items-center gap-3'>
            <div className='h-8 w-8 animate-pulse rounded-lg bg-muted/40' />
            <div className='space-y-1.5'>
              <div className='h-4 w-40 animate-pulse rounded bg-muted/50' />
              <div className='h-3 w-64 animate-pulse rounded bg-muted/30' />
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <div className='h-6 w-20 animate-pulse rounded-full bg-muted/40' />
            <div className='h-6 w-24 animate-pulse rounded bg-muted/30' />
          </div>
        </div>
        {/* 3-column layout skeleton */}
        <div className='flex min-h-0 flex-1 overflow-hidden'>
          <div className='w-56 border-r border-border/50 p-2 space-y-2'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='h-16 animate-pulse rounded-xl bg-muted/30' />
            ))}
          </div>
          <div className='flex-1 p-4 space-y-3'>
            <div className='h-12 animate-pulse rounded-xl bg-muted/30' />
            <div className='h-24 animate-pulse rounded-xl bg-[#56D090]/5 border border-[#56D090]/20' />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='h-20 animate-pulse rounded-xl bg-muted/20' style={{ opacity: 1 - i * 0.2 }} />
            ))}
          </div>
          <div className='w-80 border-l border-border/50 p-4 space-y-3'>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className='h-12 animate-pulse rounded-lg bg-muted/30' />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className='flex h-[80vh] flex-col items-center justify-center gap-4'>
        <p className='text-muted-foreground'>Execution not found.</p>
        <Button variant='outline' onClick={() => router.push('/dashboard/executions')}>
          <IconArrowLeft className='mr-2 h-4 w-4' />
          Back to Executions
        </Button>
      </div>
    );
  }

  const isActive =
    execution.status === 'running' ||
    execution.status === 'planning' ||
    execution.status === 'pending_approval' ||
    execution.status === 'awaiting_approval';

  const isRunning = execution.status === 'running' || execution.status === 'planning';
  const hasNeedsHelp = execution.plan?.some(s => s.status === 'needs_help');

  async function handleInjectCredential() {
    if (!execution || !credKey.trim() || !credValue.trim()) return;
    setCredSaving(true);
    setInterveneStatus('idle');
    try {
      const normalizedService = (credService.trim() || inferServiceFromKey(credKey.trim()) || 'custom').toLowerCase();
      if (workforce?.id) {
        await api.upsertCredential(workforce.id, {
          service: normalizedService,
          key_name: credKey.trim(),
          value: credValue.trim()
        });
      }
      const msg = workforce?.id
        ? `Credential stored: ${credKey.trim()} is now available via list_secrets (service: ${normalizedService}). Please retry the blocked operation.`
        : `Here is the credential you need — ${credKey.trim()}: ${credValue.trim()}. Please retry the blocked operation.`;
      await api.interveneExecution(execution.id, msg);
      setCredPanelOpen(false);
      setCredValue('');
      setInterveneStatus('ok');
      setTimeout(() => {
        loadData();
      }, 250);
    } catch (err: any) {
      setInterveneStatus('err');
      setInterveneErrMsg(err?.message || 'Failed to store credential');
    } finally {
      setCredSaving(false);
    }
  }

  async function handleChat(mode: 'ask' | 'instruct') {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatLoading(true);

    // Build history for multi-turn context (only ask entries)
    const history = chatEntries.flatMap(e => {
      if (e.kind !== 'answer') return [];
      return [{ role: 'user', content: e.input }, { role: 'assistant', content: e.answer }];
    });

    const tempId = `tmp-${Date.now()}`;
    if (mode === 'instruct') {
      setChatEntries(prev => [...prev, { kind: 'action', id: tempId, input: msg, loading: true }]);
    }

    try {
      const res = await api.executionChat(execId, mode, msg, history);
      if (res.data) {
        if (mode === 'ask') {
          setChatEntries(prev => [...prev, { kind: 'answer', id: res.data.id, input: msg, answer: res.data.answer! }]);
        } else {
          setChatEntries(prev => prev.map(e => e.id === tempId
            ? { kind: 'action', id: res.data.id, input: msg, loading: false, action: res.data.action }
            : e));
        }
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      if (mode === 'instruct') {
        setChatEntries(prev => prev.map(e => e.id === tempId
          ? { ...e, loading: false, error: 'Failed to send instruction' }
          : e));
      }
      console.error('Chat failed:', err);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleSaveMeta() {
    setMetaSaving(true);
    try {
      await api.updateExecutionMeta(execId, {
        title: metaTitle || undefined,
        description: metaDescription || undefined,
        image_url: metaImageUrl || undefined
      });
      setMetaEditOpen(false);
      await loadData();
    } catch (err) {
      console.error('Save meta failed:', err);
    } finally {
      setMetaSaving(false);
    }
  }

  function scrollToAgent(id: string) {
    userScrolledUpRef.current = true;
    setTimeout(() => {
      agentThreadRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }

  function toggleAgent(id: string) {
    userScrolledUpRef.current = true; // prevent auto-scroll from hijacking focus
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        scrollToAgent(id);
      }
      return next;
    });
  }

  return (
    <>
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Top Bar */}
      <div className='flex items-center justify-between border-b border-border/50 px-6 py-3'>
        <div className='flex items-center gap-3'>
          <Button variant='ghost' size='icon' onClick={() => router.push('/dashboard/executions')} className='h-8 w-8'>
            <IconArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <div className='flex items-center gap-2'>
              <h1
                className='text-sm font-semibold transition-colors duration-300'
                style={titleFlash ? { color: '#9A66FF', textShadow: '0 0 12px #9A66FF88' } : undefined}
              >
                {execution.title || workforce?.name || 'Execution'}
              </h1>
              {isRunning && (
                <span className='relative flex h-2 w-2'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-[#9A66FF] opacity-75' />
                  <span className='relative inline-flex h-2 w-2 rounded-full bg-[#9A66FF]' />
                </span>
              )}
              <Button
                variant='ghost' size='icon'
                className='h-6 w-6 opacity-50 hover:opacity-100'
                onClick={() => {
                  setMetaTitle(execution.title || '');
                  setMetaDescription(execution.description || '');
                  setMetaImageUrl(execution.image_url || '');
                  setMetaEditOpen((v) => !v);
                }}
              >
                <IconPencil className='h-3 w-3' />
              </Button>
            </div>
            <p className='max-w-md truncate text-xs text-muted-foreground'>
              {execution.description || execution.objective.slice(0, 80)}{!execution.description && execution.objective.length > 80 ? '...' : ''}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          {/* Agent roster mini-pills */}
          <div className='hidden items-center gap-1 sm:flex'>
            {orderedAgents.map((a) => (
              <EntityAvatar
                key={a.id}
                icon={a.icon}
                color={a.color}
                avatarUrl={a.avatar_url}
                name={a.name}
                size='xs'
              />
            ))}
          </div>
          <Badge variant='outline' className={execStatusColors[execution.status] || 'bg-muted text-muted-foreground'}>
            {execution.status}
          </Badge>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            {(() => {
              const mt = messages.reduce((s, m) => s + (m.tokens_input || 0) + (m.tokens_output || 0), 0);
              const dt = execution.tokens_used > 0 ? execution.tokens_used : mt;
              const mi = messages.length > 0 ? Math.max(...messages.map(m => m.iteration || 0)) : 0;
              const di = execution.iterations > 0 ? execution.iterations : mi;
              const budgetTokens = workforce?.budget_tokens ?? 0;
              const budgetTimeS = workforce?.budget_time_s ?? 0;
              const tokenPct = budgetTokens > 0 ? Math.min(100, (dt / budgetTokens) * 100) : 0;
              const timePct = budgetTimeS > 0 && execution.elapsed_s > 0 ? Math.min(100, (execution.elapsed_s / budgetTimeS) * 100) : 0;
              const tokenBarColor = tokenPct > 90 ? '#EF4444' : tokenPct > 70 ? '#FFBF47' : '#9A66FF';
              const timeBarColor = timePct > 90 ? '#EF4444' : timePct > 70 ? '#FFBF47' : '#14FFF7';
              return (
                <>
                  <span>{formatTokens(dt)} tokens</span>
                  {budgetTokens > 0 && (
                    <div
                      className='w-14 h-1 rounded-full bg-border/40 overflow-hidden'
                      title={`${formatTokens(dt)} / ${formatTokens(budgetTokens)} token budget (${tokenPct.toFixed(0)}%)`}
                    >
                      <div className='h-full rounded-full transition-all duration-500' style={{ width: `${tokenPct}%`, backgroundColor: tokenBarColor }} />
                    </div>
                  )}
                  <span className='text-border'>·</span>
                  <span>{di} iter{di !== 1 ? 's' : ''}</span>
                  {execution.elapsed_s > 0 && (
                    <>
                      <span className='text-border'>·</span>
                      <span>{execution.elapsed_s >= 60 ? `${(execution.elapsed_s / 60).toFixed(1)}m` : `${execution.elapsed_s}s`}</span>
                      {budgetTimeS > 0 && (
                        <div
                          className='w-10 h-1 rounded-full bg-border/40 overflow-hidden'
                          title={`${execution.elapsed_s}s / ${budgetTimeS}s time budget (${timePct.toFixed(0)}%)`}
                        >
                          <div className='h-full rounded-full transition-all duration-500' style={{ width: `${timePct}%`, backgroundColor: timeBarColor }} />
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </div>
          <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleRefresh} disabled={refreshing}>
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          {isRunning && (
            <Button variant='outline' size='sm' className='border-[#FFBF47]/30 text-[#FFBF47] hover:bg-[#FFBF47]/10' onClick={handleHalt}>
              <IconHandStop className='mr-1 h-3.5 w-3.5' />
              Halt
            </Button>
          )}
          {execution?.status === 'halted' && (
            <Button variant='outline' size='sm' className='border-[#56D090]/30 text-[#56D090] hover:bg-[#56D090]/10' onClick={handleResume}>
              <IconPlayerPlay className='mr-1 h-3.5 w-3.5' />
              Resume
            </Button>
          )}
          {(execution.status === 'completed' || execution.status === 'failed') && workforce && (
            <Button
              variant='outline' size='sm'
              className='border-[#9A66FF]/30 text-[#9A66FF] hover:bg-[#9A66FF]/10'
              onClick={handleRerun}
              title='Start a new execution with the same objective'
            >
              <IconPlayerPlay className='mr-1 h-3.5 w-3.5' />
              Re-run
            </Button>
          )}
          <Button
            variant='outline' size='sm'
            className='border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/20'
            title='Export as Markdown'
            onClick={() => {
              const md = buildMarkdown(execution, workforce, orderedAgents, messages);
              const slug = (execution.title || execution.objective).slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
              downloadMarkdown(md, `execution-${slug}-${execution.id.slice(0, 8)}.md`);
            }}
          >
            <IconDownload className='mr-1 h-3.5 w-3.5' />
            Export .md
          </Button>
          {!isRunning && execution.status !== 'planning' && (
            <Button
              variant='ghost' size='icon'
              className='h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
              onClick={() => {
                if (!confirm('Delete this execution? This cannot be undone.')) return;
                api.deleteExecution(execution.id).then(() => router.push('/dashboard/executions'));
              }}
            >
              <IconTrash className='h-4 w-4' />
            </Button>
          )}
        </div>
      </div>

      {/* ── 3-Column Mission Control Body ── */}
      <div className='flex min-h-0 flex-1 overflow-hidden'>

        {/* ─── Col 1: Visual / Stats / Events (left, narrow) ─── */}
        <div className='flex w-56 shrink-0 flex-col overflow-hidden border-r border-border/50'>

          {/* Teams-style agent call grid */}
          <div className='shrink-0'>
            <AgentCallGrid
              agents={orderedAgents}
              plan={execution.plan || []}
              messages={messages}
              isRunning={isRunning}
              expandedAgents={expandedAgents}
              onToggleAgent={toggleAgent}
              speechBubbles={speechBubbles}
            />
          </div>

          {/* Mission Stats */}
          {(() => {
            const msgTokens = messages.reduce((s, m) => s + (m.tokens_input || 0) + (m.tokens_output || 0), 0);
            const dispTokens = execution.tokens_used > 0 ? execution.tokens_used : msgTokens;
            const msgIters = messages.length > 0 ? Math.max(...messages.map(m => m.iteration || 0)) : 0;
            const dispIters = execution.iterations > 0 ? execution.iterations : msgIters;
            return (
              <div className='border-t border-b border-border/50 p-3 space-y-2 shrink-0'>
                <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Stats</p>
                <div className='grid grid-cols-2 gap-1.5'>
                  <div className='rounded-lg border border-border/30 bg-background/30 p-2'>
                    <p className='text-[9px] text-muted-foreground/55'>Tokens</p>
                    <p className='text-xs font-semibold text-[#9A66FF]'>{formatTokens(dispTokens)}</p>
                  </div>
                  <div className='rounded-lg border border-border/30 bg-background/30 p-2'>
                    <p className='text-[9px] text-muted-foreground/55'>Iterations</p>
                    <p className='text-xs font-semibold text-[#9A66FF]'>{dispIters}</p>
                  </div>
                  {execution.elapsed_s > 0 && (
                    <div className='col-span-2 rounded-lg border border-border/30 bg-background/30 p-2'>
                      <p className='text-[9px] text-muted-foreground/55'>Elapsed</p>
                      <p className='text-xs font-semibold text-[#14FFF7]'>
                        {execution.elapsed_s >= 60 ? `${(execution.elapsed_s / 60).toFixed(1)}m` : `${execution.elapsed_s}s`}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Agent Interactions (P1+P2+P3) — collapsible, above Flow Events */}
          <InteractionsPanel
            agents={orderedAgents}
            discussionMessages={discussionMessages}
            allMessages={messages}
            reviewMessages={reviewMessages}
            leaderAgentId={workforce?.leader_agent_id}
          />

          {/* Token usage per agent */}
          {(() => {
            const agentToks = orderedAgents.map(a => {
              const agentMsgs = messages.filter(m => m.agent_id === a.id && m.role === 'assistant');
              const tokIn = agentMsgs.reduce((s, m) => s + (m.tokens_input || 0), 0);
              const tokOut = agentMsgs.reduce((s, m) => s + (m.tokens_output || 0), 0);
              return { agent: a, tokIn, tokOut, total: tokIn + tokOut, calls: agentMsgs.length };
            }).filter(r => r.total > 0);
            if (agentToks.length === 0) return null;
            const grandTotal = agentToks.reduce((s, r) => s + r.total, 0);
            return (
              <div className='border-t border-border/50 shrink-0'>
                <div className='px-3 py-2 border-b border-border/30'>
                  <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Token Usage</p>
                </div>
                <div className='px-3 py-2 space-y-1.5'>
                  {agentToks.map(r => {
                    const pct = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0;
                    const agentColor = r.agent.color || '#9A66FF';
                    return (
                      <div key={r.agent.id} className='space-y-0.5'>
                        <div className='flex items-center justify-between'>
                          <span className='text-[10px] truncate text-muted-foreground/70' style={{ maxWidth: '60%' }}>{r.agent.name}</span>
                          <span className='text-[10px] font-mono text-muted-foreground/60 shrink-0'>{formatTokens(r.total)}</span>
                        </div>
                        <div className='h-1 rounded-full bg-border/30 overflow-hidden'>
                          <div className='h-full rounded-full' style={{ width: `${pct}%`, backgroundColor: agentColor + 'cc' }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className='flex justify-between pt-0.5 border-t border-border/20'>
                    <span className='text-[9px] text-muted-foreground/40'>Total</span>
                    <span className='text-[10px] font-mono text-muted-foreground/60'>{formatTokens(grandTotal)}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Flow Events — live, newest at bottom, animated */}
          <div className='flex max-h-56 flex-col border-t border-border/50'>
            <div className='flex items-center justify-between border-b border-border/50 px-3 py-2 shrink-0'>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Flow Events</p>
              {wsConnected && (
                <span className='flex items-center gap-1 text-[10px] text-[#56D090]'>
                  <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#56D090]' />
                  live
                </span>
              )}
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-1 p-2'>
                {liveEvents.length === 0 ? (
                  <p className='p-1 text-[11px] text-muted-foreground/50'>
                    {isRunning ? 'Waiting for events…' : 'No events yet.'}
                  </p>
                ) : (
                  liveEvents.map((ev) => {
                    if (ev.type === 'agent_thinking') {
                      return <ThinkingEventCard key={ev.id} ev={ev} />;
                    }
                    const evCfg = eventTypeConfig[ev.type];
                    const dot = evCfg?.dot || '#6B7280';
                    const label = evCfg?.label || ev.type.replace(/_/g, ' ');
                    return <EventCard key={ev.id} ev={ev} dot={dot} label={label} workforceId={workforce?.id} workspacePath={workforce?.workspace_path} />;
                  })
                )}
                <div ref={eventsEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Col 2: Main Message Stream (center, largest) ─── */}
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex-1 overflow-y-auto space-y-2.5 px-4 py-4'>

            {/* Objective — collapsible */}
            <div className='rounded-xl border border-[#9A66FF]/20 bg-[#9A66FF]/5 overflow-hidden'>
              <button
                className='w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[#9A66FF]/5 transition-colors text-left'
                onClick={() => setObjOpen(v => !v)}
              >
                <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1'>Mission Objective</span>
                <span className='text-[10px] text-muted-foreground/50'>{timeAgo(execution.created_at)}</span>
                <IconChevronDown className={`ml-1 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${objOpen ? '' : '-rotate-90'}`} />
              </button>
              {!objOpen && (
                <p className='px-4 pb-2.5 text-xs text-muted-foreground/55 truncate'>
                  {execution.objective.slice(0, 100)}{execution.objective.length > 100 ? '…' : ''}
                </p>
              )}
              {objOpen && (
                <p className='px-4 pb-3 pt-0 whitespace-pre-wrap text-sm leading-relaxed text-[#EAEAEA]/88'>{execution.objective}</p>
              )}
            </div>

            {/* Final result */}
            {execution.status === 'completed' && execution.result && (() => {
              const completion = parseCompletionSignalFromContent(execution.result);
              const parsed = completion?.details || null;
              const summary = completion?.summary || (completion ? humanizeCompletionStatus(completion.status) : null);
              const isCompletionSignal = !!completion;
              return (
                <div className='rounded-xl border border-[#56D090]/30 bg-[#56D090]/5 p-4 space-y-3'>
                  <div className='flex items-center gap-2'>
                    <span className='text-base'>✅</span>
                    <span className='text-xs font-semibold uppercase tracking-wider text-[#56D090]'>
                      Final Result{completion?.status ? ` · ${completion.status.replace(/_/g, ' ')}` : ''}
                    </span>
                  </div>
                  {summary ? (
                    <>
                      <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/90'>
                        <TextWithFilePaths text={summary} workforceId={workforce?.id} />
                      </p>
                      {/* Show other fields from completion signal beyond status/summary */}
                      {isCompletionSignal && Object.entries(parsed!).filter(([k]) => k !== 'status' && k !== 'summary').length > 0 && (
                        <div className='space-y-1.5 border-t border-[#56D090]/20 pt-3'>
                          {Object.entries(parsed!).filter(([k]) => k !== 'status' && k !== 'summary').map(([k, v]) => (
                            <div key={k}>
                              <span className='text-[10px] font-semibold uppercase text-[#56D090]/60'>{k}</span>
                              <p className='text-xs text-[#EAEAEA]/70 whitespace-pre-wrap'>
                                <TextWithFilePaths text={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} workforceId={workforce?.id} />
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/90'>
                      <TextWithFilePaths text={execution.result} workforceId={workforce?.id} />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Deliverables — files written + external actions */}
            {execution.delivery_report && (execution.delivery_report.files.length > 0 || execution.delivery_report.actions.length > 0) && (
              <DeliverablesSummary
                report={execution.delivery_report}
                workforceId={workforce?.id ?? ''}
              />
            )}

            {/* Error */}
            {execution.status === 'failed' && execution.error_message && (
              <div className='rounded-xl border border-red-500/30 bg-red-500/5 p-4'>
                <div className='mb-2 flex items-center gap-2'>
                  <span className='text-base'>❌</span>
                  <span className='text-xs font-semibold uppercase tracking-wider text-red-400'>Error</span>
                </div>
                <pre className='whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-red-400/90'>{execution.error_message}</pre>
              </div>
            )}

            {/* Team Discussion (P1) — shown when discussion messages exist or planning in progress */}
            {(discussionMessages.length > 0 || execution.status === 'planning') && (
              <DiscussionPanel
                agents={orderedAgents}
                discussionMessages={discussionMessages}
                isPlanning={execution.status === 'planning'}
                leaderAgentId={workforce?.leader_agent_id}
              />
            )}

            {/* Strategy Session (legacy — old executions without discussion phase) */}
            {discussionMessages.length === 0 &&
              execution.status !== 'planning' &&
              messages.some(m => m.iteration === 0 && m.role === 'assistant' && m.phase !== 'discussion') && (
              <PlanningRoomPanel
                agents={orderedAgents}
                messages={messages}
                isPlanning={false}
              />
            )}

            {/* Peer Exchanges (P2) — shown when agents have consulted each other */}
            <PeerExchangesPanel agents={orderedAgents} messages={messages} />

            {/* Operator interventions */}
            {(() => {
              const operatorMsgs = messages
                .filter((m) => m.role === 'user' && !m.agent_id && m.iteration > 0)
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

              if (operatorMsgs.length === 0) return null;

              return (
                <div className='rounded-xl border border-[#FFBF47]/30 bg-[#FFBF47]/6 p-3'>
                  <div className='mb-2.5 flex items-center gap-2'>
                    <span className='text-sm'>🧭</span>
                    <span className='text-[10px] font-semibold uppercase tracking-wider text-[#FFBF47]'>
                      Operator Interventions
                    </span>
                    <span className='ml-auto text-[10px] text-muted-foreground/55'>
                      {operatorMsgs.length} message{operatorMsgs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className='space-y-2'>
                    {operatorMsgs.map((msg) => (
                      <div key={msg.id} className='rounded-lg border border-[#FFBF47]/20 bg-[#FFBF47]/8 px-3 py-2'>
                        <div className='mb-1 flex items-center justify-between text-[10px]'>
                          <span className='font-semibold text-[#FFBF47]'>You</span>
                          <span className='text-muted-foreground/50'>{timeAgo(msg.created_at)}</span>
                        </div>
                        <p className='whitespace-pre-wrap text-sm leading-relaxed text-[#FFBF47]/90'>{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Agent threads */}
            {orderedAgents.map((agent) => {
              const subtask = (execution.plan || []).find((s) => s.agent_id === agent.id);
              const isActiveAgent = isRunning && subtask?.status === 'running';
              return (
                <AgentThread
                  key={agent.id}
                  ref={(el) => {
                    if (el) agentThreadRefs.current.set(agent.id, el);
                    else agentThreadRefs.current.delete(agent.id);
                  }}
                  agent={agent}
                  messages={messages}
                  isExpanded={expandedAgents.has(agent.id)}
                  isActive={isActiveAgent}
                  activityHint={agentActivityById[agent.id]}
                  subtask={subtask}
                  onToggle={() => toggleAgent(agent.id)}
                />
              );
            })}

            {/* Empty state */}
            {messages.length === 0 && (
              <div className='flex flex-col items-center justify-center gap-4 py-12'>
                {isRunning ? (
                  <>
                    <div className='relative'>
                      <div className='h-14 w-14 animate-spin rounded-full border-2 border-[#9A66FF]/20 border-t-[#9A66FF]' />
                      <div className='absolute inset-0 flex items-center justify-center'>
                        <span className='text-xl'>{orderedAgents[0]?.icon || '⚡'}</span>
                      </div>
                    </div>
                    <p className='text-sm text-muted-foreground/70'>Agents are initializing the mission…</p>
                  </>
                ) : (
                  <p className='text-sm text-muted-foreground/50'>No messages recorded for this execution.</p>
                )}
              </div>
            )}

            {/* Working indicator */}
            {isRunning && messages.length > 0 && (
              <div className='flex items-center justify-center gap-2 py-2 text-[11px] text-[#9A66FF]/70'>
                <IconLoader2 className='h-3 w-3 animate-spin' />
                {runningActivityText || 'Agents are working…'}
                <ThinkingDots color='#9A66FF' />
              </div>
            )}

            {/* Leader Review (P3) — shown after execution completes */}
            {execution.status === 'completed' && (
              <ReviewPanel
                agents={orderedAgents}
                messages={reviewMessages}
                leaderAgentId={workforce?.leader_agent_id}
                workforceId={workforce?.id}
              />
            )}

            {/* Execution Chat — ask questions or send instructions to agents */}
            <div className='rounded-xl border border-border/30 bg-background/30 overflow-hidden flex flex-col'>
              <div className='flex items-center gap-2 border-b border-border/30 px-4 py-2.5 shrink-0'>
                <IconMessageQuestion className='h-3.5 w-3.5 text-[#14FFF7]' />
                <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Agent Chat</span>
                <span className='ml-auto text-[10px] text-muted-foreground/40'>
                  {execution.status === 'halted' ? 'Send instructions to resume' : execution.status === 'running' ? 'Running — intervene anytime' : 'Ask or instruct'}
                </span>
              </div>

              {/* Message thread */}
              <div className='flex flex-col gap-3 p-3 max-h-96 overflow-y-auto'>
                {chatEntries.length === 0 && (
                  <p className='text-center text-[10px] text-muted-foreground/30 py-4'>
                    Ask anything about this execution, or send instructions to the agents.
                  </p>
                )}
                {chatEntries.map((entry) => (
                  <div key={entry.id} className='flex flex-col gap-2'>
                    {/* User message */}
                    <div className='flex justify-end'>
                      <div className='max-w-[80%] rounded-2xl rounded-tr-sm bg-[#9A66FF]/20 border border-[#9A66FF]/20 px-3 py-2'>
                        <p className='text-xs text-foreground/90 leading-relaxed'>{entry.input}</p>
                      </div>
                    </div>
                    {/* Response */}
                    {entry.kind === 'answer' && (
                      <div className='flex justify-start'>
                        <div className='max-w-[85%] rounded-2xl rounded-tl-sm bg-[#14FFF7]/5 border border-[#14FFF7]/15 px-3 py-2'>
                          <p className='whitespace-pre-wrap text-xs text-foreground/75 leading-relaxed'>{entry.answer}</p>
                        </div>
                      </div>
                    )}
                    {entry.kind === 'action' && (
                      <div className='flex justify-start'>
                        {entry.loading ? (
                          <div className='flex items-center gap-2 text-xs text-muted-foreground/50'>
                            <IconLoader2 className='h-3 w-3 animate-spin' />
                            <span>Sending to agents…</span>
                          </div>
                        ) : entry.error ? (
                          <div className='rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400'>{entry.error}</div>
                        ) : entry.action ? (
                          <div className='rounded-xl border border-[#9A66FF]/25 bg-[#9A66FF]/8 px-3 py-2 flex items-start gap-2'>
                            <IconBolt className='h-3.5 w-3.5 text-[#9A66FF] mt-0.5 shrink-0' />
                            <div className='flex flex-col gap-1'>
                              <p className='text-xs text-[#9A66FF] font-medium'>
                                {entry.action.type === 'resumed' ? 'Execution resumed' : entry.action.type === 'new_execution' ? 'New execution started' : 'Message delivered'}
                              </p>
                              <p className='text-[11px] text-muted-foreground/60'>{entry.action.message}</p>
                              {entry.action.execution_id && entry.action.type === 'new_execution' && (
                                <a
                                  href={`/dashboard/executions/${entry.action.execution_id}`}
                                  className='mt-0.5 inline-flex items-center gap-1 text-[10px] text-[#9A66FF]/70 hover:text-[#9A66FF] transition-colors'
                                >
                                  <IconExternalLink className='h-2.5 w-2.5' />
                                  View new execution
                                </a>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className='border-t border-border/30 p-3 flex flex-col gap-2 shrink-0'>
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat('ask'); } }}
                  placeholder='Ask a question or give an instruction…'
                  className='min-h-[56px] resize-none text-xs bg-background/40 border-border/40 focus:border-[#9A66FF]/40'
                  disabled={chatLoading}
                />
                <div className='flex gap-2'>
                  <button
                    onClick={() => handleChat('ask')}
                    disabled={chatLoading || !chatInput.trim()}
                    className='flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#14FFF7]/30 bg-[#14FFF7]/8 text-[#14FFF7] text-[11px] font-medium hover:bg-[#14FFF7]/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  >
                    <IconMessageQuestion className='h-3 w-3' />
                    Ask
                  </button>
                  <button
                    onClick={() => handleChat('instruct')}
                    disabled={chatLoading || !chatInput.trim()}
                    className='flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg border border-[#9A66FF]/30 bg-[#9A66FF]/10 text-[#9A66FF] text-[11px] font-medium hover:bg-[#9A66FF]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  >
                    {chatLoading ? <IconLoader2 className='h-3 w-3 animate-spin' /> : <IconRobot className='h-3 w-3' />}
                    Send to agents
                  </button>
                </div>
              </div>
            </div>

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ─── Col 3: Operations Panel (right) ─── */}
        <div className='flex w-80 shrink-0 flex-col overflow-hidden border-l border-border/50'>

          {/* Approval card */}
          {execution.status === 'awaiting_approval' && (
            <div className='shrink-0 border-b border-border/50'>
              <div className='p-4 space-y-3'>
                {/* needs_help */}
                {hasNeedsHelp && (
                  <div className='flex items-center gap-2 rounded-lg border border-[#FFBF47]/40 bg-[#FFBF47]/10 px-3 py-2'>
                    <span className='animate-pulse text-sm'>🙋</span>
                    <span className='text-xs text-[#FFBF47]'>An agent needs your input.</span>
                  </div>
                )}
                <div className='flex items-start gap-2.5'>
                  <span className='mt-0.5 text-base animate-pulse'>🔐</span>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-semibold text-[#FFBF47] leading-snug'>
                      {execution.pending_approval?.title || 'Awaiting your approval'}
                    </p>
                    <p className='mt-0.5 text-xs text-muted-foreground/65 leading-relaxed'>
                      {execution.pending_approval?.description || 'Review the proposed plan and strategy, then approve or reject.'}
                    </p>
                  </div>
                </div>
                {execution.strategy && (
                  <div className='flex items-center gap-1.5'>
                    <button
                      type='button'
                      onClick={() => setStrategyOpen(v => !v)}
                      className='flex-1 flex items-center justify-between rounded-lg border border-[#FFBF47]/30 bg-[#FFBF47]/5 px-3 py-2 text-[11px] font-medium text-[#FFBF47] hover:bg-[#FFBF47]/10 transition-colors'
                    >
                      <span>{strategyOpen ? 'Hide strategy' : 'View strategy'}</span>
                      {strategyOpen ? <IconChevronDown className='h-3 w-3' /> : <IconChevronRight className='h-3 w-3' />}
                    </button>
                    <button
                      type='button'
                      onClick={() => setStrategyDialogOpen(true)}
                      title='Expand plan'
                      className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FFBF47]/30 bg-[#FFBF47]/5 text-[#FFBF47] hover:bg-[#FFBF47]/10 transition-colors'
                    >
                      <IconArrowsMaximize className='h-3.5 w-3.5' />
                    </button>
                  </div>
                )}
              </div>
              {strategyOpen && (
                <div className='max-h-[45vh] overflow-y-auto border-t border-[#FFBF47]/20'>
                  <PlanningRoomPanel agents={orderedAgents} messages={messages} isPlanning={false} />
                </div>
              )}
            </div>
          )}

          {/* Running — needs help: expandable credential injector */}
          {hasNeedsHelp && isRunning && execution.status !== 'awaiting_approval' && (
            <div className='shrink-0 border-b border-border/50'>
              <button
                type='button'
                className='w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#FFBF47]/5 transition-colors'
                onClick={() => {
                  const next = !credPanelOpen;
                  setCredPanelOpen(next);
                  if (next && detectedCred) {
                    setCredService(detectedCred.service);
                    setCredKey(detectedCred.key);
                  }
                }}
              >
                <div className='flex items-center gap-2'>
                  <span className='animate-pulse text-sm'>🙋</span>
                  <span className='text-xs text-[#FFBF47]'>
                    {detectedCred
                      ? `Agent requested ${detectedCred.key}`
                      : needsHelpReason
                        ? 'Agent is waiting for a credential'
                        : 'Agent needs credentials to continue'}
                  </span>
                </div>
                <span className='font-mono text-[9px] text-[#FFBF47]/70'>
                  {credPanelOpen ? 'hide ↑' : 'add ↓'}
                </span>
              </button>
              {credPanelOpen && (
                <div className='border-t border-[#FFBF47]/20 bg-[#FFBF47]/[0.03] px-4 py-3 space-y-2.5'>
                  {needsHelpReason && (
                    <div className='rounded-md border border-[#FFBF47]/25 bg-[#FFBF47]/5 px-2.5 py-2'>
                      <p className='font-mono text-[9px] uppercase tracking-wider text-[#FFBF47]/70'>Agent request</p>
                      <p className='mt-1 text-[11px] leading-relaxed text-[#EAEAEA]/80'>{needsHelpReason}</p>
                    </div>
                  )}
                  <div className='grid grid-cols-2 gap-2'>
                    <div className='space-y-1'>
                      <p className='font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50'>Service</p>
                      <Input
                        value={credService}
                        onChange={(e) => setCredService(e.target.value)}
                        placeholder={detectedCred?.service || 'service-name'}
                        className='h-7 font-mono text-xs'
                      />
                    </div>
                    <div className='space-y-1'>
                      <p className='font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50'>Key Name</p>
                      <Input
                        value={credKey}
                        onChange={(e) => setCredKey(e.target.value)}
                        placeholder={detectedCred?.key || 'API_KEY'}
                        className='h-7 font-mono text-xs uppercase'
                      />
                    </div>
                  </div>
                  <div className='space-y-1'>
                    <p className='font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50'>Value</p>
                    <Input
                      type='password'
                      value={credValue}
                      onChange={(e) => setCredValue(e.target.value)}
                      placeholder='ghp_••••••••'
                      className='h-7 font-mono text-xs'
                    />
                  </div>
                  <Button
                    size='sm'
                    className='w-full bg-[#FFBF47] text-[#0A0D11] hover:bg-[#FFBF47]/90'
                    disabled={credSaving || !credKey.trim() || !credValue.trim()}
                    onClick={handleInjectCredential}
                  >
                    {credSaving
                      ? <IconLoader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                      : <IconKey className='mr-1.5 h-3.5 w-3.5' />}
                    {workforce?.id ? 'Store & Resume' : 'Inject & Resume'}
                  </Button>
                  {!workforce?.id && (
                    <p className='text-[10px] text-muted-foreground/40'>No workforce linked — value will be injected as message only, not persisted.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Input / Action area (scrollable, fills available space) */}
          <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>

            {/* Textarea + buttons */}
            {isActive && (
              <div className='border-b border-border/50 p-4 space-y-3 shrink-0'>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    execution.status === 'awaiting_approval'
                      ? 'Add context or instructions, then approve…'
                      : execution.status === 'running'
                      ? 'Redirect agents, provide info, correct course…'
                      : 'Send feedback…'
                  }
                  rows={5}
                  className='resize-none text-sm'
                />
                {interveneStatus === 'ok' && (
                  <p className='flex items-center gap-1.5 text-[11px] text-[#56D090]'>
                    <IconCheck className='h-3 w-3' />
                    Message injected — agents will receive it on the next turn.
                  </p>
                )}
                {interveneStatus === 'err' && (
                  <p className='text-[11px] text-red-400'>✗ {interveneErrMsg || 'Could not reach the execution.'}</p>
                )}
                <div className='flex flex-col gap-1.5'>
                  {execution.status === 'awaiting_approval' ? (
                    <>
                      <Button size='sm' onClick={() => handleApprove(feedback.trim().length > 0)} disabled={sending}
                        className='w-full bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'>
                        {sending ? <IconLoader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <IconCheck className='mr-1.5 h-3.5 w-3.5' />}
                        Approve
                      </Button>
                      <Button size='sm' variant='outline' onClick={handleReject} disabled={sending} className='w-full text-red-400 border-red-500/30 hover:bg-red-500/10'>
                        <IconX className='mr-1.5 h-3.5 w-3.5' />
                        Reject
                      </Button>
                    </>
                  ) : execution.status === 'running' ? (
                    <>
                      <Button size='sm' onClick={handleIntervene} disabled={intervening || !feedback.trim()}
                        className='w-full bg-[#FFBF47] text-[#0A0D11] hover:bg-[#FFBF47]/90'>
                        {intervening ? <IconLoader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <IconSend className='mr-1.5 h-3.5 w-3.5' />}
                        Intervene
                      </Button>
                      <Button size='sm' variant='outline' onClick={handleHalt}
                        className='w-full border-red-500/30 text-red-400 hover:bg-red-500/10'>
                        <IconHandStop className='mr-1.5 h-3.5 w-3.5' />
                        Halt
                      </Button>
                    </>
                  ) : (
                    <Button size='sm' onClick={() => handleApprove(true)} disabled={sending || !feedback.trim()}
                      className='w-full bg-[#9A66FF] hover:bg-[#9A66FF]/90'>
                      {sending ? <IconLoader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' /> : <IconSend className='mr-1.5 h-3.5 w-3.5' />}
                      Send
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Execution Info (compact) */}
            <div className='border-b border-border/50 px-4 py-2.5 space-y-2 shrink-0'>
              <div className='flex items-center justify-between'>
                <p className='text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60'>Execution Info</p>
                <button
                  onClick={() => { setMetaTitle(execution.title || ''); setMetaDescription(execution.description || ''); setMetaImageUrl(execution.image_url || ''); setMetaEditOpen(v => !v); }}
                  className='text-[9px] text-muted-foreground/40 hover:text-foreground transition-colors'>
                  {metaEditOpen ? 'Cancel' : 'Edit'}
                </button>
              </div>
              {metaEditOpen ? (
                <div className='space-y-1.5'>
                  <AvatarUpload currentUrl={metaImageUrl} size='sm' onUploaded={(url) => setMetaImageUrl(url)} />
                  <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder='Title' className='h-7 text-xs' />
                  <Input value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder='Description' className='h-7 text-xs' />
                  <Button size='sm' className='w-full h-7 text-xs bg-[#9A66FF] hover:bg-[#9A66FF]/90' onClick={handleSaveMeta} disabled={metaSaving}>
                    {metaSaving ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Save'}
                  </Button>
                </div>
              ) : (
                <div className='flex items-center gap-2'>
                  {execution.image_url && (
                    <img src={resolveImg(execution.image_url)} alt='' className='h-7 w-7 rounded-md object-cover shrink-0' />
                  )}
                  <div className='min-w-0 flex-1'>
                    <p className='text-[11px] font-medium truncate text-foreground/80'>{execution.title || <span className='text-muted-foreground/35 italic'>No title</span>}</p>
                    <p className='text-[9px] text-muted-foreground/40 truncate'>{execution.description || 'No description'}</p>
                    <p className='text-[9px] font-mono text-muted-foreground/25 truncate'>{execution.id.slice(0, 8)}…</p>
                  </div>
                </div>
              )}
            </div>

            {/* Inputs */}
            {execution.inputs && Object.keys(execution.inputs).length > 0 && (
              <div className='border-b border-border/50 p-4 space-y-2 shrink-0'>
                <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>Inputs</p>
                {Object.entries(execution.inputs).map(([k, v]) => (
                  <div key={k}>
                    <p className='text-[10px] text-muted-foreground/55'>{k}</p>
                    <p className='text-xs text-foreground/70 break-words'>{v}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Workspace Files */}
            {workforce?.id && touchedFiles.length > 0 && (
              <div className='border-b border-border/50 shrink-0'>
                <button
                  type='button'
                  onClick={() => setWsFilesOpen(v => !v)}
                  className='w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors'
                >
                  <span className='flex items-center gap-1.5'>
                    <IconFolder className='h-3 w-3' />
                    Files Used
                    <span className='ml-1 rounded-full bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground/60'>
                      {touchedFiles.length}
                    </span>
                  </span>
                  <IconChevronDown className={`h-3 w-3 transition-transform ${wsFilesOpen ? 'rotate-180' : ''}`} />
                </button>
                {wsFilesOpen && (
                  <div className='px-3 pb-3 space-y-0.5 max-h-52 overflow-y-auto'>
                    {touchedFiles.map((f) => {
                      const opColors: Record<string, string> = {
                        wrote: '#56D090', appended: '#56D090', deleted: '#FF6B6B',
                        moved: '#14FFF7', copied: '#14FFF7', read: '#EAEAEA',
                      };
                      const opColor = opColors[f.op] ?? '#EAEAEA';
                      return (
                        <div key={f.path} className='flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted/20'>
                          <IconFile className='h-3 w-3 shrink-0 text-muted-foreground/40' />
                          <WorkspaceFilePath relPath={f.path} workforceId={workforce.id} />
                          <span
                            className='ml-auto text-[9px] font-mono shrink-0 opacity-60'
                            style={{ color: opColor }}
                          >
                            {f.op}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className='p-4 space-y-2 mt-auto'>
              <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40'>Actions</p>
              {isRunning && (
                <Button variant='outline' size='sm' className='w-full border-[#FFBF47]/30 text-[#FFBF47] hover:bg-[#FFBF47]/10' onClick={handleHalt}>
                  <IconHandStop className='mr-1.5 h-3.5 w-3.5' />
                  Halt Execution
                </Button>
              )}
              {execution?.status === 'halted' && (
                <Button variant='outline' size='sm' className='w-full border-[#56D090]/30 text-[#56D090] hover:bg-[#56D090]/10' onClick={handleResume}>
                  <IconPlayerPlay className='mr-1.5 h-3.5 w-3.5' />
                  Resume Execution
                </Button>
              )}
              <Button variant='ghost' size='sm' className='w-full text-muted-foreground/50 hover:text-foreground'
                onClick={() => router.push('/dashboard/executions')}>
                <IconArrowLeft className='mr-1.5 h-3.5 w-3.5' />
                Back to Executions
              </Button>
            </div>

          </div>
        </div>

      </div>
    </div>

    {/* ── Strategy / Plan full-screen dialog ── */}

    <Dialog open={strategyDialogOpen} onOpenChange={setStrategyDialogOpen}>
      <DialogContent className='max-w-2xl max-h-[85vh] flex flex-col'>
        <DialogHeader className='shrink-0'>
          <DialogTitle className='text-[#FFBF47]'>Proposed Execution Plan</DialogTitle>
        </DialogHeader>
        <div className='overflow-y-auto flex-1 min-h-0 space-y-4 pr-1'>
          {execution?.strategy && (() => {
            const planSteps = parsePlanStepsFromStrategy(execution.strategy);
            if (planSteps && planSteps.length > 0) {
              return (
                <div className='space-y-3'>
                  {planSteps.map((step, i) => {
                    const stepId = step.id ?? i + 1;
                    const agentName = typeof step.agent_name === 'string' ? step.agent_name : 'Agent';
                    const dependsOn = Array.isArray(step.depends_on)
                      ? step.depends_on.map((dep) => String(dep))
                      : [];
                    const subtask =
                      typeof step.subtask === 'string'
                        ? step.subtask
                        : typeof step.task === 'string'
                          ? step.task
                          : 'No subtask details provided.';

                    return (
                      <div key={String(stepId)} className='flex gap-3 rounded-lg border border-border/40 bg-muted/10 p-3'>
                        <span className='mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9A66FF]/20 font-mono text-[10px] font-bold text-[#9A66FF]'>
                          {String(stepId)}
                        </span>
                        <div className='min-w-0 flex-1 space-y-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-mono text-xs font-semibold text-[#14FFF7]'>{agentName}</span>
                            {dependsOn.length > 0 && (
                              <span className='rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60'>
                                after {dependsOn.join(', ')}
                              </span>
                            )}
                          </div>
                          <p className='text-sm leading-relaxed text-[#EAEAEA]/80'>{subtask}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            const leaderName = orderedAgents.find((a) => a.id === workforce?.leader_agent_id)?.name || 'Team lead';
            const oneLineSummary = summarizeStrategyForDisplay(execution.strategy, leaderName);
            return (
              <div className='rounded-lg border border-border/40 bg-muted/10 p-4'>
                <p className='mb-2 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40'>Strategy Summary</p>
                <p className='text-sm leading-relaxed text-[#EAEAEA]/80'>{oneLineSummary}</p>
              </div>
            );
          })()}
          <div className='border-t border-border/30 pt-3'>
            <p className='mb-2 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40'>Planning Discussion</p>
            <PlanningRoomPanel agents={orderedAgents} messages={messages} isPlanning={false} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
