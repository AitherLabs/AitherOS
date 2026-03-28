'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconPlus,
  IconArrowRight,
  IconArrowLeft,
  IconLoader2,
  IconTarget,
  IconShield,
  IconBolt,
  IconUsers
} from '@tabler/icons-react';
import api, { Agent, Workforce } from '@/lib/api';
import { EntityAvatar, EntityAvatarStack } from '@/components/entity-avatar';
import { IconPicker } from '@/components/icon-picker';

// ── Tactical Status System ───────────────────────────────────────────────────

interface TacticalStatus {
  label: string;
  color: string;
  bg: string;
  border: string;
  pulse: boolean;
}

const TACTICAL_STATUS: Record<string, TacticalStatus> = {
  draft:             { label: 'STANDBY',         color: '#FFBF47', bg: '#FFBF4718', border: '#FFBF4740', pulse: false },
  planning:          { label: 'BRIEFING',         color: '#14FFF7', bg: '#14FFF718', border: '#14FFF740', pulse: true  },
  executing:         { label: 'ACTIVE OPS',       color: '#9A66FF', bg: '#9A66FF18', border: '#9A66FF40', pulse: true  },
  running:           { label: 'ACTIVE OPS',       color: '#9A66FF', bg: '#9A66FF18', border: '#9A66FF40', pulse: true  },
  completed:         { label: 'MISSION COMPLETE', color: '#56D090', bg: '#56D09018', border: '#56D09040', pulse: false },
  failed:            { label: 'COMPROMISED',      color: '#EF4444', bg: '#EF444418', border: '#EF444440', pulse: false },
  halted:            { label: 'STAND DOWN',       color: '#FFBF47', bg: '#FFBF4718', border: '#FFBF4740', pulse: false },
  active:            { label: 'DEPLOYED',         color: '#56D090', bg: '#56D09018', border: '#56D09040', pulse: true  },
  pending_approval:  { label: 'AWAITING ORDERS',  color: '#FFBF47', bg: '#FFBF4718', border: '#FFBF4740', pulse: true  },
  awaiting_approval: { label: 'AWAITING APPROVAL', color: '#14FFF7', bg: '#14FFF718', border: '#14FFF740', pulse: true  },
};

function getTacticalStatus(status: string): TacticalStatus {
  return TACTICAL_STATUS[status] || { label: status.toUpperCase(), color: '#888', bg: '#88888818', border: '#88888840', pulse: false };
}

// ── Workforce Emblem ─────────────────────────────────────────────────────────

function WorkforceEmblem({ icon, color, size = 72 }: { icon: string; color: string; size?: number }) {
  const half = size / 2;
  const r = half * 0.82;
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${half + r * Math.cos(a)},${half + r * Math.sin(a)}`;
  }).join(' ');
  const innerR = r * 0.72;
  const innerPoints = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${half + innerR * Math.cos(a)},${half + innerR * Math.sin(a)}`;
  }).join(' ');

  return (
    <div className='relative shrink-0' style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className='absolute inset-0'>
        {/* Outer hex fill */}
        <polygon points={points} fill={color + '18'} stroke={color + '50'} strokeWidth='1.5' />
        {/* Inner hex outline */}
        <polygon points={innerPoints} fill='none' stroke={color + '30'} strokeWidth='1' strokeDasharray='3 2' />
        {/* Corner ticks */}
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const x1 = half + r * Math.cos(a);
          const y1 = half + r * Math.sin(a);
          const x2 = half + (r + 4) * Math.cos(a);
          const y2 = half + (r + 4) * Math.sin(a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color + '60'} strokeWidth='1.5' />;
        })}
      </svg>
      {/* Icon centered */}
      <div className='absolute inset-0 flex items-center justify-center' style={{ fontSize: size * 0.38 }}>
        {icon}
      </div>
    </div>
  );
}

// ── Team Structure Diagram ────────────────────────────────────────────────────

