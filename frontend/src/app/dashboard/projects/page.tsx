'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  IconArchive, IconCheck, IconCircleDashed, IconLoader2,
  IconPause, IconPlus, IconTrash
} from '@tabler/icons-react';
import api, { Project, ProjectStatus, Workforce } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

const STATUS_CFG: Record<ProjectStatus, { label: string; color: string; icon: React.ReactNode }> = {
  active:    { label: 'Active',     color: '#56D090', icon: <IconCircleDashed className='h-3 w-3' /> },
  paused:    { label: 'Paused',     color: '#FFBF47', icon: <IconPause className='h-3 w-3' /> },
  completed: { label: 'Completed',  color: '#14FFF7', icon: <IconCheck className='h-3 w-3' /> },
  archived:  { label: 'Archived',   color: '#6B7280', icon: <IconArchive className='h-3 w-3' /> },
};

const ICON_OPTIONS = ['📁', '🎨', '⚡', '🚀', '💡', '🔧', '🌐', '📊', '🤖', '🎯', '🏗️', '📝'];
const COLOR_OPTIONS = ['#9A66FF', '#56D090', '#14FFF7', '#FFBF47', '#EF4444', '#3B82F6', '#EC4899', '#F97316'];

interface ProjectWithWorkforce extends Project {
  workforce_name?: string;
}

