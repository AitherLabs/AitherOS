'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import api, { Agent, Workforce } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EntityAvatar } from '@/components/entity-avatar';
import {
  IconArrowRight,
  IconBuilding,
  IconDoorEnter,
  IconRefresh,
  IconUsers
} from '@tabler/icons-react';

type OfficeSeat = {
  agent: Agent;
  leftPct: number;
  topPct: number;
};

const AGENT_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: '#56D090' },
  working: { label: 'Working', color: '#14FFF7' },
  busy: { label: 'Busy', color: '#14FFF7' },
  idle: { label: 'Idle', color: '#A1A1AA' },
  offline: { label: 'Offline', color: '#71717A' },
  blocked: { label: 'Blocked', color: '#EF4444' }
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildOfficeSeats(agents: Agent[]): OfficeSeat[] {
  if (agents.length === 0) return [];

  const seatsPerRing = 8;

  return agents.map((agent, index) => {
    const ring = Math.floor(index / seatsPerRing);
    const indexInRing = index % seatsPerRing;
    const agentsInRing = Math.min(seatsPerRing, agents.length - ring * seatsPerRing);
    const angle = (indexInRing / agentsInRing) * Math.PI * 2 - Math.PI / 2;

    const radiusX = 22 + ring * 8;
    const radiusY = 16 + ring * 6;

    return {
      agent,
      leftPct: clamp(50 + Math.cos(angle) * radiusX, 8, 92),
      topPct: clamp(54 + Math.sin(angle) * radiusY, 12, 92)
    };
  });
}

function getAgentStatusStyle(status: string | undefined): { label: string; color: string } {
  const normalized = (status || '').toLowerCase();
  return AGENT_STATUS_STYLE[normalized] || { label: normalized || 'Unknown', color: '#A1A1AA' };
}

function getAgentAuraOpacity(status: string | undefined): number {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'working' || normalized === 'busy') return 0.55;
  if (normalized === 'blocked') return 0.2;
  if (normalized === 'idle' || normalized === 'offline') return 0.12;
  return 0.25;
}

