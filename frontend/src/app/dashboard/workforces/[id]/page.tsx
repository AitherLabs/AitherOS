'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBolt,
  IconBrain,
  IconClock,
  IconCoins,
  IconDeviceFloppy,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconKey,
  IconLink,
  IconLinkOff,
  IconLoader2,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconTool,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import api, { ActivityEvent, Agent, Approval, Credential, Execution, KanbanTask, KanbanStatus, KnowledgeEntry, MCPServer, MCPToolDefinition, Workforce } from '@/lib/api';
import { AvatarUpload } from '@/components/avatar-upload';
import { EntityAvatar } from '@/components/entity-avatar';

const statusColors: Record<string, { color: string; bg: string; border: string }> = {
  draft: { color: '#FFBF47', bg: '#FFBF4715', border: '#FFBF4730' },
  planning: { color: '#14FFF7', bg: '#14FFF715', border: '#14FFF730' },
  executing: { color: '#9A66FF', bg: '#9A66FF15', border: '#9A66FF30' },
  completed: { color: '#56D090', bg: '#56D09015', border: '#56D09030' },
  failed: { color: '#EF4444', bg: '#EF444415', border: '#EF444430' },
  halted: { color: '#FFBF47', bg: '#FFBF4715', border: '#FFBF4730' },
  active: { color: '#56D090', bg: '#56D09015', border: '#56D09030' }
};

const execStatusColors: Record<string, { color: string; label: string }> = {
  running: { color: '#9A66FF', label: 'Running' },
  completed: { color: '#56D090', label: 'Completed' },
  failed: { color: '#EF4444', label: 'Failed' },
  halted: { color: '#FFBF47', label: 'Halted' },
  pending_approval: { color: '#FFBF47', label: 'Awaiting Approval' },
  awaiting_approval: { color: '#56D090', label: 'Awaiting Approval' },
  planning: { color: '#14FFF7', label: 'Planning' }
};

