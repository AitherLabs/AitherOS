'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import api, { Agent, KanbanTask, Workforce } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EntityAvatar } from '@/components/entity-avatar';
import {
  IconArrowRight,
  IconBuilding,
  IconRefresh,
  IconUsers
} from '@tabler/icons-react';

type OfficeSeat = {
  agent: Agent;
  leftPct: number;
  topPct: number;
};

type OfficeSceneTheme = 'aither5' | 'simulation';

type OfficePanelId = 'kanban' | 'ops' | 'intel';

type OfficeHotspot = {
  id: string;
  panel: OfficePanelId;
  label: string;
  hint: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  rotateDeg: number;
};

type OfficeChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  createdAt: string;
};

const AGENT_STATUS_STYLE: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: '#56D090' },
  working: { label: 'Working', color: '#14FFF7' },
  busy: { label: 'Busy', color: '#14FFF7' },
  idle: { label: 'Idle', color: '#A1A1AA' },
  offline: { label: 'Offline', color: '#71717A' },
  blocked: { label: 'Blocked', color: '#EF4444' }
};

const OFFICE_HOTSPOTS: Record<OfficeSceneTheme, OfficeHotspot[]> = {
  aither5: [
    {
      id: 'left-thin-monitor',
      panel: 'kanban',
      label: 'Kanban Board',
      hint: 'Open live task board for this workforce.',
      leftPct: 11.2,
      topPct: 61.8,
      widthPct: 4.4,
      heightPct: 21.8,
      rotateDeg: -27
    },
    {
      id: 'left-console-stack',
      panel: 'ops',
      label: 'Operations Console',
      hint: 'Quick actions and team controls.',
      leftPct: 24.3,
      topPct: 45.8,
      widthPct: 11.8,
      heightPct: 19.4,
      rotateDeg: -16
    },
    {
      id: 'right-console-stack',
      panel: 'intel',
      label: 'Intel Display',
      hint: 'Team pulse and office telemetry.',
      leftPct: 76.9,
      topPct: 46.2,
      widthPct: 12,
      heightPct: 20.4,
      rotateDeg: 17
    }
  ],
  simulation: [
    {
      id: 'left-thin-monitor',
      panel: 'kanban',
      label: 'Kanban Board',
      hint: 'Open live task board for this workforce.',
      leftPct: 11,
      topPct: 62,
      widthPct: 4.4,
      heightPct: 21.8,
      rotateDeg: -27
    },
    {
      id: 'left-console-stack',
      panel: 'ops',
      label: 'Operations Console',
      hint: 'Quick actions and team controls.',
      leftPct: 24,
      topPct: 46,
      widthPct: 11.8,
      heightPct: 19.4,
      rotateDeg: -16
    },
    {
      id: 'right-console-stack',
      panel: 'intel',
      label: 'Intel Display',
      hint: 'Team pulse and office telemetry.',
      leftPct: 77,
      topPct: 46,
      widthPct: 12,
      heightPct: 20.4,
      rotateDeg: 17
    }
  ]
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

function isAgentInteracting(status: string | undefined): boolean {
  const normalized = (status || '').toLowerCase();
  return normalized === 'active' || normalized === 'working' || normalized === 'busy';
}

function formatKanbanStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function extractDebugReply(payload: any): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();

  const candidates = [
    payload?.response,
    payload?.reply,
    payload?.content,
    payload?.result,
    payload?.output,
    payload?.message
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  if (payload && typeof payload === 'object' && payload.data && payload.data !== payload) {
    const nested = extractDebugReply(payload.data);
    if (nested) return nested;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload || 'No response returned.');
  }
}

