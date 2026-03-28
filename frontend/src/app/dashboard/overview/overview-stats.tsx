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
  IconPlus,
  IconServer,
  IconShieldCheck,
  IconX,
  IconAlertTriangle,
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
  running:           { color: P.purple, label: 'Running',        pulse: true },
  planning:          { color: P.cyan,   label: 'Planning',       pulse: true },
  completed:         { color: P.green,  label: 'Completed' },
  failed:            { color: P.red,    label: 'Failed' },
  halted:            { color: P.amber,  label: 'Halted' },
  awaiting_approval: { color: P.amber,  label: 'Needs approval', pulse: true },
  pending_approval:  { color: P.amber,  label: 'Needs approval', pulse: true },
};

interface ExecWithMeta extends Execution {
  workforce_name?: string;
  workforce_agents?: Agent[];
}

/* ─── Ambient pulse ring ─── */
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

/* ─── Agent chip (compact for inside workforce card) ─── */
function AgentChip({ agent, busy }: { agent: Agent; busy: boolean }) {
  const color = busy ? P.purple : agent.status === 'active' ? P.green : P.muted;
  return (
    <div className='relative flex flex-col items-center gap-1'>
      <div className='relative'>
        <AgentPresence color={color} active={busy} />
        <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} name={agent.name} size='sm' />
        <span
          className='absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background'
          style={{ backgroundColor: color, boxShadow: busy ? `0 0 5px ${color}` : undefined }}
        />
      </div>
      <span className='text-[9px] font-medium leading-none text-muted-foreground/50 max-w-[48px] truncate text-center'>
        {agent.name.split(' ')[0]}
      </span>
    </div>
  );
}

/* ─── Workforce room card ─── */
function WorkforceRoomCard({
  wf, agents, activeExec, needsActionExec, agentBusyMap,
}: {
  wf: Workforce;
  agents: Agent[];
  activeExec?: ExecWithMeta;
  needsActionExec?: ExecWithMeta;
  agentBusyMap: Record<string, ExecWithMeta>;
}) {
  const router = useRouter();
  const highlightExec = activeExec || needsActionExec;
  const cfg = highlightExec ? (execStatusCfg[highlightExec.status] || { color: P.muted, label: highlightExec.status }) : null;
  const isLive = cfg?.pulse;
  const wfAgentIds = wf.agent_ids || [];
  const wfAgents = wfAgentIds.map(id => agents.find(a => a.id === id)).filter(Boolean) as Agent[];
  const completedSteps = (highlightExec?.plan || []).filter(s => s.status === 'done').length;
  const totalSteps = (highlightExec?.plan || []).length;
  const progress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className='group relative flex flex-col rounded-2xl border cursor-pointer overflow-hidden transition-all'
      style={{
        borderColor: isLive ? `${cfg!.color}35` : 'rgba(255,255,255,0.07)',
        background: isLive
          ? `linear-gradient(135deg, ${cfg!.color}0A 0%, rgba(255,255,255,0.01) 100%)`
          : 'rgba(255,255,255,0.02)',
      }}
      onClick={() => router.push(`/dashboard/workforces/${wf.id}`)}
    >
      {/* live shimmer */}
      {isLive && (
        <div
          className='pointer-events-none absolute inset-0'
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${cfg!.color}05 50%, transparent 100%)`,
            animation: 'shimmer 3s ease-in-out infinite',
          }}
        />
      )}

      <div className='relative p-4 flex flex-col gap-3 flex-1'>
        {/* Header */}
        <div className='flex items-start justify-between gap-2'>
          <div className='flex items-center gap-2.5 min-w-0'>
            <div
              className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base'
              style={{ background: `${P.purple}18`, border: `1px solid ${P.purple}30` }}
            >
              {wf.icon || '⚡'}
            </div>
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-foreground/90 truncate'>{wf.name}</p>
              <p className='text-[10px] text-muted-foreground/40 truncate'>{wfAgents.length} agent{wfAgents.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* status badge */}
          {cfg ? (
            <div
              className='flex items-center gap-1.5 rounded-full px-2 py-0.5 shrink-0'
              style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}30` }}
            >
              {isLive && (
                <span className='relative flex h-1.5 w-1.5 shrink-0'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full opacity-75' style={{ backgroundColor: cfg.color }} />
                  <span className='relative inline-flex h-1.5 w-1.5 rounded-full' style={{ backgroundColor: cfg.color }} />
                </span>
              )}
              <span className='text-[10px] font-semibold' style={{ color: cfg.color }}>{cfg.label}</span>
            </div>
          ) : (
            <div
              className='flex items-center gap-1.5 rounded-full px-2 py-0.5 shrink-0'
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <span className='h-1.5 w-1.5 rounded-full bg-muted-foreground/30' />
              <span className='text-[10px] text-muted-foreground/40'>Idle</span>
            </div>
          )}
        </div>

        {/* Active mission info */}
        {highlightExec && (
          <div className='rounded-lg px-2.5 py-2' style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className='text-[11px] font-medium text-foreground/70 line-clamp-2 leading-snug'>
              {highlightExec.title || highlightExec.objective}
            </p>
            {totalSteps > 0 && isLive && (
              <div className='mt-2'>
                <div className='h-1 w-full overflow-hidden rounded-full bg-white/5'>
                  <motion.div
                    className='h-full rounded-full'
                    style={{ backgroundColor: cfg!.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <p className='mt-1 text-[9px] text-muted-foreground/30'>{completedSteps}/{totalSteps} steps</p>
              </div>
            )}
          </div>
        )}

        {/* Agent row */}
        {wfAgents.length > 0 && (
          <div className='flex items-center gap-2 flex-wrap'>
            {wfAgents.slice(0, 6).map(agent => (
              <AgentChip key={agent.id} agent={agent} busy={!!agentBusyMap[agent.id]} />
            ))}
            {wfAgents.length > 6 && (
              <span className='text-[9px] text-muted-foreground/30'>+{wfAgents.length - 6}</span>
            )}
          </div>
        )}
      </div>

      {/* Launch CTA — visible on hover when idle */}
      {!highlightExec && (
        <div
          className='absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 py-2.5
            opacity-0 group-hover:opacity-100 transition-opacity rounded-b-2xl'
          style={{ background: `linear-gradient(to top, ${P.purple}18, transparent)` }}
        >
          <IconPlayerPlay className='h-3 w-3' style={{ color: P.purple }} />
          <span className='text-[11px] font-medium' style={{ color: P.purple }}>Launch mission</span>
        </div>
      )}
    </motion.div>
  );
}

