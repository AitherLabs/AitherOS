'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'motion/react';
import {
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconClock,
  IconPlayerPlay,
  IconServer,
  IconX,
} from '@tabler/icons-react';
import api, { ActivityEvent, Agent, Workforce, Execution, Provider } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';
import { ActivityFeedItem } from '@/app/dashboard/activity/page';

/* ─── Brand palette ─── */
const P = {
  purple: '#9A66FF',
  cyan:   '#14FFF7',
  green:  '#56D090',
  amber:  '#FFBF47',
  red:    '#EF4444',
  muted:  '#8892A4',
};

/* ─── Helpers ─── */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function greeting(name: string): string {
  const h = new Date().getHours();
  if (h < 5)  return `Still up, ${name}?`;
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  if (h < 21) return `Good evening, ${name}`;
  return `Working late, ${name}?`;
}

const execStatusCfg: Record<string, { color: string; label: string; pulse?: boolean }> = {
  running:           { color: P.purple, label: 'Running',          pulse: true },
  planning:          { color: P.cyan,   label: 'Planning',         pulse: true },
  completed:         { color: P.green,  label: 'Completed' },
  failed:            { color: P.red,    label: 'Failed' },
  halted:            { color: P.amber,  label: 'Halted' },
  awaiting_approval: { color: P.amber,  label: 'Needs approval',   pulse: true },
  pending_approval:  { color: P.amber,  label: 'Needs approval',   pulse: true },
};


interface ExecWithMeta extends Execution {
  workforce_name?: string;
  workforce_agents?: Agent[];
}

/* ─── Ambient pulse ring around agent avatar ─── */
function AgentPresence({ color, active }: { color: string; active: boolean }) {
  if (!active) return null;
  return (
    <span
      className='absolute -inset-0.5 rounded-xl'
      style={{
        boxShadow: `0 0 0 1.5px ${color}55, 0 0 8px ${color}33`,
        animation: 'pulse 2.5s ease-in-out infinite',
      }}
    />
  );
}

/* ─── Single agent "desk card" ─── */
function AgentDeskCard({ agent, busyExec }: { agent: Agent; busyExec?: ExecWithMeta }) {
  const router = useRouter();
  const isWorking = !!busyExec;
  const statusColor = isWorking ? P.purple : agent.status === 'active' ? P.green : P.muted;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
      className='relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 transition-colors'
      style={{
        borderColor: isWorking ? `${P.purple}40` : 'rgba(255,255,255,0.06)',
        background:  isWorking
          ? `linear-gradient(135deg, ${P.purple}0A 0%, transparent 100%)`
          : 'rgba(255,255,255,0.02)',
      }}
    >
      <div className='relative'>
        <AgentPresence color={statusColor} active={isWorking} />
        <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} name={agent.name} size='md' />
        {/* status dot */}
        <span
          className='absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background'
          style={{
            backgroundColor: statusColor,
            boxShadow: isWorking ? `0 0 6px ${statusColor}` : undefined,
          }}
        />
      </div>
      <div className='w-full text-center'>
        <p className='truncate text-[11px] font-semibold text-foreground/90'>{agent.name}</p>
        <p className='truncate text-[9px] text-muted-foreground/50'>
          {isWorking ? (
            <span style={{ color: P.purple }}>⚡ working</span>
          ) : agent.status === 'active' ? (
            <span style={{ color: P.green }}>ready</span>
          ) : (
            'idle'
          )}
        </p>
      </div>
      {isWorking && busyExec && (
        <p className='w-full truncate text-center text-[9px] text-muted-foreground/40 leading-tight'>
          {busyExec.title || busyExec.objective}
        </p>
      )}
    </motion.div>
  );
}

