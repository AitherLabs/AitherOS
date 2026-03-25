'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconBrain,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import api, { KnowledgeEntry, Workforce } from '@/lib/api';

const SOURCE_META: Record<
  string,
  { label: string; color: string; icon: string; bg: string }
> = {
  manual:           { label: 'Manual',     color: '#9A66FF', icon: '✍️', bg: '#9A66FF18' },
  agent_message:    { label: 'Agent',      color: '#14FFF7', icon: '🤖', bg: '#14FFF718' },
  execution_result: { label: 'Execution',  color: '#56D090', icon: '⚡', bg: '#56D09018' },
  tool_result:      { label: 'Tool',       color: '#F59E0B', icon: '🔧', bg: '#F59E0B18' }
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function KnowledgePage() {
  const params = useParams();
  const router = useRouter();
  const wfId = params.id as string;

  const [workforce, setWorkforce] = useState<Workforce | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeEntry[] | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addContent, setAddContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [wfRes, entriesRes] = await Promise.all([
        api.getWorkforce(wfId),
        api.listKnowledge(wfId)
      ]);
      if (wfRes.data) setWorkforce(wfRes.data);
      if (entriesRes.data) setEntries(entriesRes.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [wfId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSearch(q: string) {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchKnowledge(wfId, q, 10);
        if (res.data) setSearchResults(res.data);
      } catch { /* ignore */ } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function handleAdd() {
    if (!addContent.trim()) return;
    setAdding(true);
    try {
      const res = await api.createKnowledge(wfId, { title: addTitle, content: addContent });
      if (res.data) {
        setEntries(prev => [res.data!, ...prev]);
        setAddTitle('');
        setAddContent('');
        setAddOpen(false);
      }
    } catch { /* ignore */ } finally {
      setAdding(false);
    }
  }

  async function handleDelete(entryId: string) {
    setDeletingId(entryId);
    try {
      await api.deleteKnowledge(wfId, entryId);
      setEntries(prev => prev.filter(e => e.id !== entryId));
      if (searchResults) setSearchResults(prev => prev?.filter(e => e.id !== entryId) ?? null);
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  }

  const displayed = searchResults
    ? searchResults
    : sourceFilter === 'all'
      ? entries
      : entries.filter(e => e.source_type === sourceFilter);

  const sourceCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.source_type] = (acc[e.source_type] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <IconLoader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col overflow-hidden bg-background'>
      {/* Header */}
      <div className='flex shrink-0 items-center gap-3 border-b border-border/50 px-6 py-4'>
        <Button
          variant='ghost'
          size='icon'
          className='h-8 w-8'
          onClick={() => router.push(`/dashboard/workforces/${wfId}`)}
        >
          <IconArrowLeft className='h-4 w-4' />
        </Button>

        <div className='flex items-center gap-2'>
          <IconBrain className='h-5 w-5 text-[#9A66FF]' />
          <div>
            <h1 className='text-sm font-semibold leading-tight'>Knowledge Base</h1>
            {workforce && (
              <p className='text-xs text-muted-foreground/60'>{workforce.name}</p>
            )}
          </div>
        </div>

        <div className='ml-auto flex items-center gap-2'>
          <span className='rounded-full bg-[#9A66FF]/15 px-2 py-0.5 text-xs font-semibold text-[#9A66FF]'>
            {entries.length} entries
          </span>
          <Button
            size='sm'
            className='bg-[#9A66FF] text-white hover:bg-[#9A66FF]/90'
            onClick={() => setAddOpen(v => !v)}
          >
            <IconPlus className='mr-1 h-3.5 w-3.5' />
            Add Entry
          </Button>
        </div>
      </div>

      {/* Add Entry Form */}
      {addOpen && (
        <div className='shrink-0 border-b border-border/50 bg-muted/5 px-6 py-4'>
          <div className='mx-auto max-w-2xl space-y-3'>
            <div className='flex items-center justify-between'>
              <p className='text-sm font-semibold'>New Knowledge Entry</p>
              <button onClick={() => setAddOpen(false)} className='text-muted-foreground/50 hover:text-muted-foreground'>
                <IconX className='h-4 w-4' />
              </button>
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Title (optional)</Label>
              <Input
                value={addTitle}
                onChange={e => setAddTitle(e.target.value)}
                placeholder='e.g. API Authentication Guide'
                className='h-8 text-sm'
              />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Content <span className='text-red-400'>*</span></Label>
              <Textarea
                value={addContent}
                onChange={e => setAddContent(e.target.value)}
                placeholder='Paste any text, notes, documentation, code snippets, or context for this workforce…'
                rows={5}
                className='text-sm'
              />
            </div>
            <div className='flex items-center justify-end gap-2'>
              <Button variant='outline' size='sm' onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                size='sm'
                className='bg-[#9A66FF] text-white hover:bg-[#9A66FF]/90'
                onClick={handleAdd}
                disabled={adding || !addContent.trim()}
              >
                {adding ? <IconLoader2 className='mr-1 h-3.5 w-3.5 animate-spin' /> : <IconPlus className='mr-1 h-3.5 w-3.5' />}
                {adding ? 'Saving…' : 'Save Entry'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filter bar */}
      <div className='shrink-0 border-b border-border/40 bg-background px-6 py-3'>
        <div className='mx-auto flex max-w-5xl items-center gap-3'>
          <div className='relative flex-1 max-w-sm'>
            {searching
              ? <IconLoader2 className='absolute left-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground/50' />
              : <IconSearch className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/50' />
            }
            <Input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder='Semantic search…'
              className='h-9 pl-8 text-sm'
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                className='absolute right-2.5 top-2.5 text-muted-foreground/40 hover:text-muted-foreground'
              >
                <IconX className='h-4 w-4' />
              </button>
            )}
          </div>

          {/* Source type filters */}
          <div className='flex items-center gap-1.5 flex-wrap'>
            <button
              onClick={() => setSourceFilter('all')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                sourceFilter === 'all'
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              All ({entries.length})
            </button>
            {Object.entries(SOURCE_META).map(([key, meta]) => {
              const count = sourceCounts[key] || 0;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => setSourceFilter(sourceFilter === key ? 'all' : key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    sourceFilter === key
                      ? 'text-foreground'
                      : 'text-muted-foreground/60 hover:text-muted-foreground'
                  }`}
                  style={sourceFilter === key ? { backgroundColor: meta.bg, color: meta.color } : {}}
                >
                  {meta.icon} {meta.label} ({count})
                </button>
              );
            })}
          </div>

          {searchResults && (
            <span className='shrink-0 text-[11px] text-muted-foreground/50'>
              {searchResults.length} semantic result{searchResults.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Entries list */}
      <div className='flex-1 overflow-y-auto px-6 py-4'>
        <div className='mx-auto max-w-5xl space-y-2'>
          {displayed.length === 0 && (
            <div className='flex flex-col items-center justify-center py-20 text-center'>
              <IconBrain className='mb-3 h-10 w-10 text-muted-foreground/20' />
              <p className='text-sm font-medium text-muted-foreground/50'>
                {searchQuery ? 'No matching entries found' : 'No knowledge entries yet'}
              </p>
              <p className='mt-1 text-xs text-muted-foreground/30'>
                {searchQuery
                  ? 'Try a different search term'
                  : 'Entries are created automatically from executions and agent chats, or you can add them manually.'}
              </p>
            </div>
          )}

          {displayed.map(entry => {
            const meta = SOURCE_META[entry.source_type] || SOURCE_META.manual;
            const isExpanded = expandedId === entry.id;
            const isDeleting = deletingId === entry.id;

            return (
              <div
                key={entry.id}
                className='group rounded-xl border border-border/40 bg-card/50 hover:border-border/70 transition-colors overflow-hidden'
              >
                <div className='flex items-start gap-3 p-4'>
                  {/* Source icon */}
                  <div
                    className='mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-base'
                    style={{ backgroundColor: meta.bg }}
                  >
                    {meta.icon}
                  </div>

                  {/* Content */}
                  <div className='min-w-0 flex-1 cursor-pointer' onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                    <div className='flex items-start gap-2 mb-1'>
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm font-semibold leading-snug truncate'>
                          {entry.title || 'Untitled Entry'}
                        </p>
                        <div className='flex items-center gap-2 mt-0.5'>
                          <span
                            className='text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full'
                            style={{ backgroundColor: meta.bg, color: meta.color }}
                          >
                            {meta.label}
                          </span>
                          {entry.metadata?.agent_name && (
                            <span className='text-[10px] text-muted-foreground/50'>
                              by {entry.metadata.agent_name}
                            </span>
                          )}
                          {entry.similarity !== undefined && (
                            <span className='text-[10px] text-[#56D090] font-medium'>
                              {Math.round(entry.similarity * 100)}% match
                            </span>
                          )}
                          <span className='text-[10px] text-muted-foreground/30 ml-auto'>
                            {timeAgo(entry.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className={`text-xs text-muted-foreground/70 leading-relaxed break-words whitespace-pre-wrap ${isExpanded ? '' : 'line-clamp-3'}`}>
                      {entry.content}
                    </p>

                    {!isExpanded && entry.content.length > 300 && (
                      <button className='mt-1 text-[11px] text-[#9A66FF] hover:underline'>
                        Show more
                      </button>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(entry.id)}
                    disabled={isDeleting}
                    className='shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-red-400'
                  >
                    {isDeleting
                      ? <IconLoader2 className='h-4 w-4 animate-spin' />
                      : <IconTrash className='h-4 w-4' />
                    }
                  </button>
                </div>

                {/* Metadata row */}
                {isExpanded && entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div className='flex flex-wrap gap-x-4 gap-y-1 border-t border-border/30 bg-muted/5 px-4 py-2'>
                    {Object.entries(entry.metadata).map(([k, v]) => (
                      <span key={k} className='text-[10px] text-muted-foreground/40'>
                        <span className='font-medium text-muted-foreground/60'>{k}:</span>{' '}
                        {String(v).slice(0, 80)}
                      </span>
                    ))}
                    {entry.execution_id && (
                      <button
                        className='text-[10px] text-[#9A66FF] hover:underline'
                        onClick={() => router.push(`/dashboard/executions/${entry.execution_id}`)}
                      >
                        → View execution
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
