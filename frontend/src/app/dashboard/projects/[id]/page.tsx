'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  IconArrowLeft, IconCheck, IconChevronDown, IconChevronUp,
  IconEdit, IconLoader2, IconRefresh, IconX, IconBrain
} from '@tabler/icons-react';
import api, { Execution, KanbanTask, KnowledgeEntry, Project, ProjectStatus, UpdateProjectRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

const STATUS_CFG: Record<ProjectStatus, { label: string; color: string }> = {
  active:    { label: 'Active',    color: '#56D090' },
  paused:    { label: 'Paused',    color: '#FFBF47' },
  completed: { label: 'Completed', color: '#14FFF7' },
  archived:  { label: 'Archived',  color: '#6B7280' },
};

const EXEC_STATUS_CFG: Record<string, { color: string; label: string }> = {
  running:           { color: '#9A66FF', label: 'Running' },
  planning:          { color: '#14FFF7', label: 'Planning' },
  completed:         { color: '#56D090', label: 'Completed' },
  failed:            { color: '#EF4444', label: 'Failed' },
  halted:            { color: '#FFBF47', label: 'Halted' },
  awaiting_approval: { color: '#FFBF47', label: 'Approval' },
};

const KANBAN_STATUS_CFG: Record<string, { color: string; label: string }> = {
  open:        { color: '#6B7280', label: 'Open' },
  todo:        { color: '#14FFF7', label: 'To Do' },
  in_progress: { color: '#9A66FF', label: 'In Progress' },
  blocked:     { color: '#FFBF47', label: 'Blocked' },
  done:        { color: '#56D090', label: 'Done' },
};

const ICON_OPTIONS = ['📁', '🎨', '⚡', '🚀', '💡', '🔧', '🌐', '📊', '🤖', '🎯', '🏗️', '📝'];
const COLOR_OPTIONS = ['#9A66FF', '#56D090', '#14FFF7', '#FFBF47', '#EF4444', '#3B82F6', '#EC4899', '#F97316'];

const INTERVAL_OPTIONS = [
  { value: 0,   label: 'Manual only' },
  { value: 30,  label: 'Every 30 min' },
  { value: 60,  label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 240, label: 'Every 4 hours' },
  { value: 480, label: 'Every 8 hours' },
];

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProjectDetailPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [facts, setFacts] = useState<KnowledgeEntry[]>([]);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Project edit state
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStatus, setEditStatus] = useState<ProjectStatus>('active');
  const [editIcon, setEditIcon] = useState('📁');
  const [editColor, setEditColor] = useState('#9A66FF');

  // Brief state
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [editingBrief, setEditingBrief] = useState(false);
  const [editBrief, setEditBrief] = useState('');
  const [editBriefInterval, setEditBriefInterval] = useState(0);
  const [savingBrief, setSavingBrief] = useState(false);
  const [refreshingBrief, setRefreshingBrief] = useState(false);

  const load = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const pRes = await api.getProject(projectId);
      if (!pRes.data) return;
      const p = pRes.data;
      setProject(p);
      setEditName(p.name);
      setEditDesc(p.description);
      setEditStatus(p.status);
      setEditIcon(p.icon);
      setEditColor(p.color);
      setEditBrief(p.brief);
      setEditBriefInterval(p.brief_interval_m);

      const [kanbanRes, execRes, factsRes] = await Promise.all([
        api.listKanbanTasks(p.workforce_id),
        api.listAllExecutions(),
        api.listProjectKnowledge(projectId),
      ]);
      setTasks((kanbanRes.data || []).filter(t => t.project_id === projectId));
      setExecutions((execRes.data || []).filter(e => e.project_id === projectId));
      setFacts(factsRes.data || []);
    } catch (err) {
      console.error('Failed to load project:', err);
    } finally {
      setLoading(false);
    }
  }, [session, projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    try {
      const update: UpdateProjectRequest = {
        name: editName,
        description: editDesc,
        status: editStatus,
        icon: editIcon,
        color: editColor,
      };
      const res = await api.updateProject(project.id, update);
      if (res.data) setProject(res.data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBrief() {
    if (!project) return;
    setSavingBrief(true);
    try {
      const res = await api.updateProject(project.id, {
        brief: editBrief,
        brief_interval_m: editBriefInterval,
      });
      if (res.data) setProject(res.data);
      setEditingBrief(false);
    } finally {
      setSavingBrief(false);
    }
  }

  async function handleRefreshBrief() {
    if (!project) return;
    setRefreshingBrief(true);
    try {
      const res = await api.refreshProjectBrief(project.id);
      if (res.data) {
        setProject(res.data);
        setEditBrief(res.data.brief);
      }
    } catch (err) {
      console.error('Brief refresh failed:', err);
    } finally {
      setRefreshingBrief(false);
    }
  }

  if (loading) {
    return (
      <div className='flex h-[calc(100vh-64px)] items-center justify-center'>
        <IconLoader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (!project) {
    return (
      <div className='flex h-[calc(100vh-64px)] flex-col items-center justify-center gap-3'>
        <p className='text-muted-foreground'>Project not found.</p>
        <Button variant='outline' size='sm' onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  const scfg = STATUS_CFG[project.status] || STATUS_CFG.active;
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const activeTasks = tasks.filter(t => t.status === 'in_progress').length;
  const completedExecs = executions.filter(e => e.status === 'completed').length;
  const intervalLabel = INTERVAL_OPTIONS.find(o => o.value === project.brief_interval_m)?.label ?? `Every ${project.brief_interval_m} min`;

  return (
    <div className='flex flex-col h-[calc(100vh-64px)]'>
      {/* Header */}
      <div className='border-b border-border/50 px-6 py-4'>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex items-start gap-3'>
            <button
              onClick={() => router.push('/dashboard/projects')}
              className='mt-0.5 text-muted-foreground hover:text-foreground transition-colors'
            >
              <IconArrowLeft className='h-4 w-4' />
            </button>
            {editing ? (
              <div className='space-y-3'>
                <div className='flex gap-2 items-center'>
                  <div className='flex flex-wrap gap-1'>
                    {ICON_OPTIONS.map(ic => (
                      <button
                        key={ic}
                        onClick={() => setEditIcon(ic)}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-base transition-all ${editIcon === ic ? 'bg-[#9A66FF]/20 ring-1 ring-[#9A66FF]' : 'hover:bg-accent'}`}
                      >{ic}</button>
                    ))}
                  </div>
                  <div className='flex flex-wrap gap-1'>
                    {COLOR_OPTIONS.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`h-5 w-5 rounded-full transition-all ${editColor === c ? 'ring-2 ring-offset-1 ring-offset-background' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <Input value={editName} onChange={e => setEditName(e.target.value)} className='text-lg font-semibold h-9 w-72' />
                <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} className='resize-none w-72 text-sm' placeholder='Description' />
                <div className='w-48'>
                  <Label className='text-xs mb-1 block'>Status</Label>
                  <Select value={editStatus} onValueChange={v => setEditStatus(v as ProjectStatus)}>
                    <SelectTrigger className='h-8 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_CFG) as ProjectStatus[]).map(s => (
                        <SelectItem key={s} value={s}>{STATUS_CFG[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div>
                <div className='flex items-center gap-2.5'>
                  <span className='text-2xl'>{project.icon}</span>
                  <h2 className='text-lg font-semibold tracking-tight'>{project.name}</h2>
                  <div
                    className='flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
                    style={{ backgroundColor: scfg.color + '18', color: scfg.color, border: `1px solid ${scfg.color}30` }}
                  >
                    {scfg.label}
                  </div>
                </div>
                {project.description && (
                  <p className='mt-1 text-sm text-muted-foreground/70'>{project.description}</p>
                )}
              </div>
            )}
          </div>

          <div className='flex items-center gap-2 shrink-0'>
            {editing ? (
              <>
                <Button size='sm' variant='outline' onClick={() => setEditing(false)}>
                  <IconX className='h-3.5 w-3.5' />
                </Button>
                <Button size='sm' onClick={handleSave} disabled={saving}>
                  {saving ? <IconLoader2 className='h-3.5 w-3.5 animate-spin' /> : <IconCheck className='h-3.5 w-3.5 mr-1' />}
                  Save
                </Button>
              </>
            ) : (
              <Button size='sm' variant='outline' onClick={() => setEditing(true)}>
                <IconEdit className='h-3.5 w-3.5 mr-1.5' />
                Edit
              </Button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className='flex items-center gap-6 mt-4 text-[11px] text-muted-foreground/60'>
          <span><span className='font-semibold text-foreground/80'>{tasks.length}</span> tasks</span>
          <span><span className='font-semibold text-[#56D090]'>{doneTasks}</span> done</span>
          <span><span className='font-semibold text-[#9A66FF]'>{activeTasks}</span> in progress</span>
          <span><span className='font-semibold text-foreground/80'>{executions.length}</span> executions</span>
          <span><span className='font-semibold text-[#56D090]'>{completedExecs}</span> completed</span>
          <span><span className='font-semibold text-[#14FFF7]'>{facts.length}</span> facts</span>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto px-6 py-4 space-y-6'>

        {/* ── Project Brief ────────────────────────────────────────────── */}
        <div className='rounded-xl border border-border/40 bg-background/60'>
          {/* Brief header */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-border/30'>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => setBriefExpanded(v => !v)}
                className='flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors'
              >
                {briefExpanded ? <IconChevronUp className='h-3.5 w-3.5' /> : <IconChevronDown className='h-3.5 w-3.5' />}
                Project Brief
              </button>
              <div className='flex items-center gap-1.5'>
                <div
                  className='rounded px-1.5 py-0.5 text-[10px] font-medium'
                  style={{ backgroundColor: '#9A66FF18', color: '#9A66FF' }}
                >
                  {intervalLabel}
                </div>
                {project.brief_updated_at && (
                  <span className='text-[10px] text-muted-foreground/40'>
                    updated {timeAgo(project.brief_updated_at)}
                  </span>
                )}
              </div>
            </div>
            <div className='flex items-center gap-1.5'>
              {!editingBrief && (
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 px-2 text-xs border-[#9A66FF]/30 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                  onClick={handleRefreshBrief}
                  disabled={refreshingBrief}
                >
                  {refreshingBrief
                    ? <IconLoader2 className='h-3 w-3 animate-spin mr-1' />
                    : <IconRefresh className='h-3 w-3 mr-1' />
                  }
                  {refreshingBrief ? 'Refreshing…' : 'AI Refresh'}
                </Button>
              )}
              {editingBrief ? (
                <>
                  <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => { setEditingBrief(false); setEditBrief(project.brief); setEditBriefInterval(project.brief_interval_m); }}>
                    Cancel
                  </Button>
                  <Button size='sm' className='h-7 px-2 text-xs' onClick={handleSaveBrief} disabled={savingBrief}>
                    {savingBrief ? <IconLoader2 className='h-3 w-3 animate-spin mr-1' /> : <IconCheck className='h-3 w-3 mr-1' />}
                    Save Brief
                  </Button>
                </>
              ) : (
                <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => { setEditingBrief(true); setBriefExpanded(true); }}>
                  <IconEdit className='h-3 w-3 mr-1' />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {/* Brief body */}
          {briefExpanded && (
            <div className='px-4 py-3'>
              {editingBrief ? (
                <div className='space-y-3'>
                  <Textarea
                    value={editBrief}
                    onChange={e => setEditBrief(e.target.value)}
                    rows={18}
                    className='font-mono text-xs resize-y w-full'
                    placeholder={`# Project: ${project.name}\n\n## Objective\n...\n\n## Workspace\n...\n\n## What Works\n...\n\n## Avoid\n...`}
                  />
                  <div className='flex items-center gap-3'>
                    <Label className='text-xs text-muted-foreground shrink-0'>Auto-refresh interval</Label>
                    <select
                      value={editBriefInterval}
                      onChange={e => setEditBriefInterval(Number(e.target.value))}
                      className='rounded-md border border-border/50 bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                    >
                      {INTERVAL_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <span className='text-[10px] text-muted-foreground/50'>
                      Runs after each execution completion when interval {'>'} 0
                    </span>
                  </div>
                </div>
              ) : project.brief ? (
                <pre className='whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/80 max-h-96 overflow-y-auto'>
                  {project.brief}
                </pre>
              ) : (
                <div className='flex flex-col items-center justify-center py-8 gap-2'>
                  <p className='text-sm text-muted-foreground/50'>No brief yet.</p>
                  <p className='text-xs text-muted-foreground/40'>
                    Click <span className='text-[#9A66FF]'>AI Refresh</span> to generate from execution history, or <span className='text-foreground/60'>Edit</span> to write manually.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Project Facts (extracted knowledge) ─────────────────────── */}
        {facts.length > 0 && (
          <div className='rounded-xl border border-border/40 bg-background/60'>
            <button
              className='flex w-full items-center justify-between px-4 py-3 border-b border-border/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors'
              onClick={() => setFactsExpanded(v => !v)}
            >
              <div className='flex items-center gap-2'>
                <IconBrain className='h-3.5 w-3.5' />
                Project Facts
                <span
                  className='ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold'
                  style={{ backgroundColor: '#14FFF718', color: '#14FFF7' }}
                >
                  {facts.length}
                </span>
              </div>
              {factsExpanded ? <IconChevronUp className='h-3.5 w-3.5' /> : <IconChevronDown className='h-3.5 w-3.5' />}
            </button>
            {factsExpanded && (
              <div className='divide-y divide-border/20'>
                {facts.map(fact => (
                  <div key={fact.id} className='px-4 py-3'>
                    <div className='flex items-start justify-between gap-2 mb-1'>
                      <p className='text-xs font-semibold text-foreground/80'>{fact.title}</p>
                      <span className='shrink-0 text-[10px] text-muted-foreground/40'>{timeAgo(fact.created_at)}</span>
                    </div>
                    <p className='text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap'>{fact.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tasks & Executions ──────────────────────────────────────── */}
        <div className='grid gap-6 lg:grid-cols-2'>
          {/* Kanban Tasks */}
          <div>
            <h3 className='mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50'>
              Tasks ({tasks.length})
            </h3>
            {tasks.length === 0 ? (
              <div className='flex h-24 items-center justify-center rounded-xl border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>No tasks linked to this project yet.</p>
              </div>
            ) : (
              <div className='space-y-2'>
                {tasks.map(task => {
                  const kcfg = KANBAN_STATUS_CFG[task.status] || { color: '#888', label: task.status };
                  return (
                    <div
                      key={task.id}
                      className='flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 px-4 py-3'
                      style={{ borderLeftColor: kcfg.color + '60', borderLeftWidth: 3 }}
                    >
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm font-medium line-clamp-1'>{task.title}</p>
                        {task.description && (
                          <p className='text-[11px] text-muted-foreground/60 line-clamp-1 mt-0.5'>{task.description}</p>
                        )}
                      </div>
                      <div
                        className='shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold'
                        style={{ backgroundColor: kcfg.color + '18', color: kcfg.color }}
                      >
                        {kcfg.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Executions */}
          <div>
            <h3 className='mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50'>
              Executions ({executions.length})
            </h3>
            {executions.length === 0 ? (
              <div className='flex h-24 items-center justify-center rounded-xl border border-dashed border-border/50'>
                <p className='text-xs text-muted-foreground'>No executions linked to this project yet.</p>
              </div>
            ) : (
              <div className='space-y-2'>
                {executions.map(exec => {
                  const ecfg = EXEC_STATUS_CFG[exec.status] || { color: '#888', label: exec.status };
                  return (
                    <div
                      key={exec.id}
                      className='flex cursor-pointer items-start gap-3 rounded-xl border border-border/40 bg-background/60 px-4 py-3 transition-all hover:border-border/80'
                      style={{ borderLeftColor: ecfg.color + '60', borderLeftWidth: 3 }}
                      onClick={() => router.push(`/dashboard/executions/${exec.id}`)}
                    >
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm font-medium line-clamp-1'>{exec.title || exec.objective}</p>
                        <p className='text-[10px] text-muted-foreground/50 mt-0.5'>{timeAgo(exec.created_at)}</p>
                      </div>
                      <div
                        className='shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold'
                        style={{ backgroundColor: ecfg.color + '18', color: ecfg.color }}
                      >
                        {ecfg.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
