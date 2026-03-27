import { WORKFORCE_ID, API_URL, apiHeaders } from '../config.js';

function requireWorkforce() {
  if (!WORKFORCE_ID) throw new Error('AITHER_WORKFORCE_ID is not set — kanban tools unavailable');
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'kanban_list',
    description:
      'List the workforce Kanban board tasks, optionally filtered by status. ' +
      'Use this to see what work is planned, in progress, or blocked before ' +
      'deciding what to tackle or what tasks to create.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'todo', 'in_progress', 'blocked', 'done'],
          description: 'Filter by status (omit for all tasks)',
        },
      },
      required: [],
    },
  },
  {
    name: 'kanban_create',
    description:
      'Create a new task on the workforce Kanban board. Use this to track ' +
      'planned work items, sub-goals, or follow-up actions that should be ' +
      'visible to the team and the human operator.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title:       { type: 'string', description: 'Short task title (required)' },
        description: { type: 'string', description: 'Detailed description of the task' },
        priority:    { type: 'number', description: '0=low, 1=normal, 2=high, 3=urgent (default: 1)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'kanban_update',
    description:
      'Update a Kanban task — move it to a new status, change title/description, ' +
      'or add notes. Use this to reflect real progress: move tasks to in_progress ' +
      'when starting them, blocked when stuck, or done when complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id:     { type: 'string', description: 'Task UUID to update' },
        status:      {
          type: 'string',
          enum: ['open', 'todo', 'in_progress', 'blocked', 'done'],
          description: 'New status',
        },
        title:       { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        notes:       { type: 'string', description: 'Progress notes or blocker explanation' },
        priority:    { type: 'number', description: '0=low, 1=normal, 2=high, 3=urgent' },
      },
      required: ['task_id'],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<string>> = {

  async kanban_list(args) {
    requireWorkforce();
    const url = `${API_URL}/api/v1/workforces/${WORKFORCE_ID}/kanban`;
    const res = await fetch(url, { headers: apiHeaders() });
    if (!res.ok) throw new Error(`Kanban API returned ${res.status}`);

    const tasks = await res.json() as Array<{
      id: string; title: string; status: string;
      description?: string; priority?: number; notes?: string;
    }>;

    if (!tasks || tasks.length === 0) return 'Kanban board is empty.';

    const filtered = args.status
      ? tasks.filter(t => t.status === args.status)
      : tasks;

    if (filtered.length === 0) return `No tasks with status "${args.status}".`;

    const priorityLabel = (p?: number) => ['low', 'normal', 'high', 'urgent'][p ?? 1] ?? 'normal';
    const statusGroups: Record<string, typeof tasks> = {};
    for (const t of filtered) {
      (statusGroups[t.status] ??= []).push(t);
    }

    const order = ['in_progress', 'todo', 'open', 'blocked', 'done'];
    const lines: string[] = [];
    for (const status of order) {
      const group = statusGroups[status];
      if (!group?.length) continue;
      lines.push(`\n## ${status.replace('_', ' ').toUpperCase()} (${group.length})`);
      for (const t of group) {
        lines.push(`- [${t.id.slice(0, 8)}] **${t.title}** [${priorityLabel(t.priority)}]`);
        if (t.description) lines.push(`  ${t.description.slice(0, 120)}`);
        if (t.notes) lines.push(`  _Notes: ${t.notes.slice(0, 80)}_`);
      }
    }
    return lines.join('\n');
  },

  async kanban_create(args) {
    requireWorkforce();
    const title = (args.title as string)?.trim();
    if (!title) throw new Error('title is required');

    const body: Record<string, unknown> = {
      title,
      created_by: 'agent',
      priority: args.priority ?? 1,
    };
    if (args.description) body.description = args.description;

    const url = `${API_URL}/api/v1/workforces/${WORKFORCE_ID}/kanban`;
    const res = await fetch(url, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Kanban create returned ${res.status}: ${err}`);
    }

    const task = await res.json() as { id: string; title: string; status: string };
    return `Created task [${task.id.slice(0, 8)}] "${task.title}" — status: ${task.status}`;
  },

  async kanban_update(args) {
    requireWorkforce();
    const taskId = (args.task_id as string)?.trim();
    if (!taskId) throw new Error('task_id is required');

    const body: Record<string, unknown> = {};
    if (args.status      != null) body.status      = args.status;
    if (args.title       != null) body.title        = args.title;
    if (args.description != null) body.description  = args.description;
    if (args.notes       != null) body.notes        = args.notes;
    if (args.priority    != null) body.priority     = args.priority;

    if (Object.keys(body).length === 0) throw new Error('No fields to update provided');

    const url = `${API_URL}/api/v1/kanban/${taskId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Kanban update returned ${res.status}: ${err}`);
    }

    const task = await res.json() as { id: string; title: string; status: string };
    return `Updated task [${task.id.slice(0, 8)}] "${task.title}" — status: ${task.status}`;
  },
};