function TeamStructure({ agents, color, leaderId }: { agents: Agent[]; color: string; leaderId?: string }) {
  if (agents.length === 0) return null;
  const sorted = leaderId
    ? [agents.find(a => a.id === leaderId), ...agents.filter(a => a.id !== leaderId)].filter(Boolean) as Agent[]
    : agents;
  const orchestrator = sorted[0];
  const members = sorted.slice(1, 5); // cap at 4 to keep card compact

  return (
    <div className='flex flex-col items-center'>
      {/* Orchestrator / Lead */}
      <div className='flex flex-col items-center gap-1'>
        <div className='relative'>
          <div className='absolute -inset-1 rounded-full blur-sm' style={{ background: color + '40' }} />
          <EntityAvatar icon={orchestrator.icon} color={orchestrator.color || color} avatarUrl={orchestrator.avatar_url} name={orchestrator.name} size='sm' />
        </div>
        <span className='rounded px-1.5 font-mono text-[8px] font-bold tracking-widest' style={{ color, backgroundColor: color + '15' }}>
          LEAD
        </span>
      </div>

      {members.length > 0 && (
        <>
          {/* Vertical drop from lead */}
          <div className='h-3 w-px' style={{ backgroundColor: color + '60' }} />

          {/* Horizontal branch spanning all members — 44px = 32px avatar + 12px gap */}
          {members.length > 1 && (
            <div className='h-px' style={{ width: `${(members.length - 1) * 44}px`, backgroundColor: color + '40' }} />
          )}

          {/* Members row — each with a vertical drop line above */}
          <div className='flex items-start gap-3'>
            {members.map((agent) => (
              <div key={agent.id} className='flex flex-col items-center gap-0.5'>
                <div className='h-3 w-px' style={{ backgroundColor: color + '40' }} />
                <EntityAvatar icon={agent.icon} color={agent.color || color} avatarUrl={agent.avatar_url} name={agent.name} size='sm' />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

export default function WorkforcesPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsMap, setAgentsMap] = useState<Record<string, Agent>>({});
  const [loading, setLoading] = useState(true);
  const [cumStats, setCumStats] = useState({ totalTokens: 0, totalMissions: 0, completed: 0, failed: 0 });

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formIcon, setFormIcon] = useState('\ud83d\udc65');
  const [formColor, setFormColor] = useState('#9A66FF');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formObjective, setFormObjective] = useState('');
  const [formBudgetTokens, setFormBudgetTokens] = useState(1000000);
  const [formBudgetTime, setFormBudgetTime] = useState(7200);
  const [formAgentIds, setFormAgentIds] = useState<string[]>([]);
  const [formLeaderAgentId, setFormLeaderAgentId] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes, statsRes] = await Promise.all([
        api.listWorkforces(),
        api.listAgents(),
        api.getGlobalStats()
      ]);
      const wfList = wfRes.data || [];
      setWorkforces(wfList);
      setAgents(agRes.data || []);
      const map: Record<string, Agent> = {};
      for (const a of agRes.data || []) map[a.id] = a;
      setAgentsMap(map);

      setCumStats({
        totalTokens: statsRes.data.total_tokens,
        totalMissions: statsRes.data.total_missions,
        completed: statsRes.data.completed,
        failed: statsRes.data.failed
      });
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openCreate() {
    setCreateStep(0);
    setFormIcon('\ud83d\udc65');
    setFormColor('#9A66FF');
    setFormName('');
    setFormDescription('');
    setFormObjective('');
    setFormBudgetTokens(1000000);
    setFormBudgetTime(7200);
    setFormAgentIds([]);
    setFormLeaderAgentId('');
    setCreateOpen(true);
  }

  function toggleAgent(agentId: string) {
    setFormAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await api.createWorkforce({
        name: formName,
        description: formDescription,
        objective: formObjective,
        icon: formIcon,
        color: formColor,
        budget_tokens: formBudgetTokens,
        budget_time_s: formBudgetTime,
        agent_ids: formAgentIds,
        leader_agent_id: formLeaderAgentId
      });
      setCreateOpen(false);
      if (res.data?.id) {
        router.push(`/dashboard/workforces/${res.data.id}`);
      } else {
        await loadData();
      }
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className='flex h-[50vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  const activeCount = workforces.filter((w) => ['executing', 'running', 'planning', 'active'].includes(w.status)).length;
  const successRate = cumStats.totalMissions > 0 ? Math.round((cumStats.completed / cumStats.totalMissions) * 100) : null;

  return (
    <div className='space-y-6 p-6'>
      {/* Cumulative Stats Banner */}
      {cumStats.totalMissions > 0 && (
        <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
          {[
            { label: 'TOTAL MISSIONS', value: cumStats.totalMissions.toString(), color: '#9A66FF', icon: '⚡' },
            { label: 'TOKENS MANAGED', value: formatTokens(cumStats.totalTokens), color: '#14FFF7', icon: '🔮' },
            { label: 'COMPLETED', value: cumStats.completed.toString(), color: '#56D090', icon: '✓' },
            { label: 'SUCCESS RATE', value: successRate !== null ? `${successRate}%` : '—', color: successRate !== null && successRate >= 80 ? '#56D090' : successRate !== null && successRate >= 50 ? '#FFBF47' : '#EF4444', icon: '📊' }
          ].map((stat) => (
            <div key={stat.label} className='relative overflow-hidden rounded-lg border border-border/30 bg-card/60 px-4 py-3'>
              <div className='pointer-events-none absolute inset-0' style={{ background: `radial-gradient(ellipse at 0% 50%, ${stat.color}08, transparent 70%)` }} />
              <div className='flex items-center gap-2'>
                <span className='text-base'>{stat.icon}</span>
                <div>
                  <p className='font-mono text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50'>{stat.label}</p>
                  <p className='font-mono text-lg font-black leading-tight' style={{ color: stat.color }}>{stat.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Mission Board Header */}
      <div className='flex items-start justify-between'>
        <div>
          <div className='mb-1 flex items-center gap-3'>
            <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[#9A66FF]/10'>
              <IconTarget className='h-4 w-4 text-[#9A66FF]' />
            </div>
            <h2 className='font-mono text-2xl font-black tracking-tight text-foreground'>
              MISSION BOARD
            </h2>
            {activeCount > 0 && (
              <span className='flex items-center gap-1.5 rounded-full border border-[#56D090]/30 bg-[#56D090]/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-[#56D090]'>
                <span className='relative flex h-1.5 w-1.5'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-[#56D090] opacity-75' />
                  <span className='relative inline-flex h-1.5 w-1.5 rounded-full bg-[#56D090]' />
                </span>
                {activeCount} ACTIVE
              </span>
            )}
          </div>
          <p className='pl-11 font-mono text-xs text-muted-foreground/70'>
            {workforces.length} UNIT{workforces.length !== 1 ? 'S' : ''} REGISTERED · CLICK TO DEPLOY OR INSPECT
          </p>
        </div>
        <Button onClick={openCreate} className='bg-[#9A66FF] font-mono hover:bg-[#9A66FF]/90'>
          <IconPlus className='mr-2 h-4 w-4' />
          NEW UNIT
        </Button>
      </div>

      <Separator className='opacity-30' />

      {workforces.length === 0 ? (
        <div
          className='flex h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border/30 transition-all hover:border-[#9A66FF]/40 hover:bg-[#9A66FF]/3'
          onClick={openCreate}
        >
          <div className='flex h-14 w-14 items-center justify-center rounded-2xl border border-[#9A66FF]/20 bg-[#9A66FF]/10'>
            <IconShield className='h-6 w-6 text-[#9A66FF]' />
          </div>
          <div className='text-center'>
            <p className='font-mono font-semibold uppercase tracking-wider'>No units assembled</p>
            <p className='mt-1 text-sm text-muted-foreground'>
              Recruit agents and assemble your first operational unit.
            </p>
          </div>
        </div>
      ) : (
        <div className='grid gap-5 md:grid-cols-2'>
          {workforces.map((wf) => {
            const ts = getTacticalStatus(wf.status);
            const accentColor = wf.color || '#9A66FF';
            const wfAgents = (wf.agent_ids || []).map((id) => agentsMap[id]).filter(Boolean) as Agent[];
            const tokenPct = Math.min(100, Math.round((wf.budget_tokens / 2_000_000) * 100));

            return (
              <div
                key={wf.id}
                className='group relative cursor-pointer overflow-hidden rounded-xl border border-border/40 bg-background/90 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5'
                onClick={() => router.push(`/dashboard/workforces/${wf.id}`)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 40px ${accentColor}20, 0 0 0 1px ${accentColor}25`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                {/* Top accent line */}
                <div className='h-0.5 w-full' style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }} />

                {/* Background glow on hover */}
                <div
                  className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                  style={{ background: `radial-gradient(ellipse at 30% 0%, ${accentColor}06 0%, transparent 65%)` }}
                />

                {/* Corner scan line decoration */}
                <div className='pointer-events-none absolute right-3 top-3 opacity-20'>
                  <svg width='24' height='24' viewBox='0 0 24 24'>
                    <path d='M24 0 L24 8 M24 0 L16 0' stroke={accentColor} strokeWidth='1.5' fill='none' />
                  </svg>
                </div>
                <div className='pointer-events-none absolute bottom-3 left-3 opacity-20'>
                  <svg width='24' height='24' viewBox='0 0 24 24'>
                    <path d='M0 24 L0 16 M0 24 L8 24' stroke={accentColor} strokeWidth='1.5' fill='none' />
                  </svg>
                </div>

                <div className='p-5'>
                  {/* Header row: Emblem + Info + Status */}
                  <div className='mb-4 flex items-start gap-4'>
                    <WorkforceEmblem icon={wf.icon || '👥'} color={accentColor} size={72} />

                    <div className='min-w-0 flex-1'>
                      <div className='mb-1.5 flex items-start justify-between gap-2'>
                        <h3 className='font-mono text-base font-bold leading-tight tracking-wide text-foreground'>
                          {wf.name.toUpperCase()}
                        </h3>
                        {/* Tactical status badge */}
                        <span
                          className='shrink-0 rounded px-2 py-0.5 font-mono text-[9px] font-black tracking-widest'
                          style={{ backgroundColor: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}
                        >
                          {ts.pulse && (
                            <span className='mr-1 inline-flex h-1.5 w-1.5 translate-y-[-0.5px] rounded-full align-middle'
                              style={{ backgroundColor: ts.color, boxShadow: `0 0 4px ${ts.color}`, animation: 'pulse 1.5s ease-in-out infinite' }}
                            />
                          )}
                          {ts.label}
                        </span>
                      </div>
                      <p className='mb-2 text-xs leading-relaxed text-muted-foreground/70 line-clamp-2'>
                        {wf.description || wf.objective}
                      </p>
                      {/* Resource row */}
                      <div className='flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50'>
                        <span>{formatTokens(wf.budget_tokens)} TOK</span>
                        <span className='text-border'>·</span>
                        <span>{formatTime(wf.budget_time_s)} LIMIT</span>
                        <span className='text-border'>·</span>
                        <span>{wfAgents.length} AGENT{wfAgents.length !== 1 ? 'S' : ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* Separator with label */}
                  <div className='mb-4 flex items-center gap-2'>
                    <div className='h-px flex-1' style={{ background: `linear-gradient(90deg, ${accentColor}40, transparent)` }} />
                    <span className='font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40'>
                      <IconUsers className='inline h-2.5 w-2.5 mr-1' />
                      TEAM STRUCTURE
                    </span>
                    <div className='h-px flex-1' style={{ background: `linear-gradient(90deg, transparent, ${accentColor}20)` }} />
                  </div>

                  {/* Team Structure Diagram */}
                  {wfAgents.length > 0 ? (
                    <div className='mb-4 flex justify-center'>
                      <TeamStructure agents={wfAgents} color={accentColor} leaderId={wf.leader_agent_id} />
                    </div>
                  ) : (
                    <div className='mb-4 flex h-12 items-center justify-center rounded-lg border border-dashed border-border/30'>
                      <span className='font-mono text-[10px] text-muted-foreground/40'>NO AGENTS ASSIGNED</span>
                    </div>
                  )}

                  {/* Mission objective snippet */}
                  {wf.objective && wf.objective !== wf.description && (
                    <div className='mb-3 rounded-lg border border-border/20 bg-muted/10 px-3 py-2'>
                      <p className='mb-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40'>
                        <IconBolt className='mr-1 inline h-2.5 w-2.5' />
                        OBJECTIVE
                      </p>
                      <p className='text-[11px] leading-relaxed text-muted-foreground/70 line-clamp-2'>
                        {wf.objective}
                      </p>
                    </div>
                  )}

                  {/* Token budget bar */}
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-[9px] text-muted-foreground/40'>BUDGET</span>
                    <div className='relative h-1 flex-1 overflow-hidden rounded-full bg-muted/30'>
                      <div
                        className='h-full rounded-full'
                        style={{
                          width: `${tokenPct}%`,
                          background: `linear-gradient(90deg, ${accentColor}80, ${accentColor})`,
                          boxShadow: `0 0 4px ${accentColor}60`
                        }}
                      />
                    </div>
                    <span className='font-mono text-[9px] text-muted-foreground/40'>{formatTokens(wf.budget_tokens)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Workforce Dialog (Multi-Step) ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='max-w-2xl gap-0 p-0 max-h-[90vh] flex flex-col'>
          {/* Step Indicator */}
          <div className='shrink-0 flex items-center gap-2 border-b px-6 py-4'>
            {['Identity', 'Team', 'Mission'].map((label, i) => (
              <div key={label} className='flex items-center gap-2'>
                <button
                  type='button'
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    i === createStep
                      ? 'bg-[#9A66FF] text-white'
                      : i < createStep
                        ? 'bg-[#9A66FF]/20 text-[#9A66FF]'
                        : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => i < createStep && setCreateStep(i)}
                >
                  {i < createStep ? '\u2713' : i + 1}
                </button>
                <span className={`text-sm ${i === createStep ? 'font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </span>
                {i < 2 && <IconArrowRight className='h-3 w-3 text-muted-foreground/40' />}
              </div>
            ))}
          </div>

          <div className='overflow-y-auto flex-1 min-h-0 px-6 py-6'>
            {/* Step 0: Identity */}
            {createStep === 0 && (
              <div className='space-y-6'>
                <div>
                  <h3 className='text-lg font-semibold'>Workforce icon & name</h3>
                  <p className='text-sm text-muted-foreground'>
                    Give your workforce a recognizable identity.
                  </p>
                </div>
                <div className='flex items-center gap-5'>
                  <IconPicker
                    icon={formIcon}
                    color={formColor}
                    onIconChange={setFormIcon}
                    onColorChange={setFormColor}
                    size='lg'
                  />
                  <div className='flex-1 space-y-3'>
                    <div className='space-y-2'>
                      <Label>Name</Label>
                      <Input
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder='e.g. Research Team'
                        className='text-base'
                        autoFocus
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Description</Label>
                      <Input
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder='What is this team for?'
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Select Agents */}
            {createStep === 1 && (
              <div className='space-y-5'>
                <div>
                  <h3 className='text-lg font-semibold'>Select agents for this workforce</h3>
                  <p className='text-sm text-muted-foreground'>
                    Choose which agents will collaborate. You need at least one.
                  </p>
                </div>
                {agents.length === 0 ? (
                  <div className='flex h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50'>
                    <p className='text-sm text-muted-foreground'>No agents available.</p>
                    <Button variant='link' onClick={() => { setCreateOpen(false); router.push('/dashboard/agents'); }}>
                      Create agents first \u2192
                    </Button>
                  </div>
                ) : (
                  <ScrollArea className='max-h-[40vh]'>
                    <div className='grid gap-2'>
                      {agents.map((agent) => {
                        const selected = formAgentIds.includes(agent.id);
                        return (
                          <button
                            key={agent.id}
                            type='button'
                            className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                              selected
                                ? 'border-[var(--a-color)] bg-[var(--a-color)]/5'
                                : 'border-border/50 hover:border-border'
                            }`}
                            style={{ '--a-color': agent.color } as React.CSSProperties}
                            onClick={() => toggleAgent(agent.id)}
                          >
                            <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} size='md' />
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-center gap-1.5'>
                                <p className='font-medium text-sm'>{agent.name}</p>
                                {(agent.model_type === 'image' || agent.model_type === 'video' || agent.model_type === 'audio') && (
                                  <span className='rounded px-1 py-0.5 text-[8px] font-black tracking-widest uppercase' style={{ background: '#9A66FF22', color: '#9A66FF', border: '1px solid #9A66FF44' }}>
                                    {agent.model_type}
                                  </span>
                                )}
                              </div>
                              <p className='text-xs text-muted-foreground line-clamp-1'>
                                {agent.model} \u00b7 {agent.strategy}
                              </p>
                            </div>
                            <div
                              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
                                selected
                                  ? 'border-[var(--a-color)] bg-[var(--a-color)] text-white'
                                  : 'border-border'
                              }`}
                            >
                              {selected && <span className='text-xs'>\u2713</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
                {formAgentIds.length > 0 && (
                  <div className='space-y-3'>
                    <div className='flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2'>
                      <EntityAvatarStack
                        entities={formAgentIds.map((id) => agentsMap[id]).filter(Boolean).map((a) => ({ icon: a.icon, color: a.color, avatarUrl: a.avatar_url, name: a.name, id: a.id }))}
                        size='xs'
                      />
                      <span className='text-xs text-muted-foreground'>
                        {formAgentIds.length} agent{formAgentIds.length !== 1 ? 's' : ''} selected
                      </span>
                    </div>
                    <div className='space-y-2'>
                      <p className='text-sm font-medium flex items-center gap-1.5'>
                        Team Leader
                        <span className='text-[10px] font-normal text-muted-foreground'>(required — handles summaries & org tasks)</span>
                      </p>
                      <div className='grid gap-2'>
                        {formAgentIds.map((id) => {
                          const a = agentsMap[id];
                          if (!a) return null;
                          const isLeader = formLeaderAgentId === a.id;
                          return (
                            <button
                              key={a.id}
                              type='button'
                              onClick={() => setFormLeaderAgentId(isLeader ? '' : a.id)}
                              className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                                isLeader
                                  ? 'border-[#9A66FF] bg-[#9A66FF]/10'
                                  : 'border-border/50 hover:border-border'
                              }`}
                            >
                              <EntityAvatar icon={a.icon} color={a.color} avatarUrl={a.avatar_url} size='sm' />
                              <div className='flex-1 min-w-0'>
                                <p className='text-sm font-medium'>{a.name}</p>
                                <p className='text-xs text-muted-foreground'>{a.strategy} · {a.model}</p>
                              </div>
                              {isLeader && (
                                <span className='shrink-0 rounded-full bg-[#9A66FF] px-2 py-0.5 text-[10px] font-semibold text-white'>Leader</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Mission & Budget */}
            {createStep === 2 && (
              <div className='space-y-5'>
                <div>
                  <h3 className='text-lg font-semibold'>Define the mission</h3>
                  <p className='text-sm text-muted-foreground'>
                    Set the objective and resource budgets for this workforce.
                  </p>
                </div>
                <div className='space-y-2'>
                  <Label>Objective</Label>
                  <Textarea
                    value={formObjective}
                    onChange={(e) => setFormObjective(e.target.value)}
                    placeholder='The shared goal this workforce will pursue...'
                    rows={3}
                    autoFocus
                  />
                </div>
                <div className='grid grid-cols-2 gap-4'>
                  <div className='space-y-2'>
                    <Label>Token Budget</Label>
                    <Input
                      type='number'
                      value={formBudgetTokens}
                      onChange={(e) => setFormBudgetTokens(parseInt(e.target.value) || 0)}
                    />
                    <p className='text-[10px] text-muted-foreground'>
                      {formatTokens(formBudgetTokens)} tokens
                    </p>
                  </div>
                  <div className='space-y-2'>
                    <Label>Time Budget (seconds)</Label>
                    <Input
                      type='number'
                      value={formBudgetTime}
                      onChange={(e) => setFormBudgetTime(parseInt(e.target.value) || 0)}
                    />
                    <p className='text-[10px] text-muted-foreground'>
                      {formatTime(formBudgetTime)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className='shrink-0 flex items-center justify-between border-t px-6 py-4'>
            <div>
              {createStep > 0 && (
                <Button variant='ghost' onClick={() => setCreateStep(createStep - 1)}>
                  <IconArrowLeft className='mr-1 h-4 w-4' />
                  Back
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              {createStep < 2 ? (
                <Button
                  className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  onClick={() => setCreateStep(createStep + 1)}
                  disabled={
                    (createStep === 0 && !formName.trim()) ||
                    (createStep === 1 && formAgentIds.length === 0)
                  }
                >
                  Continue
                  <IconArrowRight className='ml-1 h-4 w-4' />
                </Button>
              ) : (
                <Button
                  className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  onClick={handleCreate}
                  disabled={saving || !formName.trim() || !formObjective.trim() || formAgentIds.length === 0}
                >
                  {saving && <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />}
                  {saving ? 'Creating...' : 'Create Workforce'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