export default function OfficePage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedWorkforceId, setSelectedWorkforceId] = useState('');

  const loadOfficeData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes] = await Promise.all([api.listWorkforces(), api.listAgents()]);
      const wfList = wfRes.data || [];
      const agList = agRes.data || [];

      setWorkforces(wfList);
      setAgents(agList);
      setSelectedWorkforceId((prev) => {
        if (prev && wfList.some((wf) => wf.id === prev)) return prev;
        return wfList[0]?.id || '';
      });
    } catch (err) {
      console.error('Failed to load office data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    loadOfficeData();
  }, [loadOfficeData]);

  const selectedWorkforce = useMemo(
    () => workforces.find((wf) => wf.id === selectedWorkforceId) || null,
    [workforces, selectedWorkforceId]
  );

  const agentsById = useMemo(() => {
    const map: Record<string, Agent> = {};
    for (const agent of agents) map[agent.id] = agent;
    return map;
  }, [agents]);

  const workforceAgents = useMemo(() => {
    if (!selectedWorkforce) return [];
    return (selectedWorkforce.agent_ids || [])
      .map((agentId) => agentsById[agentId])
      .filter(Boolean) as Agent[];
  }, [agentsById, selectedWorkforce]);

  const officeSeats = useMemo(() => buildOfficeSeats(workforceAgents), [workforceAgents]);

  if (loading) {
    return (
      <div className='flex h-[60vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#14FFF7]/25 border-t-[#14FFF7]' />
      </div>
    );
  }

  if (workforces.length === 0) {
    return (
      <div className='space-y-6 p-6'>
        <div className='rounded-2xl border border-dashed border-border/40 bg-muted/10 p-10 text-center'>
          <div className='mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#14FFF7]/10 text-[#14FFF7]'>
            <IconBuilding className='h-6 w-6' />
          </div>
          <h1 className='text-xl font-semibold'>No office yet</h1>
          <p className='mx-auto mt-2 max-w-md text-sm text-muted-foreground'>
            Create your first workforce and this room will automatically populate with your agents.
          </p>
          <Button asChild className='mt-5 bg-[#14FFF7] text-black hover:bg-[#14FFF7]/90'>
            <Link href='/dashboard/workforces'>Create workforce</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-5 p-6'>
      <style>{`
        @keyframes officePulse {
          0%, 100% { opacity: 0.35; transform: scale(0.98); }
          50% { opacity: 0.7; transform: scale(1.02); }
        }
        @keyframes ringRotate {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes ringCounterRotate {
          from { transform: translate(-50%, -50%) rotate(360deg); }
          to { transform: translate(-50%, -50%) rotate(0deg); }
        }
        @keyframes hologramFloat {
          0%, 100% { transform: translate(-50%, -50%) translateY(0px); }
          50% { transform: translate(-50%, -50%) translateY(-6px); }
        }
        @keyframes seatFloat {
          0%, 100% { transform: translate(-50%, -50%) translateY(0px); }
          50% { transform: translate(-50%, -50%) translateY(-4px); }
        }
        @keyframes scanDrift {
          0% { transform: translateY(0px); }
          100% { transform: translateY(26px); }
        }
      `}</style>

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-semibold tracking-tight'>
            <IconDoorEnter className='h-6 w-6 text-[#14FFF7]' />
            Virtual Office
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Shared room template for every workforce. We can later skin this per team.
          </p>
        </div>
        <Button
          variant='outline'
          className='border-[#14FFF7]/30 text-[#14FFF7] hover:bg-[#14FFF7]/10 hover:text-[#14FFF7]'
          onClick={() => {
            setRefreshing(true);
            loadOfficeData();
          }}
          disabled={refreshing}
        >
          <IconRefresh className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className='flex gap-2 overflow-x-auto pb-1'>
        {workforces.map((wf) => {
          const isActive = wf.id === selectedWorkforceId;
          const accent = wf.color || '#14FFF7';
          return (
            <button
              key={wf.id}
              type='button'
              onClick={() => setSelectedWorkforceId(wf.id)}
              className='shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors'
              style={{
                borderColor: isActive ? `${accent}66` : 'rgba(255,255,255,0.12)',
                backgroundColor: isActive ? `${accent}1F` : 'rgba(255,255,255,0.02)',
                color: isActive ? accent : 'rgba(255,255,255,0.7)'
              }}
            >
              {wf.icon || '🏢'} {wf.name}
            </button>
          );
        })}
      </div>

      {selectedWorkforce && (
        <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]'>
          <div className='relative overflow-hidden rounded-3xl border border-[#14FFF7]/20 bg-[#06090D]'>
            <div className='relative aspect-[16/10] min-h-[420px] w-full'>
              <div className='absolute inset-0 bg-[#06090D]' />
              <div
                className='absolute inset-0 opacity-30'
                style={{
                  backgroundImage: "url('/assets/office/floor_carpet.png')",
                  backgroundSize: '260px 260px'
                }}
              />
              <div
                className='pointer-events-none absolute inset-0 opacity-[0.07]'
                style={{
                  backgroundImage: 'repeating-linear-gradient(180deg, rgba(20,255,247,0.45) 0, rgba(20,255,247,0.45) 1px, transparent 1px, transparent 14px)',
                  animation: 'scanDrift 6s linear infinite'
                }}
              />

              <img
                src='/assets/office/wall_h.png'
                alt='top wall'
                className='pointer-events-none absolute left-0 top-0 h-20 w-full object-cover opacity-75'
              />
              <img
                src='/assets/office/wall_h.png'
                alt='bottom wall'
                className='pointer-events-none absolute bottom-0 left-0 h-20 w-full rotate-180 object-cover opacity-75'
              />
              <img
                src='/assets/office/wall_v.png'
                alt='left wall'
                className='pointer-events-none absolute left-0 top-0 h-full w-20 object-cover opacity-70'
              />
              <img
                src='/assets/office/wall_v.png'
                alt='right wall'
                className='pointer-events-none absolute right-0 top-0 h-full w-20 -scale-x-100 object-cover opacity-70'
              />
              <img
                src='/assets/office/wall_corner.png'
                alt='top left corner wall'
                className='pointer-events-none absolute left-0 top-0 h-16 w-16 object-cover opacity-65'
              />
              <img
                src='/assets/office/wall_corner.png'
                alt='top right corner wall'
                className='pointer-events-none absolute right-0 top-0 h-16 w-16 -scale-x-100 object-cover opacity-65'
              />
              <img
                src='/assets/office/wall_corner.png'
                alt='bottom left corner wall'
                className='pointer-events-none absolute bottom-0 left-0 h-16 w-16 -scale-y-100 object-cover opacity-65'
              />
              <img
                src='/assets/office/wall_corner.png'
                alt='bottom right corner wall'
                className='pointer-events-none absolute bottom-0 right-0 h-16 w-16 -scale-x-100 -scale-y-100 object-cover opacity-65'
              />

              <img
                src='/assets/office/mission_whiteboard.png'
                alt='mission whiteboard'
                className='pointer-events-none absolute left-1/2 top-2 h-28 w-28 -translate-x-1/2 object-contain opacity-55'
              />

              <img
                src='/assets/office/prop_plant_terminal.png'
                alt='left office prop'
                className='pointer-events-none absolute bottom-2 left-6 h-24 w-24 object-contain opacity-70'
              />
              <img
                src='/assets/office/prop_plant_terminal.png'
                alt='right office prop'
                className='pointer-events-none absolute bottom-4 right-8 h-20 w-20 -scale-x-100 object-contain opacity-55'
              />

              <img
                src='/assets/office/portal_ring_purple.png'
                alt='entry portal ring'
                className='pointer-events-none absolute bottom-4 left-1/2 h-32 w-32 -translate-x-1/2 object-contain opacity-40'
                style={{ animation: 'officePulse 4.4s ease-in-out infinite' }}
              />

              <img
                src='/assets/office/neon_ring.png'
                alt='holo table glow'
                className='pointer-events-none absolute left-1/2 top-[56%] h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 opacity-45 mix-blend-screen'
              />

              <img
                src='/assets/office/hud_ring_green.png'
                alt='core hud outer ring'
                className='pointer-events-none absolute left-1/2 top-[56%] h-[230px] w-[230px] object-contain opacity-30 mix-blend-screen'
                style={{ animation: 'ringRotate 18s linear infinite' }}
              />

              <img
                src='/assets/office/hud_ring_green.png'
                alt='core hud inner ring'
                className='pointer-events-none absolute left-1/2 top-[56%] h-[175px] w-[175px] object-contain opacity-24 mix-blend-screen'
                style={{ animation: 'ringCounterRotate 12s linear infinite' }}
              />

              <img
                src='/assets/office/core_hex_emblem.png'
                alt='office core emblem'
                className='pointer-events-none absolute left-1/2 top-[56%] h-24 w-24 object-contain opacity-85'
                style={{ animation: 'hologramFloat 3.8s ease-in-out infinite' }}
              />

              <div className='absolute left-1/2 top-[56%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#14FFF7]/40 bg-[#14FFF7]/5 shadow-[0_0_40px_rgba(20,255,247,0.2)]' />

              {officeSeats.map(({ agent, leftPct, topPct }, index) => {
                const style = getAgentStatusStyle(agent.status);
                const isLeader = agent.id === selectedWorkforce.leader_agent_id;
                const auraOpacity = getAgentAuraOpacity(agent.status);
                return (
                  <div
                    key={agent.id}
                    className='absolute -translate-x-1/2 -translate-y-1/2'
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  >
                    <Link
                      href={`/dashboard/agents/${agent.id}`}
                      className='group relative flex w-24 flex-col items-center gap-1.5'
                      style={{
                        animation: 'seatFloat 3.6s ease-in-out infinite',
                        animationDelay: `${(index % 7) * 0.35}s`
                      }}
                    >
                      <img
                        src='/assets/office/hud_ring_green.png'
                        alt='agent activity ring'
                        className='pointer-events-none absolute top-0 h-12 w-12 object-contain mix-blend-screen'
                        style={{
                          opacity: auraOpacity,
                          animation: 'officePulse 2.8s ease-in-out infinite',
                          animationDelay: `${(index % 5) * 0.25}s`
                        }}
                      />
                      <div className='absolute top-[14px] h-9 w-16 rounded-full bg-black/45 blur-[2px]' />
                      <EntityAvatar
                        icon={agent.icon || '🤖'}
                        color={agent.color || '#14FFF7'}
                        avatarUrl={agent.avatar_url}
                        name={agent.name}
                        size='sm'
                        className='relative border border-white/10 shadow-[0_0_0_1px_rgba(20,255,247,0.15)] transition-transform group-hover:scale-105'
                      />
                      <div className='rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-center text-[10px] font-medium text-white/85'>
                        {agent.name}
                      </div>
                      <div className='flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[9px] text-white/70'>
                        <span
                          className='h-1.5 w-1.5 rounded-full'
                          style={{ backgroundColor: style.color, boxShadow: `0 0 8px ${style.color}` }}
                        />
                        <span>{isLeader ? 'Leader' : style.label}</span>
                      </div>
                    </Link>
                  </div>
                );
              })}

              {workforceAgents.length === 0 && (
                <div className='absolute inset-0 flex items-center justify-center'>
                  <div className='rounded-xl border border-dashed border-[#14FFF7]/25 bg-black/30 px-4 py-3 text-center text-sm text-muted-foreground'>
                    No agents assigned to this workforce yet.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className='space-y-3 rounded-2xl border border-border/40 bg-card/40 p-4'>
            <div>
              <p className='text-xs uppercase tracking-wider text-muted-foreground'>Current office</p>
              <h2 className='mt-1 text-lg font-semibold'>{selectedWorkforce.name}</h2>
              <p className='mt-1 text-xs text-muted-foreground line-clamp-3'>
                {selectedWorkforce.description || selectedWorkforce.objective || 'No mission description set.'}
              </p>
            </div>

            <div className='rounded-xl border border-border/40 bg-black/10 p-3'>
              <div className='flex items-center gap-2 text-sm'>
                <IconUsers className='h-4 w-4 text-[#14FFF7]' />
                <span className='font-medium'>Team size</span>
                <span className='ml-auto text-[#14FFF7]'>{workforceAgents.length}</span>
              </div>
            </div>

            <div className='space-y-2'>
              {workforceAgents.map((agent) => {
                const statusStyle = getAgentStatusStyle(agent.status);
                return (
                  <Link
                    key={agent.id}
                    href={`/dashboard/agents/${agent.id}`}
                    className='flex items-center gap-2.5 rounded-lg border border-border/30 bg-background/30 px-2.5 py-2 transition-colors hover:border-[#14FFF7]/40 hover:bg-[#14FFF7]/5'
                  >
                    <EntityAvatar
                      icon={agent.icon || '🤖'}
                      color={agent.color || '#14FFF7'}
                      avatarUrl={agent.avatar_url}
                      name={agent.name}
                      size='xs'
                    />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-xs font-medium'>{agent.name}</p>
                      <p className='truncate text-[10px] text-muted-foreground'>{agent.model}</p>
                    </div>
                    <span className='text-[10px]' style={{ color: statusStyle.color }}>
                      {agent.id === selectedWorkforce.leader_agent_id ? 'Leader' : statusStyle.label}
                    </span>
                  </Link>
                );
              })}
            </div>

            <Button asChild className='mt-2 w-full bg-[#14FFF7] text-black hover:bg-[#14FFF7]/90'>
              <Link href={`/dashboard/workforces/${selectedWorkforce.id}`}>
                Open workforce details
                <IconArrowRight className='ml-1 h-4 w-4' />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
