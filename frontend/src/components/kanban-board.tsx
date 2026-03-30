'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  IconBolt,
  IconEdit,
  IconExternalLink,
  IconFolder,
  IconLoader2,
  IconPaperclip,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import api, { Agent, ExecutionMode, KanbanStatus, KanbanTask, KanbanQAStatus, Project, Workforce, WorkspaceFileEntry } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';

// ── Constants ─────────────────────────────────────────────────────────────────

const COLUMNS: { status: KanbanStatus; label: string; color: string }[] = [
  { status: 'open',        label: 'Open',        color: '#6B7280' },
  { status: 'todo',        label: 'To Do',       color: '#14FFF7' },
  { status: 'in_progress', label: 'In Progress', color: '#9A66FF' },
  { status: 'blocked',     label: 'Blocked',     color: '#FFBF47' },
  { status: 'done',        label: 'Done',        color: '#56D090' },
];

function priorityLabel(p: number): string {
  if (p >= 3) return 'Urgent';
  if (p >= 2) return 'High';
  if (p >= 1) return 'Normal';
  return 'Low';
}
function priorityColor(p: number): string {
  if (p >= 3) return '#EF4444';
  if (p >= 2) return '#FFBF47';
  if (p >= 1) return '#9A66FF';
  return '#6B7280';
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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  workforceId: string;
  agents: Agent[];
  workforce: Workforce;
  onWorkforceUpdate: (wf: Workforce) => void;
}

