'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'motion/react';
import { IconArrowRight, IconFilter, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import api, { ActivityEvent, Agent } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';

/* ─── Shared helpers (duplicated from overview to keep pages independent) ─── */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function fullTime(date: string): string {
  return new Date(date).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const ACTION_META: Record<string, { label: string; color: string; verb: string }> = {
  'execution.started':   { label: 'Started',   color: '#9A66FF', verb: 'launched a mission' },
  'execution.completed': { label: 'Completed',  color: '#56D090', verb: 'completed a mission' },
  'execution.failed':    { label: 'Failed',     color: '#EF4444', verb: 'mission failed' },
  'execution.halted':    { label: 'Halted',     color: '#FFBF47', verb: 'mission halted' },
  'execution.resumed':   { label: 'Resumed',    color: '#14FFF7', verb: 'resumed a mission' },
  'execution.rejected':  { label: 'Rejected',   color: '#EF4444', verb: 'rejected plan' },
  'approval.approved':   { label: 'Approved',   color: '#56D090', verb: 'approved plan' },
  'approval.rejected':   { label: 'Rejected',   color: '#EF4444', verb: 'rejected plan' },
};

function actionMeta(action: string) {
  return ACTION_META[action] || { label: action, color: '#8892A4', verb: action.replace(/\./g, ' ') };
}

function dayLabel(date: string): string {
  const d     = new Date(date);
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString())  return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ─── Actor avatar ─── */
function ActorAvatar({ evt, agentsMap }: { evt: ActivityEvent; agentsMap: Record<string, Agent> }) {
  if (evt.actor_type === 'agent') {
    const agent = agentsMap[evt.actor_id];
    if (agent) {
      return (
        <EntityAvatar
          icon={agent.icon}
          color={agent.color}
          avatarUrl={agent.avatar_url}
          name={agent.name}
          size='sm'
        />
      );
    }
  }

  if (evt.actor_type === 'user') {
    const initials = evt.actor_name
      ? evt.actor_name.split(/[\s_]/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
      : 'OP';
    return (
      <div
        className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold'
        style={{ background: 'rgba(154,102,255,0.15)', color: '#9A66FF', border: '1px solid rgba(154,102,255,0.3)' }}
      >
        {initials}
      </div>
    );
  }

  // system / orchestrator
  return (
    <div
      className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm'
      style={{ background: 'rgba(20,255,247,0.08)', border: '1px solid rgba(20,255,247,0.2)' }}
    >
      ⚙️
    </div>
  );
}

/* ─── Single activity row ─── */
export function ActivityFeedItem({
  evt,
  agentsMap,
  compact = false,
  idx = 0,
}: {
  evt: ActivityEvent;
  agentsMap: Record<string, Agent>;
  compact?: boolean;
  idx?: number;
}) {
  const router  = useRouter();
  const meta    = actionMeta(evt.action || '');
  const mdTokens   = evt.metadata?.tokens_used as number | undefined;
  const mdIter     = evt.metadata?.iterations  as number | undefined;
  const mdError    = evt.metadata?.error        as string | undefined;
  const mdWfName   = (evt.metadata?.workforce_name || '') as string;
  const mdExecTitle= (evt.metadata?.execution_title || '') as string;
  const hasExec    = !!evt.execution_id;

  const label = mdExecTitle || mdWfName || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      className='group flex items-start gap-3 py-3'
    >
      {/* Avatar */}
      <ActorAvatar evt={evt} agentsMap={agentsMap} />

      {/* Body */}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2 flex-wrap'>
          {/* Actor name */}
          <span className='text-xs font-semibold text-foreground/90'>
            {evt.actor_type === 'system' ? 'Orchestrator' : (evt.actor_name || evt.actor_type)}
          </span>

          {/* Verb */}
          <span className='text-xs text-muted-foreground/60'>{meta.verb}</span>

          {/* Action pill */}
          <span
            className='rounded-full border px-2 py-0.5 text-[10px] font-semibold'
            style={{
              color: meta.color,
              borderColor: meta.color + '35',
              backgroundColor: meta.color + '12',
            }}
          >
            {meta.label}
          </span>

          {/* Time */}
          <span className='ml-auto shrink-0 text-[10px] text-muted-foreground/40' title={fullTime(evt.created_at)}>
            {timeAgo(evt.created_at)}
          </span>
        </div>

        {/* Context label (execution title or workforce name) */}
        {label && (
          <p
            className={`mt-0.5 text-[11px] font-medium truncate ${hasExec ? 'cursor-pointer hover:underline' : ''}`}
            style={{ color: meta.color + 'CC' }}
            onClick={hasExec ? () => router.push(`/dashboard/executions/${evt.execution_id}`) : undefined}
          >
            {label}
            {hasExec && <IconArrowRight className='inline h-2.5 w-2.5 ml-0.5 mb-0.5' />}
          </p>
        )}

        {/* Summary */}
        {!compact && evt.summary && evt.summary !== evt.action && (
          <p className='mt-1 text-[11px] leading-relaxed text-muted-foreground/60 line-clamp-2'>
            {evt.summary}
          </p>
        )}

        {/* Metadata pills */}
        {!compact && (mdTokens || mdIter || mdError) && (
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            {mdTokens !== undefined && mdTokens > 0 && (
              <span className='rounded-md border border-border/30 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60'>
                {formatTokens(mdTokens)} tokens
              </span>
            )}
            {mdIter !== undefined && mdIter > 0 && (
              <span className='rounded-md border border-border/30 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60'>
                {mdIter} iter{mdIter !== 1 ? 's' : ''}
              </span>
            )}
            {mdError && (
              <span className='rounded-md border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400/80 max-w-xs truncate'>
                {mdError.slice(0, 80)}
              </span>
            )}
          </div>
        )}

        {/* Execution link (when no title already shown) */}
        {hasExec && !label && !compact && (
          <button
            onClick={() => router.push(`/dashboard/executions/${evt.execution_id}`)}
            className='mt-1 flex items-center gap-0.5 text-[10px] text-muted-foreground/40 hover:text-[#9A66FF] transition-colors'
          >
            View execution <IconArrowRight className='h-2.5 w-2.5' />
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ─── Filter types ─── */
type ActorFilter   = 'all' | 'user' | 'agent' | 'system';
type ActionFilter  = 'all' | 'completed' | 'failed' | 'halted' | 'started' | 'approved';

const ACTOR_FILTERS:  { key: ActorFilter;  label: string }[] = [
  { key: 'all',    label: 'Everyone' },
  { key: 'user',   label: 'Human' },
  { key: 'agent',  label: 'Agent' },
  { key: 'system', label: 'System' },
];
const ACTION_FILTERS: { key: ActionFilter; label: string; color: string }[] = [
  { key: 'all',       label: 'All actions', color: '#8892A4' },
  { key: 'completed', label: 'Completed',   color: '#56D090' },
  { key: 'started',   label: 'Started',     color: '#9A66FF' },
  { key: 'failed',    label: 'Failed',      color: '#EF4444' },
  { key: 'halted',    label: 'Halted',      color: '#FFBF47' },
  { key: 'approved',  label: 'Approved',    color: '#56D090' },
];

/* ─── Page ─── */
export default function ActivityPage() {
  const { data: session }                        = useSession();
  const [events, setEvents]                      = useState<ActivityEvent[]>([]);
  const [agentsMap, setAgentsMap]                = useState<Record<string, Agent>>({});
  const [loading, setLoading]                    = useState(true);
  const [refreshing, setRefreshing]              = useState(false);
  const [actorFilter, setActorFilter]            = useState<ActorFilter>('all');
  const [actionFilter, setActionFilter]          = useState<ActionFilter>('all');
  const [search, setSearch]                      = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [actRes, agRes] = await Promise.all([
        api.listActivity(undefined, 200),
        api.listAgents(),
      ]);
      setEvents(actRes.data || []);
      const map: Record<string, Agent> = {};
      for (const a of agRes.data || []) map[a.id] = a;
      setAgentsMap(map);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(evt => {
      if (actorFilter  !== 'all' && evt.actor_type !== actorFilter)         return false;
      if (actionFilter !== 'all' && !(evt.action || '').includes(actionFilter)) return false;
      if (q) {
        const hay = [
          evt.actor_name,
          evt.action,
          evt.summary,
          evt.metadata?.workforce_name,
          evt.metadata?.execution_title,
          evt.metadata?.error,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, actorFilter, actionFilter, search]);

  /* ── Date grouping ── */
  const groups = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const evt of filtered) {
      const key = dayLabel(evt.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(evt);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (loading) {
    return (
      <div className='space-y-4 p-6'>
        <div className='h-7 w-32 animate-pulse rounded-lg bg-muted/40' />
        <div className='h-9 w-full animate-pulse rounded-lg bg-muted/30' />
        <div className='space-y-3 mt-6'>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className='flex items-start gap-3 py-3' style={{ opacity: 1 - i * 0.1 }}>
              <div className='h-8 w-8 shrink-0 animate-pulse rounded-xl bg-muted/40' />
              <div className='flex-1 space-y-1.5'>
                <div className='h-3 w-1/3 animate-pulse rounded bg-muted/40' />
                <div className='h-3 w-2/3 animate-pulse rounded bg-muted/30' />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-5 p-6'>
      {/* Header */}
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Activity</h2>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {filtered.length} events · global audit trail
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className='flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-all'
        >
          <IconRefresh className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className='relative'>
        <IconSearch className='absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none' />
        <input
          type='text'
          placeholder='Search events, actors, summaries…'
          value={search}
          onChange={e => setSearch(e.target.value)}
          className='w-full rounded-lg border border-border/40 bg-background/60 pl-9 pr-9 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#9A66FF]/50 transition-all'
        />
        {search && (
          <button onClick={() => setSearch('')} className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground'>
            <IconX className='h-3.5 w-3.5' />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className='flex flex-wrap gap-3'>
        {/* Actor filter */}
        <div className='flex items-center gap-1'>
          <IconFilter className='h-3.5 w-3.5 text-muted-foreground/50 shrink-0' />
          <div className='flex gap-1'>
            {ACTOR_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setActorFilter(f.key)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                  actorFilter === f.key
                    ? 'border-[#9A66FF]/50 bg-[#9A66FF]/15 text-[#9A66FF]'
                    : 'border-border/40 bg-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className='h-6 w-px bg-border/40' />

        {/* Action filter */}
        <div className='flex flex-wrap gap-1'>
          {ACTION_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setActionFilter(f.key)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                actionFilter === f.key
                  ? 'border-opacity-50 bg-opacity-15'
                  : 'border-border/40 bg-transparent text-muted-foreground hover:text-foreground'
              }`}
              style={actionFilter === f.key ? {
                borderColor: f.color + '55',
                backgroundColor: f.color + '18',
                color: f.color,
              } : {}}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Events grouped by date */}
      {groups.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-xl border border-dashed border-border/40'>
          <p className='text-sm text-muted-foreground/60'>
            {search ? `No events matching "${search}"` : 'No activity recorded yet.'}
          </p>
        </div>
      ) : (
        <div className='space-y-6'>
          <AnimatePresence>
            {groups.map(([day, dayEvents]) => (
              <motion.div
                key={day}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {/* Day header */}
                <div className='flex items-center gap-3 mb-1'>
                  <span className='text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap'>
                    {day}
                  </span>
                  <div className='flex-1 h-px bg-border/30' />
                  <span className='text-[10px] text-muted-foreground/35'>{dayEvents.length}</span>
                </div>

                {/* Events */}
                <div className='divide-y divide-border/20 rounded-xl border border-border/30 bg-background/30 px-4'>
                  {dayEvents.map((evt, i) => (
                    <ActivityFeedItem
                      key={evt.id}
                      evt={evt}
                      agentsMap={agentsMap}
                      idx={i}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