/* ─── Active mission card ─── */
function MissionCard({ exec, agents }: { exec: ExecWithMeta; agents: Agent[] }) {
  const router = useRouter();
  const cfg = execStatusCfg[exec.status] || { color: P.muted, label: exec.status };
  const isLive = cfg.pulse;
  const completedSteps = (exec.plan || []).filter(s => s.status === 'done').length;
  const totalSteps = (exec.plan || []).length;
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
      className='group relative cursor-pointer overflow-hidden rounded-xl border transition-all hover:border-opacity-60'
      style={{
        borderColor: `${cfg.color}30`,
        background: `linear-gradient(135deg, ${cfg.color}08 0%, transparent 60%)`,
        borderLeftWidth: 2,
        borderLeftColor: cfg.color,
      }}
    >
      {/* live shimmer */}
      {isLive && (
        <div
          className='pointer-events-none absolute inset-0'
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${cfg.color}06 50%, transparent 100%)`,
            animation: 'shimmer 2.5s ease-in-out infinite',
          }}
        />
      )}

      <div className='relative p-3'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-1.5 mb-1'>
              {isLive && (
                <span className='relative flex h-2 w-2 shrink-0'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full opacity-75' style={{ backgroundColor: cfg.color }} />
                  <span className='relative inline-flex h-2 w-2 rounded-full' style={{ backgroundColor: cfg.color }} />
                </span>
              )}
              {exec.status === 'completed' && <IconCheck className='h-3.5 w-3.5 shrink-0' style={{ color: cfg.color }} />}
              {exec.status === 'failed'    && <IconX     className='h-3.5 w-3.5 shrink-0' style={{ color: cfg.color }} />}
              {exec.status === 'halted'    && <IconClock className='h-3.5 w-3.5 shrink-0' style={{ color: cfg.color }} />}
              <span className='text-[10px] font-semibold uppercase tracking-wide' style={{ color: cfg.color }}>{cfg.label}</span>
              <span className='ml-auto text-[9px] text-muted-foreground/40'>{timeAgo(exec.created_at)}</span>
            </div>

            <p className='text-xs font-medium text-foreground/90 line-clamp-1 leading-snug'>
              {exec.title || exec.objective}
            </p>

            {exec.workforce_name && (
              <p className='mt-0.5 text-[10px] text-muted-foreground/50'>
                {exec.workforce_name}
              </p>
            )}
          </div>

          {/* Agent stack */}
          <div className='flex shrink-0 -space-x-1.5'>
            {(exec.workforce_agents || []).slice(0, 3).map(a => (
              <EntityAvatar key={a.id} icon={a.icon} color={a.color} avatarUrl={a.avatar_url} name={a.name} size='xs' className='border-2 border-background' />
            ))}
          </div>
        </div>

        {/* Progress bar for running executions with a plan */}
        {totalSteps > 0 && isLive && (
          <div className='mt-2.5'>
            <div className='flex items-center justify-between mb-1'>
              <span className='text-[9px] text-muted-foreground/40'>
                {completedSteps}/{totalSteps} steps
              </span>
              <span className='text-[9px] text-muted-foreground/40'>
                {Math.round(progress * 100)}%
              </span>
            </div>
            <div className='h-1 w-full overflow-hidden rounded-full bg-white/5'>
              <motion.div
                className='h-full rounded-full'
                style={{ backgroundColor: cfg.color }}
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}

        {/* Result preview */}
        {exec.status === 'completed' && exec.result && (
          <p className='mt-2 text-[10px] leading-relaxed text-muted-foreground/50 line-clamp-2'>
            {exec.result.slice(0, 160)}
          </p>
        )}
      </div>
    </motion.div>
  );
}


/* ─── Stat pill ─── */
function StatPill({ value, label, color, href }: { value: number | string; label: string; color: string; href: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className='flex flex-col items-center rounded-xl border px-4 py-3 transition-all hover:scale-[1.03] active:scale-[0.98]'
      style={{
        borderColor: `${color}25`,
        background: `${color}08`,
      }}
    >
      <span className='text-2xl font-extrabold tabular-nums tracking-tight' style={{ color }}>
        {value}
      </span>
      <span className='text-[10px] font-medium text-muted-foreground/60 mt-0.5 whitespace-nowrap'>
        {label}
      </span>
    </button>
  );
}

/* ─── Workspace pulse indicator ─── */
function WorkspacePulse({ active }: { active: boolean }) {
  return (
    <div className='flex items-center gap-1.5'>
      <span className='relative flex h-2 w-2'>
        {active ? (
          <>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60' />
            <span className='relative inline-flex h-2 w-2 rounded-full bg-green-400' />
          </>
        ) : (
          <span className='relative inline-flex h-2 w-2 rounded-full bg-muted-foreground/30' />
        )}
      </span>
      <span className='text-[11px] font-medium' style={{ color: active ? P.green : P.muted }}>
        {active ? 'Workspace active' : 'Workspace idle'}
      </span>
    </div>
  );
}

/* ─── Main component ─── */
export function OverviewStats() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading]                 = useState(true);
  const [agents, setAgents]                   = useState<Agent[]>([]);
  const [workforces, setWorkforces]           = useState<Workforce[]>([]);
  const [executions, setExecutions]           = useState<ExecWithMeta[]>([]);
  const [providers, setProviders]             = useState<Provider[]>([]);
  const [totalTokens, setTotalTokens]         = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recentActivity, setRecentActivity]   = useState<ActivityEvent[]>([]);
  const [clock, setClock]                     = useState(new Date());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live clock
  useEffect(() => {
    tickRef.current = setInterval(() => setClock(new Date()), 30_000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const loadAll = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [agRes, wfRes, pvRes, execRes, actRes] = await Promise.all([
        api.listAgents(),
        api.listWorkforces(),
        api.listProviders(),
        api.listAllExecutions(),
        api.listActivity(undefined, 20),
      ]);

      const agList = agRes.data || [];
      const wfList = wfRes.data || [];
      const pvList = pvRes.data || [];
      setAgents(agList);
      setWorkforces(wfList);
      setProviders(pvList);
      setRecentActivity(actRes.data || []);

      const agMap: Record<string, Agent>     = {};
      const wfMap: Record<string, Workforce> = {};
      for (const a  of agList) agMap[a.id]  = a;
      for (const wf of wfList) wfMap[wf.id] = wf;

      const allExecs: ExecWithMeta[] = (execRes.data || []).map((e) => {
        const wf      = wfMap[e.workforce_id];
        const wfAgents = wf ? (wf.agent_ids || []).map(id => agMap[id]).filter(Boolean) : [];
        return { ...e, workforce_name: wf?.name || '', workforce_agents: wfAgents };
      });

      setExecutions(allExecs);
      setTotalTokens(allExecs.reduce((s, e) => s + (e.tokens_used || 0), 0));

      const approvalCounts = await Promise.allSettled(wfList.map(wf => api.countPendingApprovals(wf.id)));
      setPendingApprovals(approvalCounts.reduce((s, r) => s + (r.status === 'fulfilled' ? (r.value.data?.count || 0) : 0), 0));
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const userName    = (session?.user as any)?.username || session?.user?.name || 'Operator';
  const agentsMap   = agents.reduce<Record<string, Agent>>((m, a) => { m[a.id] = a; return m; }, {});
  const activeExecs = executions.filter(e => ['running', 'planning'].includes(e.status));
  const needsAction = executions.filter(e => ['awaiting_approval', 'pending_approval', 'halted'].includes(e.status));
  const recentExecs = executions.slice(0, 8);
  const isActive    = activeExecs.length > 0;

  // Map agent → their current running execution
  const agentBusyMap: Record<string, ExecWithMeta> = {};
  for (const exec of activeExecs) {
    for (const s of exec.plan || []) {
      if (s.status === 'running' && s.agent_id) {
        agentBusyMap[s.agent_id] = exec;
      }
    }
  }

  const clockStr = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr  = clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className='flex flex-col gap-6'>
      <style>{`
        @keyframes shimmer {
          0%,100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
      `}</style>

      {/* ── HEADER: Greeting + workspace status ── */}
      <div className='flex items-start justify-between gap-4 flex-wrap'>
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className='text-2xl font-bold tracking-tight'
          >
            {loading ? '—' : greeting(userName)}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className='mt-0.5 text-sm text-muted-foreground'
          >
            {isActive
              ? `${activeExecs.length} mission${activeExecs.length !== 1 ? 's' : ''} in progress · your team is working`
              : 'Your AI team is standing by'}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className='flex flex-col items-end gap-1.5'
        >
          <WorkspacePulse active={isActive} />
          <div className='text-right'>
            <p className='text-lg font-mono font-semibold tabular-nums tracking-tight text-foreground/80'>{clockStr}</p>
            <p className='text-[10px] text-muted-foreground/50'>{dateStr}</p>
          </div>
        </motion.div>
      </div>

      {/* ── NEEDS ATTENTION banner ── */}
      <AnimatePresence>
        {pendingApprovals > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            onClick={() => router.push('/dashboard/workforces')}
            className='cursor-pointer rounded-xl border px-4 py-3 flex items-center gap-3'
            style={{ borderColor: `${P.amber}40`, background: `${P.amber}08` }}
          >
            <span className='relative flex h-2.5 w-2.5 shrink-0'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full opacity-75' style={{ backgroundColor: P.amber }} />
              <span className='relative inline-flex h-2.5 w-2.5 rounded-full' style={{ backgroundColor: P.amber }} />
            </span>
            <p className='text-sm font-medium' style={{ color: P.amber }}>
              {pendingApprovals} execution{pendingApprovals !== 1 ? 's' : ''} waiting for your approval
            </p>
            <IconArrowRight className='ml-auto h-4 w-4 shrink-0' style={{ color: P.amber }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── STAT PILLS ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className='grid grid-cols-2 gap-3 sm:grid-cols-4'
      >
        <StatPill value={loading ? '—' : agents.length}     label='AI colleagues'      color={P.purple} href='/dashboard/agents' />
        <StatPill value={loading ? '—' : workforces.length} label='workforces'          color={P.green}  href='/dashboard/workforces' />
        <StatPill value={loading ? '—' : activeExecs.length}label='active missions'     color={P.cyan}   href='/dashboard/executions' />
        <StatPill value={loading ? '—' : formatTokens(totalTokens)} label='tokens used' color={P.amber}  href='/dashboard/providers' />
      </motion.div>

      {/* ── MAIN GRID: missions (left) + team (right) ── */}
      <div className='grid gap-6 lg:grid-cols-[1fr_260px]'>

        {/* LEFT: Missions */}
        <div className='flex flex-col gap-4 min-w-0'>

          {/* Active missions */}
          {(activeExecs.length > 0 || needsAction.length > 0) && (
            <div>
              <div className='mb-3 flex items-center gap-2'>
                <span className='relative flex h-2 w-2'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-60' />
                  <span className='relative inline-flex h-2 w-2 rounded-full bg-purple-400' />
                </span>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Live</h2>
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <AnimatePresence>
                  {[...activeExecs, ...needsAction].map(exec => (
                    <MissionCard key={exec.id} exec={exec} agents={agents} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Recent executions */}
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Recent missions
              </h2>
              <button
                onClick={() => router.push('/dashboard/executions')}
                className='flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-[#9A66FF] transition-colors'
              >
                All <IconArrowRight className='h-3 w-3' />
              </button>
            </div>

            {loading ? (
              <div className='space-y-2'>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className='h-14 animate-pulse rounded-xl border border-border/30 bg-muted/20' style={{ opacity: 1 - i * 0.2 }} />
                ))}
              </div>
            ) : recentExecs.length === 0 ? (
              <div
                className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 py-12 text-center'
                style={{ background: `${P.purple}04` }}
              >
                <span className='text-3xl mb-3'>🚀</span>
                <p className='text-sm font-medium text-foreground/60'>No missions yet</p>
                <p className='text-xs text-muted-foreground/40 mt-1'>
                  Head to a workforce and launch your first execution
                </p>
                <button
                  onClick={() => router.push('/dashboard/workforces')}
                  className='mt-4 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all hover:scale-105'
                  style={{ borderColor: `${P.purple}40`, color: P.purple, background: `${P.purple}10` }}
                >
                  <IconPlayerPlay className='h-3 w-3' />
                  Go to workforces
                </button>
              </div>
            ) : (
              <div className='space-y-1.5'>
                {recentExecs.map((exec, i) => {
                  const cfg    = execStatusCfg[exec.status] || { color: P.muted, label: exec.status };
                  const isLive = cfg.pulse;
                  return (
                    <motion.div
                      key={exec.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                      className='group flex cursor-pointer items-center gap-3 rounded-xl border border-border/30 px-3 py-2.5 transition-all hover:border-border/60 hover:bg-white/[0.02]'
                      style={{ borderLeftWidth: 2, borderLeftColor: cfg.color + '80' }}
                    >
                      {/* Agents */}
                      <div className='flex shrink-0 -space-x-1.5'>
                        {(exec.workforce_agents || []).slice(0, 3).map(a => (
                          <EntityAvatar key={a.id} icon={a.icon} color={a.color} avatarUrl={a.avatar_url} name={a.name} size='xs' className='border-2 border-background' />
                        ))}
                      </div>

                      {/* Info */}
                      <div className='min-w-0 flex-1'>
                        <p className='text-xs font-medium line-clamp-1 text-foreground/90'>
                          {exec.title || exec.objective}
                        </p>
                        <p className='text-[10px] text-muted-foreground/45 mt-0.5'>
                          {exec.workforce_name}{exec.tokens_used > 0 ? ` · ${formatTokens(exec.tokens_used)} tokens` : ''}
                        </p>
                      </div>

                      {/* Status + time */}
                      <div className='flex shrink-0 flex-col items-end gap-0.5'>
                        <div className='flex items-center gap-1'>
                          {isLive && (
                            <span className='h-1.5 w-1.5 rounded-full animate-pulse' style={{ backgroundColor: cfg.color }} />
                          )}
                          <span className='text-[10px] font-semibold' style={{ color: cfg.color }}>
                            {cfg.label}
                          </span>
                        </div>
                        <span className='text-[9px] text-muted-foreground/35'>
                          {timeAgo(exec.created_at)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Team + Activity */}
        <div className='flex flex-col gap-6 min-w-0'>

          {/* Team / Agent presence */}
          <div>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Your team
              </h2>
              <button
                onClick={() => router.push('/dashboard/agents')}
                className='flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-[#9A66FF] transition-colors'
              >
                All <IconArrowRight className='h-3 w-3' />
              </button>
            </div>

            {loading ? (
              <div className='grid grid-cols-3 gap-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className='h-24 animate-pulse rounded-xl border border-border/30 bg-muted/20' />
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div
                className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 py-8 text-center'
                style={{ background: `${P.purple}04` }}
              >
                <p className='text-xs text-muted-foreground/50'>No agents yet.</p>
                <button
                  onClick={() => router.push('/dashboard/agents')}
                  className='mt-2 text-xs text-[#9A66FF] hover:underline'
                >
                  Create your first agent →
                </button>
              </div>
            ) : (
              <div className='grid grid-cols-3 gap-1.5'>
                {agents.slice(0, 9).map(agent => (
                  <AgentDeskCard
                    key={agent.id}
                    agent={agent}
                    busyExec={agentBusyMap[agent.id]}
                  />
                ))}
              </div>
            )}

            {/* Workforce summary */}
            {workforces.length > 0 && (
              <div className='mt-3 space-y-1'>
                {workforces.slice(0, 3).map(wf => {
                  const wfExec = activeExecs.find(e => e.workforce_id === wf.id);
                  return (
                    <button
                      key={wf.id}
                      onClick={() => router.push(`/dashboard/workforces/${wf.id}`)}
                      className='group w-full flex items-center gap-2.5 rounded-lg border border-border/30 px-2.5 py-2 text-left transition-colors hover:border-border/60 hover:bg-white/[0.02]'
                    >
                      <div
                        className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs'
                        style={{ background: `${P.purple}18`, border: `1px solid ${P.purple}30` }}
                      >
                        {wf.icon || '⚡'}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-[11px] font-medium text-foreground/80'>{wf.name}</p>
                        {wfExec && (
                          <p className='truncate text-[9px] text-muted-foreground/45'>
                            ⚡ {wfExec.title || wfExec.objective}
                          </p>
                        )}
                      </div>
                      {wfExec ? (
                        <span className='h-1.5 w-1.5 rounded-full shrink-0 animate-pulse' style={{ backgroundColor: P.purple }} />
                      ) : (
                        <span className='h-1.5 w-1.5 rounded-full shrink-0 bg-muted-foreground/20' />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity feed */}
          {recentActivity.length > 0 && (
            <div>
              <div className='mb-3 flex items-center justify-between'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                  Activity
                </h2>
                <button
                  onClick={() => router.push('/dashboard/activity')}
                  className='flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-[#9A66FF] transition-colors'
                >
                  All <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
              <div
                className='rounded-xl border border-border/30 px-3 divide-y divide-border/20'
                style={{ background: 'rgba(255,255,255,0.01)' }}
              >
                {recentActivity.slice(0, 6).map((evt, i) => (
                  <ActivityFeedItem
                    key={evt.id}
                    evt={evt}
                    agentsMap={agentsMap}
                    compact
                    idx={i}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Providers */}
          {providers.length > 0 && (
            <div>
              <div className='mb-3 flex items-center justify-between'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                  Providers
                </h2>
                <button
                  onClick={() => router.push('/dashboard/providers')}
                  className='flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-[#14FFF7] transition-colors'
                >
                  All <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
              <div className='space-y-1'>
                {providers.map(pv => (
                  <div key={pv.id} className='flex items-center gap-2.5 rounded-lg border border-border/30 px-2.5 py-2'>
                    <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md' style={{ background: `${P.cyan}14` }}>
                      <IconServer className='h-3.5 w-3.5' style={{ color: P.cyan }} />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-[11px] font-medium text-foreground/80'>{pv.name}</p>
                      <p className='text-[9px] text-muted-foreground/40'>
                        {pv.provider_type} · {pv.models?.length || 0} model{(pv.models?.length || 0) !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span
                      className='h-1.5 w-1.5 rounded-full shrink-0'
                      style={{ backgroundColor: pv.is_enabled ? P.green : P.muted }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