export default function OfficePage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedWorkforceId, setSelectedWorkforceId] = useState('');
  const [officeTheme, setOfficeTheme] = useState<OfficeSceneTheme>('aither5');
  const [contrastMode, setContrastMode] = useState(false);
  const [activeAgentMenuId, setActiveAgentMenuId] = useState('');
  const [activePanel, setActivePanel] = useState<OfficePanelId | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [kanbanPreview, setKanbanPreview] = useState<KanbanTask[]>([]);
  const [officeChatAgentId, setOfficeChatAgentId] = useState('');
  const [officeChatByAgent, setOfficeChatByAgent] = useState<Record<string, OfficeChatMessage[]>>({});
  const [officeChatDraft, setOfficeChatDraft] = useState('');
  const [officeChatSending, setOfficeChatSending] = useState(false);
  const [officeChatError, setOfficeChatError] = useState('');

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
  const officeHotspots = useMemo(() => OFFICE_HOTSPOTS[officeTheme] || OFFICE_HOTSPOTS.aither5, [officeTheme]);
  const officeChatAgent = useMemo(
    () => workforceAgents.find((agent) => agent.id === officeChatAgentId) || null,
    [workforceAgents, officeChatAgentId]
  );
  const officeChatMessages = officeChatAgentId ? officeChatByAgent[officeChatAgentId] || [] : [];
  const defaultPanelChatAgent = useMemo(
    () => workforceAgents.find((agent) => agent.id === selectedWorkforce?.leader_agent_id) || workforceAgents[0] || null,
    [workforceAgents, selectedWorkforce?.leader_agent_id]
  );
  const activeCount = useMemo(
    () => workforceAgents.filter((agent) => isAgentInteracting(agent.status)).length,
    [workforceAgents]
  );
  const blockedCount = useMemo(
    () => workforceAgents.filter((agent) => (agent.status || '').toLowerCase() === 'blocked').length,
    [workforceAgents]
  );
  const idleCount = useMemo(() => workforceAgents.length - activeCount - blockedCount, [workforceAgents.length, activeCount, blockedCount]);
  const activePanelHotspot = useMemo(
    () => officeHotspots.find((hotspot) => hotspot.panel === activePanel) || null,
    [officeHotspots, activePanel]
  );

  useEffect(() => {
    setActiveAgentMenuId('');
    setActivePanel(null);
    setPanelError('');
  }, [selectedWorkforceId]);

  useEffect(() => {
    if (!officeChatAgentId) return;
    if (workforceAgents.some((agent) => agent.id === officeChatAgentId)) return;
    setOfficeChatAgentId('');
  }, [officeChatAgentId, workforceAgents]);

  useEffect(() => {
    if (activePanel !== 'kanban' || !selectedWorkforce) return;
    let cancelled = false;

    setPanelLoading(true);
    setPanelError('');
    api
      .listKanbanTasks(selectedWorkforce.id)
      .then((res) => {
        if (cancelled) return;
        setKanbanPreview(Array.isArray(res.data) ? res.data : []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setPanelError(err?.message || 'Failed to load kanban preview.');
      })
      .finally(() => {
        if (!cancelled) setPanelLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePanel, selectedWorkforce]);

  async function handleSendOfficeChat() {
    if (!selectedWorkforce || !officeChatAgent || officeChatSending) return;
    const text = officeChatDraft.trim();
    if (!text) return;

    const agentId = officeChatAgent.id;
    const userMsg: OfficeChatMessage = {
      id: `office-user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    };
    setOfficeChatByAgent((prev) => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), userMsg]
    }));
    setOfficeChatDraft('');
    setOfficeChatError('');
    setOfficeChatSending(true);

    try {
      const previous = officeChatByAgent[agentId] || [];
      const history = previous
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await api.debugAgent(
        agentId,
        `User request:\n${text}\n\nRespond in concise natural language.`,
        {
          workforce_id: selectedWorkforce.id,
          workforce_name: selectedWorkforce.name,
          request_mode: 'workforce_chat'
        },
        history
      );

      const assistantMsg: OfficeChatMessage = {
        id: `office-assistant-${Date.now()}`,
        role: 'assistant',
        content: extractDebugReply(res.data),
        createdAt: new Date().toISOString()
      };
      setOfficeChatByAgent((prev) => ({
        ...prev,
        [agentId]: [...(prev[agentId] || []), assistantMsg]
      }));
    } catch (err: any) {
      const message = err?.message || 'Failed to send message.';
      setOfficeChatError(message);
      setOfficeChatByAgent((prev) => ({
        ...prev,
        [agentId]: [
          ...(prev[agentId] || []),
          {
            id: `office-error-${Date.now()}`,
            role: 'error',
            content: `Error: ${message}`,
            createdAt: new Date().toISOString()
          }
        ]
      }));
    } finally {
      setOfficeChatSending(false);
    }
  }

  const sceneStyle = useMemo(() => {
    if (officeTheme === 'aither5') {
      return {
        label: 'Aither Core',
        backgroundSrc: '/assets/office/aither5_bg.png',
        backgroundOpacity: contrastMode ? 0.9 : 0.86,
        backgroundFilter: contrastMode ? 'saturate(1.24) contrast(1.14)' : 'saturate(1.1) contrast(1.02)',
        atmosphereGradient: contrastMode
          ? 'radial-gradient(circle at 50% 56%, rgba(76,255,255,0.24), rgba(6,18,35,0.24) 30%, rgba(4,11,22,0.74) 70%, rgba(2,7,14,0.95) 100%)'
          : 'radial-gradient(circle at 50% 56%, rgba(68,248,255,0.16), rgba(6,16,30,0.2) 33%, rgba(4,10,20,0.7) 72%, rgba(2,6,12,0.92) 100%)',
        scanlineGradient: 'repeating-linear-gradient(180deg, rgba(122,255,252,0.48) 0, rgba(122,255,252,0.48) 1px, transparent 1px, transparent 14px)',
        scanlineOpacity: contrastMode ? 0.13 : 0.09,
        accentBloom: contrastMode
          ? 'radial-gradient(circle at 50% 56%, rgba(111,255,255,0.4) 0, rgba(111,255,255,0.16) 26%, transparent 58%)'
          : 'radial-gradient(circle at 50% 56%, rgba(111,255,255,0.3) 0, rgba(111,255,255,0.08) 24%, transparent 56%)',
        accentOpacity: contrastMode ? 0.2 : 0.12,
        centerBorder: contrastMode ? 'rgba(137,255,255,0.42)' : 'rgba(137,255,255,0.26)',
        centerFill: contrastMode ? 'rgba(88,248,255,0.14)' : 'rgba(88,248,255,0.08)',
        centerShadow: contrastMode ? '0 0 48px rgba(90,248,255,0.32)' : '0 0 40px rgba(90,248,255,0.22)'
      };
    }

    return {
      label: 'Simulation',
      backgroundSrc: '/assets/office/simulation_bg.png',
      backgroundOpacity: contrastMode ? 0.9 : 0.86,
      backgroundFilter: contrastMode ? 'saturate(1.2) contrast(1.15)' : 'saturate(1.12) contrast(1.03)',
      atmosphereGradient: contrastMode
        ? 'radial-gradient(circle at 50% 56%, rgba(40,240,255,0.21), rgba(5,9,22,0.24) 31%, rgba(3,7,16,0.76) 70%, rgba(2,5,10,0.95) 100%)'
        : 'radial-gradient(circle at 50% 56%, rgba(24,238,255,0.14), rgba(4,8,20,0.2) 34%, rgba(3,6,14,0.7) 72%, rgba(2,4,10,0.92) 100%)',
      scanlineGradient: 'repeating-linear-gradient(180deg, rgba(112,255,253,0.45) 0, rgba(112,255,253,0.45) 1px, transparent 1px, transparent 14px)',
      scanlineOpacity: contrastMode ? 0.13 : 0.09,
      accentBloom: contrastMode
        ? 'radial-gradient(circle at 50% 56%, rgba(186,112,255,0.44) 0, rgba(186,112,255,0.18) 24%, transparent 58%)'
        : 'radial-gradient(circle at 50% 56%, rgba(186,112,255,0.35) 0, rgba(186,112,255,0.08) 22%, transparent 56%)',
      accentOpacity: contrastMode ? 0.2 : 0.12,
      centerBorder: contrastMode ? 'rgba(140,231,255,0.38)' : 'rgba(140,231,255,0.25)',
      centerFill: contrastMode ? 'rgba(154,102,255,0.14)' : 'rgba(154,102,255,0.08)',
      centerShadow: contrastMode ? '0 0 50px rgba(186,112,255,0.3)' : '0 0 40px rgba(20,255,247,0.2)'
    };
  }, [officeTheme, contrastMode]);

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
        @keyframes presenceFloat {
          0%, 100% { transform: translate(-50%, -50%) translateY(0px); }
          50% { transform: translate(-50%, -50%) translateY(-6px); }
        }
        @keyframes scanDrift {
          0% { transform: translateY(0px); }
          100% { transform: translateY(26px); }
        }
        @keyframes padRipple {
          0% { opacity: 0.65; transform: scale(0.92); }
          70% { opacity: 0.24; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.22); }
        }
        @keyframes padSweep {
          0%, 100% { opacity: 0.2; transform: rotate(45deg) scale(0.92); }
          50% { opacity: 0.5; transform: rotate(45deg) scale(1.05); }
        }
        @keyframes statusRingOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes particlePulse {
          0%, 100% { opacity: 0; transform: translateY(4px) scale(0.7); }
          45% { opacity: 0.85; transform: translateY(-3px) scale(1); }
        }
        @keyframes statusBadgePulse {
          0%, 100% { box-shadow: 0 0 0 rgba(20,255,247,0.0); }
          50% { box-shadow: 0 0 10px rgba(20,255,247,0.55); }
        }
        @keyframes tetherFlow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -20; }
        }
        @keyframes tetherGlow {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.85; }
        }
      `}</style>

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-semibold tracking-tight'>
            <img src='/assets/favicon.png' alt='AitherOS' className='h-6 w-6 rounded-sm' />
            Virtual Office
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Shared room template for every workforce. We can later skin this per team.
          </p>
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <div className='flex items-center rounded-full border border-white/12 bg-black/35 p-1'>
            {([
              { key: 'aither5' as OfficeSceneTheme, label: 'Aither Core' },
              { key: 'simulation' as OfficeSceneTheme, label: 'Simulation' }
            ]).map((theme) => {
              const isActive = officeTheme === theme.key;
              return (
                <button
                  key={theme.key}
                  type='button'
                  onClick={() => setOfficeTheme(theme.key)}
                  className='rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors'
                  style={{
                    color: isActive ? '#0A1118' : 'rgba(255,255,255,0.78)',
                    backgroundColor: isActive ? '#14FFF7' : 'transparent'
                  }}
                >
                  {theme.label}
                </button>
              );
            })}
          </div>

          <button
            type='button'
            onClick={() => setContrastMode((prev) => !prev)}
            className='rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-[11px] font-medium text-white/85 transition-colors hover:border-[#14FFF7]/45 hover:text-[#14FFF7]'
          >
            Contrast: {contrastMode ? 'High' : 'Normal'}
          </button>

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
              {wf.name}
            </button>
          );
        })}
      </div>

      {selectedWorkforce && (
        <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]'>
          <div className='relative overflow-hidden rounded-3xl border border-[#14FFF7]/20 bg-[#06090D]'>
            <div
              className='relative aspect-[16/10] min-h-[420px] w-full'
              onClick={() => setActiveAgentMenuId('')}
            >
              <div className='absolute inset-0 bg-[#030712]' />
              <img
                src={sceneStyle.backgroundSrc}
                alt={`${sceneStyle.label} virtual office background`}
                className='pointer-events-none absolute inset-0 h-full w-full object-cover'
                style={{
                  opacity: sceneStyle.backgroundOpacity,
                  filter: sceneStyle.backgroundFilter,
                  objectPosition: 'center 20%'
                }}
              />
              <div
                className='pointer-events-none absolute inset-0'
                style={{
                  background: sceneStyle.atmosphereGradient
                }}
              />
              <div
                className='pointer-events-none absolute inset-0'
                style={{
                  opacity: sceneStyle.scanlineOpacity,
                  backgroundImage: sceneStyle.scanlineGradient,
                  animation: 'scanDrift 6s linear infinite'
                }}
              />
              <div
                className='pointer-events-none absolute inset-0'
                style={{
                  opacity: sceneStyle.accentOpacity,
                  backgroundImage: sceneStyle.accentBloom
                }}
              />
              <div
                className='pointer-events-none absolute left-1/2 top-[56%] h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#8CE7FF]/25 bg-[#9A66FF]/8'
                style={{
                  borderColor: sceneStyle.centerBorder,
                  backgroundColor: sceneStyle.centerFill,
                  boxShadow: sceneStyle.centerShadow,
                  animation: 'officePulse 4.6s ease-in-out infinite'
                }}
              />

              {officeHotspots.map((hotspot) => (
                <button
                  key={hotspot.id}
                  type='button'
                  title={`${hotspot.label} • ${hotspot.hint}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActivePanel(hotspot.panel);
                  }}
                  className='absolute z-[6] rounded-sm border border-[#14FFF7]/8 bg-[#14FFF7]/5 transition-all hover:border-[#14FFF7]/55 hover:bg-[#14FFF7]/18'
                  style={{
                    left: `${hotspot.leftPct}%`,
                    top: `${hotspot.topPct}%`,
                    width: `${hotspot.widthPct}%`,
                    height: `${hotspot.heightPct}%`,
                    transform: `translate(-50%, -50%) rotate(${hotspot.rotateDeg}deg)`,
                    boxShadow: '0 0 0 1px rgba(20,255,247,0.06), inset 0 0 0 1px rgba(255,255,255,0.03)'
                  }}
                >
                  <span className='sr-only'>{hotspot.label}</span>
                </button>
              ))}

              <svg className='pointer-events-none absolute inset-0 h-full w-full' viewBox='0 0 100 100' preserveAspectRatio='none'>
                {officeSeats.map(({ agent, leftPct, topPct }) => {
                  if (!isAgentInteracting(agent.status)) return null;
                  const statusStyle = getAgentStatusStyle(agent.status);
                  const dx = leftPct - 50;
                  const dy = topPct - 56;
                  const distance = Math.hypot(dx, dy) || 1;
                  const anchorRadius = 7;
                  const x2 = 50 + (dx / distance) * anchorRadius;
                  const y2 = 56 + (dy / distance) * anchorRadius;
                  return (
                    <g key={`tether-${agent.id}`}>
                      <line
                        x1={leftPct}
                        y1={topPct}
                        x2={x2}
                        y2={y2}
                        stroke={statusStyle.color}
                        strokeWidth={0.16}
                        strokeLinecap='round'
                        strokeDasharray='2.4 4.8'
                        style={{
                          filter: `drop-shadow(0 0 4px ${statusStyle.color})`,
                          animation: 'tetherFlow 2.1s linear infinite, tetherGlow 2.2s ease-in-out infinite'
                        }}
                      />
                      <circle cx={x2} cy={y2} r={0.26} fill={statusStyle.color} />
                    </g>
                  );
                })}
              </svg>

              {officeSeats.map(({ agent, leftPct, topPct }, index) => {
                const statusStyle = getAgentStatusStyle(agent.status);
                const isLeader = agent.id === selectedWorkforce.leader_agent_id;
                const auraOpacity = getAgentAuraOpacity(agent.status);
                const isInteracting = isAgentInteracting(agent.status);
                return (
                  <div
                    key={agent.id}
                    className='absolute -translate-x-1/2 -translate-y-1/2'
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  >
                    <div
                      className='group relative flex w-24 flex-col items-center gap-1.5'
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        animation: 'presenceFloat 4.2s ease-in-out infinite',
                        animationDelay: `${(index % 7) * 0.35}s`
                      }}
                    >
                      <button
                        type='button'
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveAgentMenuId((prev) => (prev === agent.id ? '' : agent.id));
                        }}
                        className='relative flex h-16 w-24 items-center justify-center'
                      >
                        <div className='pointer-events-none absolute bottom-[6px] h-5 w-16 rounded-full bg-black/65 blur-[4px]' />
                        <div
                          className='pointer-events-none absolute bottom-[7px] h-7 w-14 rounded-full border'
                          style={{
                            borderColor: `${statusStyle.color}AA`,
                            boxShadow: `0 0 16px ${statusStyle.color}55`
                          }}
                        />
                        <div
                          className='pointer-events-none absolute bottom-[7px] h-7 w-14 rounded-full border border-white/35'
                          style={{
                            animation: 'padRipple 2.8s ease-out infinite',
                            animationDelay: `${(index % 4) * 0.3}s`
                          }}
                        />
                        <div
                          className='pointer-events-none absolute bottom-[7px] h-8 w-8 rotate-45 border bg-black/25'
                          style={{
                            borderColor: `${statusStyle.color}66`,
                            boxShadow: `0 0 18px ${statusStyle.color}44`,
                            animation: 'padSweep 3.2s ease-in-out infinite'
                          }}
                        />

                        <img
                          src='/assets/office/hud_ring_green.png'
                          alt='agent activity ring'
                          className='pointer-events-none absolute top-[6px] h-11 w-11 object-contain mix-blend-screen'
                          style={{
                            opacity: auraOpacity,
                            animation: 'officePulse 2.8s ease-in-out infinite',
                            animationDelay: `${(index % 5) * 0.25}s`
                          }}
                        />

                        <div className='pointer-events-none absolute inset-0'>
                          <span
                            className='absolute left-[26px] top-[8px] h-1 w-1 rounded-full'
                            style={{
                              backgroundColor: statusStyle.color,
                              animation: 'particlePulse 2.1s ease-in-out infinite'
                            }}
                          />
                          <span
                            className='absolute right-[26px] top-[11px] h-1 w-1 rounded-full'
                            style={{
                              backgroundColor: '#14FFF7',
                              animation: 'particlePulse 2.4s ease-in-out infinite',
                              animationDelay: '0.35s'
                            }}
                          />
                          <span
                            className='absolute left-1/2 top-[4px] h-1.5 w-1.5 -translate-x-1/2 rounded-full'
                            style={{
                              backgroundColor: `${statusStyle.color}CC`,
                              animation: 'particlePulse 2.8s ease-in-out infinite',
                              animationDelay: '0.7s'
                            }}
                          />
                        </div>

                        <div className='relative'>
                          <div
                            className='pointer-events-none absolute -inset-1.5 rounded-full border border-white/25'
                            style={{
                              borderColor: `${statusStyle.color}AA`,
                              boxShadow: `0 0 10px ${statusStyle.color}55`,
                              animation: 'statusRingOrbit 9s linear infinite'
                            }}
                          />
                          <EntityAvatar
                            icon={agent.icon || 'A'}
                            color={agent.color || '#14FFF7'}
                            avatarUrl={agent.avatar_url}
                            name={agent.name}
                            size='sm'
                            className='relative z-10 rounded-full border border-white/15 shadow-[0_0_0_1px_rgba(20,255,247,0.22)] transition-transform group-hover:scale-105'
                          />
                        </div>
                      </button>

                      <div className='rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-center text-[10px] font-medium text-white/85'>
                        {agent.name}
                      </div>
                      <div className='flex items-center gap-1 text-[8px] uppercase tracking-[0.12em] text-white/55'>
                        <span className='rounded-full border border-white/10 bg-black/45 px-1.5 py-[2px]'>Presence</span>
                        <span className='rounded-full border border-white/10 bg-black/45 px-1.5 py-[2px]'>
                          {isInteracting ? 'Linked' : 'Idle Node'}
                        </span>
                      </div>
                      <div className='flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-0.5 text-[9px] text-white/70'>
                        <span
                          className='h-1.5 w-1.5 rounded-full'
                          style={{
                            backgroundColor: statusStyle.color,
                            boxShadow: `0 0 8px ${statusStyle.color}`,
                            animation: 'statusBadgePulse 1.9s ease-in-out infinite'
                          }}
                        />
                        <span>{isLeader ? 'Leader' : statusStyle.label}</span>
                      </div>

                      {activeAgentMenuId === agent.id && (
                        <div className='absolute left-1/2 top-[106%] z-20 w-44 -translate-x-1/2 rounded-xl border border-[#14FFF7]/30 bg-[#030A12]/95 p-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur'>
                          <button
                            type='button'
                            className='flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] text-white/85 transition-colors hover:bg-[#14FFF7]/12 hover:text-[#14FFF7]'
                            onClick={() => {
                              setOfficeChatAgentId(agent.id);
                              setOfficeChatError('');
                              setActiveAgentMenuId('');
                            }}
                          >
                            <span>Chat with agent</span>
                            <span className='text-[10px] text-white/45'>live</span>
                          </button>

                          <Link
                            href={`/dashboard/agents/${agent.id}`}
                            className='flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[11px] text-white/80 transition-colors hover:bg-[#14FFF7]/12 hover:text-[#14FFF7]'
                            onClick={() => setActiveAgentMenuId('')}
                          >
                            <span>Open profile</span>
                            <span className='text-[10px] text-white/45'>↗</span>
                          </Link>

                          <Link
                            href={`/dashboard/workforces/${selectedWorkforce.id}`}
                            className='flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[11px] text-white/80 transition-colors hover:bg-[#14FFF7]/12 hover:text-[#14FFF7]'
                            onClick={() => setActiveAgentMenuId('')}
                          >
                            <span>Workforce panel</span>
                            <span className='text-[10px] text-white/45'>↗</span>
                          </Link>
                        </div>
                      )}
                    </div>
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
                      icon={agent.icon || 'A'}
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

      <Sheet open={activePanel !== null} onOpenChange={(open) => !open && setActivePanel(null)}>
        <SheetContent
          side='right'
          className='w-[92vw] border-l border-[#14FFF7]/25 bg-[#050D16] p-0 text-white sm:max-w-[480px]'
        >
          <SheetHeader className='border-b border-white/10 pb-3'>
            <SheetTitle className='text-base text-white'>
              {activePanelHotspot?.label || 'Office panel'}
            </SheetTitle>
            {activePanelHotspot?.hint && (
              <SheetDescription className='text-xs text-white/60'>{activePanelHotspot.hint}</SheetDescription>
            )}
          </SheetHeader>

          <div className='h-[calc(100%-88px)] overflow-y-auto p-4'>
            {activePanel === 'kanban' && (
              <div className='space-y-3'>
                {panelLoading ? (
                  <div className='rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/65'>
                    Loading kanban preview...
                  </div>
                ) : panelError ? (
                  <div className='rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200'>
                    {panelError}
                  </div>
                ) : kanbanPreview.length === 0 ? (
                  <div className='rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-sm text-white/65'>
                    No tasks yet in this workforce board.
                  </div>
                ) : (
                  <div className='space-y-2'>
                    {kanbanPreview
                      .slice()
                      .sort((a, b) => b.priority - a.priority)
                      .slice(0, 14)
                      .map((task) => (
                        <div key={task.id} className='rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5'>
                          <div className='flex items-start gap-2'>
                            <p className='min-w-0 flex-1 text-sm font-medium text-white/90'>{task.title}</p>
                            <span className='rounded-full border border-[#14FFF7]/35 bg-[#14FFF7]/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#83FFFC]'>
                              {formatKanbanStatus(task.status)}
                            </span>
                          </div>
                          <div className='mt-1.5 flex items-center gap-2 text-[11px] text-white/50'>
                            <span>Priority {task.priority}</span>
                            {task.assigned_to && (
                              <>
                                <span>•</span>
                                <span>
                                  {agentsById[task.assigned_to]?.name || 'Assigned'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                <div className='flex justify-end'>
                  <Button asChild className='bg-[#14FFF7] text-black hover:bg-[#14FFF7]/90'>
                    <Link href={`/dashboard/workforces/${selectedWorkforce?.id || ''}`}>Open full board</Link>
                  </Button>
                </div>
              </div>
            )}

            {activePanel === 'ops' && (
              <div className='space-y-3'>
                <div className='rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-white/75'>
                  Run quick operations for <span className='text-white'>{selectedWorkforce?.name}</span> directly from the office.
                </div>
                <div className='grid gap-2 sm:grid-cols-2'>
                  <Button asChild variant='outline' className='border-[#14FFF7]/35 text-[#14FFF7] hover:bg-[#14FFF7]/12'>
                    <Link href={`/dashboard/workforces/${selectedWorkforce?.id}`}>Open workforce detail</Link>
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    className='border-[#14FFF7]/35 text-[#14FFF7] hover:bg-[#14FFF7]/12'
                    onClick={() => {
                      if (defaultPanelChatAgent) {
                        setOfficeChatAgentId(defaultPanelChatAgent.id);
                        setActivePanel(null);
                      }
                    }}
                  >
                    Chat with {defaultPanelChatAgent?.name || 'leader'}
                  </Button>
                </div>
              </div>
            )}

            {activePanel === 'intel' && (
              <div className='space-y-3'>
                <div className='grid grid-cols-3 gap-2'>
                  <div className='rounded-xl border border-[#56D090]/35 bg-[#56D090]/10 p-3'>
                    <p className='text-[11px] uppercase tracking-wide text-[#A7FFD0]'>Active</p>
                    <p className='mt-1 text-xl font-semibold text-[#D5FFE8]'>{activeCount}</p>
                  </div>
                  <div className='rounded-xl border border-white/20 bg-white/[0.04] p-3'>
                    <p className='text-[11px] uppercase tracking-wide text-white/60'>Idle</p>
                    <p className='mt-1 text-xl font-semibold text-white/85'>{Math.max(0, idleCount)}</p>
                  </div>
                  <div className='rounded-xl border border-red-400/30 bg-red-400/10 p-3'>
                    <p className='text-[11px] uppercase tracking-wide text-red-200'>Blocked</p>
                    <p className='mt-1 text-xl font-semibold text-red-100'>{blockedCount}</p>
                  </div>
                </div>

                <div className='space-y-2'>
                  {workforceAgents.map((agent) => {
                    const statusStyle = getAgentStatusStyle(agent.status);
                    return (
                      <div key={agent.id} className='flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2'>
                        <EntityAvatar
                          icon={agent.icon || 'A'}
                          color={agent.color || '#14FFF7'}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='xs'
                        />
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-xs font-medium text-white/90'>{agent.name}</p>
                          <p className='truncate text-[10px] text-white/45'>{agent.model || 'model n/a'}</p>
                        </div>
                        <span className='text-[10px]' style={{ color: statusStyle.color }}>
                          {statusStyle.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!officeChatAgent}
        onOpenChange={(open) => {
          if (!open) {
            setOfficeChatAgentId('');
            setOfficeChatError('');
          }
        }}
      >
        <DialogContent className='max-w-2xl border-[#14FFF7]/25 bg-[#040B14] text-white'>
          <DialogHeader>
            <DialogTitle className='text-base'>
              Office chat · {officeChatAgent?.name || 'Agent'}
            </DialogTitle>
          </DialogHeader>

          <div className='space-y-3'>
            <div className='max-h-[48vh] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3'>
              {officeChatMessages.length === 0 ? (
                <p className='text-sm text-white/55'>Start the conversation from here. Messages stay local to this office session.</p>
              ) : (
                officeChatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap',
                      msg.role === 'user' && 'ml-8 border-[#14FFF7]/35 bg-[#14FFF7]/10 text-[#D8FFFE]',
                      msg.role === 'assistant' && 'mr-8 border-white/15 bg-white/[0.03] text-white/85',
                      msg.role === 'error' && 'mr-8 border-red-500/40 bg-red-500/12 text-red-100'
                    )}
                  >
                    {msg.content}
                  </div>
                ))
              )}
            </div>

            {officeChatError && (
              <div className='rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100'>
                {officeChatError}
              </div>
            )}

            <div className='space-y-2'>
              <Textarea
                value={officeChatDraft}
                onChange={(event) => setOfficeChatDraft(event.target.value)}
                placeholder='Ask this agent to review, create, or explain something...'
                className='min-h-[96px] border-white/15 bg-white/[0.02] text-white placeholder:text-white/35 focus-visible:ring-[#14FFF7]/45'
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSendOfficeChat();
                  }
                }}
              />
              <div className='flex justify-end'>
                <Button
                  type='button'
                  onClick={handleSendOfficeChat}
                  disabled={officeChatSending || !officeChatDraft.trim()}
                  className='bg-[#14FFF7] text-black hover:bg-[#14FFF7]/90'
                >
                  {officeChatSending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