export function KanbanBoard({ workforceId, agents, workforce, onWorkforceUpdate }: Props) {
  const router = useRouter();

  // Task data
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);

  // Pending move (open→todo needs a reason dialog)
  const [pendingMove, setPendingMove] = useState<{ task: KanbanTask; toStatus: KanbanStatus } | null>(null);
  const [moveReason, setMoveReason] = useState('');

  // In-flight states
  const [movingId, setMovingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [autonomousToggling, setAutonomousToggling] = useState(false);

  // Run dialog (mode selection for Kanban execution)
  const [runTaskTarget, setRunTaskTarget] = useState<KanbanTask | null>(null);
  const [runMode, setRunMode] = useState<ExecutionMode>('all_agents');
  const [runSingleAgentId, setRunSingleAgentId] = useState('');

  // Task detail / edit dialog
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [editingTask, setEditingTask] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [editAssignee, setEditAssignee] = useState('');
  const [editTaskProjectId, setEditTaskProjectId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [confirmCardDeleteId, setConfirmCardDeleteId] = useState<string | null>(null);

  // Drag detection — prevents detail dialog opening when dragging
  const didDragRef = useRef(false);

  // Add task dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState(1);
  const [newAssignee, setNewAssignee] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newAttachments, setNewAttachments] = useState<string[]>([]);
  const [newTaskRefs, setNewTaskRefs] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Workspace file picker for Add Task dialog
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [loadingWsFiles, setLoadingWsFiles] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [taskRefSearch, setTaskRefSearch] = useState('');

  // Projects for this workforce
  const [projects, setProjects] = useState<Project[]>([]);

  // New project dialog
  const [projectOpen, setProjectOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projIcon, setProjIcon] = useState('📁');
  const [projColor, setProjColor] = useState('#9A66FF');
  const [creatingProject, setCreatingProject] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.listKanbanTasks(workforceId);
      setTasks(res.data || []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [workforceId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    api.listProjects(workforceId).then(res => setProjects(res.data || [])).catch(() => {});
  }, [workforceId]);

  useEffect(() => {
    if (!addOpen) return;
    setLoadingWsFiles(true);
    api.listWorkspaceFiles(workforceId)
      .then(res => setWorkspaceFiles(res.data || []))
      .catch(() => setWorkspaceFiles([]))
      .finally(() => setLoadingWsFiles(false));
  }, [addOpen, workforceId]);

  // ── Task actions ───────────────────────────────────────────────────────────

  // Execute the move (called directly or after dialog confirmation).
  // Appends a timestamped log entry to notes.
  async function doMove(task: KanbanTask, toStatus: KanbanStatus, reason?: string) {
    setMovingId(task.id);
    try {
      const ts = new Date().toLocaleString();
      const entry = reason
        ? `[${ts}] → ${toStatus}: ${reason}`
        : `[${ts}] → ${toStatus}`;
      const notes = task.notes ? `${task.notes}\n${entry}` : entry;
      const res = await api.updateKanbanTask(task.id, { status: toStatus, notes });
      if (res.data) setTasks(prev => prev.map(t => t.id === task.id ? res.data! : t));
    } finally {
      setMovingId(null);
    }
  }

  function requestMove(task: KanbanTask, toStatus: KanbanStatus) {
    if (task.status === toStatus) return;
    // Dragging from Open → To Do: pause for reason
    if (task.status === 'open' && toStatus === 'todo') {
      setPendingMove({ task, toStatus });
      return;
    }
    doMove(task, toStatus);
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    await doMove(pendingMove.task, pendingMove.toStatus, moveReason || undefined);
    setPendingMove(null);
    setMoveReason('');
  }

  async function deleteTask(task: KanbanTask) {
    setDeletingTask(true);
    try {
      await api.deleteKanbanTask(task.id);
      setTasks(prev => prev.filter(t => t.id !== task.id));
      setSelectedTask(null);
      setConfirmDelete(false);
    } finally {
      setDeletingTask(false);
    }
  }

  async function runTask(task: KanbanTask, mode: ExecutionMode = 'all_agents', singleAgentId?: string) {
    setRunningId(task.id);
    try {
      const objective = task.description
        ? `${task.title}\n\n${task.description}`
        : task.title;
      const execRes = await api.startExecution(
        workforceId,
        objective,
        undefined,
        task.project_id,
        mode,
        mode === 'single_agent' ? singleAgentId : undefined
      );
      if (!execRes.data?.id) return;
      const execId = execRes.data.id;
      const updated = await api.updateKanbanTask(task.id, {
        status: 'in_progress',
        execution_id: execId,
      });
      if (updated.data) setTasks(prev => prev.map(t => t.id === task.id ? updated.data! : t));
      router.push(`/dashboard/executions/${execId}`);
    } finally {
      setRunningId(null);
    }
  }

  // Runs the highest-priority task in the To Do column.
  async function runNextTask() {
    const next = tasks
      .filter(t => t.status === 'todo')
      .sort((a, b) => b.priority - a.priority || a.position - b.position)[0];
    if (next) openRunTaskDialog(next);
  }

  function openRunTaskDialog(task: KanbanTask) {
    setRunTaskTarget(task);
    setRunMode('all_agents');
    const fallbackAgentId = task.assigned_to || agents[0]?.id || '';
    setRunSingleAgentId(fallbackAgentId);
  }

  async function confirmRunTask() {
    if (!runTaskTarget) return;
    if (runMode === 'single_agent' && !runSingleAgentId) return;
    const task = runTaskTarget;
    setRunTaskTarget(null);
    await runTask(task, runMode, runMode === 'single_agent' ? runSingleAgentId : undefined);
  }

  async function handleCreateProject() {
    if (!projName.trim()) return;
    setCreatingProject(true);
    try {
      const res = await api.createProject(workforceId, {
        name: projName.trim(),
        description: projDesc.trim(),
        icon: projIcon,
        color: projColor,
      });
      if (res.data) setProjects(prev => [...prev, res.data!]);
      setProjectOpen(false);
      setProjName(''); setProjDesc(''); setProjIcon('📁'); setProjColor('#9A66FF');
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleAddTask() {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const res = await api.createKanbanTask(workforceId, {
        title: newTitle.trim(),
        description: newDesc.trim(),
        priority: newPriority,
        assigned_to: newAssignee || undefined,
        created_by: 'human',
        project_id: newProjectId || undefined,
        attachments: newAttachments.length > 0 ? newAttachments : undefined,
        task_refs: newTaskRefs.length > 0 ? newTaskRefs : undefined,
      });
      if (res.data) setTasks(prev => [...prev, res.data!]);
      setAddOpen(false);
      setNewTitle(''); setNewDesc(''); setNewPriority(1); setNewAssignee(''); setNewProjectId('');
      setNewAttachments([]); setNewTaskRefs([]); setFileSearch(''); setTaskRefSearch('');
    } finally {
      setAdding(false);
    }
  }

  function openDetail(task: KanbanTask) {
    setSelectedTask(task);
    setEditingTask(false);
    setConfirmDelete(false);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditPriority(task.priority);
    setEditAssignee(task.assigned_to || '');
    setEditTaskProjectId(task.project_id || '');
  }

  async function saveEdit() {
    if (!selectedTask) return;
    setSavingEdit(true);
    try {
      const res = await api.updateKanbanTask(selectedTask.id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        priority: editPriority,
        assigned_to: editAssignee,
        project_id: editTaskProjectId,
      });
      if (res.data) {
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? res.data! : t));
        setSelectedTask(res.data);
      }
      setEditingTask(false);
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, taskId: string) {
    didDragRef.current = true;
    setDraggingId(taskId);
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd() {
    setDraggingId(null);
    setDragOverCol(null);
    // Reset after a tick so the click handler (which fires after dragend) can check it
    setTimeout(() => { didDragRef.current = false; }, 50);
  }

  function onDragOverColumn(e: React.DragEvent, status: KanbanStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(status);
  }

  function onDragLeaveColumn(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragOverCol(null);
    }
  }

  function onDropColumn(e: React.DragEvent, toStatus: KanbanStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === toStatus) return;
    requestMove(task, toStatus);
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const todoCount = tasks.filter(t => t.status === 'todo').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold uppercase tracking-wider text-muted-foreground'>
          Task Board
        </h3>

        <div className='flex flex-wrap items-center gap-2'>
          {/* Autonomous mode toggle */}
          <div className='flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-1.5'>
            <IconRobot className={`h-3.5 w-3.5 ${workforce.autonomous_mode ? 'text-[#9A66FF]' : 'text-muted-foreground'}`} />
            <span className='text-xs text-muted-foreground'>Autonomous</span>
            <button
              onClick={async () => {
                setAutonomousToggling(true);
                try {
                  const res = await api.updateWorkforce(workforceId, { autonomous_mode: !workforce.autonomous_mode });
                  if (res.data) onWorkforceUpdate(res.data);
                } finally { setAutonomousToggling(false); }
              }}
              disabled={autonomousToggling}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${workforce.autonomous_mode ? 'bg-[#9A66FF]' : 'bg-border'} ${autonomousToggling ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${workforce.autonomous_mode ? 'translate-x-4' : 'translate-x-0.5'}`} />
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
                    const res = await api.updateWorkforce(workforceId, { heartbeat_interval_m: v });
                    if (res.data) onWorkforceUpdate(res.data);
                  }}
                  className='w-12 rounded border border-[#9A66FF]/40 bg-transparent px-1 py-0.5 text-center text-xs text-[#9A66FF] focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                />
                <span className='text-xs text-[#9A66FF]'>min</span>
              </div>
            )}
          </div>

          {/* Run Next Task — only visible when there are todo tasks */}
          {todoCount > 0 && (
            <Button
              size='sm'
              variant='outline'
              className='border-[#56D090]/40 text-[#56D090] hover:bg-[#56D090]/10'
              onClick={runNextTask}
              disabled={runningId !== null}
            >
              {runningId ? (
                <IconLoader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
              ) : (
                <IconPlayerPlay className='mr-1 h-3.5 w-3.5' />
              )}
              Run Next Task
            </Button>
          )}

          <Button
            size='sm'
            variant='outline'
            className='border-[#14FFF7]/30 text-[#14FFF7]/70 hover:bg-[#14FFF7]/10'
            onClick={() => setProjectOpen(true)}
          >
            <IconFolder className='mr-1 h-3.5 w-3.5' />
            New Project
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='border-[#9A66FF]/40 text-[#9A66FF] hover:bg-[#9A66FF]/10'
            onClick={() => setAddOpen(true)}
          >
            <IconPlus className='mr-1 h-3.5 w-3.5' />
            Add Task
          </Button>
        </div>
      </div>

      {/* Hint banner */}
      {tasks.filter(t => t.status === 'open' && t.created_by !== 'human').length > 0 && (
        <div className='mb-3 rounded-lg border border-[#14FFF7]/20 bg-[#14FFF7]/5 px-3 py-2 text-[10px] text-[#14FFF7]/70'>
          💡 Drag tasks from <span className='font-semibold'>Open</span> into <span className='font-semibold'>To Do</span> to approve them for execution.
        </div>
      )}

      {/* Board */}
      <div className='flex gap-3 overflow-x-auto pb-3'>
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t => t.status === col.status);
          const isDragTarget = dragOverCol === col.status;

          return (
            <div
              key={col.status}
              className='flex w-72 flex-shrink-0 flex-col rounded-xl transition-all'
              style={{
                border: isDragTarget
                  ? `1px solid ${col.color}50`
                  : '1px solid rgba(255,255,255,0.06)',
                background: isDragTarget
                  ? `${col.color}08`
                  : 'rgba(10,13,17,0.6)',
              }}
              onDragOver={e => onDragOverColumn(e, col.status)}
              onDragLeave={onDragLeaveColumn}
              onDrop={e => onDropColumn(e, col.status)}
            >
              {/* Column header */}
              <div
                className='flex shrink-0 items-center justify-between px-3 py-2.5'
                style={{ borderBottom: `1px solid ${col.color}18` }}
              >
                <div className='flex items-center gap-2'>
                  <div className='h-2 w-2 rounded-full' style={{ backgroundColor: col.color }} />
                  <span className='text-xs font-semibold' style={{ color: col.color }}>
                    {col.label}
                  </span>
                  {col.status === 'open' && (
                    <span className='text-[9px] italic text-muted-foreground/40'>agent backlog</span>
                  )}
                  {col.status === 'todo' && (
                    <span className='text-[9px] italic text-muted-foreground/40'>approved</span>
                  )}
                </div>
                <span
                  className='rounded-full px-1.5 py-0.5 text-[10px] font-medium'
                  style={{ background: `${col.color}15`, color: col.color }}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Cards — fixed-height scrollable area */}
              <div className='flex flex-col gap-2 overflow-y-auto p-2' style={{ maxHeight: '540px' }}>
                {colTasks.map(task => {
                  const assignedAgent = agents.find(a => a.id === task.assigned_to);
                  const isMoving = movingId === task.id;
                  const isRunning = runningId === task.id;
                  const isDragging = draggingId === task.id;
                  const lastNote = task.notes
                    ? task.notes.split('\n').filter(Boolean).pop()
                    : null;

                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={e => onDragStart(e, task.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => { if (!didDragRef.current) openDetail(task); }}
                      className={`group relative select-none rounded-lg border border-border/30 bg-card/80 p-3 transition-all ${
                        isDragging
                          ? 'cursor-grabbing opacity-40 scale-95'
                          : 'cursor-pointer hover:border-border/60 hover:shadow-sm'
                      } ${isMoving || isRunning ? 'opacity-50' : ''}`}
                      style={{ borderLeft: `3px solid ${priorityColor(task.priority)}` }}
                    >
                      {/* Delete */}
                      {confirmCardDeleteId === task.id ? (
                        <div className='absolute right-1 top-1 flex items-center gap-1' onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setConfirmCardDeleteId(null)}
                            className='rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground'
                          >Cancel</button>
                          <button
                            onClick={() => { setConfirmCardDeleteId(null); deleteTask(task); }}
                            className='rounded bg-destructive/20 px-1 py-0.5 text-[10px] text-destructive hover:bg-destructive/30'
                          >Delete</button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmCardDeleteId(task.id); }}
                          className='absolute right-2 top-2 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block'
                        >
                          <IconTrash className='h-3 w-3' />
                        </button>
                      )}

                      {/* Title */}
                      <p className='mb-1 pr-4 text-sm font-medium leading-snug text-foreground line-clamp-2'>
                        {task.title}
                      </p>

                      {/* Description */}
                      {task.description && (
                        <p className='mb-2 text-xs text-muted-foreground line-clamp-2'>
                          {task.description}
                        </p>
                      )}

                      {/* Tags row */}
                      <div className='mb-2 flex flex-wrap items-center gap-1'>
                        <span
                          className='rounded px-1.5 py-0.5 text-[10px] font-medium'
                          style={{
                            background: `${priorityColor(task.priority)}20`,
                            color: priorityColor(task.priority),
                          }}
                        >
                          {priorityLabel(task.priority)}
                        </span>

                        {task.project_id && (() => {
                          const proj = projects.find(p => p.id === task.project_id);
                          if (!proj) return null;
                          return (
                            <span
                              className='flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]'
                              style={{ background: `${proj.color}18`, color: proj.color }}
                            >
                              <span>{proj.icon}</span>
                              <span className='max-w-[56px] truncate'>{proj.name}</span>
                            </span>
                          );
                        })()}

                        {assignedAgent && (
                          <span
                            className='flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]'
                            style={{ background: `${assignedAgent.color}15`, color: assignedAgent.color }}
                          >
                            <span>{assignedAgent.icon}</span>
                            <span>{assignedAgent.name}</span>
                          </span>
                        )}

                        {task.created_by !== 'human' && (
                          <span className='rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/60'>
                            by {task.created_by}
                          </span>
                        )}

                        {task.execution_id && (
                          <a
                            href={`/dashboard/executions/${task.execution_id}`}
                            className='flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#9A66FF] hover:underline'
                            onClick={e => e.stopPropagation()}
                          >
                            <IconBolt className='h-2.5 w-2.5' />
                            Run
                          </a>
                        )}
                      </div>

                      {/* QA status badge (shown after execution completes) */}
                      {task.qa_status && task.qa_status !== 'pending' && task.qa_status !== 'skipped' && (
                        <div className='mb-1.5'>
                          {task.qa_status === 'passed' ? (
                            <span className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold'
                              style={{ background: '#56D09020', color: '#56D090', border: '1px solid #56D09040' }}>
                              ✓ QA passed
                            </span>
                          ) : (
                            <span
                              className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold cursor-help'
                              style={{ background: '#FFBF4720', color: '#FFBF47', border: '1px solid #FFBF4740' }}
                              title={task.qa_notes}
                            >
                              ⚠ QA review needed
                            </span>
                          )}
                        </div>
                      )}

                      {/* Last note (timestamped trail) */}
                      {lastNote && (
                        <p className='mb-1 text-[9px] italic text-muted-foreground/40 line-clamp-1'>
                          {lastNote}
                        </p>
                      )}

                      {/* Timestamps */}
                      <p className='text-[9px] text-muted-foreground/30'>
                        Created {new Date(task.created_at).toLocaleDateString()} · {timeAgo(task.updated_at)}
                      </p>

                      {/* Action buttons */}
                      {!isMoving && !isRunning && (
                        <div className='mt-2 flex flex-wrap gap-1'>
                          {task.status === 'todo' && (
                            <button
                              onClick={e => { e.stopPropagation(); openRunTaskDialog(task); }}
                              disabled={runningId !== null}
                              className='flex items-center gap-0.5 rounded bg-[#9A66FF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#9A66FF] hover:bg-[#9A66FF]/25 disabled:opacity-40'
                            >
                              <IconPlayerPlay className='h-2.5 w-2.5' />
                              Run
                            </button>
                          )}
                          {task.status === 'in_progress' && (
                            <button
                              onClick={e => { e.stopPropagation(); requestMove(task, 'blocked'); }}
                              className='rounded px-1.5 py-0.5 text-[10px] font-medium text-[#FFBF47] hover:bg-[#FFBF47]/10'
                            >
                              ⚠ Blocked
                            </button>
                          )}
                          {task.status === 'blocked' && (
                            <button
                              onClick={e => { e.stopPropagation(); requestMove(task, 'todo'); }}
                              className='rounded px-1.5 py-0.5 text-[10px] font-medium text-[#14FFF7] hover:bg-[#14FFF7]/10'
                            >
                              ↩ Unblock
                            </button>
                          )}
                        </div>
                      )}

                      {(isMoving || isRunning) && (
                        <div className='mt-2 flex justify-center'>
                          <IconLoader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Empty state */}
                {colTasks.length === 0 && (
                  <div
                    className='flex h-20 items-center justify-center rounded-lg border border-dashed transition-colors'
                    style={{
                      borderColor: isDragTarget ? `${col.color}40` : 'rgba(255,255,255,0.08)',
                      background: isDragTarget ? `${col.color}08` : 'transparent',
                    }}
                  >
                    <p className='text-[11px] text-muted-foreground/40'>
                      {col.status === 'open'
                        ? 'Agent tasks appear here'
                        : col.status === 'todo'
                        ? 'Drag from Open to approve'
                        : 'Empty'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className='flex h-32 items-center justify-center'>
          <IconLoader2 className='h-5 w-5 animate-spin text-muted-foreground' />
        </div>
      )}

      {/* ── New Project Dialog ─────────────────────────────────────── */}
      <Dialog open={projectOpen} onOpenChange={o => { setProjectOpen(o); if (!o) { setProjName(''); setProjDesc(''); setProjIcon('📁'); setProjColor('#9A66FF'); } }}>
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>Create a project to group tasks and executions for this workforce.</DialogDescription>
          </DialogHeader>
          <div className='space-y-3 py-1'>
            <div className='space-y-1.5'>
              <Label>Name <span className='text-destructive'>*</span></Label>
              <Input
                placeholder='e.g. Q2 Campaign'
                value={projName}
                onChange={e => setProjName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                autoFocus
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Description</Label>
              <Textarea
                placeholder='What is this project about?'
                value={projDesc}
                onChange={e => setProjDesc(e.target.value)}
                rows={2}
                className='resize-none text-xs'
              />
            </div>
            <div className='flex gap-4'>
              <div className='space-y-1.5'>
                <Label>Icon</Label>
                <div className='flex flex-wrap gap-1 w-36'>
                  {['📁', '🎨', '⚡', '🚀', '💡', '🔧', '🌐', '📊', '🤖', '🎯', '🏗️', '📝'].map(ic => (
                    <button key={ic} onClick={() => setProjIcon(ic)}
                      className={`flex h-7 w-7 items-center justify-center rounded text-base transition-all ${projIcon === ic ? 'bg-[#9A66FF]/20 ring-1 ring-[#9A66FF]' : 'hover:bg-accent'}`}
                    >{ic}</button>
                  ))}
                </div>
              </div>
              <div className='space-y-1.5'>
                <Label>Color</Label>
                <div className='flex flex-wrap gap-1.5'>
                  {['#9A66FF', '#56D090', '#14FFF7', '#FFBF47', '#EF4444', '#3B82F6', '#EC4899', '#F97316'].map(c => (
                    <button key={c} onClick={() => setProjColor(c)}
                      className={`h-6 w-6 rounded-full transition-all ${projColor === c ? 'ring-2 ring-offset-1 ring-offset-background' : ''}`}
                      style={{ backgroundColor: c, boxShadow: projColor === c ? `0 0 0 2px ${c}` : undefined }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setProjectOpen(false)}>Cancel</Button>
            <Button
              disabled={!projName.trim() || creatingProject}
              className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
              onClick={handleCreateProject}
            >
              {creatingProject ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : null}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Run Task Dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={runTaskTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRunTaskTarget(null);
            setRunMode('all_agents');
            setRunSingleAgentId('');
          }
        }}
      >
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Run Task</DialogTitle>
            <DialogDescription>
              Choose how this task should execute before launching.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3 py-1'>
            {runTaskTarget && (
              <p className='rounded-lg bg-muted/20 px-3 py-2 text-sm font-medium leading-snug text-foreground line-clamp-3'>
                {runTaskTarget.title}
              </p>
            )}

            <div className='space-y-2'>
              <Label>Execution mode</Label>
              <div className='grid grid-cols-2 gap-2'>
                <button
                  type='button'
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    runMode === 'all_agents'
                      ? 'border-[#9A66FF]/50 bg-[#9A66FF]/10 text-[#9A66FF]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => setRunMode('all_agents')}
                >
                  <p className='font-semibold'>All agents</p>
                  <p className='mt-0.5 text-[10px] opacity-80'>With approval gate</p>
                </button>
                <button
                  type='button'
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    runMode === 'single_agent'
                      ? 'border-[#56D090]/50 bg-[#56D090]/10 text-[#56D090]'
                      : 'border-border/40 bg-background/40 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => {
                    setRunMode('single_agent');
                    if (!runSingleAgentId && agents.length > 0) setRunSingleAgentId(agents[0].id);
                  }}
                >
                  <p className='font-semibold'>Single agent</p>
                  <p className='mt-0.5 text-[10px] opacity-80'>Simple run, no approval</p>
                </button>
              </div>
            </div>

            {runMode === 'single_agent' && (
              <div className='space-y-1.5 rounded-md border border-[#56D090]/20 bg-[#56D090]/5 p-2.5'>
                <Label className='text-[11px] text-[#56D090]'>Agent</Label>
                <div className='grid gap-1.5'>
                  {agents.map((agent) => {
                    const selected = runSingleAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type='button'
                        onClick={() => setRunSingleAgentId(agent.id)}
                        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                          selected
                            ? 'border-[#56D090]/60 bg-[#56D090]/12 text-[#56D090]'
                            : 'border-border/40 bg-background/60 text-muted-foreground hover:bg-muted/20'
                        }`}
                      >
                        <EntityAvatar
                          icon={agent.icon}
                          color={agent.color}
                          avatarUrl={agent.avatar_url}
                          name={agent.name}
                          size='xs'
                        />
                        <span className='font-medium'>{agent.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRunTaskTarget(null)}>Cancel</Button>
            <Button
              onClick={confirmRunTask}
              disabled={runningId !== null || (runMode === 'single_agent' && !runSingleAgentId)}
              className='bg-[#56D090] text-[#0A0D11] hover:bg-[#56D090]/90'
            >
              {runningId ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlayerPlay className='mr-1 h-4 w-4' />}
              {runningId ? 'Starting...' : 'Run Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move Reason Dialog (Open → To Do) ──────────────────────────── */}
      <Dialog
        open={pendingMove !== null}
        onOpenChange={o => { if (!o) { setPendingMove(null); setMoveReason(''); } }}
      >
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Approve for To Do</DialogTitle>
            <DialogDescription>
              Optionally add a reason why this task is ready to action. A timestamp will be recorded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3 py-1'>
            <p className='rounded-lg bg-muted/20 px-3 py-2 text-sm font-medium leading-snug text-foreground line-clamp-3'>
              {pendingMove?.task.title}
            </p>
            <div className='space-y-1.5'>
              <Label>Reason <span className='text-muted-foreground/50 text-xs font-normal'>(optional)</span></Label>
              <Input
                placeholder='e.g. Approved in design review, sprint started…'
                value={moveReason}
                onChange={e => setMoveReason(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmPendingMove(); }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setPendingMove(null); setMoveReason(''); }}>
              Cancel
            </Button>
            <Button
              onClick={confirmPendingMove}
              className='border border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[#14FFF7] hover:bg-[#14FFF7]/20'
            >
              Move to To Do
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Task Detail Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={selectedTask !== null}
        onOpenChange={o => { if (!o) { setSelectedTask(null); setEditingTask(false); } }}
      >
        <DialogContent className='max-w-xl max-h-[85vh] overflow-y-auto'>
          {selectedTask && (() => {
            const col = COLUMNS.find(c => c.status === selectedTask.status);
            const assignedAgent = agents.find(a => a.id === selectedTask.assigned_to);
            const notes = selectedTask.notes
              ? selectedTask.notes.split('\n').filter(Boolean)
              : [];
            return (
              <>
                <DialogHeader>
                  <div className='flex items-start gap-2 pr-6'>
                    <div className='mt-0.5 h-3 w-1.5 flex-shrink-0 rounded-full' style={{ backgroundColor: priorityColor(selectedTask.priority) }} />
                    {editingTask ? (
                      <input
                        className='flex-1 rounded border border-border/50 bg-background px-2 py-1 text-base font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <DialogTitle className='text-base leading-snug'>{selectedTask.title}</DialogTitle>
                    )}
                  </div>
                  <div className='flex flex-wrap items-center gap-1.5 pl-5 pt-1'>
                    {/* Status */}
                    <span className='rounded-full px-2 py-0.5 text-[10px] font-semibold' style={{ background: `${col?.color}20`, color: col?.color }}>
                      {col?.label}
                    </span>
                    {/* Priority */}
                    <span className='rounded-full px-2 py-0.5 text-[10px] font-semibold' style={{ background: `${priorityColor(selectedTask.priority)}20`, color: priorityColor(selectedTask.priority) }}>
                      P{selectedTask.priority} · {priorityLabel(selectedTask.priority)}
                    </span>
                    {/* Assigned agent */}
                    {assignedAgent && (
                      <span className='flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]' style={{ background: `${assignedAgent.color}15`, color: assignedAgent.color }}>
                        {assignedAgent.icon} {assignedAgent.name}
                      </span>
                    )}
                    {/* Created by */}
                    {selectedTask.created_by !== 'human' && (
                      <span className='rounded-full bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground/60'>
                        by {selectedTask.created_by}
                      </span>
                    )}
                    {/* Project badge */}
                    {selectedTask.project_id && (() => {
                      const proj = projects.find(p => p.id === selectedTask.project_id);
                      if (!proj) return null;
                      return (
                        <span
                          className='flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium'
                          style={{ background: `${proj.color}18`, color: proj.color, border: `1px solid ${proj.color}30` }}
                        >
                          {proj.icon} {proj.name}
                        </span>
                      );
                    })()}
                    {/* Execution link */}
                    {selectedTask.execution_id && (
                      <a
                        href={`/dashboard/executions/${selectedTask.execution_id}`}
                        className='flex items-center gap-1 rounded-full bg-[#9A66FF]/10 px-2 py-0.5 text-[10px] text-[#9A66FF] hover:underline'
                        onClick={e => e.stopPropagation()}
                      >
                        <IconBolt className='h-2.5 w-2.5' />
                        View Execution
                        <IconExternalLink className='h-2.5 w-2.5' />
                      </a>
                    )}
                  </div>
                </DialogHeader>

                <div className='space-y-4 py-2'>
                  {/* Description */}
                  <div className='space-y-1.5'>
                    <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Description</p>
                    {editingTask ? (
                      <Textarea
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        rows={8}
                        className='font-mono text-xs'
                        placeholder='Task description, acceptance criteria, specs…'
                      />
                    ) : selectedTask.description ? (
                      <div className='rounded-lg bg-muted/10 px-3 py-2.5'>
                        <pre className='whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90'>
                          {selectedTask.description}
                        </pre>
                      </div>
                    ) : (
                      <p className='text-sm italic text-muted-foreground/40'>No description</p>
                    )}
                  </div>

                  {/* Edit-mode fields: priority, assignee, project */}
                  {editingTask && (
                    <div className='space-y-3'>
                      <div className='space-y-1.5'>
                        <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Priority</p>
                        <div className='flex items-center gap-3'>
                          <input
                            type='range' min={0} max={3} value={editPriority}
                            onChange={e => setEditPriority(Number(e.target.value))}
                            className='flex-1 accent-[#9A66FF]'
                          />
                          <span className='w-20 text-right text-sm font-semibold' style={{ color: priorityColor(editPriority) }}>
                            {priorityLabel(editPriority)}
                          </span>
                        </div>
                      </div>
                      <div className='grid grid-cols-2 gap-3'>
                        <div className='space-y-1.5'>
                          <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Assign to</p>
                          <select
                            value={editAssignee}
                            onChange={e => setEditAssignee(e.target.value)}
                            className='w-full rounded border border-border/50 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                          >
                            <option value=''>Unassigned</option>
                            {agents.map(a => (
                              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                            ))}
                          </select>
                        </div>
                        {projects.length > 0 && (
                          <div className='space-y-1.5'>
                            <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Project</p>
                            <select
                              value={editTaskProjectId}
                              onChange={e => setEditTaskProjectId(e.target.value)}
                              className='w-full rounded border border-border/50 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                            >
                              <option value=''>No project</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* QA Status */}
                  {selectedTask.qa_status && selectedTask.qa_status !== 'pending' && selectedTask.qa_status !== 'skipped' && (
                    <div className='space-y-1.5'>
                      <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>QA Review</p>
                      <div className='rounded-lg p-3' style={{
                        background: selectedTask.qa_status === 'passed' ? '#56D09010' : '#FFBF4710',
                        border: `1px solid ${selectedTask.qa_status === 'passed' ? '#56D09030' : '#FFBF4730'}`,
                      }}>
                        <p className='mb-1 text-xs font-semibold' style={{ color: selectedTask.qa_status === 'passed' ? '#56D090' : '#FFBF47' }}>
                          {selectedTask.qa_status === 'passed' ? '✓ QA Passed' : '⚠ QA Review Needed'}
                        </p>
                        {selectedTask.qa_notes && (
                          <p className='text-xs text-muted-foreground'>{selectedTask.qa_notes}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Audit trail */}
                  {notes.length > 0 && (
                    <div className='space-y-1.5'>
                      <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Activity</p>
                      <div className='space-y-1 rounded-lg bg-muted/10 px-3 py-2.5'>
                        {notes.map((note, i) => (
                          <p key={i} className='font-mono text-[11px] text-muted-foreground/60'>{note}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className='space-y-0.5'>
                    <p className='text-[10px] text-muted-foreground/30'>
                      Created {new Date(selectedTask.created_at).toLocaleString()}
                    </p>
                    {selectedTask.started_at && (
                      <p className='text-[10px] text-[#9A66FF]/50'>
                        Started {new Date(selectedTask.started_at).toLocaleString()}
                      </p>
                    )}
                    {selectedTask.done_at && (
                      <p className='text-[10px] text-[#56D090]/50'>
                        Completed {new Date(selectedTask.done_at).toLocaleString()}
                      </p>
                    )}
                    {!selectedTask.done_at && (
                      <p className='text-[10px] text-muted-foreground/30'>
                        Last updated {timeAgo(selectedTask.updated_at)}
                      </p>
                    )}
                  </div>
                </div>

                <DialogFooter className='flex-wrap gap-2'>
                  {editingTask ? (
                    <>
                      <Button variant='outline' onClick={() => setEditingTask(false)}>Cancel</Button>
                      <Button
                        disabled={!editTitle.trim() || savingEdit}
                        className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                        onClick={saveEdit}
                      >
                        {savingEdit ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : null}
                        Save Changes
                      </Button>
                    </>
                  ) : confirmDelete ? (
                    <>
                      <span className='mr-auto text-sm text-muted-foreground'>Delete this task?</span>
                      <Button variant='outline' size='sm' onClick={() => setConfirmDelete(false)}>Cancel</Button>
                      <Button
                        size='sm'
                        variant='destructive'
                        disabled={deletingTask}
                        onClick={() => deleteTask(selectedTask)}
                      >
                        {deletingTask ? <IconLoader2 className='mr-1 h-3.5 w-3.5 animate-spin' /> : <IconTrash className='mr-1 h-3.5 w-3.5' />}
                        Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='mr-auto text-muted-foreground hover:text-destructive'
                        onClick={() => setConfirmDelete(true)}
                      >
                        <IconTrash className='mr-1 h-3.5 w-3.5' />
                        Delete
                      </Button>

                      <Button variant='outline' size='sm' onClick={() => setEditingTask(true)}>
                        <IconEdit className='mr-1 h-3.5 w-3.5' />
                        Edit
                      </Button>

                      {selectedTask.status === 'open' && (
                        <Button
                          size='sm'
                          className='border border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[#14FFF7] hover:bg-[#14FFF7]/20'
                          onClick={() => {
                            setSelectedTask(null);
                            requestMove(selectedTask, 'todo');
                          }}
                        >
                          → Move to To Do
                        </Button>
                      )}

                      {selectedTask.status === 'todo' && (
                        <Button
                          size='sm'
                          className='border border-[#9A66FF]/30 bg-[#9A66FF]/10 text-[#9A66FF] hover:bg-[#9A66FF]/20'
                          disabled={runningId !== null}
                          onClick={() => {
                            setSelectedTask(null);
                            openRunTaskDialog(selectedTask);
                          }}
                        >
                          <IconPlayerPlay className='mr-1 h-3.5 w-3.5' />
                          Run Task
                        </Button>
                      )}

                      {selectedTask.status === 'blocked' && (
                        <Button
                          size='sm'
                          className='border border-[#14FFF7]/30 bg-[#14FFF7]/10 text-[#14FFF7] hover:bg-[#14FFF7]/20'
                          onClick={() => {
                            setSelectedTask(null);
                            requestMove(selectedTask, 'todo');
                          }}
                        >
                          ↩ Unblock
                        </Button>
                      )}
                    </>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Add Task Dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={addOpen}
        onOpenChange={o => {
          setAddOpen(o);
          if (!o) { setNewTitle(''); setNewDesc(''); setNewPriority(1); setNewAssignee(''); setNewProjectId(''); setNewAttachments([]); setNewTaskRefs([]); setFileSearch(''); setTaskRefSearch(''); }
        }}
      >
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>
              Add a task to the Open backlog. Drag it to To Do when ready to action.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label>Title <span className='text-destructive'>*</span></Label>
              <Input
                placeholder='What needs to be done?'
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); }}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Description</Label>
              <Textarea
                placeholder='Context, acceptance criteria, links…'
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={3}
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1.5'>
                <Label>Priority</Label>
                <select
                  value={newPriority}
                  onChange={e => setNewPriority(Number(e.target.value))}
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
                  value={newAssignee}
                  onChange={e => setNewAssignee(e.target.value)}
                  className='w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                >
                  <option value=''>Unassigned</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {projects.length > 0 && (
              <div className='space-y-1.5'>
                <Label>Project</Label>
                <select
                  value={newProjectId}
                  onChange={e => setNewProjectId(e.target.value)}
                  className='w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                >
                  <option value=''>No project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Attach workspace files */}
            <div className='space-y-1.5'>
              <div className='flex items-center gap-1.5'>
                <IconPaperclip className='h-3.5 w-3.5 text-muted-foreground' />
                <Label>Attach Files <span className='text-[10px] font-normal text-muted-foreground/60'>(optional — agent-generated)</span></Label>
              </div>
              {newAttachments.length > 0 && (
                <div className='flex flex-wrap gap-1 pb-1'>
                  {newAttachments.map(p => (
                    <span key={p} className='flex items-center gap-1 rounded bg-[#9A66FF]/15 px-1.5 py-0.5 font-mono text-[10px] text-[#9A66FF]'>
                      {p.split('/').pop()}
                      <button onClick={() => setNewAttachments(prev => prev.filter(x => x !== p))} className='opacity-60 hover:opacity-100'>
                        <IconX className='h-2.5 w-2.5' />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className='relative'>
                <IconSearch className='absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50' />
                <input
                  placeholder='Search files…'
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                  className='w-full rounded border border-border/40 bg-background/60 py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
                />
              </div>
              <div className='max-h-32 overflow-y-auto rounded border border-border/30 bg-background/40'>
                {loadingWsFiles ? (
                  <div className='flex items-center justify-center py-4'>
                    <IconLoader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground/50' />
                  </div>
                ) : workspaceFiles.filter(f => !fileSearch || f.path.toLowerCase().includes(fileSearch.toLowerCase())).length === 0 ? (
                  <p className='py-3 text-center text-[11px] text-muted-foreground/40'>
                    {workspaceFiles.length === 0 ? 'No workspace files found' : 'No matches'}
                  </p>
                ) : (
                  workspaceFiles
                    .filter(f => !fileSearch || f.path.toLowerCase().includes(fileSearch.toLowerCase()))
                    .map(f => {
                      const selected = newAttachments.includes(f.path);
                      return (
                        <button
                          key={f.path}
                          type='button'
                          onClick={() => setNewAttachments(prev => selected ? prev.filter(x => x !== f.path) : [...prev, f.path])}
                          className={`flex w-full items-center gap-2 border-b border-border/20 px-2.5 py-1.5 text-left text-xs transition-colors last:border-0 ${selected ? 'bg-[#9A66FF]/10 text-[#9A66FF]' : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'}`}
                        >
                          <span className={`h-3.5 w-3.5 flex-shrink-0 rounded border text-center text-[9px] leading-3 ${selected ? 'border-[#9A66FF] bg-[#9A66FF] text-white' : 'border-border/60'}`}>
                            {selected ? '✓' : ''}
                          </span>
                          <span className='flex-1 truncate font-mono'>{f.path}</span>
                          <span className='flex-shrink-0 text-[9px] opacity-40'>{f.ext}</span>
                        </button>
                      );
                    })
                )}
              </div>
            </div>

            {/* Reference previous tasks */}
            <div className='space-y-1.5'>
              <Label>Reference Tasks <span className='text-[10px] font-normal text-muted-foreground/60'>(optional — provide context from past work)</span></Label>
              {newTaskRefs.length > 0 && (
                <div className='flex flex-wrap gap-1 pb-1'>
                  {newTaskRefs.map(refId => {
                    const t = tasks.find(x => x.id === refId);
                    return (
                      <span key={refId} className='flex items-center gap-1 rounded bg-[#14FFF7]/10 px-1.5 py-0.5 text-[10px] text-[#14FFF7]'>
                        {t ? t.title.slice(0, 30) + (t.title.length > 30 ? '…' : '') : refId.slice(0, 8)}
                        <button onClick={() => setNewTaskRefs(prev => prev.filter(x => x !== refId))} className='opacity-60 hover:opacity-100'>
                          <IconX className='h-2.5 w-2.5' />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {(() => {
                const doneTasks = tasks.filter(t => t.status === 'done' && (!taskRefSearch || t.title.toLowerCase().includes(taskRefSearch.toLowerCase())));
                const hasDone = tasks.some(t => t.status === 'done');
                if (!hasDone) return (
                  <p className='rounded border border-border/30 bg-background/40 py-3 text-center text-[11px] text-muted-foreground/40'>No completed tasks yet</p>
                );
                return (
                  <>
                    <div className='relative'>
                      <IconSearch className='absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50' />
                      <input
                        placeholder='Search completed tasks…'
                        value={taskRefSearch}
                        onChange={e => setTaskRefSearch(e.target.value)}
                        className='w-full rounded border border-border/40 bg-background/60 py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-[#14FFF7]'
                      />
                    </div>
                    <div className='max-h-28 overflow-y-auto rounded border border-border/30 bg-background/40'>
                      {doneTasks.length === 0 ? (
                        <p className='py-3 text-center text-[11px] text-muted-foreground/40'>No matches</p>
                      ) : doneTasks.map(t => {
                        const selected = newTaskRefs.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type='button'
                            onClick={() => setNewTaskRefs(prev => selected ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                            className={`flex w-full items-center gap-2 border-b border-border/20 px-2.5 py-1.5 text-left text-xs transition-colors last:border-0 ${selected ? 'bg-[#14FFF7]/10 text-[#14FFF7]' : 'text-muted-foreground hover:bg-muted/20 hover:text-foreground'}`}
                          >
                            <span className={`h-3.5 w-3.5 flex-shrink-0 rounded border text-center text-[9px] leading-3 ${selected ? 'border-[#14FFF7] bg-[#14FFF7] text-[#0A0D11]' : 'border-border/60'}`}>
                              {selected ? '✓' : ''}
                            </span>
                            <span className='flex-1 truncate'>{t.title}</span>
                            {t.done_at && <span className='flex-shrink-0 text-[9px] opacity-40'>{new Date(t.done_at).toLocaleDateString()}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!newTitle.trim() || adding}
              className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
              onClick={handleAddTask}
            >
              {adding ? <IconLoader2 className='mr-1 h-4 w-4 animate-spin' /> : <IconPlus className='mr-1 h-4 w-4' />}
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
