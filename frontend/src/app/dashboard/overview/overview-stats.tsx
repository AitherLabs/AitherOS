'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  IconRobot,
  IconUsersGroup,
  IconBolt,
  IconServer,
  IconArrowRight
} from '@tabler/icons-react';
import api, { ActivityEvent, Agent, Workforce, Execution, Provider } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';

const strategyColors: Record<string, string> = {
  react: '#9A66FF',
  simple: '#56D090',
  function_call: '#14FFF7'
};

const execStatusColors: Record<string, { color: string; label: string }> = {
  running: { color: '#9A66FF', label: 'Running' },
  completed: { color: '#56D090', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  halted: { color: '#FFBF47', label: 'Halted' },
  pending_approval: { color: '#FFBF47', label: 'Awaiting' },
  awaiting_approval: { color: '#56D090', label: 'Awaiting' },
  planning: { color: '#14FFF7', label: 'Planning' }
};

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

interface ExecWithMeta extends Execution {
  workforce_name?: string;
  workforce_agents?: Agent[];
}

export function OverviewStats() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [executions, setExecutions] = useState<ExecWithMeta[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);

  const loadAll = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [agRes, wfRes, pvRes, execRes, actRes] = await Promise.all([
        api.listAgents(),
        api.listWorkforces(),
        api.listProviders(),
        api.listAllExecutions(),
        api.listActivity(undefined, 10)
      ]);

      const agList = agRes.data || [];
      const wfList = wfRes.data || [];
      const pvList = pvRes.data || [];
      setAgents(agList);
      setWorkforces(wfList);
      setProviders(pvList);
      setRecentActivity(actRes.data || []);

      const agMap: Record<string, Agent> = {};
      for (const a of agList) agMap[a.id] = a;

      const wfMap: Record<string, Workforce> = {};
      for (const wf of wfList) wfMap[wf.id] = wf;

      const allExecs: ExecWithMeta[] = (execRes.data || []).map((e) => {
        const wf = wfMap[e.workforce_id];
        const wfAgents = wf ? (wf.agent_ids || []).map((id) => agMap[id]).filter(Boolean) : [];
        return { ...e, workforce_agents: wfAgents };
      });

      setExecutions(allExecs);
      setTotalTokens(allExecs.reduce((sum, e) => sum + (e.tokens_used || 0), 0));

      // Load pending approvals count across all workforces in parallel
      const approvalCounts = await Promise.allSettled(
        wfList.map((wf) => api.countPendingApprovals(wf.id))
      );
      const totalPending = approvalCounts.reduce((sum, result) => {
        if (result.status === 'fulfilled') {
          return sum + (result.value.data?.count || 0);
        }
        return sum;
      }, 0);
      setPendingApprovals(totalPending);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const userName = session?.user?.name || 'Operator';
  const activeExecs = executions.filter((e) => ['running', 'planning', 'pending_approval', 'awaiting_approval'].includes(e.status));

  const statCards = [
    { label: 'Agents', value: agents.length, icon: IconRobot, color: '#9A66FF', desc: 'configured', href: '/dashboard/agents' },
    { label: 'Workforces', value: workforces.length, icon: IconUsersGroup, color: '#56D090', desc: 'teams', href: '/dashboard/workforces' },
    { label: 'Executions', value: executions.length, icon: IconBolt, color: '#FFBF47', desc: `${activeExecs.length} active`, href: '/dashboard/executions' },
    { label: 'Providers', value: providers.length, icon: IconServer, color: '#14FFF7', desc: `${formatTokens(totalTokens)} tokens used`, href: '/dashboard/providers' }
  ];

  const activityActionColor = (action: string) =>
    action.includes('completed') ? '#56D090' :
    action.includes('failed') ? '#EF4444' :
    action.includes('approved') ? '#56D090' :
    action.includes('rejected') ? '#EF4444' :
    action.includes('started') ? '#9A66FF' :
    action.includes('halted') ? '#FFBF47' :
    action.includes('created') ? '#14FFF7' : '#888';

  return (
    <>
      {/* Welcome */}
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            Welcome back, {userName}
          </h2>
          <p className='text-muted-foreground'>
            Here&apos;s an overview of your AitherOS workspace.
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.label}
              className='cursor-pointer transition-all hover:shadow-md'
              style={{ '--tw-shadow-color': card.color + '10' } as React.CSSProperties}
              onClick={() => router.push(card.href)}
            >
              <CardHeader>
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className='text-2xl font-semibold tabular-nums'>
                  {loading ? '—' : card.value}
                </CardTitle>
                <CardAction>
                  <Badge
                    variant='outline'
                    style={{
                      borderColor: card.color + '50',
                      backgroundColor: card.color + '15',
                      color: card.color
                    }}
                  >
                    <Icon className='size-3.5' />
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardFooter className='flex-col items-start gap-1.5 text-sm'>
                <div className='text-muted-foreground text-xs'>{card.desc}</div>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Two-column: Recent Executions + Agents */}
      <div className='grid gap-6 lg:grid-cols-[1fr_380px]'>

        {/* Recent Executions */}
        <Card className='border-border/50'>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-base'>Recent Executions</CardTitle>
              <button
                onClick={() => router.push('/dashboard/executions')}
                className='flex items-center gap-1 text-xs text-muted-foreground hover:text-[#9A66FF] transition-colors'
              >
                View all <IconArrowRight className='h-3 w-3' />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className='flex h-32 items-center justify-center'>
                <div className='h-6 w-6 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
              </div>
            ) : executions.length === 0 ? (
              <p className='py-8 text-center text-xs text-muted-foreground'>
                No executions yet. Start one from a workforce.
              </p>
            ) : (
              <div className='space-y-2'>
                {executions.slice(0, 5).map((exec) => {
                  const es = execStatusColors[exec.status] || { color: '#888', label: exec.status };
                  return (
                    <div
                      key={exec.id}
                      className='flex cursor-pointer items-center gap-3 rounded-lg border border-border/30 px-3 py-2.5 transition-colors hover:border-[#9A66FF]/40'
                      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                    >
                      <div className='flex -space-x-1.5'>
                        {(exec.workforce_agents || []).slice(0, 3).map((a) => (
                          <EntityAvatar
                            key={a.id}
                            icon={a.icon}
                            color={a.color}
                            avatarUrl={a.avatar_url}
                            name={a.name}
                            size='xs'
                            className='border-2 border-background'
                          />
                        ))}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <p className='text-xs font-medium line-clamp-1'>
                          {exec.objective.slice(0, 80)}
                        </p>
                        <div className='flex items-center gap-2 text-[10px] text-muted-foreground'>
                          <span>{exec.workforce_name}</span>
                          <span className='text-border'>·</span>
                          <span>{formatTokens(exec.tokens_used)} tokens</span>
                          <span className='text-border'>·</span>
                          <span>{timeAgo(exec.created_at)}</span>
                        </div>
                      </div>
                      <Badge
                        variant='outline'
                        className='shrink-0 text-[9px]'
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Approvals + Activity + Agents + Providers */}
        <div className='space-y-6'>
          {/* Pending Approvals */}
          {pendingApprovals > 0 && (
            <Card className='border-[#FFBF47]/30 bg-[#FFBF47]/5'>
              <CardHeader className='pb-2'>
                <CardTitle className='flex items-center gap-2 text-base text-[#FFBF47]'>
                  ⏳ {pendingApprovals} Pending Approval{pendingApprovals !== 1 ? 's' : ''}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className='text-xs text-muted-foreground'>
                  Executions are waiting for your review. Visit workforce detail pages to approve or reject.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <Card className='border-border/50'>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='text-base'>Recent Activity</CardTitle>
                  <button
                    onClick={() => router.push('/dashboard/activity')}
                    className='flex items-center gap-1 text-xs text-muted-foreground hover:text-[#9A66FF] transition-colors'
                  >
                    View all <IconArrowRight className='h-3 w-3' />
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className='space-y-2'>
                  {recentActivity.slice(0, 5).map((evt) => {
                    const color = activityActionColor(evt.action || '');
                    const icon = evt.actor_type === 'user' ? '👤' : evt.actor_type === 'agent' ? '🤖' : '⚙️';
                    return (
                      <div key={evt.id} className='flex items-start gap-2'>
                        <span className='text-[10px] mt-0.5'>{icon}</span>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1.5'>
                            <Badge variant='outline' className='text-[8px] px-1 py-0' style={{
                              backgroundColor: color + '15',
                              borderColor: color + '30',
                              color
                            }}>
                              {(evt.action || '').replace(/\./g, ' ')}
                            </Badge>
                            <span className='text-[9px] text-muted-foreground/60'>
                              {timeAgo(evt.created_at)}
                            </span>
                          </div>
                          <p className='text-[10px] text-muted-foreground/70 line-clamp-1'>
                            {evt.summary || evt.action}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agent Grid */}
          <Card className='border-border/50'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base'>Agents</CardTitle>
                <button
                  onClick={() => router.push('/dashboard/agents')}
                  className='flex items-center gap-1 text-xs text-muted-foreground hover:text-[#9A66FF] transition-colors'
                >
                  View all <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className='flex h-20 items-center justify-center'>
                  <div className='h-5 w-5 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
                </div>
              ) : (
                <div className='space-y-1.5'>
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className='flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50'
                      onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                    >
                      <EntityAvatar
                        icon={agent.icon}
                        color={agent.color}
                        avatarUrl={agent.avatar_url}
                        name={agent.name}
                        size='sm'
                      />
                      <div className='flex-1 min-w-0'>
                        <p className='text-xs font-medium'>{agent.name}</p>
                        <p className='text-[10px] text-muted-foreground'>
                          {agent.model} · {agent.strategy}
                        </p>
                      </div>
                      <div
                        className='h-2 w-2 rounded-full'
                        style={{
                          backgroundColor:
                            agent.status === 'active'
                              ? '#56D090'
                              : agent.status === 'inactive'
                                ? '#FFBF47'
                                : '#666'
                        }}
                      />
                    </div>
                  ))}
                  {agents.length === 0 && (
                    <p className='py-4 text-center text-xs text-muted-foreground'>No agents yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Providers */}
          <Card className='border-border/50'>
            <CardHeader className='pb-3'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-base'>Providers</CardTitle>
                <button
                  onClick={() => router.push('/dashboard/providers')}
                  className='flex items-center gap-1 text-xs text-muted-foreground hover:text-[#14FFF7] transition-colors'
                >
                  View all <IconArrowRight className='h-3 w-3' />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className='flex h-16 items-center justify-center'>
                  <div className='h-5 w-5 animate-spin rounded-full border-2 border-[#14FFF7]/30 border-t-[#14FFF7]' />
                </div>
              ) : providers.length === 0 ? (
                <p className='py-4 text-center text-xs text-muted-foreground'>No providers configured.</p>
              ) : (
                <div className='space-y-1.5'>
                  {providers.map((pv) => (
                    <div
                      key={pv.id}
                      className='flex items-center gap-2.5 rounded-lg px-2 py-1.5'
                    >
                      <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[#14FFF7]/10'>
                        <IconServer className='h-4 w-4 text-[#14FFF7]' />
                      </div>
                      <div className='flex-1 min-w-0'>
                        <p className='text-xs font-medium'>{pv.name}</p>
                        <p className='text-[10px] text-muted-foreground'>
                          {pv.provider_type} · {pv.models?.length || 0} models
                        </p>
                      </div>
                      <div
                        className='h-2 w-2 rounded-full'
                        style={{ backgroundColor: pv.is_enabled ? '#56D090' : '#666' }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
