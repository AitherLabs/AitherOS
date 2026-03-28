'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  IconBolt, IconCheck, IconClock, IconLoader2, IconPlayerPlay,
  IconSearch, IconTrash, IconX, IconChevronDown, IconChevronRight
} from '@tabler/icons-react';
import api, { Agent, Workforce, Execution } from '@/lib/api';
import { EntityAvatarStack } from '@/components/entity-avatar';
import { Button } from '@/components/ui/button';

const execStatusConfig: Record<string, { color: string; bg: string; border: string; label: string; pulse?: boolean }> = {
  running:           { color: '#9A66FF', bg: '#9A66FF12', border: '#9A66FF35', label: 'Running',           pulse: true },
  planning:          { color: '#14FFF7', bg: '#14FFF712', border: '#14FFF735', label: 'Planning',           pulse: true },
  completed:         { color: '#56D090', bg: '#56D09012', border: '#56D09035', label: 'Completed' },
  failed:            { color: '#EF4444', bg: '#EF444412', border: '#EF444435', label: 'Failed' },
  halted:            { color: '#FFBF47', bg: '#FFBF4712', border: '#FFBF4735', label: 'Halted' },
  pending_approval:  { color: '#FFBF47', bg: '#FFBF4712', border: '#FFBF4735', label: 'Awaiting Approval', pulse: true },
  awaiting_approval: { color: '#FFBF47', bg: '#FFBF4712', border: '#FFBF4735', label: 'Awaiting Approval', pulse: true },
};

const STATUS_FILTERS = [
  { key: 'all',               label: 'All' },
  { key: 'active',            label: 'Active' },
  { key: 'completed',         label: 'Completed' },
  { key: 'awaiting_approval', label: 'Approval' },
  { key: 'halted',            label: 'Halted' },
  { key: 'failed',            label: 'Failed' },
] as const;

type FilterKey = typeof STATUS_FILTERS[number]['key'];