const strategyInfo: Record<string, { label: string; desc: string; color: string }> = {
  simple: { label: 'Simple', desc: 'Single prompt, direct response', color: '#56D090' },
  react: { label: 'ReAct', desc: 'Thought → Action → Observation loop', color: '#9A66FF' },
  function_call: { label: 'Function Call', desc: 'OpenAI-style tool use', color: '#14FFF7' }
};

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

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function WorkforceDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const wfId = params.id as string;

  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Dialogs
  const [execOpen, setExecOpen] = useState(false);
  const [execObjective, setExecObjective] = useState('');
  const [execRunning, setExecRunning] = useState(false);
  const [preflight, setPreflight] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    objective: '',
    avatar_url: '',
    budget_tokens: 0,
    budget_time_s: 0,
    agent_ids: [] as string[],
    leader_agent_id: '' as string
  });

  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [allMcpServers, setAllMcpServers] = useState<MCPServer[]>([]);
  const [agentPerms, setAgentPerms] = useState<Record<string, Record<string, string[]>>>({});
  const [mcpLoading, setMcpLoading] = useState(false);
  const [discoveringMcp, setDiscoveringMcp] = useState<string | null>(null);

  // Knowledge state
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [kbAddOpen, setKbAddOpen] = useState(false);
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResults, setKbSearchResults] = useState<KnowledgeEntry[] | null>(null);
  const [kbLoading, setKbLoading] = useState(false);

  // Approvals state
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [approvalsLoading, setApprovalsLoading] = useState(false);

  // Activity state
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // Workspace provisioning
  const [provisioning, setProvisioning] = useState(false);

  // Credentials state
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credService, setCredService] = useState('');
  const [credKey, setCredKey] = useState('');
  const [credValue, setCredValue] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [credShowValue, setCredShowValue] = useState(false);

  // Kanban state
  const [kanbanTasks, setKanbanTasks] = useState<KanbanTask[]>([]);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState(1);
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [autonomousToggling, setAutonomousToggling] = useState(false);

  const loadData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes] = await Promise.all([
        api.getWorkforce(wfId),
        api.listAgents()
      ]);
      const wf = wfRes.data;
      if (!wf) return;
      setWorkforce(wf);
      setAllAgents(agRes.data || []);

      // Resolve agents
      const agMap: Record<string, Agent> = {};
      for (const a of agRes.data || []) agMap[a.id] = a;
      const resolved = (wf.agent_ids || []).map((id) => agMap[id]).filter(Boolean);
      setAgents(resolved);

      // Load executions
      try {
        const exRes = await api.listExecutions(wfId);
        const execs = (exRes.data || []).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setExecutions(execs);
      } catch {
        setExecutions([]);
      }

      // Load MCP data
      try {
        const [wfMcpRes, allMcpRes] = await Promise.all([
          api.listWorkforceMCPServers(wfId),
          api.listMCPServers()
        ]);
        const wfMcpData = wfMcpRes.data || [];
        const allMcpData = allMcpRes.data || [];
        setMcpServers(wfMcpData);
        setAllMcpServers(allMcpData);

        // Load agent permissions for each attached server
        const perms: Record<string, Record<string, string[]>> = {};
        for (const srv of wfMcpData) {
          for (const ag of resolved) {
            try {
              const toolsRes = await api.getAgentTools(ag.id, srv.id);
              if (!perms[ag.id]) perms[ag.id] = {};
              perms[ag.id][srv.id] = toolsRes.data || [];
            } catch {
              // No permissions set
            }
          }
        }
        setAgentPerms(perms);
      } catch {
        setMcpServers([]);
        setAllMcpServers([]);
      }

      // Load knowledge data
      try {
        const [kbRes, kbCountRes] = await Promise.all([
          api.listKnowledge(wfId),
          api.countKnowledge(wfId)
        ]);
        setKnowledgeEntries(kbRes.data || []);
        setKnowledgeCount(kbCountRes.data?.count || 0);
      } catch {
        setKnowledgeEntries([]);
        setKnowledgeCount(0);
      }

      // Load approvals
      try {
        const [appRes, pendingRes] = await Promise.all([
          api.listApprovals(wfId),
          api.countPendingApprovals(wfId)
        ]);
        setApprovals(appRes.data || []);
        setPendingApprovalCount(pendingRes.data?.count || 0);
      } catch {
        setApprovals([]);
        setPendingApprovalCount(0);
      }

      // Load activity events
      try {
        const actRes = await api.listActivity(wfId, 30);
        setActivityEvents(actRes.data || []);
      } catch {
        setActivityEvents([]);
      }

      // Load kanban tasks
      try {
        const kbRes = await api.listKanbanTasks(wfId);
        setKanbanTasks(kbRes.data || []);
      } catch {
        setKanbanTasks([]);
      }

      // Load credentials
      try {
        const credsRes = await api.listCredentials(wfId);
        setCredentials(credsRes.data || []);
      } catch {
        setCredentials([]);
      }
    } catch (err) {
      console.error('Failed to load workforce:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session, wfId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openEdit() {
    if (!workforce) return;
    setEditForm({
      name: workforce.name,
      description: workforce.description,
      objective: workforce.objective,
      avatar_url: workforce.avatar_url || '',
      budget_tokens: workforce.budget_tokens,
      budget_time_s: workforce.budget_time_s,
      agent_ids: workforce.agent_ids || [],
      leader_agent_id: workforce.leader_agent_id || ''
    });
    setEditOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateWorkforce(wfId, editForm);
      setEditOpen(false);
      await loadData();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteWorkforce(wfId);
      router.push('/dashboard/workforces');
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function runPreflight() {
    setPreflightLoading(true);
    setPreflight(null);
    try {
      const res = await api.preflightWorkforce(wfId);
      if (res.data) setPreflight(res.data);
    } catch { /* ignore */ } finally {
      setPreflightLoading(false);
    }
  }

  async function moveKanbanTask(task: KanbanTask, status: KanbanStatus) {
    setMovingTaskId(task.id);
    try {
      const res = await api.updateKanbanTask(task.id, { status });
      if (res.data) setKanbanTasks(prev => prev.map(t => t.id === task.id ? res.data! : t));
    } finally {
      setMovingTaskId(null);
    }
  }

  async function deleteKanbanTask(task: KanbanTask) {
    await api.deleteKanbanTask(task.id);
    setKanbanTasks(prev => prev.filter(t => t.id !== task.id));
  }

  async function runKanbanTask(task: KanbanTask) {
    setRunningTaskId(task.id);
    try {
      const objective = task.description
        ? `${task.title}\n\n${task.description}`
        : task.title;
      const execRes = await api.startExecution(wfId, objective);
      if (!execRes.data?.id) return;
      const execId = execRes.data.id;
      // Link the task to the execution and move it to in_progress
      const updated = await api.updateKanbanTask(task.id, {
        status: 'in_progress',
        execution_id: execId,
      });
      if (updated.data) setKanbanTasks(prev => prev.map(t => t.id === task.id ? updated.data! : t));
      router.push(`/dashboard/executions/${execId}`);
    } finally {
      setRunningTaskId(null);
    }
  }

  async function handleStartExec() {
    if (!execObjective.trim()) return;
    setExecRunning(true);
    try {
      const res = await api.startExecution(wfId, execObjective);
      setExecOpen(false);
      setExecObjective('');
      setPreflight(null);
      if (res.data?.id) {
        router.push(`/dashboard/executions/${res.data.id}`);
      }
    } catch (err) {
      console.error('Start execution failed:', err);
    } finally {
      setExecRunning(false);
    }
  }

  async function handleAttachMCP(serverId: string) {
    setMcpLoading(true);
    try {
      await api.attachMCPServer(wfId, serverId);
      await loadData();
    } catch (err) {
      console.error('Attach MCP failed:', err);
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleDetachMCP(serverId: string) {
    setMcpLoading(true);
    try {
      await api.detachMCPServer(wfId, serverId);
      await loadData();
    } catch (err) {
      console.error('Detach MCP failed:', err);
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleGrantAllTools(agentId: string, serverId: string) {
    try {
      await api.setAgentTools(agentId, serverId, []);
      await loadData();
    } catch (err) {
      console.error('Grant tools failed:', err);
    }
  }

  async function handleRevokeTools(agentId: string, serverId: string) {
    try {
      await api.removeAgentTools(agentId, serverId);
      await loadData();
    } catch (err) {
      console.error('Revoke tools failed:', err);
    }
  }

  async function handleDiscoverMCPTools(serverId: string) {
    setDiscoveringMcp(serverId);
    try {
      await api.discoverMCPTools(serverId);
      await loadData();
    } catch (err) {
      console.error('Discover tools failed:', err);
    } finally {
      setDiscoveringMcp(null);
    }
  }

  async function handleAddKnowledge() {
    if (!kbContent.trim()) return;
    setKbLoading(true);
    try {
      await api.createKnowledge(wfId, { title: kbTitle, content: kbContent });
      setKbTitle('');
      setKbContent('');
      setKbAddOpen(false);
      await loadData();
    } catch (err) {
      console.error('Add knowledge failed:', err);
    } finally {
      setKbLoading(false);
    }
  }

  async function handleDeleteKnowledge(entryId: string) {
    try {
      await api.deleteKnowledge(wfId, entryId);
      setKnowledgeEntries((prev) => prev.filter((e) => e.id !== entryId));
      setKnowledgeCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Delete knowledge failed:', err);
    }
  }

  async function handleResolveApproval(approvalId: string, approved: boolean) {
    setApprovalsLoading(true);
    try {
      await api.resolveApproval(approvalId, {
        approved,
        reviewer_notes: '',
        resolved_by: 'operator'
      });
      await loadData();
    } catch (err) {
      console.error('Resolve approval failed:', err);
    } finally {
      setApprovalsLoading(false);
    }
  }

  async function handleSearchKnowledge() {
    if (!kbSearchQuery.trim()) {
      setKbSearchResults(null);
      return;
    }
    setKbLoading(true);
    try {
      const res = await api.searchKnowledge(wfId, kbSearchQuery, 5);
      setKbSearchResults(res.data || []);
    } catch (err) {
      console.error('Search knowledge failed:', err);
    } finally {
      setKbLoading(false);
    }
  }

  if (loading) {
    return (
      <div className='flex h-[80vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  if (!workforce) {
    return (
      <div className='flex h-[80vh] flex-col items-center justify-center gap-4'>
        <p className='text-muted-foreground'>Workforce not found.</p>
        <Button variant='outline' onClick={() => router.push('/dashboard/workforces')}>
          <IconArrowLeft className='mr-2 h-4 w-4' /> Back
        </Button>
      </div>
    );
  }

  const sc = statusColors[workforce.status] || statusColors.draft;

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Top Bar */}
      <div className='flex items-center justify-between border-b border-border/50 px-6 py-3'>
        <div className='flex items-center gap-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => router.push('/dashboard/workforces')}
            className='h-8 w-8'
          >
            <IconArrowLeft className='h-4 w-4' />
          </Button>
          <EntityAvatar
            icon={workforce.icon || '👥'}
            color={workforce.color || '#9A66FF'}
            avatarUrl={workforce.avatar_url}
            size='sm'
          />
          <div>
            <h1 className='text-sm font-semibold'>{workforce.name}</h1>
            <p className='text-xs text-muted-foreground'>
              {agents.length} agent{agents.length !== 1 ? 's' : ''} · {executions.length} execution{executions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Badge
            variant='outline'
            className='ml-1 text-[10px]'
            style={{ backgroundColor: sc.bg, borderColor: sc.border, color: sc.color }}
          >
            {workforce.status}
          </Badge>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            onClick={() => { setRefreshing(true); loadData(); }}
          >
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => router.push(`/dashboard/workforces/${wfId}/knowledge`)}
          >
            <IconBrain className='mr-1 h-3.5 w-3.5 text-[#9A66FF]' /> Knowledge
          </Button>
          <Button variant='outline' size='sm' onClick={openEdit}>
            <IconPencil className='mr-1 h-3.5 w-3.5' /> Edit
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='text-red-400 hover:text-red-400'
            onClick={() => setDeleteOpen(true)}
          >
            <IconTrash className='mr-1 h-3.5 w-3.5' /> Delete
          </Button>
          <Button
            size='sm'
            className='bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'
            onClick={() => {
              setExecObjective(workforce.objective);
              setExecOpen(true);
            }}
          >
            <IconPlayerPlay className='mr-1 h-3.5 w-3.5' /> Launch
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <ScrollArea className='flex-1'>
        <div className='mx-auto max-w-6xl space-y-8 p-6'>

          {/* Objective & Budget */}
          <div className='grid gap-6 lg:grid-cols-[1fr_300px]'>
            <div className='rounded-xl border border-border/50 bg-[#9A66FF]/5 p-5'>
              <h3 className='mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Mission Objective
              </h3>
              <p className='whitespace-pre-wrap text-sm leading-relaxed text-[#EAEAEA]/90'>
                {workforce.objective}
              </p>
              {workforce.description && (
                <p className='mt-3 text-xs text-muted-foreground'>
                  {workforce.description}
                </p>
              )}
            </div>
            <div className='space-y-3'>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFBF47]/15'>
                    <IconCoins className='h-5 w-5 text-[#FFBF47]' />
                  </div>
                  <div>
                    <p className='text-lg font-semibold'>{formatTokens(workforce.budget_tokens)}</p>
                    <p className='text-xs text-muted-foreground'>Token budget</p>
                  </div>
                </CardContent>
              </Card>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[#14FFF7]/15'>
                    <IconClock className='h-5 w-5 text-[#14FFF7]' />
                  </div>
                  <div>
                    <p className='text-lg font-semibold'>{formatTime(workforce.budget_time_s)}</p>
                    <p className='text-xs text-muted-foreground'>Time budget</p>
                  </div>
                </CardContent>
              </Card>
              <Card className='border-border/50'>
                <CardContent className='flex items-center gap-3 p-4'>
                  <div className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#9A66FF]/15'>
                    <IconFolder className='h-5 w-5 text-[#9A66FF]' />
                  </div>
                  <div className='min-w-0 flex-1'>
                    {workforce.workspace_path ? (
                      <p className='truncate font-mono text-xs text-foreground' title={workforce.workspace_path}>
                        {workforce.workspace_path}
                      </p>
                    ) : (
                      <p className='text-xs text-muted-foreground'>Not provisioned</p>
                    )}
                    <p className='text-xs text-muted-foreground'>Workspace</p>
                  </div>
                  {!workforce.workspace_path && (
                    <Button
                      size='sm'
                      variant='outline'
                      className='flex-shrink-0 border-[#9A66FF]/40 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                      disabled={provisioning}
                      onClick={async () => {
                        setProvisioning(true);
                        try {
                          await api.provisionWorkspace(wfId);
                          const res = await api.getWorkforce(wfId);
                          if (res.data) setWorkforce(res.data);
                        } finally {
                          setProvisioning(false);
                        }
                      }}
                    >
                      {provisioning ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Provision'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator />

          {/* ── Task Board ─────────────────────────────────────── */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Task Board
              </h3>
              <div className='flex items-center gap-3'>
                {/* Autonomous mode toggle */}
                <div className='flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-1.5'>
                  <IconRobot className={`h-3.5 w-3.5 ${workforce.autonomous_mode ? 'text-[#9A66FF]' : 'text-muted-foreground'}`} />
                  <span className='text-xs text-muted-foreground'>Autonomous</span>
                  <button
                    onClick={async () => {
                      setAutonomousToggling(true);
                      try {
                        const res = await api.updateWorkforce(wfId, { autonomous_mode: !workforce.autonomous_mode });
                        if (res.data) setWorkforce(res.data);
                      } finally {
                        setAutonomousToggling(false);
                      }
                    }}
                    disabled={autonomousToggling}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
                      workforce.autonomous_mode ? 'bg-[#9A66FF]' : 'bg-border'
                    } ${autonomousToggling ? 'opacity-50' : ''}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      workforce.autonomous_mode ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                  {workforce.autonomous_mode && (
                    <div className='flex items-center gap-1'>
                      <span className='text-xs text-muted-foreground'>every</span>
                      <input
                        type='number'
                        min={5}
                        max={1440}
                        value={workforce.heartbeat_interval_m}
                        onChange={async (e) => {
                          const v = Math.max(5, Math.min(1440, parseInt(e.target.value) || 30));
                          const res = await api.updateWorkforce(wfId, { heartbeat_interval_m: v });
                          if (res.data) setWorkforce(res.data);
                        }}
                        className='w-12 rounded border border-[#9A66FF]/40 bg-transparent px-1 py-0.5 text-center text-xs text-[#9A66FF] focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                      />
                      <span className='text-xs text-[#9A66FF]'>min</span>
                    </div>
                  )}
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  className='border-[#9A66FF]/40 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                  onClick={() => setAddTaskOpen(true)}
                >
                  <IconPlus className='mr-1 h-3.5 w-3.5' />
                  Add Task
                </Button>
              </div>
            </div>

            {/* Board columns */}
            {(() => {
              const columns: { status: KanbanStatus; label: string; color: string; bg: string }[] = [
                { status: 'open',        label: 'Open',        color: '#6B7280', bg: '#6B728015' },
                { status: 'todo',        label: 'To Do',       color: '#14FFF7', bg: '#14FFF715' },
                { status: 'in_progress', label: 'In Progress', color: '#9A66FF', bg: '#9A66FF15' },
                { status: 'blocked',     label: 'Blocked',     color: '#FFBF47', bg: '#FFBF4715' },
                { status: 'done',        label: 'Done',        color: '#56D090', bg: '#56D09015' },
              ];
              const priorityLabel = ['Low', 'Normal', 'High', 'Urgent'];
              const priorityColor = ['#6B7280', '#14FFF7', '#FFBF47', '#EF4444'];

              const nextStatus: Partial<Record<KanbanStatus, KanbanStatus>> = {
                open: 'todo',
                todo: 'in_progress',
                in_progress: 'done',
                blocked: 'todo',
              };
              const prevStatus: Partial<Record<KanbanStatus, KanbanStatus>> = {
                todo: 'open',
                in_progress: 'todo',
                done: 'in_progress',
              };

              return (
                <div className='flex gap-3 overflow-x-auto pb-2'>
                  {columns.map(col => {
                    const colTasks = kanbanTasks.filter(t => t.status === col.status);
                    return (
                      <div key={col.status} className='flex w-64 flex-shrink-0 flex-col rounded-xl border border-border/40 bg-[#0A0D11]/60'>
                        {/* Column header */}
                        <div className='flex items-center justify-between px-3 py-2.5' style={{ borderBottom: `1px solid ${col.color}20` }}>
                          <div className='flex items-center gap-2'>
                            <div className='h-2 w-2 rounded-full' style={{ backgroundColor: col.color }} />
                            <span className='text-xs font-semibold' style={{ color: col.color }}>{col.label}</span>
                          </div>
                          <span className='rounded-full px-1.5 py-0.5 text-[10px] font-medium' style={{ background: col.bg, color: col.color }}>
                            {colTasks.length}
                          </span>
                        </div>

                        {/* Cards */}
                        <div className='flex flex-col gap-2 p-2'>
                          {colTasks.map(task => {
                            const assignedAgent = agents.find(a => a.id === task.assigned_to);
                            const isMoving = movingTaskId === task.id;
                            const next = nextStatus[task.status];
                            const prev = prevStatus[task.status];
                            return (
                              <div
                                key={task.id}
                                className={`group relative rounded-lg border border-border/40 bg-card/80 p-3 transition-opacity ${isMoving ? 'opacity-50' : ''}`}
                                style={{ borderLeft: `3px solid ${priorityColor[task.priority] || '#6B7280'}` }}
                              >
                                {/* Delete button */}
                                <button
                                  onClick={() => deleteKanbanTask(task)}
                                  className='absolute right-2 top-2 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block'
                                >
                                  <IconX className='h-3 w-3' />
                                </button>

                                <p className='mb-1 pr-4 text-sm font-medium leading-snug text-foreground line-clamp-2'>
                                  {task.title}
                                </p>
                                {task.description && (
                                  <p className='mb-2 text-xs text-muted-foreground line-clamp-2'>{task.description}</p>
                                )}

                                <div className='flex flex-wrap items-center gap-1.5'>
                                  <span className='rounded px-1.5 py-0.5 text-[10px] font-medium' style={{ background: `${priorityColor[task.priority]}20`, color: priorityColor[task.priority] }}>
                                    {priorityLabel[task.priority]}
                                  </span>
                                  {assignedAgent && (
                                    <span className='flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]' style={{ background: `${assignedAgent.color}15`, color: assignedAgent.color }}>
                                      <span>{assignedAgent.icon}</span>
                                      <span>{assignedAgent.name}</span>
                                    </span>
                                  )}
                                  {task.created_by !== 'human' && (
                                    <span className='rounded px-1.5 py-0.5 text-[10px] text-muted-foreground'>by {task.created_by}</span>
                                  )}
                                  {task.execution_id && (
                                    <a
                                      href={`/dashboard/executions/${task.execution_id}`}
                                      className='flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#9A66FF] hover:underline'
                                    >
                                      <IconBolt className='h-2.5 w-2.5' />
                                      View run
                                    </a>
                                  )}
                                </div>

                                {/* Action buttons */}
                                {!isMoving && (
                                  <div className='mt-2.5 flex flex-wrap gap-1'>
                                    {prev && (
                                      <button
                                        onClick={() => moveKanbanTask(task, prev)}
                                        className='rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/50'
                                      >
                                        ← Back
                                      </button>
                                    )}
                                    {task.status === 'todo' && (
                                      <button
                                        onClick={() => runKanbanTask(task)}
                                        disabled={runningTaskId === task.id}
                                        className='flex items-center gap-0.5 rounded bg-[#9A66FF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#9A66FF] hover:bg-[#9A66FF]/25 disabled:opacity-50'
                                      >
                                        {runningTaskId === task.id
                                          ? <IconLoader2 className='h-2.5 w-2.5 animate-spin' />
                                          : <IconPlayerPlay className='h-2.5 w-2.5' />}
                                        Run
                                      </button>
                                    )}
                                    {next && task.status !== 'todo' && (
                                      <button
                                        onClick={() => moveKanbanTask(task, next)}
                                        className='rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent/50'
                                        style={{ color: columns.find(c => c.status === next)?.color }}
                                      >
                                        → {columns.find(c => c.status === next)?.label}
                                      </button>
                                    )}
                                    {task.status === 'in_progress' && (
                                      <button
                                        onClick={() => moveKanbanTask(task, 'blocked')}
                                        className='rounded px-1.5 py-0.5 text-[10px] font-medium text-[#FFBF47] hover:bg-[#FFBF47]/10'
                                      >
                                        ⚠ Blocked
                                      </button>
                                    )}
                                  </div>
                                )}
                                {isMoving && (
                                  <div className='mt-2 flex justify-center'>
                                    <IconLoader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {colTasks.length === 0 && (
                            <div className='flex h-16 items-center justify-center rounded-lg border border-dashed border-border/30'>
                              <p className='text-[11px] text-muted-foreground/50'>Empty</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <Separator />

          {/* Agent Team Topology */}
          <div>
            <h3 className='mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
              Agent Team
            </h3>

            {/* Visual Agent Flow */}
            <div className='mb-6 rounded-xl border border-border/40 bg-[#0A0D11]/40 p-6'>
              <div className='flex items-center justify-center gap-3'>
                {/* Orchestrator node */}
                <div className='flex flex-col items-center'>
                  <div className='flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#14FFF7]/40 bg-[#14FFF7]/10 text-2xl'>
                    🎯
                  </div>
                  <span className='mt-1.5 text-[10px] font-medium text-[#14FFF7]'>
                    Orchestrator
                  </span>
                </div>

                {/* Connection lines */}
                <div className='flex flex-col items-center gap-1'>
                  {agents.map((_, i) => (
                    <div
                      key={i}
                      className='h-[2px] w-12'
                      style={{
                        background: `linear-gradient(90deg, #14FFF740, ${agents[i]?.color || '#9A66FF'}40)`
                      }}
                    />
                  ))}
                  {agents.length === 0 && <div className='h-[2px] w-12 bg-border/30' />}
                </div>

                {/* Agent nodes */}
                <div className='flex flex-col gap-3'>
                  {agents.map((agent) => {
                    const si = strategyInfo[agent.strategy] || strategyInfo.simple;
                    return (
                      <div
                        key={agent.id}
                        className='flex items-center gap-3 rounded-xl border border-border/40 bg-background/60 px-4 py-3 transition-colors hover:border-[#9A66FF]/40 cursor-pointer'
                        onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                      >
                        <EntityAvatar
                          icon={agent.icon}
                          color={agent.color}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='lg'
                        />
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-semibold' style={{ color: agent.color }}>
                              {agent.name}
                            </span>
                            <Badge
                              variant='outline'
                              className='text-[9px]'
                              style={{
                                borderColor: si.color + '30',
                                color: si.color,
                                backgroundColor: si.color + '10'
                              }}
                            >
                              {si.label}
                            </Badge>
                          </div>
                          <div className='flex items-center gap-2 text-[10px] text-muted-foreground'>
                            <span className='font-mono'>{agent.model}</span>
                            <span className='text-border'>·</span>
                            <span>max {agent.max_iterations} iters</span>
                            {agent.tools?.length > 0 && (
                              <>
                                <span className='text-border'>·</span>
                                <span>{agent.tools.length} tool{agent.tools.length !== 1 ? 's' : ''}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <IconArrowRight className='h-4 w-4 text-muted-foreground/30' />
                      </div>
                    );
                  })}
                </div>

                {/* Connection to result */}
                <div className='flex flex-col items-center gap-1'>
                  {agents.map((agent, i) => (
                    <div
                      key={i}
                      className='h-[2px] w-12'
                      style={{
                        background: `linear-gradient(90deg, ${agent.color}40, #56D09040)`
                      }}
                    />
                  ))}
                  {agents.length === 0 && <div className='h-[2px] w-12 bg-border/30' />}
                </div>

                {/* Result node */}
                <div className='flex flex-col items-center'>
                  <div className='flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#56D090]/40 bg-[#56D090]/10 text-2xl'>
                    ⚡
                  </div>
                  <span className='mt-1.5 text-[10px] font-medium text-[#56D090]'>
                    Result
                  </span>
                </div>
              </div>
            </div>

            {/* Agent Detail Cards */}
            <div className='grid gap-4 md:grid-cols-2'>
              {agents.map((agent) => {
                const si = strategyInfo[agent.strategy] || strategyInfo.simple;
                return (
                  <Card
                    key={agent.id}
                    className='cursor-pointer border-border/50 transition-colors hover:border-[#9A66FF]/40'
                    onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                  >
                    <CardHeader className='pb-2'>
                      <div className='flex items-start gap-3'>
                        <EntityAvatar
                          icon={agent.icon}
                          color={agent.color}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='lg'
                        />
                        <div className='flex-1 min-w-0'>
                          <CardTitle className='text-base' style={{ color: agent.color }}>
                            {agent.name}
                          </CardTitle>
                          <p className='mt-0.5 text-xs text-muted-foreground line-clamp-2'>
                            {agent.description}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      <div className='grid grid-cols-3 gap-3'>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Strategy</p>
                          <p className='text-xs font-medium' style={{ color: si.color }}>
                            {si.label}
                          </p>
                        </div>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Model</p>
                          <p className='truncate font-mono text-xs'>{agent.model}</p>
                        </div>
                        <div className='rounded-lg bg-background/60 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground'>Max Iters</p>
                          <p className='text-xs font-medium'>{agent.max_iterations}</p>
                        </div>
                      </div>
                      {/* Variables & Tools */}
                      <div className='flex flex-wrap gap-1.5'>
                        {agent.variables?.map((v) => (
                          <Badge key={v.name} variant='secondary' className='font-mono text-[10px]'>
                            {'{{' + v.name + '}}'}
                          </Badge>
                        ))}
                        {agent.tools?.map((tool) => (
                          <Badge
                            key={tool}
                            variant='outline'
                            className='border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[10px] text-[#14FFF7]'
                          >
                            {tool}
                          </Badge>
                        ))}
                      </div>
                      {/* System prompt preview */}
                      {agent.system_prompt && (
                        <div className='rounded-lg border border-border/30 bg-[#0A0D11]/40 px-3 py-2'>
                          <p className='text-[10px] text-muted-foreground mb-1'>System Prompt</p>
                          <p className='font-mono text-[10px] leading-relaxed text-[#EAEAEA]/60 line-clamp-3'>
                            {agent.system_prompt}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* MCP Tools */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                <IconTool className='mr-1 inline h-4 w-4' />
                MCP Tools
              </h3>
              {mcpLoading && <IconLoader2 className='h-4 w-4 animate-spin text-muted-foreground' />}
            </div>

            {/* Attached MCP Servers */}
            {mcpServers.length > 0 ? (
              <div className='space-y-3'>
                {mcpServers.map((srv) => (
                  <Card key={srv.id} className='border-border/50'>
                    <CardHeader className='pb-2'>
                      <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-2'>
                          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-[#14FFF7]/10'>
                            <IconTool className='h-4 w-4 text-[#14FFF7]' />
                          </div>
                          <div>
                            <CardTitle className='text-sm'>{srv.name}</CardTitle>
                            <p className='text-[10px] text-muted-foreground'>
                              {srv.transport} · {srv.tools?.length || 0} tools
                            </p>
                          </div>
                        </div>
                        <div className='flex gap-1'>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-xs text-muted-foreground hover:text-foreground'
                            disabled={discoveringMcp === srv.id}
                            onClick={() => handleDiscoverMCPTools(srv.id)}
                            title='Re-run tool discovery'
                          >
                            {discoveringMcp === srv.id
                              ? <IconLoader2 className='h-3 w-3 animate-spin' />
                              : <IconRefresh className='h-3 w-3' />}
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-xs text-red-400 hover:text-red-400'
                            onClick={() => handleDetachMCP(srv.id)}
                          >
                            <IconLinkOff className='mr-1 h-3 w-3' /> Detach
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      {/* Per-agent access */}
                      <div className='space-y-2'>
                        <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                          Agent Access
                        </p>
                        {agents.map((agent) => {
                          const perms = agentPerms[agent.id]?.[srv.id];
                          const hasAccess = perms && perms.length > 0;
                          const hasAll = hasAccess && perms.some((p: string) => p === '');
                          return (
                            <div
                              key={agent.id}
                              className='flex items-center justify-between rounded-lg border border-border/30 px-3 py-2'
                            >
                              <div className='flex items-center gap-2'>
                                <EntityAvatar icon={agent.icon} color={agent.color} avatarUrl={agent.avatar_url} name={agent.name} size='xs' />
                                <span className='text-xs font-medium' style={{ color: agent.color }}>
                                  {agent.name}
                                </span>
                                {hasAccess && (
                                  <Badge
                                    variant='outline'
                                    className='border-[#56D090]/30 bg-[#56D090]/10 text-[9px] text-[#56D090]'
                                  >
                                    {hasAll ? 'All tools' : `${perms.length} tool${perms.length !== 1 ? 's' : ''}`}
                                  </Badge>
                                )}
                              </div>
                              <div className='flex gap-1'>
                                {hasAccess ? (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 text-[10px] text-red-400 hover:text-red-400'
                                    onClick={() => handleRevokeTools(agent.id, srv.id)}
                                  >
                                    Revoke
                                  </Button>
                                ) : (
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 text-[10px] text-[#56D090] hover:text-[#56D090]'
                                    onClick={() => handleGrantAllTools(agent.id, srv.id)}
                                  >
                                    Grant All
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Tool list preview */}
                      {srv.tools && srv.tools.length > 0 && (
                        <div className='space-y-1'>
                          <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                            Available Tools
                          </p>
                          <div className='flex flex-wrap gap-1'>
                            {srv.tools.map((tool) => (
                              <Badge
                                key={tool.name}
                                variant='outline'
                                className='border-border/50 text-[9px]'
                                title={tool.description}
                              >
                                {tool.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No MCP servers attached. Add one to give agents tools.
                </p>
              </div>
            )}

            {/* Available servers to attach */}
            {(() => {
              const attachedIds = new Set(mcpServers.map((s) => s.id));
              const available = allMcpServers.filter((s) => !attachedIds.has(s.id) && s.is_enabled);
              if (available.length === 0) return null;
              return (
                <div className='mt-3'>
                  <p className='mb-2 text-[10px] font-semibold uppercase text-muted-foreground'>
                    Available Servers
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {available.map((srv) => (
                      <Button
                        key={srv.id}
                        variant='outline'
                        size='sm'
                        className='text-xs'
                        onClick={() => handleAttachMCP(srv.id)}
                        disabled={mcpLoading}
                      >
                        <IconLink className='mr-1 h-3 w-3' />
                        {srv.name}
                        {srv.tools && srv.tools.length > 0 && (
                          <span className='ml-1 text-muted-foreground'>
                            ({srv.tools.length} tools)
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <Separator />

          {/* Knowledge Base */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Knowledge Base
                {knowledgeCount > 0 && (
                  <span className='ml-2 text-[10px] font-normal text-muted-foreground/70'>
                    ({knowledgeCount} entries)
                  </span>
                )}
              </h3>
              <Button
                size='sm'
                variant='ghost'
                className='text-xs'
                onClick={() => setKbAddOpen(true)}
              >
                <IconPlus className='mr-1 h-3 w-3' /> Add Knowledge
              </Button>
            </div>

            {/* Search */}
            <div className='mb-3 flex gap-2'>
              <Input
                placeholder='Search knowledge base...'
                value={kbSearchQuery}
                onChange={(e) => {
                  setKbSearchQuery(e.target.value);
                  if (!e.target.value.trim()) setKbSearchResults(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchKnowledge()}
                className='h-8 text-xs'
              />
              <Button
                size='sm'
                variant='outline'
                className='h-8 text-xs'
                onClick={handleSearchKnowledge}
                disabled={kbLoading}
              >
                {kbLoading ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Search'}
              </Button>
            </div>

            {/* Search Results */}
            {kbSearchResults !== null && (
              <div className='mb-3 space-y-2'>
                <div className='flex items-center justify-between'>
                  <p className='text-[10px] font-semibold uppercase text-muted-foreground'>
                    Search Results ({kbSearchResults.length})
                  </p>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='h-6 text-[10px]'
                    onClick={() => { setKbSearchResults(null); setKbSearchQuery(''); }}
                  >
                    Clear
                  </Button>
                </div>
                {kbSearchResults.length === 0 ? (
                  <p className='text-xs text-muted-foreground'>No matching entries found.</p>
                ) : (
                  kbSearchResults.map((entry) => (
                    <div
                      key={entry.id}
                      className='rounded-lg border border-border/40 bg-background/50 p-3'
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <p className='text-xs font-medium'>{entry.title || 'Untitled'}</p>
                            {entry.similarity !== undefined && (
                              <Badge variant='outline' className='text-[9px]' style={{
                                backgroundColor: '#9A66FF15',
                                borderColor: '#9A66FF30',
                                color: '#9A66FF'
                              }}>
                                {Math.round(entry.similarity * 100)}% match
                              </Badge>
                            )}
                          </div>
                          <p className='mt-1 text-[10px] text-muted-foreground line-clamp-2'>
                            {(entry.content || '').slice(0, 200)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Knowledge Entries List */}
            {kbSearchResults === null && (
              knowledgeEntries.length === 0 ? (
                <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                  <p className='text-xs text-muted-foreground'>
                    No knowledge entries yet. They are auto-created from completed executions.
                  </p>
                </div>
              ) : (
                <div className='space-y-2'>
                  {knowledgeEntries.slice(0, 10).map((entry) => (
                    <div
                      key={entry.id}
                      className='group rounded-lg border border-border/40 bg-background/50 p-3'
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <p className='text-xs font-medium'>{entry.title || 'Untitled'}</p>
                            <Badge variant='outline' className='text-[9px]' style={{
                              backgroundColor: entry.source_type === 'manual' ? '#14FFF715' : '#56D09015',
                              borderColor: entry.source_type === 'manual' ? '#14FFF730' : '#56D09030',
                              color: entry.source_type === 'manual' ? '#14FFF7' : '#56D090'
                            }}>
                              {(entry.source_type || '').replace('_', ' ')}
                            </Badge>
                          </div>
                          <p className='mt-1 text-[10px] text-muted-foreground line-clamp-2'>
                            {(entry.content || '').slice(0, 200)}
                          </p>
                          <p className='mt-1 text-[9px] text-muted-foreground/60'>
                            {timeAgo(entry.created_at)}
                          </p>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-400'
                          onClick={() => handleDeleteKnowledge(entry.id)}
                        >
                          <IconTrash className='h-3 w-3' />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {knowledgeEntries.length > 10 && (
                    <p className='text-center text-[10px] text-muted-foreground'>
                      Showing 10 of {knowledgeEntries.length} entries
                    </p>
                  )}
                </div>
              )
            )}

            {/* Add Knowledge Dialog */}
            <Dialog open={kbAddOpen} onOpenChange={setKbAddOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Knowledge</DialogTitle>
                  <DialogDescription>
                    Add manual knowledge to this workforce. Agents will use it via RAG during executions.
                  </DialogDescription>
                </DialogHeader>
                <div className='space-y-3'>
                  <div className='space-y-2'>
                    <Label>Title</Label>
                    <Input
                      value={kbTitle}
                      onChange={(e) => setKbTitle(e.target.value)}
                      placeholder='Brief title for this knowledge entry'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Content</Label>
                    <Textarea
                      value={kbContent}
                      onChange={(e) => setKbContent(e.target.value)}
                      placeholder='Knowledge content (facts, procedures, context...)'
                      rows={6}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant='outline' onClick={() => setKbAddOpen(false)}>Cancel</Button>
                  <Button
                    onClick={handleAddKnowledge}
                    disabled={kbLoading || !kbContent.trim()}
                    className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  >
                    {kbLoading ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlus className='mr-1 h-4 w-4' />}
                    {kbLoading ? 'Embedding...' : 'Add'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Separator />

          {/* ── Credentials ──────────────────────────────────────── */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                  Credentials
                </h3>
                <span className='rounded-full bg-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                  {credentials.length} stored
                </span>
              </div>
            </div>

            {/* Add credential form */}
            <div className='mb-4 rounded-xl border border-border/40 bg-[#0A0D11]/60 p-4'>
              <p className='mb-1 text-xs text-muted-foreground'>
                Credentials are encrypted at rest. Agents access them via Aither-Tools:
              </p>
              <ul className='mb-3 space-y-0.5 pl-3 text-[11px] text-muted-foreground/70'>
                <li><code className='text-[#14FFF7]'>list_secrets()</code> — discover all available service/key pairs</li>
                <li><code className='text-[#14FFF7]'>get_secret("service", "key_name")</code> — retrieve a value at runtime</li>
                <li className='text-muted-foreground/50'>If a credential is missing, the agent should signal <code>needs_help</code> with the exact service and key name needed.</li>
              </ul>
              <div className='flex gap-2'>
                <Input
                  placeholder='Service (e.g. hackerone)'
                  value={credService}
                  onChange={(e) => setCredService(e.target.value)}
                  className='h-8 text-xs'
                />
                <Input
                  placeholder='Key (e.g. api_key)'
                  value={credKey}
                  onChange={(e) => setCredKey(e.target.value)}
                  className='h-8 text-xs'
                />
                <div className='relative flex-1'>
                  <Input
                    type={credShowValue ? 'text' : 'password'}
                    placeholder='Value'
                    value={credValue}
                    onChange={(e) => setCredValue(e.target.value)}
                    className='h-8 pr-8 text-xs'
                  />
                  <button
                    onClick={() => setCredShowValue(v => !v)}
                    className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                  >
                    {credShowValue ? <IconEyeOff className='h-3.5 w-3.5' /> : <IconEye className='h-3.5 w-3.5' />}
                  </button>
                </div>
                <Button
                  size='sm'
                  className='h-8 bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  disabled={!credService.trim() || !credKey.trim() || !credValue.trim() || credSaving}
                  onClick={async () => {
                    setCredSaving(true);
                    try {
                      const res = await api.upsertCredential(wfId, {
                        service: credService.trim().toLowerCase(),
                        key_name: credKey.trim().toLowerCase(),
                        value: credValue,
                      });
                      if (res.data) {
                        setCredentials(prev => {
                          const filtered = prev.filter(c => !(c.service === res.data!.service && c.key_name === res.data!.key_name));
                          return [...filtered, res.data!].sort((a, b) => a.service.localeCompare(b.service) || a.key_name.localeCompare(b.key_name));
                        });
                        setCredService('');
                        setCredKey('');
                        setCredValue('');
                      }
                    } finally {
                      setCredSaving(false);
                    }
                  }}
                >
                  {credSaving ? <IconLoader2 className='h-3.5 w-3.5 animate-spin' /> : <IconKey className='h-3.5 w-3.5' />}
                  <span className='ml-1'>Save</span>
                </Button>
              </div>
            </div>

            {/* Credentials list grouped by service */}
            {credentials.length > 0 ? (() => {
              const grouped: Record<string, Credential[]> = {};
              for (const c of credentials) {
                if (!grouped[c.service]) grouped[c.service] = [];
                grouped[c.service].push(c);
              }
              return (
                <div className='space-y-2'>
                  {Object.entries(grouped).map(([service, keys]) => (
                    <div key={service} className='rounded-lg border border-border/30 bg-card/50'>
                      <div className='flex items-center gap-2 border-b border-border/30 px-3 py-2'>
                        <div className='flex h-5 w-5 items-center justify-center rounded bg-[#9A66FF]/15'>
                          <IconKey className='h-3 w-3 text-[#9A66FF]' />
                        </div>
                        <span className='text-xs font-semibold text-[#9A66FF]'>{service}</span>
                        <span className='text-[10px] text-muted-foreground'>{keys.length} key{keys.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className='divide-y divide-border/20'>
                        {keys.map(cred => (
                          <div key={cred.id} className='flex items-center justify-between px-3 py-2'>
                            <div className='flex items-center gap-3'>
                              <span className='font-mono text-xs text-foreground'>{cred.key_name}</span>
                              <span className='font-mono text-xs tracking-widest text-muted-foreground'>••••••••</span>
                            </div>
                            <button
                              onClick={async () => {
                                await api.deleteCredential(wfId, cred.service, cred.key_name);
                                setCredentials(prev => prev.filter(c => c.id !== cred.id));
                              }}
                              className='rounded p-1 text-muted-foreground hover:text-destructive'
                            >
                              <IconTrash className='h-3.5 w-3.5' />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })() : (
              <div className='flex h-16 items-center justify-center rounded-lg border border-dashed border-border/30'>
                <p className='text-xs text-muted-foreground/50'>No credentials yet — add your first above</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Approvals */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Approvals
                {pendingApprovalCount > 0 && (
                  <Badge className='ml-2 text-[9px]' style={{ backgroundColor: '#FFBF47', color: '#0A0D11' }}>
                    {pendingApprovalCount} pending
                  </Badge>
                )}
              </h3>
            </div>

            {approvals.length === 0 ? (
              <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No approvals yet. They are created automatically when executions need review.
                </p>
              </div>
            ) : (
              <div className='space-y-2'>
                {approvals.slice(0, 10).map((approval) => {
                  const isPending = approval.status === 'pending';
                  const isApproved = approval.status === 'approved';
                  const statusColor = isPending ? '#FFBF47' : isApproved ? '#56D090' : '#EF4444';
                  const statusLabel = isPending ? 'Pending' : isApproved ? 'Approved' : approval.status === 'rejected' ? 'Rejected' : approval.status;
                  return (
                    <div
                      key={approval.id}
                      className='rounded-lg border border-border/40 bg-background/50 p-3'
                      style={isPending ? { borderColor: '#FFBF4740' } : undefined}
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-2'>
                            <p className='text-xs font-medium'>{approval.title || 'Untitled'}</p>
                            <Badge variant='outline' className='text-[9px]' style={{
                              backgroundColor: statusColor + '15',
                              borderColor: statusColor + '30',
                              color: statusColor
                            }}>
                              {statusLabel}
                            </Badge>
                            <Badge variant='outline' className='text-[9px]' style={{
                              backgroundColor: '#9A66FF15',
                              borderColor: '#9A66FF30',
                              color: '#9A66FF'
                            }}>
                              {(approval.action_type || '').replace('_', ' ')}
                            </Badge>
                          </div>
                          {approval.description && (
                            <p className='mt-1 text-[10px] text-muted-foreground line-clamp-2'>
                              {approval.description}
                            </p>
                          )}
                          <div className='mt-1 flex items-center gap-3 text-[9px] text-muted-foreground/60'>
                            <span>by {approval.requested_by}</span>
                            {approval.confidence > 0 && (
                              <span>confidence: {Math.round(approval.confidence * 100)}%</span>
                            )}
                            {Object.keys(approval.rubric_scores || {}).length > 0 && (
                              <span>
                                rubric: {Object.entries(approval.rubric_scores).map(([k, v]) => `${k}=${v}`).join(', ')}
                              </span>
                            )}
                            <span>{timeAgo(approval.created_at)}</span>
                            {approval.resolved_at && (
                              <span>resolved {timeAgo(approval.resolved_at)} by {approval.resolved_by}</span>
                            )}
                          </div>
                          {approval.reviewer_notes && (
                            <p className='mt-1 text-[10px] italic text-muted-foreground'>
                              &quot;{approval.reviewer_notes}&quot;
                            </p>
                          )}
                        </div>
                        {isPending && (
                          <div className='flex shrink-0 gap-1'>
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 px-2 text-[10px] text-[#56D090] hover:bg-[#56D090]/10 hover:text-[#56D090]'
                              disabled={approvalsLoading}
                              onClick={() => handleResolveApproval(approval.id, true)}
                            >
                              Approve
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 px-2 text-[10px] text-[#EF4444] hover:bg-[#EF4444]/10 hover:text-[#EF4444]'
                              disabled={approvalsLoading}
                              onClick={() => handleResolveApproval(approval.id, false)}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {approvals.length > 10 && (
                  <p className='text-center text-[10px] text-muted-foreground'>
                    Showing 10 of {approvals.length} approvals
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Activity Timeline */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Activity Timeline
              </h3>
              <span className='text-[10px] text-muted-foreground'>{activityEvents.length} events</span>
            </div>

            {activityEvents.length === 0 ? (
              <div className='flex h-20 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No activity recorded yet.
                </p>
              </div>
            ) : (
              <div className='relative ml-3 border-l border-border/40 pl-4'>
                {activityEvents.slice(0, 20).map((evt) => {
                  const actionColor =
                    (evt.action || '').includes('completed') ? '#56D090' :
                    (evt.action || '').includes('failed') ? '#EF4444' :
                    (evt.action || '').includes('approved') ? '#56D090' :
                    (evt.action || '').includes('rejected') ? '#EF4444' :
                    (evt.action || '').includes('started') ? '#9A66FF' :
                    (evt.action || '').includes('halted') ? '#FFBF47' :
                    (evt.action || '').includes('created') ? '#14FFF7' :
                    '#888';
                  const actorIcon =
                    evt.actor_type === 'user' ? '👤' :
                    evt.actor_type === 'agent' ? '🤖' : '⚙️';
                  return (
                    <div key={evt.id} className='relative mb-3 pb-3 last:mb-0 last:pb-0'>
                      <div
                        className='absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background'
                        style={{ backgroundColor: actionColor }}
                      />
                      <div className='flex items-start justify-between gap-2'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1.5'>
                            <span className='text-[10px]'>{actorIcon}</span>
                            <Badge variant='outline' className='text-[8px] px-1 py-0' style={{
                              backgroundColor: actionColor + '15',
                              borderColor: actionColor + '30',
                              color: actionColor
                            }}>
                              {(evt.action || '').replace(/\./g, ' ')}
                            </Badge>
                            {evt.actor_name && (
                              <span className='text-[9px] text-muted-foreground'>
                                by {evt.actor_name}
                              </span>
                            )}
                          </div>
                          <p className='mt-0.5 text-[10px] text-muted-foreground/80'>
                            {evt.summary || (evt.action || '')}
                          </p>
                        </div>
                        <span className='shrink-0 text-[9px] text-muted-foreground/50'>
                          {timeAgo(evt.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {activityEvents.length > 20 && (
                  <p className='mt-2 text-center text-[10px] text-muted-foreground'>
                    Showing 20 of {activityEvents.length} events
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Execution History */}
          <div>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
                Execution History
              </h3>
              <Button
                size='sm'
                variant='ghost'
                className='text-xs'
                onClick={() => {
                  setExecObjective(workforce.objective);
                  setExecOpen(true);
                }}
              >
                <IconPlayerPlay className='mr-1 h-3 w-3' /> New
              </Button>
            </div>

            {executions.length === 0 ? (
              <div className='flex h-24 items-center justify-center rounded-lg border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>
                  No executions yet. Launch one to get started.
                </p>
              </div>
            ) : (
              <div className='space-y-2'>
                {executions.map((exec) => {
                  const es = execStatusColors[exec.status] || { color: '#888', label: exec.status };
                  return (
                    <div
                      key={exec.id}
                      className='flex cursor-pointer items-center gap-4 rounded-lg border border-border/40 bg-background/50 px-4 py-3 transition-colors hover:border-[#9A66FF]/40'
                      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                    >
                      <div className='flex h-9 w-9 items-center justify-center rounded-lg' style={{ backgroundColor: es.color + '15' }}>
                        <IconBolt className='h-4 w-4' style={{ color: es.color }} />
                      </div>
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm line-clamp-1'>{(exec.objective || '').slice(0, 100)}</p>
                        <div className='mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground'>
                          <span>{formatTokens(exec.tokens_used)} tokens</span>
                          <span className='text-border'>·</span>
                          <span>{exec.iterations} iter{exec.iterations !== 1 ? 's' : ''}</span>
                          <span className='text-border'>·</span>
                          <span>{timeAgo(exec.created_at)}</span>
                        </div>
                      </div>
                      <Badge
                        variant='outline'
                        className='shrink-0 text-[10px]'
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
          </div>

        </div>
      </ScrollArea>

      {/* Start Execution Dialog */}
      <Dialog open={execOpen} onOpenChange={(v) => { setExecOpen(v); if (v) runPreflight(); else setPreflight(null); }}>
        <DialogContent className='max-w-lg max-h-[90vh] flex flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle className='flex items-center gap-2'>
              <IconPlayerPlay className='h-5 w-5 text-[#56D090]' />
              Launch Execution
            </DialogTitle>
            <DialogDescription>
              Define the objective for {workforce.name}.
            </DialogDescription>
          </DialogHeader>
          <div className='overflow-y-auto flex-1 min-h-0 space-y-4 py-1'>
            <div className='space-y-2'>
              <Label>Objective</Label>
              <Textarea
                value={execObjective}
                onChange={(e) => setExecObjective(e.target.value)}
                placeholder='What should this workforce accomplish?'
                rows={4}
              />
              <p className='text-xs text-muted-foreground'>Team: {agents.map((a) => `${a.icon} ${a.name}`).join(', ')}</p>
            </div>

            {/* Pre-flight checks */}
            <div className='rounded-lg border border-border/40 overflow-hidden'>
              <div className='flex items-center gap-2 px-3 py-2 bg-muted/10 border-b border-border/30'>
                <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1'>Pre-flight Check</span>
                <button
                  onClick={runPreflight}
                  disabled={preflightLoading}
                  className='flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors'
                >
                  {preflightLoading
                    ? <IconLoader2 className='h-3 w-3 animate-spin' />
                    : <IconRefresh className='h-3 w-3' />}
                  {preflightLoading ? 'Checking…' : 'Re-run'}
                </button>
                {preflight && (
                  <span className={`text-[10px] font-bold ${preflight.ok ? 'text-[#56D090]' : 'text-red-400'}`}>
                    {preflight.ok ? '✓ Ready' : '✗ Issues found'}
                  </span>
                )}
              </div>
              <div className='divide-y divide-border/20'>
                {preflightLoading && !preflight && (
                  <p className='px-3 py-2 text-[11px] text-muted-foreground/50'>Running checks…</p>
                )}
                {preflight?.checks.map((c, i) => (
                  <div key={i} className='flex items-start gap-2 px-3 py-2'>
                    <span className={`mt-0.5 text-[11px] font-bold shrink-0 ${c.ok ? 'text-[#56D090]' : 'text-red-400'}`}>
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <div className='min-w-0'>
                      <p className='text-[11px] font-medium text-foreground/80'>{c.name}</p>
                      <p className='text-[10px] text-muted-foreground/60'>{c.detail}</p>
                    </div>
                  </div>
                ))}
                {!preflight && !preflightLoading && (
                  <p className='px-3 py-2 text-[11px] text-muted-foreground/40'>Click Re-run to validate configuration</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className='shrink-0'>
            <Button variant='outline' onClick={() => setExecOpen(false)}>Cancel</Button>
            <Button
              onClick={handleStartExec}
              disabled={execRunning || !execObjective.trim()}
              className='bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'
            >
              {execRunning ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlayerPlay className='mr-1 h-4 w-4' />}
              {execRunning ? 'Starting...' : 'Launch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className='max-w-2xl max-h-[90vh] flex flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle>Edit Workforce</DialogTitle>
          </DialogHeader>
          <ScrollArea className='flex-1 min-h-0 pr-4'>
            <div className='space-y-4 py-2'>
              <div className='flex items-start gap-4'>
                <div className='space-y-1'>
                  <Label className='text-xs text-muted-foreground'>Cover Image</Label>
                  <AvatarUpload
                    currentUrl={editForm.avatar_url}
                    size='md'
                    onUploaded={(url) => setEditForm({ ...editForm, avatar_url: url })}
                  />
                </div>
                <div className='flex-1 space-y-2'>
                  <Label>Name</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
              </div>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-2'>
                  <Label>Token Budget</Label>
                  <Input type='number' value={editForm.budget_tokens} onChange={(e) => setEditForm({ ...editForm, budget_tokens: parseInt(e.target.value) || 0 })} />
                </div>
                <div className='space-y-2'>
                  <Label>Time (sec)</Label>
                  <Input type='number' value={editForm.budget_time_s} onChange={(e) => setEditForm({ ...editForm, budget_time_s: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div className='space-y-2'>
                <Label>Description</Label>
                <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} />
              </div>
              <div className='space-y-2'>
                <Label>Objective</Label>
                <Textarea value={editForm.objective} onChange={(e) => setEditForm({ ...editForm, objective: e.target.value })} rows={3} />
              </div>
              <div className='space-y-2'>
                <Label>Agents</Label>
                <div className='grid grid-cols-2 gap-2 rounded-lg border border-border/50 p-3'>
                  {allAgents.map((agent) => (
                    <label key={agent.id} className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50'>
                      <input
                        type='checkbox'
                        checked={editForm.agent_ids.includes(agent.id)}
                        onChange={() => {
                          setEditForm((prev) => ({
                            ...prev,
                            agent_ids: prev.agent_ids.includes(agent.id)
                              ? prev.agent_ids.filter((id) => id !== agent.id)
                              : [...prev.agent_ids, agent.id]
                          }));
                        }}
                        className='accent-[#9A66FF]'
                      />
                      <span className='text-sm'>{agent.icon}</span>
                      <span className='text-sm'>{agent.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editForm.agent_ids.length > 0 && (
                <div className='space-y-2'>
                  <Label className='flex items-center gap-1.5'>
                    Team Leader
                    <span className='text-[10px] font-normal text-muted-foreground'>(handles summaries & org tasks)</span>
                  </Label>
                  <div className='grid grid-cols-2 gap-2 rounded-lg border border-border/50 p-3'>
                    {editForm.agent_ids.map((aid) => {
                      const a = allAgents.find((ag) => ag.id === aid);
                      if (!a) return null;
                      const isLeader = editForm.leader_agent_id === a.id;
                      return (
                        <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                          isLeader ? 'bg-[#9A66FF]/10 ring-1 ring-[#9A66FF]/40' : 'hover:bg-accent/50'
                        }`}>
                          <input
                            type='radio'
                            name='leader_agent_id'
                            checked={isLeader}
                            onChange={() => setEditForm((prev) => ({ ...prev, leader_agent_id: a.id }))}
                            className='accent-[#9A66FF]'
                          />
                          <span className='text-sm'>{a.icon}</span>
                          <span className='text-sm'>{a.name}</span>
                          {isLeader && <span className='ml-auto text-[10px] text-[#9A66FF] font-semibold'>Leader</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className='shrink-0'>
            <Button variant='outline' onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'>
              {saving ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconDeviceFloppy className='mr-1 h-4 w-4' />}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog */}
      <Dialog open={addTaskOpen} onOpenChange={(o) => { setAddTaskOpen(o); if (!o) { setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskPriority(1); setNewTaskAssignee(''); } }}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>Add a task to the Open backlog. You can move it to To Do when ready to action.</DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label>Title <span className='text-destructive'>*</span></Label>
              <Input
                placeholder='What needs to be done?'
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); }}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Description</Label>
              <Textarea
                placeholder='Context, acceptance criteria, links...'
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                rows={3}
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1.5'>
                <Label>Priority</Label>
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                  className='w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                >
                  <option value={0}>Low</option>
                  <option value={1}>Normal</option>
                  <option value={2}>High</option>
                  <option value={3}>Urgent</option>
                </select>
              </div>
              <div className='space-y-1.5'>
                <Label>Assign to</Label>
                <select
                  value={newTaskAssignee}
                  onChange={(e) => setNewTaskAssignee(e.target.value)}
                  className='w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                >
                  <option value=''>Unassigned</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAddTaskOpen(false)}>Cancel</Button>
            <Button
              disabled={!newTaskTitle.trim() || addingTask}
              className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
              onClick={async () => {
                if (!newTaskTitle.trim()) return;
                setAddingTask(true);
                try {
                  const res = await api.createKanbanTask(wfId, {
                    title: newTaskTitle.trim(),
                    description: newTaskDesc.trim(),
                    priority: newTaskPriority,
                    assigned_to: newTaskAssignee || undefined,
                    created_by: 'human',
                  });
                  if (res.data) setKanbanTasks(prev => [...prev, res.data!]);
                  setAddTaskOpen(false);
                  setNewTaskTitle('');
                  setNewTaskDesc('');
                  setNewTaskPriority(1);
                  setNewTaskAssignee('');
                } finally {
                  setAddingTask(false);
                }
              }}
            >
              {addingTask ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlus className='mr-1 h-4 w-4' />}
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Workforce</DialogTitle>
            <DialogDescription>
              Delete <span className='font-semibold'>{workforce.name}</span>? Agents won't be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant='destructive' onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
