'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHandStop,
  IconKey,
  IconLoader2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
  IconSend,
  IconTool,
  IconX
} from '@tabler/icons-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import api, { Agent, Execution, ExecutionEvent, ExecutionQA, ExecutionSubtask, Message, ToolCallRecord, Workforce } from '@/lib/api';
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
};

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
                const cleanContent = msg.content
                  .replace(/```json\n[\s\S]*?\n```/g, '')
                  .replace(/```[\s\S]*?```/g, '[plan]')
                  .trim();
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
                        {cleanContent || '(synthesizing plan…)'}
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

function ReviewPanel({ agents, messages, leaderAgentId }: { agents: Agent[]; messages: Message[]; leaderAgentId?: string }) {
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
            <p className='text-[12px] leading-relaxed text-[#EAEAEA]/80'>{summary}</p>
          )}
          {highlights.length > 0 && (
            <div className='space-y-1'>
              <p className='text-[10px] font-semibold text-[#56D090]/70 uppercase tracking-wider'>Strengths</p>
              {highlights.map((h, i) => (
                <div key={i} className='flex items-start gap-2 text-[11px] text-[#EAEAEA]/65'>
                  <span className='mt-0.5 text-[#56D090]'>+</span>{h}
                </div>
              ))}
            </div>
          )}
          {issues.length > 0 && (
            <div className='space-y-1'>
              <p className='text-[10px] font-semibold text-[#FFBF47]/70 uppercase tracking-wider'>Issues</p>
              {issues.map((issue, i) => (
                <div key={i} className='flex items-start gap-2 text-[11px] text-[#EAEAEA]/65'>
                  <span className='mt-0.5 text-[#FFBF47]'>!</span>{issue}
                </div>
              ))}
            </div>
          )}
          {!summary && !highlights.length && !issues.length && (
            <p className='text-[11px] text-muted-foreground/50 whitespace-pre-wrap'>{leaderResponse.content}</p>
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
                    {msg.content}
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
  timestamp: Date;
  isNew?: boolean;
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
  subtask?: ExecutionSubtask;
  onToggle: () => void;
}

// ── Smart message content renderer ───────────────────────────────────────────
// Detects JSON plan blobs and renders them as a readable plan list instead of
// dumping raw JSON at the user.
function MessageContent({ content, dim = false }: { content: string; dim?: boolean }) {
  const planSteps = useMemo(() => {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(content.slice(start, end + 1));
      if (Array.isArray(parsed?.plan) && parsed.plan.length > 0) return parsed.plan as any[];
    } catch { /* not valid JSON */ }
    return null;
  }, [content]);

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
function AgentThread({ agent, messages, isExpanded, isActive, subtask, onToggle }, ref) {
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
            {isActive && <span className='flex items-center gap-1 text-[10px] text-[#9A66FF]'><span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#9A66FF]' />working</span>}
          </div>
          {lastMsg && !isExpanded && (
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
              {isActive ? 'Generating response…' : 'No messages yet.'}
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

  // Q&A
  const [qaItems, setQaItems] = useState<ExecutionQA[]>([]);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaLoading, setQaLoading] = useState(false);

  // Metadata editing
  const [metaEditOpen, setMetaEditOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaImageUrl, setMetaImageUrl] = useState('');
  const [metaSaving, setMetaSaving] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [objOpen, setObjOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgContainerRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const agentThreadRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scan recent messages to auto-detect what credential the blocked agent needs.
  // Must stay above early returns to satisfy Rules of Hooks.
  const detectedCred = useMemo(() => {
    const needsHelp = execution?.plan?.some(s => s.status === 'needs_help');
    if (!needsHelp) return null;
    const recent = messages.slice(-12);
    for (let i = recent.length - 1; i >= 0; i--) {
      const content = recent[i].content;
      const envMatch = content.match(/\b([A-Z][A-Z0-9]{1,}_(?:TOKEN|KEY|SECRET|API_KEY|ACCESS_TOKEN|PAT|PASSWORD))\b/);
      if (envMatch) {
        const key = envMatch[1];
        return { service: key.toLowerCase().split('_')[0], key };
      }
      if (/github/i.test(content))    return { service: 'github',    key: 'GITHUB_TOKEN' };
      if (/openai/i.test(content))    return { service: 'openai',    key: 'OPENAI_API_KEY' };
      if (/anthropic/i.test(content)) return { service: 'anthropic', key: 'ANTHROPIC_API_KEY' };
      if (/stripe/i.test(content))    return { service: 'stripe',    key: 'STRIPE_SECRET_KEY' };
      if (/aws/i.test(content))       return { service: 'aws',       key: 'AWS_ACCESS_KEY_ID' };
      if (/docker/i.test(content))    return { service: 'docker',    key: 'DOCKER_TOKEN' };
    }
    return null;
  }, [execution?.plan, messages]);

  const loadData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);

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

      if (qaResult.status === 'fulfilled')
        setQaItems(qaResult.value.data || []);

      if (evResult.status === 'fulfilled') {
        const historical: LiveEvent[] = (evResult.value.data || []).map((e: ExecutionEvent) => ({
          id: e.id,
          type: e.type,
          agent_name: e.agent_name || undefined,
          content: e.message,
          timestamp: new Date(e.timestamp),
          isNew: false,
        }));
        setLiveEvents(historical);
      }

      if (agResult.status === 'fulfilled') {
        const map: Record<string, Agent> = {};
        for (const a of agResult.value.data || []) map[a.id] = a;
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
          if (['agent_thinking', 'iteration_done', 'system'].includes(data.type)) return;
          const evt: LiveEvent = {
            id: data.id || Math.random().toString(36).slice(2),
            type: data.type || 'event',
            agent_name: data.agent_name,
            content: data.message || data.content || JSON.stringify(data),
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

  async function handleIntervene() {
    if (!execution || !feedback.trim()) return;
    setIntervening(true);
    setInterveneStatus('idle');
    setInterveneErrMsg('');
    try {
      await api.interveneExecution(execution.id, feedback.trim());
      setFeedback('');
      setInterveneStatus('ok');
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
      if (workforce?.id && credService.trim()) {
        await api.upsertCredential(workforce.id, {
          service: credService.trim().toLowerCase(),
          key_name: credKey.trim(),
          value: credValue.trim()
        });
      }
      const msg = workforce?.id
        ? `Credential stored: ${credKey.trim()} is now available via list_secrets (service: ${credService.trim() || credKey.trim()}). Please retry the blocked operation.`
        : `Here is the credential you need — ${credKey.trim()}: ${credValue.trim()}. Please retry the blocked operation.`;
      await api.interveneExecution(execution.id, msg);
      setCredPanelOpen(false);
      setCredValue('');
      setInterveneStatus('ok');
    } catch (err: any) {
      setInterveneStatus('err');
      setInterveneErrMsg(err?.message || 'Failed to store credential');
    } finally {
      setCredSaving(false);
    }
  }

  async function handleAskQA() {
    if (!qaQuestion.trim() || qaLoading) return;
    setQaLoading(true);
    try {
      const res = await api.askExecutionQA(execId, qaQuestion.trim());
      if (res.data) {
        setQaItems(prev => [...prev, res.data]);
        setQaQuestion('');
      }
    } catch (err) {
      console.error('QA failed:', err);
    } finally {
      setQaLoading(false);
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
              <h1 className='text-sm font-semibold'>
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
          <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            {(() => {
              const mt = messages.reduce((s, m) => s + (m.tokens_input || 0) + (m.tokens_output || 0), 0);
              const dt = execution.tokens_used > 0 ? execution.tokens_used : mt;
              const mi = messages.length > 0 ? Math.max(...messages.map(m => m.iteration || 0)) : 0;
              const di = execution.iterations > 0 ? execution.iterations : mi;
              return (<><span>{formatTokens(dt)} tokens</span><span className='text-border'>·</span><span>{di} iter{di !== 1 ? 's' : ''}</span></>);
            })()}
            {execution.elapsed_s > 0 && (
              <><span className='text-border'>·</span>
              <span>{execution.elapsed_s >= 60 ? `${(execution.elapsed_s / 60).toFixed(1)}m` : `${execution.elapsed_s}s`}</span></>
            )}
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
                    const evCfg = eventTypeConfig[ev.type];
                    const dot = evCfg?.dot || '#6B7280';
                    const label = evCfg?.label || ev.type.replace(/_/g, ' ');
                    return (
                      <div
                        key={ev.id}
                        className='flow-event-enter rounded-md border border-border/20 bg-background/30 p-2'
                        style={{ borderLeftColor: dot + '60', borderLeftWidth: 2 }}
                      >
                        <div className='flex items-center gap-1.5 mb-0.5'>
                          <span className='h-1.5 w-1.5 rounded-full shrink-0' style={{ backgroundColor: dot }} />
                          <span className='text-[10px] font-semibold truncate' style={{ color: dot }}>
                            {ev.agent_name ? `${ev.agent_name} · ` : ''}{label}
                          </span>
                          <span className='ml-auto shrink-0 text-[9px] text-muted-foreground/35'>
                            {ev.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <p className='break-words text-[10px] leading-relaxed text-muted-foreground/65 line-clamp-3'>{ev.content}</p>
                      </div>
                    );
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
            {execution.status === 'completed' && execution.result && (
              <div className='rounded-xl border border-[#56D090]/30 bg-[#56D090]/5 p-4'>
                <div className='mb-2 flex items-center gap-2'>
                  <span className='text-base'>✅</span>
                  <span className='text-xs font-semibold uppercase tracking-wider text-[#56D090]'>Final Result</span>
                </div>
                <div className='whitespace-pre-wrap break-words text-sm leading-relaxed text-[#EAEAEA]/90'>{execution.result}</div>
              </div>
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

            {/* Interleaved: operator messages + per-agent threads, sorted by time */}
            {(() => {
              const operatorMsgs = messages.filter(m => m.role === 'user' && !m.agent_id && m.iteration > 0);
              type Item = { type: 'op'; msg: typeof operatorMsgs[0] } | { type: 'thread'; agentId: string };
              const items: Item[] = [];
              orderedAgents.forEach(a => items.push({ type: 'thread', agentId: a.id }));
              operatorMsgs.forEach(m => items.push({ type: 'op', msg: m }));
              items.sort((a, b) => {
                const ta = a.type === 'op' ? new Date(a.msg.created_at).getTime() : 0;
                const tb = b.type === 'op' ? new Date(b.msg.created_at).getTime() : 0;
                if (a.type === 'thread' && b.type === 'thread') return 0;
                if (a.type === 'thread') return -1;
                if (b.type === 'thread') return 1;
                return ta - tb;
              });
              return items.map((item, i) => {
                if (item.type === 'op') {
                  return (
                    <div key={item.msg.id} className='flex items-start gap-3 justify-end'>
                      <div className='max-w-[85%]'>
                        <div className='mb-1 flex items-center justify-end gap-1.5'>
                          <span className='text-[10px] text-muted-foreground/50'>{timeAgo(item.msg.created_at)}</span>
                          <span className='text-[11px] font-semibold text-[#FFBF47]'>You</span>
                        </div>
                        <div className='rounded-xl rounded-tr-sm border border-[#FFBF47]/30 bg-[#FFBF47]/10 px-4 py-2.5'>
                          <p className='whitespace-pre-wrap text-sm leading-relaxed text-[#FFBF47]/90'>{item.msg.content}</p>
                        </div>
                      </div>
                      <div className='mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FFBF47]/20 text-sm'>
                        👤
                      </div>
                    </div>
                  );
                }
                const agent = orderedAgents.find(a => a.id === item.agentId)!;
                const subtask = (execution.plan || []).find(s => s.agent_id === agent.id);
                const isActiveAgent = isRunning && subtask?.status === 'running';
                return (
                  <AgentThread
                    key={agent.id}
                    ref={(el) => { if (el) agentThreadRefs.current.set(agent.id, el); else agentThreadRefs.current.delete(agent.id); }}
                    agent={agent}
                    messages={messages}
                    isExpanded={expandedAgents.has(agent.id)}
                    isActive={isActiveAgent}
                    subtask={subtask}
                    onToggle={() => toggleAgent(agent.id)}
                  />
                );
              });
            })()}

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
                Agents are working…
                <ThinkingDots color='#9A66FF' />
              </div>
            )}

            {/* Leader Review (P3) — shown after execution completes */}
            {execution.status === 'completed' && (
              <ReviewPanel
                agents={orderedAgents}
                messages={reviewMessages}
                leaderAgentId={workforce?.leader_agent_id}
              />
            )}

            {/* Post-execution Q&A — ask anything about what happened */}
            {execution.status === 'completed' && (
              <div className='rounded-xl border border-[#14FFF7]/20 bg-[#14FFF7]/5 overflow-hidden'>
                <div className='flex items-center gap-2 border-b border-border/30 px-4 py-2.5'>
                  <IconMessageQuestion className='h-3.5 w-3.5 text-[#14FFF7]' />
                  <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>Ask about this execution</span>
                  {qaItems.length > 0 && (
                    <span className='ml-auto text-[10px] text-muted-foreground/40'>{qaItems.length} question{qaItems.length !== 1 ? 's' : ''}</span>
                  )}
                </div>

                {/* Existing Q&A pairs */}
                {qaItems.length > 0 && (
                  <div className='divide-y divide-border/20'>
                    {qaItems.map((qa) => (
                      <div key={qa.id} className='px-4 py-3 space-y-2'>
                        <div className='flex items-start gap-2'>
                          <span className='mt-0.5 text-[10px] font-semibold text-[#FFBF47] shrink-0'>Q</span>
                          <p className='text-xs text-foreground/80 leading-relaxed'>{qa.question}</p>
                        </div>
                        <div className='flex items-start gap-2'>
                          <span className='mt-0.5 text-[10px] font-semibold text-[#14FFF7] shrink-0'>A</span>
                          <p className='whitespace-pre-wrap text-xs text-foreground/70 leading-relaxed'>{qa.answer}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input */}
                <div className='p-3 flex gap-2'>
                  <Textarea
                    value={qaQuestion}
                    onChange={(e) => setQaQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAskQA(); } }}
                    placeholder='Ask anything about what happened in this execution…'
                    className='min-h-[60px] resize-none text-xs bg-background/40 border-border/40 focus:border-[#14FFF7]/40'
                    disabled={qaLoading}
                  />
                  <button
                    onClick={handleAskQA}
                    disabled={qaLoading || !qaQuestion.trim()}
                    className='shrink-0 flex items-center justify-center h-9 w-9 self-end rounded-lg border border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[#14FFF7] hover:bg-[#14FFF7]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
                  >
                    {qaLoading
                      ? <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
                      : <IconSend className='h-3.5 w-3.5' />
                    }
                  </button>
                </div>
              </div>
            )}

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
                    {detectedCred ? `Agent needs ${detectedCred.key}` : 'Agent needs credentials to continue'}
                  </span>
                </div>
                <span className='font-mono text-[9px] text-[#FFBF47]/70'>
                  {credPanelOpen ? 'hide ↑' : 'add ↓'}
                </span>
              </button>
              {credPanelOpen && (
                <div className='border-t border-[#FFBF47]/20 bg-[#FFBF47]/[0.03] px-4 py-3 space-y-2.5'>
                  <div className='grid grid-cols-2 gap-2'>
                    <div className='space-y-1'>
                      <p className='font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50'>Service</p>
                      <Input
                        value={credService}
                        onChange={(e) => setCredService(e.target.value)}
                        placeholder='github'
                        className='h-7 font-mono text-xs'
                      />
                    </div>
                    <div className='space-y-1'>
                      <p className='font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50'>Key Name</p>
                      <Input
                        value={credKey}
                        onChange={(e) => setCredKey(e.target.value)}
                        placeholder='GITHUB_TOKEN'
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

            {/* Danger Zone */}
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
            try {
              const parsed = JSON.parse(execution.strategy);
              if (Array.isArray(parsed?.plan)) {
                return (
                  <div className='space-y-3'>
                    {parsed.plan.map((step: any, i: number) => (
                      <div key={step.id ?? i} className='flex gap-3 rounded-lg border border-border/40 bg-muted/10 p-3'>
                        <span className='mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9A66FF]/20 font-mono text-[10px] font-bold text-[#9A66FF]'>
                          {step.id ?? i + 1}
                        </span>
                        <div className='min-w-0 flex-1 space-y-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-mono text-xs font-semibold text-[#14FFF7]'>{step.agent_name}</span>
                            {Array.isArray(step.depends_on) && step.depends_on.length > 0 && (
                              <span className='rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60'>
                                after {step.depends_on.join(', ')}
                              </span>
                            )}
                          </div>
                          <p className='text-sm leading-relaxed text-[#EAEAEA]/80'>{step.subtask}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
            } catch { /* fall through */ }
            return (
              <pre className='whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-muted/10 p-4 font-mono text-xs text-[#EAEAEA]/75'>
                {execution.strategy}
              </pre>
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