export default function ProjectsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithWorkforce[]>([]);
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newIcon, setNewIcon] = useState('📁');
  const [newColor, setNewColor] = useState('#9A66FF');
  const [newWfId, setNewWfId] = useState('');
  const [newBriefInterval, setNewBriefInterval] = useState(0);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const wfRes = await api.listWorkforces();
      const wfList = wfRes.data || [];
      setWorkforces(wfList);
      if (wfList.length > 0 && !newWfId) setNewWfId(wfList[0].id);

      const allProjects: ProjectWithWorkforce[] = [];
      await Promise.all(wfList.map(async (wf) => {
        const res = await api.listProjects(wf.id);
        (res.data || []).forEach(p => allProjects.push({ ...p, workforce_name: wf.name }));
      }));
      allProjects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setProjects(allProjects);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newName.trim() || !newWfId) return;
    setCreating(true);
    try {
      const res = await api.createProject(newWfId, {
        name: newName.trim(),
        description: newDesc.trim(),
        icon: newIcon,
        color: newColor,
        brief_interval_m: newBriefInterval,
      });
      if (res.data) {
        const wf = workforces.find(w => w.id === newWfId);
        setProjects(prev => [{ ...res.data!, workforce_name: wf?.name }, ...prev]);
      }
      setCreateOpen(false);
      setNewName(''); setNewDesc(''); setNewIcon('📁'); setNewColor('#9A66FF'); setNewBriefInterval(0);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(p: ProjectWithWorkforce) {
    if (!confirm(`Delete project "${p.name}"? Tasks and executions will be unlinked.`)) return;
    await api.deleteProject(p.id);
    setProjects(prev => prev.filter(x => x.id !== p.id));
  }

  const grouped = workforces.map(wf => ({
    wf,
    projects: projects.filter(p => p.workforce_id === wf.id),
  })).filter(g => g.projects.length > 0);

  return (
    <div className='flex flex-col h-[calc(100vh-64px)]'>
      {/* Header */}
      <div className='flex items-center justify-between border-b border-border/50 px-6 py-4'>
        <div>
          <h2 className='text-lg font-semibold tracking-tight'>Projects</h2>
          <p className='text-xs text-muted-foreground mt-0.5'>
            {projects.length} project{projects.length !== 1 ? 's' : ''} across {grouped.length} workforce{grouped.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <IconPlus className='h-3.5 w-3.5 mr-1.5' />
          New Project
        </Button>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto px-6 py-4'>
        {loading ? (
          <div className='flex h-40 items-center justify-center'>
            <IconLoader2 className='h-5 w-5 animate-spin text-muted-foreground' />
          </div>
        ) : projects.length === 0 ? (
          <div className='flex h-40 items-center justify-center rounded-xl border border-dashed border-border/50'>
            <p className='text-sm text-muted-foreground'>No projects yet. Create one to start grouping tasks and executions.</p>
          </div>
        ) : (
          <div className='space-y-8'>
            {grouped.map(({ wf, projects: wfProjects }) => (
              <div key={wf.id}>
                <h3 className='mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground/50'>
                  {wf.icon || '⚡'} {wf.name}
                </h3>
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                  {wfProjects.map(p => {
                    const scfg = STATUS_CFG[p.status] || STATUS_CFG.active;
                    return (
                      <div
                        key={p.id}
                        className='group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border/40 bg-background/60 p-4 transition-all hover:border-border/80 hover:bg-background/80'
                        style={{ borderLeftColor: p.color + '60', borderLeftWidth: 3 }}
                        onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='flex items-center gap-2.5 min-w-0'>
                            <span className='text-xl shrink-0'>{p.icon}</span>
                            <div className='min-w-0'>
                              <p className='font-semibold text-sm text-foreground/90 truncate'>{p.name}</p>
                              {p.description && (
                                <p className='text-[11px] text-muted-foreground/60 line-clamp-1 mt-0.5'>{p.description}</p>
                              )}
                            </div>
                          </div>
                          <button
                            className='opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5'
                            onClick={e => { e.stopPropagation(); handleDelete(p); }}
                          >
                            <IconTrash className='h-3.5 w-3.5' />
                          </button>
                        </div>

                        <div className='flex items-center gap-1.5'>
                          <div
                            className='flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold'
                            style={{ backgroundColor: scfg.color + '18', color: scfg.color, border: `1px solid ${scfg.color}30` }}
                          >
                            {scfg.icon}
                            {scfg.label}
                          </div>
                          <span className='text-[10px] text-muted-foreground/40 ml-auto'>
                            {new Date(p.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label>Workforce</Label>
              <Select value={newWfId} onValueChange={setNewWfId}>
                <SelectTrigger>
                  <SelectValue placeholder='Select workforce' />
                </SelectTrigger>
                <SelectContent>
                  {workforces.map(wf => (
                    <SelectItem key={wf.id} value={wf.id}>{wf.icon || '⚡'} {wf.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex gap-3'>
              <div className='space-y-1.5'>
                <Label>Icon</Label>
                <div className='flex flex-wrap gap-1.5 w-40'>
                  {ICON_OPTIONS.map(ic => (
                    <button
                      key={ic}
                      onClick={() => setNewIcon(ic)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-all ${newIcon === ic ? 'bg-[#9A66FF]/20 ring-1 ring-[#9A66FF]' : 'hover:bg-accent'}`}
                    >{ic}</button>
                  ))}
                </div>
              </div>
              <div className='space-y-1.5 flex-1'>
                <Label>Color</Label>
                <div className='flex flex-wrap gap-1.5'>
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={`h-6 w-6 rounded-full transition-all ${newColor === c ? 'ring-2 ring-offset-2 ring-offset-background' : ''}`}
                      style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px ${c}` : undefined }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className='space-y-1.5'>
              <Label>Name <span className='text-destructive'>*</span></Label>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder='e.g. Virtual Office Assets'
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Description</Label>
              <Textarea
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder='What is this project about?'
                rows={2}
                className='resize-none'
              />
            </div>
            <div className='space-y-1.5'>
              <Label>Brief auto-refresh</Label>
              <select
                value={newBriefInterval}
                onChange={e => setNewBriefInterval(Number(e.target.value))}
                className='w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#9A66FF]'
              >
                <option value={0}>Manual only</option>
                <option value={30}>Every 30 min</option>
                <option value={60}>Every hour</option>
                <option value={120}>Every 2 hours</option>
                <option value={240}>Every 4 hours</option>
                <option value={480}>Every 8 hours</option>
              </select>
              <p className='text-[11px] text-muted-foreground/50'>How often the AI refreshes the project brief after executions complete.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <IconLoader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
