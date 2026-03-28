'use client';

import { useCallback, useEffect, useState } from 'react';
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
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconX,
} from '@tabler/icons-react';
import api, { Agent, KanbanStatus, KanbanTask, Workforce } from '@/lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const COLUMNS: { status: KanbanStatus; label: string; color: string }[] = [
  { status: 'open',        label: 'Open',        color: '#6B7280' },
  { status: 'todo',        label: 'To Do',       color: '#14FFF7' },
  { status: 'in_progress', label: 'In Progress', color: '#9A66FF' },
  { status: 'blocked',     label: 'Blocked',     color: '#FFBF47' },
  { status: 'done',        label: 'Done',        color: '#56D090' },
];

const PRIORITY_LABEL = ['Low', 'Normal', 'High', 'Urgent'];
const PRIORITY_COLOR = ['#6B7280', '#14FFF7', '#FFBF47', '#EF4444'];

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

  // Add task dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState(1);
  const [newAssignee, setNewAssignee] = useState('');
  const [adding, setAdding] = useState(false);

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
    await api.deleteKanbanTask(task.id);
    setTasks(prev => prev.filter(t => t.id !== task.id));
  }

  async function runTask(task: KanbanTask) {
    setRunningId(task.id);
    try {
      const objective = task.description
        ? `${task.title}\n\n${task.description}`
        : task.title;
      const execRes = await api.startExecution(workforceId, objective);
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
    if (next) await runTask(next);
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
      });
      if (res.data) setTasks(prev => [...prev, res.data!]);
      setAddOpen(false);
      setNewTitle(''); setNewDesc(''); setNewPriority(1); setNewAssignee('');
    } finally {
      setAdding(false);
    }
  }

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, taskId: string) {
    setDraggingId(taskId);
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd() {
    setDraggingId(null);
    setDragOverCol(null);
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
                      className={`group relative select-none rounded-lg border border-border/30 bg-card/80 p-3 transition-all ${
                        isDragging
                          ? 'cursor-grabbing opacity-40 scale-95'
                          : 'cursor-grab hover:border-border/60 hover:shadow-sm'
                      } ${isMoving || isRunning ? 'opacity-50' : ''}`}
                      style={{ borderLeft: `3px solid ${PRIORITY_COLOR[task.priority] ?? '#6B7280'}` }}
                    >
                      {/* Delete */}
                      <button
                        onClick={() => deleteTask(task)}
                        className='absolute right-2 top-2 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block'
                      >
                        <IconX className='h-3 w-3' />
                      </button>

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
                            background: `${PRIORITY_COLOR[task.priority]}20`,
                            color: PRIORITY_COLOR[task.priority],
                          }}
                        >
                          {PRIORITY_LABEL[task.priority]}
                        </span>

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
                              onClick={() => runTask(task)}
                              disabled={runningId !== null}
                              className='flex items-center gap-0.5 rounded bg-[#9A66FF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#9A66FF] hover:bg-[#9A66FF]/25 disabled:opacity-40'
                            >
                              <IconPlayerPlay className='h-2.5 w-2.5' />
                              Run
                            </button>
                          )}
                          {task.status === 'in_progress' && (
                            <button
                              onClick={() => requestMove(task, 'blocked')}
                              className='rounded px-1.5 py-0.5 text-[10px] font-medium text-[#FFBF47] hover:bg-[#FFBF47]/10'
                            >
                              ⚠ Blocked
                            </button>
                          )}
                          {task.status === 'blocked' && (
                            <button
                              onClick={() => requestMove(task, 'todo')}
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

      {/* ── Add Task Dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={addOpen}
        onOpenChange={o => {
          setAddOpen(o);
          if (!o) { setNewTitle(''); setNewDesc(''); setNewPriority(1); setNewAssignee(''); }
        }}
      >
        <DialogContent className='max-w-md'>
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
