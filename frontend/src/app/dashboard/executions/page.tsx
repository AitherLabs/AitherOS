'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { IconTrash } from '@tabler/icons-react';
import api, { Agent, Workforce, Execution } from '@/lib/api';
import { EntityAvatarStack } from '@/components/entity-avatar';

const execStatusConfig: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  running: {
    color: '#9A66FF',
    bg: '#9A66FF15',
    border: '#9A66FF30',
    label: 'Running'
  },
  completed: {
    color: '#56D090',
    bg: '#56D09015',
    border: '#56D09030',
    label: 'Completed'
  },
  failed: {
    color: '#EF4444',
    bg: '#EF444415',
    border: '#EF444430',
    label: 'Failed'
  },
  halted: {
    color: '#FFBF47',
    bg: '#FFBF4715',
    border: '#FFBF4730',
    label: 'Halted'
  },
  pending_approval: {
    color: '#FFBF47',
    bg: '#FFBF4715',
    border: '#FFBF4730',
    label: 'Awaiting Approval'
  },
  awaiting_approval: {
    color: '#56D090',
    bg: '#56D09015',
    border: '#56D09030',
    label: 'Awaiting Approval'
  },
  planning: {
    color: '#14FFF7',
    bg: '#14FFF715',
    border: '#14FFF730',
    label: 'Planning'
  }
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

export default function ExecutionsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [executions, setExecutions] = useState<ExecWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const loadExecutions = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes] = await Promise.all([
        api.listWorkforces(),
        api.listAgents()
      ]);
      const workforces: Workforce[] = wfRes.data || [];
      const agentsMap: Record<string, Agent> = {};
      for (const a of agRes.data || []) {
        agentsMap[a.id] = a;
      }

      const allExecs: ExecWithMeta[] = [];
      for (const wf of workforces) {
        try {
          const exRes = await api.listExecutions(wf.id);
          const wfAgents = (wf.agent_ids || [])
            .map((id) => agentsMap[id])
            .filter(Boolean);
          const execs = (exRes.data || []).map((e) => ({
            ...e,
            workforce_name: wf.name,
            workforce_agents: wfAgents
          }));
          allExecs.push(...execs);
        } catch {
          // skip
        }
      }

      allExecs.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setExecutions(allExecs);
    } catch (err) {
      console.error('Failed to load executions:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  if (loading) {
    return (
      <div className='flex h-[50vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  return (
    <div className='space-y-6 p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Executions</h2>
        <p className='text-muted-foreground'>
          Workforce execution history. Click to view the full conversation.
        </p>
      </div>
      <Separator />
      <div className='space-y-3'>
        {executions.map((exec) => {
          const statusConf = execStatusConfig[exec.status] || {
            color: '#888',
            bg: '#88815',
            border: '#88830',
            label: exec.status
          };

          return (
            <Card
              key={exec.id}
              className='cursor-pointer border-border/50 transition-all hover:border-[#9A66FF]/40 hover:shadow-md hover:shadow-[#9A66FF]/5'
              onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
            >
              <CardHeader className='pb-2'>
                <div className='flex items-start gap-4'>
                  {/* Agent Avatars Stack */}
                  <EntityAvatarStack
                    entities={(exec.workforce_agents || []).map((a) => ({ icon: a.icon, color: a.color, avatarUrl: a.avatar_url, name: a.name, id: a.id }))}
                    max={4}
                    size='sm'
                  />

                  {/* Content */}
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center justify-between gap-2'>
                      <h3 className='text-sm font-medium leading-snug line-clamp-1'>
                        {exec.title || exec.objective.slice(0, 120)}
                      </h3>
                      <div className='flex items-center gap-2 shrink-0'>
                        <Badge
                          variant='outline'
                          className='text-[10px]'
                          style={{
                            backgroundColor: statusConf.bg,
                            borderColor: statusConf.border,
                            color: statusConf.color
                          }}
                        >
                          {statusConf.label}
                        </Badge>
                        {exec.status !== 'running' && exec.status !== 'planning' && (
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!confirm('Delete this execution? This cannot be undone.')) return;
                              api.deleteExecution(exec.id).then(() => {
                                setExecutions((prev) => prev.filter((x) => x.id !== exec.id));
                              });
                            }}
                          >
                            <IconTrash className='h-3.5 w-3.5' />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className='mt-0.5 text-xs text-muted-foreground'>
                      {exec.workforce_name}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='pt-0'>
                <div className='flex items-center gap-3 text-[11px] text-muted-foreground'>
                  {/* Agent names */}
                  <span>
                    {(exec.workforce_agents || [])
                      .map((a) => a.name)
                      .join(', ')}
                  </span>
                  <span className='text-border'>·</span>
                  <span>{formatTokens(exec.tokens_used)} tokens</span>
                  <span className='text-border'>·</span>
                  <span>{exec.iterations > 0 ? `${exec.iterations} iter${exec.iterations !== 1 ? 's' : ''}` : 'no iters'}</span>
                  <span className='text-border'>·</span>
                  <span>{timeAgo(exec.created_at)}</span>
                  <span className='ml-auto font-mono text-[10px] text-muted-foreground/40'>
                    {exec.id.slice(0, 8)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {executions.length === 0 && (
        <div className='flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50'>
          <p className='text-muted-foreground'>
            No executions yet. Start one from a workforce.
          </p>
        </div>
      )}
    </div>
  );
}