/* ─── Needs-action execution card ─── */
function ActionCard({ exec }: { exec: ExecWithMeta }) {
  const router = useRouter();
  const isApproval = exec.status === 'awaiting_approval' || exec.status === 'pending_approval';
  const color = isApproval ? P.amber : P.red;
  const Icon = isApproval ? IconShieldCheck : IconAlertTriangle;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
      className='flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-all hover:brightness-110'
      style={{ borderColor: `${color}30`, background: `${color}08`, borderLeftWidth: 2, borderLeftColor: color }}
    >
      <Icon className='h-4 w-4 shrink-0' style={{ color }} />
      <div className='min-w-0 flex-1'>
        <p className='text-xs font-medium text-foreground/90 line-clamp-1'>
          {exec.title || exec.objective}
        </p>
        <p className='text-[10px] text-muted-foreground/45 mt-0.5'>
          {exec.workforce_name} · {timeAgo(exec.created_at)}
        </p>
      </div>
      <span className='text-[10px] font-semibold shrink-0' style={{ color }}>
        {isApproval ? 'Review plan' : 'Halted'}
      </span>
      <IconArrowRight className='h-3.5 w-3.5 shrink-0 opacity-50' style={{ color }} />
    </motion.div>
  );
}

/* ─── Main component ─── */
export function OverviewStats() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading]                   = useState(true);
  const [agents, setAgents]                     = useState<Agent[]>([]);
  const [workforces, setWorkforces]             = useState<Workforce[]>([]);
  const [executions, setExecutions]             = useState<ExecWithMeta[]>([]);
  const [providers, setProviders]               = useState<Provider[]>([]);
  const [totalTokens, setTotalTokens]           = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recentActivity, setRecentActivity]     = useState<ActivityEvent[]>([]);
  const [clock, setClock]                       = useState(new Date());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const needsAction = executions.filter(e => ['awaiting_approval', 'pending_approval'].includes(e.status));
  const isActive    = activeExecs.length > 0;

  const agentBusyMap: Record<string, ExecWithMeta> = {};
  for (const exec of activeExecs) {
    for (const s of exec.plan || []) {
      if (s.status === 'running' && s.agent_id) agentBusyMap[s.agent_id] = exec;
    }
  }

  const activeExecByWf  = activeExecs.reduce<Record<string, ExecWithMeta>>((m, e) => { m[e.workforce_id] = e; return m; }, {});
  const actionExecByWf  = needsAction.reduce<Record<string, ExecWithMeta>>((m, e) => { m[e.workforce_id] = e; return m; }, {});

  const clockStr = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr  = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const connectedProviders = providers.filter(p => p.is_enabled).length;
  const recentExecs = executions.filter(e => ['completed','failed','halted'].includes(e.status)).slice(0, 6);

  return (
    <div className='flex flex-col gap-6'>
      <style>{`
        @keyframes shimmer {
          0%,100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
      `}</style>

      {/* ── HEADER ── */}
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
            transition={{ delay: 0.1 }}
            className='mt-0.5 text-sm text-muted-foreground'
          >
            {isActive
              ? `${activeExecs.length} mission${activeExecs.length !== 1 ? 's' : ''} running · ${agents.filter(a=>a.status==='active').length} agents online`
              : 'Your office is standing by'}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          className='flex items-center gap-3'
        >
          {/* workspace pulse */}
          <div className='flex items-center gap-1.5'>
            <span className='relative flex h-2 w-2'>
              {isActive ? (
                <>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60' />
                  <span className='relative inline-flex h-2 w-2 rounded-full bg-green-400' />
                </>
              ) : (
                <span className='relative inline-flex h-2 w-2 rounded-full bg-muted-foreground/30' />
              )}
            </span>
            <span className='text-[11px] font-medium hidden sm:block' style={{ color: isActive ? P.green : P.muted }}>
              {isActive ? 'Office active' : 'Idle'}
            </span>
          </div>

          <div className='text-right'>
            <p className='text-base font-mono font-semibold tabular-nums leading-none text-foreground/80'>{clockStr}</p>
            <p className='text-[10px] text-muted-foreground/40'>{dateStr}</p>
          </div>
        </motion.div>
      </div>

      {/* ── NEEDS ATTENTION ── */}
      <AnimatePresence>
        {(pendingApprovals > 0 || needsAction.length > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className='flex flex-col gap-2'
          >
            <div className='flex items-center gap-2'>
              <span className='relative flex h-2 w-2 shrink-0'>
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full opacity-75' style={{ backgroundColor: P.amber }} />
                <span className='relative inline-flex h-2 w-2 rounded-full' style={{ backgroundColor: P.amber }} />
              </span>
              <h2 className='text-xs font-semibold uppercase tracking-wider' style={{ color: P.amber }}>
                Needs your attention
              </h2>
            </div>
            <AnimatePresence>
              {needsAction.map(exec => <ActionCard key={exec.id} exec={exec} />)}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OFFICE FLOOR: workforces ── */}
      <div>
        <div className='mb-3 flex items-center justify-between'>
          <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Your teams</h2>
          <button
            onClick={() => router.push('/dashboard/workforces')}
            className='flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-[#9A66FF] transition-colors'
          >
            Manage <IconArrowRight className='h-3 w-3' />
          </button>
        </div>

        {loading ? (
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className='h-40 animate-pulse rounded-2xl border border-border/30 bg-muted/10' />
            ))}
          </div>
        ) : workforces.length === 0 ? (
          <div
            className='flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 py-12 text-center'
            style={{ background: `${P.purple}04` }}
          >
            <span className='text-3xl mb-3'>🏢</span>
            <p className='text-sm font-medium text-foreground/60'>No teams yet</p>
            <p className='text-xs text-muted-foreground/40 mt-1'>Create a workforce to staff your first team</p>
            <button
              onClick={() => router.push('/dashboard/workforces')}
              className='mt-4 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all hover:scale-105'
              style={{ borderColor: `${P.purple}40`, color: P.purple, background: `${P.purple}10` }}
            >
              <IconPlus className='h-3 w-3' /> Create workforce
            </button>
          </div>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            <AnimatePresence>
              {workforces.map((wf, i) => (
                <motion.div key={wf.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                  <WorkforceRoomCard
                    wf={wf}
                    agents={agents}
                    activeExec={activeExecByWf[wf.id]}
                    needsActionExec={actionExecByWf[wf.id]}
                    agentBusyMap={agentBusyMap}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── BOTTOM: recent missions + activity + infra ── */}
      <div className='grid gap-6 lg:grid-cols-[1fr_280px]'>

        {/* Recent completed missions */}
        <div>
          <div className='mb-3 flex items-center justify-between'>
            <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Recent missions</h2>
            <button
              onClick={() => router.push('/dashboard/executions')}
              className='flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-[#9A66FF] transition-colors'
            >
              All <IconArrowRight className='h-3 w-3' />
            </button>
          </div>

          {loading ? (
            <div className='space-y-1.5'>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className='h-12 animate-pulse rounded-xl border border-border/30 bg-muted/10' style={{ opacity: 1 - i * 0.2 }} />
              ))}
            </div>
          ) : recentExecs.length === 0 ? (
            <div className='flex flex-col items-center justify-center rounded-xl border border-dashed border-border/40 py-10 text-center'
              style={{ background: `${P.purple}04` }}>
              <span className='text-2xl mb-2'>🚀</span>
              <p className='text-xs text-muted-foreground/50'>No completed missions yet</p>
            </div>
          ) : (
            <div className='space-y-1.5'>
              {recentExecs.map((exec, i) => {
                const cfg = execStatusCfg[exec.status] || { color: P.muted, label: exec.status };
                return (
                  <motion.div
                    key={exec.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                    className='group flex cursor-pointer items-center gap-3 rounded-xl border border-border/30 px-3 py-2.5 transition-all hover:border-border/60 hover:bg-white/[0.02]'
                    style={{ borderLeftWidth: 2, borderLeftColor: `${cfg.color}80` }}
                  >
                    <div className='flex shrink-0 -space-x-1.5'>
                      {(exec.workforce_agents || []).slice(0, 3).map(a => (
                        <EntityAvatar key={a.id} icon={a.icon} color={a.color} avatarUrl={a.avatar_url} name={a.name} size='xs' className='border-2 border-background' />
                      ))}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='text-xs font-medium line-clamp-1 text-foreground/90'>{exec.title || exec.objective}</p>
                      <p className='text-[10px] text-muted-foreground/40 mt-0.5'>
                        {exec.workforce_name}{exec.tokens_used > 0 ? ` · ${formatTokens(exec.tokens_used)} tok` : ''}
                      </p>
                    </div>
                    <div className='flex shrink-0 flex-col items-end gap-0.5'>
                      <div className='flex items-center gap-1'>
                        {exec.status === 'completed' && <IconCheck className='h-3 w-3' style={{ color: cfg.color }} />}
                        {exec.status === 'failed'    && <IconX     className='h-3 w-3' style={{ color: cfg.color }} />}
                        {exec.status === 'halted'    && <IconClock className='h-3 w-3' style={{ color: cfg.color }} />}
                        <span className='text-[10px] font-semibold' style={{ color: cfg.color }}>{cfg.label}</span>
                      </div>
                      <span className='text-[9px] text-muted-foreground/30'>{timeAgo(exec.created_at)}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column: activity + infra */}
        <div className='flex flex-col gap-6 min-w-0'>

          {/* Quick stats */}
          <div className='grid grid-cols-2 gap-2'>
            {[
              { value: loading ? '—' : agents.filter(a=>a.status==='active').length, label: 'agents online', color: P.green, href: '/dashboard/agents' },
              { value: loading ? '—' : activeExecs.length, label: 'running', color: P.purple, href: '/dashboard/executions' },
              { value: loading ? '—' : formatTokens(totalTokens), label: 'tokens used', color: P.amber, href: '/dashboard/providers' },
              { value: loading ? '—' : connectedProviders, label: 'providers', color: P.cyan, href: '/dashboard/providers' },
            ].map(({ value, label, color, href }) => (
              <button
                key={label}
                onClick={() => router.push(href)}
                className='flex flex-col rounded-xl border px-3 py-2.5 transition-all hover:scale-[1.03]'
                style={{ borderColor: `${color}20`, background: `${color}07` }}
              >
                <span className='text-xl font-extrabold tabular-nums' style={{ color }}>{value}</span>
                <span className='text-[10px] text-muted-foreground/50 mt-0.5'>{label}</span>
              </button>
            ))}
          </div>

          {/* Activity feed */}
          {recentActivity.length > 0 && (
            <div>
              <div className='mb-2.5 flex items-center justify-between'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Activity</h2>
                <button
                  onClick={() => router.push('/dashboard/activity')}
                  className='flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-[#9A66FF] transition-colors'
                >
                  All <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
              <div className='rounded-xl border border-border/30 px-3 divide-y divide-border/20' style={{ background: 'rgba(255,255,255,0.01)' }}>
                {recentActivity.slice(0, 5).map((evt, i) => (
                  <ActivityFeedItem key={evt.id} evt={evt} agentsMap={agentsMap} compact idx={i} />
                ))}
              </div>
            </div>
          )}

          {/* Providers */}
          {providers.length > 0 && (
            <div>
              <div className='mb-2.5 flex items-center justify-between'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Infrastructure</h2>
                <button
                  onClick={() => router.push('/dashboard/providers')}
                  className='flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-[#14FFF7] transition-colors'
                >
                  All <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
              <div className='space-y-1'>
                {providers.map(pv => (
                  <div key={pv.id} className='flex items-center gap-2.5 rounded-lg border border-border/30 px-2.5 py-2'>
                    <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md' style={{ background: `${P.cyan}12` }}>
                      <IconServer className='h-3.5 w-3.5' style={{ color: P.cyan }} />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-[11px] font-medium text-foreground/80'>{pv.name}</p>
                      <p className='text-[9px] text-muted-foreground/35'>{pv.provider_type} · {pv.models?.length || 0} models</p>
                    </div>
                    <span className='h-1.5 w-1.5 rounded-full shrink-0' style={{ backgroundColor: pv.is_enabled ? P.green : P.muted }} />
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