function matchesFilter(exec: Execution, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return exec.status === 'running' || exec.status === 'planning';
  if (filter === 'awaiting_approval') return exec.status === 'awaiting_approval' || exec.status === 'pending_approval';
  return exec.status === filter;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${(seconds / 3600).toFixed(1)}h`;
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

interface ExecWithMeta extends Execution {
  workforce_name?: string;
  workforce_agents?: Agent[];
}

function ExecRow({ exec, onDelete }: { exec: ExecWithMeta; onDelete: (id: string) => void }) {
  const router = useRouter();
  const cfg = execStatusConfig[exec.status] || { color: '#888', bg: '#88812', border: '#88830', label: exec.status };
  const isActive = exec.status === 'running' || exec.status === 'planning';
  const isApproval = exec.status === 'awaiting_approval' || exec.status === 'pending_approval';

  return (
    <div
      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
      className='group relative flex cursor-pointer items-stretch rounded-xl border border-border/40 bg-background/60 transition-all hover:border-border/80 hover:bg-background/80 overflow-hidden'
      style={{ borderLeftColor: cfg.color + '60', borderLeftWidth: 3 }}
    >
      {isActive && (
        <div className='pointer-events-none absolute inset-0 rounded-xl animate-pulse'
          style={{ background: `linear-gradient(90deg, ${cfg.color}06 0%, transparent 60%)` }} />
      )}
      <div className='flex flex-1 items-start gap-4 px-4 py-3 min-w-0'>
        <div className='shrink-0 mt-0.5'>
          <EntityAvatarStack
            entities={(exec.workforce_agents || []).map((a) => ({ icon: a.icon, color: a.color, avatarUrl: a.avatar_url, name: a.name, id: a.id }))}
            max={4} size='sm'
          />
        </div>
        <div className='flex-1 min-w-0'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <h3 className='text-sm font-medium leading-snug line-clamp-1 text-foreground/90'>
                {exec.title || exec.objective}
              </h3>
              <div className='mt-0.5 flex items-center gap-1.5 flex-wrap'>
                {(exec.workforce_agents || []).length > 0 && (
                  <span className='text-[11px] text-muted-foreground/45'>
                    {(exec.workforce_agents || []).map(a => a.name).join(', ')}
                  </span>
                )}
              </div>
            </div>
            <div className='flex items-center gap-2 shrink-0'>
              <div className='flex items-center gap-1.5 rounded-lg border px-2 py-1'
                style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}>
                {(isActive || isApproval) && (
                  <span className='h-1.5 w-1.5 rounded-full animate-pulse shrink-0' style={{ backgroundColor: cfg.color }} />
                )}
                {exec.status === 'completed' && <IconCheck className='h-3 w-3 shrink-0' style={{ color: cfg.color }} />}
                {exec.status === 'failed' && <IconX className='h-3 w-3 shrink-0' style={{ color: cfg.color }} />}
                <span className='text-[11px] font-semibold' style={{ color: cfg.color }}>{cfg.label}</span>
              </div>
              {exec.status !== 'running' && exec.status !== 'planning' && (
                <Button
                  variant='ghost' size='icon'
                  className='h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all'
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this execution?')) return;
                    api.deleteExecution(exec.id).then(() => onDelete(exec.id));
                  }}
                >
                  <IconTrash className='h-3.5 w-3.5' />
                </Button>
              )}
              {isActive && <IconLoader2 className='h-3.5 w-3.5 animate-spin shrink-0' style={{ color: cfg.color }} />}
            </div>
          </div>
          {exec.status === 'completed' && exec.result && (
            <p className='mt-1.5 text-[11px] leading-relaxed text-muted-foreground/55 line-clamp-2'>
              {exec.result.slice(0, 200)}
            </p>
          )}
          <div className='mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/40 flex-wrap'>
            {exec.tokens_used > 0 && <span>{formatTokens(exec.tokens_used)} tokens</span>}
            {exec.iterations > 0 && <><span className='text-border'>·</span><span>{exec.iterations} iter{exec.iterations !== 1 ? 's' : ''}</span></>}
            {exec.elapsed_s > 0 && <><span className='text-border'>·</span><span>{formatDuration(exec.elapsed_s)}</span></>}
            <span className='text-border'>·</span>
            <span>{timeAgo(exec.created_at)}</span>
            <span className='ml-auto font-mono text-[9px] text-muted-foreground/25'>{exec.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface WorkforceGroup {
  id: string;
  name: string;
  agents: Agent[];
  executions: ExecWithMeta[];
}

export default function ExecutionsPage() {
  const { data: session } = useSession();
  const [executions, setExecutions] = useState<ExecWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [wfFilter, setWfFilter] = useState<string>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupByWf, setGroupByWf] = useState(false);

  const loadExecutions = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [execRes, wfRes, agRes] = await Promise.all([
        api.listAllExecutions(),
        api.listWorkforces(),
        api.listAgents(),
      ]);
      const workforces: Workforce[] = wfRes.data || [];
      const agentsMap: Record<string, Agent> = {};
      for (const a of agRes.data || []) agentsMap[a.id] = a;
      const workforcesMap: Record<string, Workforce> = {};
      for (const wf of workforces) workforcesMap[wf.id] = wf;
      const allExecs: ExecWithMeta[] = (execRes.data || []).map((e) => {
        const wf = workforcesMap[e.workforce_id];
        const wfAgents = wf ? (wf.agent_ids || []).map((id) => agentsMap[id]).filter(Boolean) : [];
        return { ...e, workforce_name: wf?.name || '', workforce_agents: wfAgents };
      });
      setExecutions(allExecs);
    } catch (err) {
      console.error('Failed to load executions:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { loadExecutions(); }, [loadExecutions]);

  const handleDelete = (id: string) => setExecutions(prev => prev.filter(x => x.id !== id));

  // Unique workforces for filter dropdown
  const workforceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of executions) {
      if (e.workforce_id && e.workforce_name && !seen.has(e.workforce_id)) {
        seen.set(e.workforce_id, e.workforce_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [executions]);

  // Filtered + searched list
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return executions.filter((e) => {
      if (!matchesFilter(e, filter)) return false;
      if (wfFilter !== 'all' && e.workforce_id !== wfFilter) return false;
      if (q) {
        const haystack = [e.title, e.objective, e.workforce_name, ...(e.workforce_agents || []).map(a => a.name)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [executions, filter, wfFilter, search]);

  const counts = useMemo<Record<FilterKey, number>>(() => ({
    all: executions.length,
    active: executions.filter(e => e.status === 'running' || e.status === 'planning').length,
    completed: executions.filter(e => e.status === 'completed').length,
    awaiting_approval: executions.filter(e => e.status === 'awaiting_approval' || e.status === 'pending_approval').length,
    halted: executions.filter(e => e.status === 'halted').length,
    failed: executions.filter(e => e.status === 'failed').length,
  }), [executions]);

  // Group by workforce
  const groups = useMemo<WorkforceGroup[]>(() => {
    if (!groupByWf) return [];
    const map = new Map<string, WorkforceGroup>();
    for (const e of filtered) {
      const key = e.workforce_id || '__unknown__';
      if (!map.has(key)) {
        map.set(key, { id: key, name: e.workforce_name || 'Unknown workforce', agents: e.workforce_agents || [], executions: [] });
      }
      map.get(key)!.executions.push(e);
    }
    return Array.from(map.values()).sort((a, b) => {
      // Active workforces first
      const aActive = a.executions.some(e => e.status === 'running' || e.status === 'planning') ? 0 : 1;
      const bActive = b.executions.some(e => e.status === 'running' || e.status === 'planning') ? 0 : 1;
      return aActive - bActive || a.name.localeCompare(b.name);
    });
  }, [filtered, groupByWf]);

  const toggleGroup = (id: string) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (loading) {
    return (
      <div className='flex h-[calc(100vh-64px)] flex-col'>
        <div className='border-b border-border/50 px-6 py-4 space-y-3'>
          <div className='h-5 w-28 animate-pulse rounded bg-muted/50' />
          <div className='h-8 w-full animate-pulse rounded-lg bg-muted/30' />
          <div className='flex gap-1.5'>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className='h-7 w-16 animate-pulse rounded-lg bg-muted/40' />)}
          </div>
        </div>
        <div className='flex-1 overflow-hidden px-6 py-4 space-y-2'>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className='flex items-center gap-4 rounded-xl border border-border/30 bg-background/60 px-4 py-3'
              style={{ borderLeftWidth: 3, borderLeftColor: '#9A66FF30', opacity: 1 - i * 0.08 }}>
              <div className='flex -space-x-2'>
                {Array.from({ length: 3 }).map((_, j) => <div key={j} className='h-8 w-8 animate-pulse rounded-lg bg-muted/50 border-2 border-background' />)}
              </div>
              <div className='flex-1 space-y-1.5'>
                <div className='h-4 w-3/4 animate-pulse rounded bg-muted/50' />
                <div className='h-3 w-1/3 animate-pulse rounded bg-muted/30' />
              </div>
              <div className='h-6 w-20 animate-pulse rounded-lg bg-muted/40' />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Header */}
      <div className='border-b border-border/50 px-6 py-4 space-y-3'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold tracking-tight'>Executions</h2>
            <p className='text-xs text-muted-foreground mt-0.5'>
              {filtered.length} of {executions.length} · {new Set(executions.map(e => e.workforce_id)).size} workforces
            </p>
          </div>
          {/* Group toggle */}
          <button
            onClick={() => setGroupByWf(v => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
              groupByWf
                ? 'border-[#9A66FF]/50 bg-[#9A66FF]/15 text-[#9A66FF]'
                : 'border-border/40 bg-background/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <IconBolt className='h-3 w-3' />
            Group by workforce
          </button>
        </div>

        {/* Search bar */}
        <div className='relative'>
          <IconSearch className='absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none' />
          <input
            type='text'
            placeholder='Search by title, objective, workforce, agent…'
            value={search}
            onChange={e => setSearch(e.target.value)}
            className='w-full rounded-lg border border-border/40 bg-background/60 pl-9 pr-9 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#9A66FF]/50 focus:bg-background/80 transition-all'
          />
          {search && (
            <button onClick={() => setSearch('')} className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground'>
              <IconX className='h-3.5 w-3.5' />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className='flex items-center gap-2 flex-wrap'>
          {/* Status filters */}
          <div className='flex items-center gap-1 flex-wrap'>
            {STATUS_FILTERS.map(({ key, label }) => {
              const count = counts[key];
              if (count === 0 && key !== 'all') return null;
              const isActive = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    isActive
                      ? 'border-[#9A66FF]/50 bg-[#9A66FF]/15 text-[#9A66FF]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {key === 'active' && <span className='h-1.5 w-1.5 rounded-full bg-[#9A66FF] animate-pulse' />}
                  {key === 'completed' && <IconCheck className='h-3 w-3' />}
                  {key === 'failed' && <IconX className='h-3 w-3' />}
                  {key === 'halted' && <IconPlayerPlay className='h-3 w-3' />}
                  {key === 'awaiting_approval' && <IconClock className='h-3 w-3' />}
                  {label}
                  <span className={`rounded-full px-1 py-0.5 text-[10px] font-bold ${
                    isActive ? 'bg-[#9A66FF]/20 text-[#9A66FF]' : 'bg-muted text-muted-foreground'
                  }`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Workforce filter */}
          {workforceOptions.length > 1 && (
            <>
              <div className='h-4 w-px bg-border/50 mx-1' />
              <div className='flex items-center gap-1 flex-wrap'>
                <button
                  onClick={() => setWfFilter('all')}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    wfFilter === 'all'
                      ? 'border-[#14FFF7]/40 bg-[#14FFF7]/10 text-[#14FFF7]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All teams
                </button>
                {workforceOptions.map(({ id, name }) => (
                  <button
                    key={id}
                    onClick={() => setWfFilter(wfFilter === id ? 'all' : id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all truncate max-w-[160px] ${
                      wfFilter === id
                        ? 'border-[#14FFF7]/40 bg-[#14FFF7]/10 text-[#14FFF7]'
                        : 'border-border/40 bg-background/40 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <div className='flex-1 overflow-y-auto px-6 py-4'>
        {filtered.length === 0 ? (
          <div className='flex h-40 items-center justify-center rounded-xl border border-dashed border-border/50'>
            <p className='text-sm text-muted-foreground'>
              {search
                ? `No executions matching "${search}"`
                : filter === 'all' ? 'No executions yet. Start one from a workforce.' : `No ${filter} executions.`}
            </p>
          </div>
        ) : groupByWf ? (
          // ── Grouped view ──
          <div className='space-y-4'>
            {groups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.id);
              const hasActive = group.executions.some(e => e.status === 'running' || e.status === 'planning');
              return (
                <div key={group.id}>
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className='w-full flex items-center gap-2 mb-2 px-1 group/header'
                  >
                    <span className='text-muted-foreground/50 group-hover/header:text-muted-foreground transition-colors'>
                      {isCollapsed ? <IconChevronRight className='h-3.5 w-3.5' /> : <IconChevronDown className='h-3.5 w-3.5' />}
                    </span>
                    <span className='text-xs font-semibold text-foreground/70 group-hover/header:text-foreground transition-colors truncate'>
                      {group.name}
                    </span>
                    {hasActive && <span className='h-1.5 w-1.5 rounded-full bg-[#9A66FF] animate-pulse shrink-0' />}
                    <span className='text-[10px] text-muted-foreground/40 shrink-0'>
                      {group.executions.length} run{group.executions.length !== 1 ? 's' : ''}
                    </span>
                    <div className='flex-1 h-px bg-border/30' />
                  </button>
                  {!isCollapsed && (
                    <div className='space-y-2 pl-5 border-l border-border/25 ml-1.5'>
                      {group.executions.map(exec => (
                        <ExecRow key={exec.id} exec={exec} onDelete={handleDelete} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // ── Flat view ──
          <div className='space-y-2'>
            {filtered.map(exec => <ExecRow key={exec.id} exec={exec} onDelete={handleDelete} />)}
          </div>
        )}
      </div>
    </div>
  );
}
