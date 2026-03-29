'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconSearch,
  IconSparkles,
  IconShieldCheck,
  IconUsers,
  IconTag,
  IconBook2,
  IconCode,
  IconChartBar,
  IconBulb,
  IconLock,
  IconWriting,
  IconRocket
} from '@tabler/icons-react';
import api, { Skill } from '@/lib/api';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  content: IconWriting,
  security: IconLock,
  engineering: IconCode,
  documentation: IconBook2,
  analytics: IconChartBar,
  growth: IconRocket,
};

const SOURCE_COLOR = {
  official: { bg: '#9A66FF22', border: '#9A66FF44', text: '#9A66FF', label: 'Official' },
  community: { bg: '#14FFF722', border: '#14FFF744', text: '#14FFF7', label: 'Community' }
};

function SkillCard({ skill }: { skill: Skill }) {
  const [expanded, setExpanded] = useState(false);
  const src = SOURCE_COLOR[skill.source] ?? SOURCE_COLOR.community;
  const CatIcon = CATEGORY_ICONS[skill.category?.toLowerCase()] ?? IconBulb;

  return (
    <div className='flex flex-col rounded-xl border border-border/40 bg-card/50 overflow-hidden transition-all hover:border-border/70'>
      <div className='flex items-start gap-3 p-4'>
        <div
          className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl'
          style={{ background: src.bg, border: `1px solid ${src.border}` }}
        >
          {skill.icon || '✨'}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h3 className='font-semibold text-sm'>{skill.name}</h3>
            <span
              className='flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider'
              style={{ background: src.bg, border: `1px solid ${src.border}`, color: src.text }}
            >
              {skill.source === 'official' ? <IconShieldCheck className='h-2.5 w-2.5' /> : <IconUsers className='h-2.5 w-2.5' />}
              {src.label}
            </span>
          </div>
          <div className='mt-0.5 flex items-center gap-2'>
            <CatIcon className='h-3 w-3 text-muted-foreground/50' />
            <span className='text-[11px] text-muted-foreground/60 capitalize'>{skill.category}</span>
            {skill.version && (
              <span className='font-mono text-[9px] text-muted-foreground/40'>v{skill.version}</span>
            )}
          </div>
          <p className='mt-1.5 text-xs text-muted-foreground/70 line-clamp-2'>{skill.description}</p>
        </div>
      </div>

      {skill.tags?.length > 0 && (
        <div className='flex flex-wrap gap-1 px-4 pb-3'>
          {skill.tags.map((tag) => (
            <span key={tag} className='flex items-center gap-1 rounded-md border border-border/30 bg-muted/30 px-2 py-0.5 font-mono text-[9px] text-muted-foreground/60'>
              <IconTag className='h-2.5 w-2.5' />{tag}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className='flex items-center gap-2 border-t border-border/30 px-4 py-2 text-left text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/50 hover:bg-accent/20 transition-colors'
      >
        <IconBook2 className='h-3 w-3' />
        {expanded ? 'Hide Content' : 'View Content'}
        <span className='ml-auto font-mono text-[9px]'>{skill.content.length} chars</span>
      </button>

      {expanded && (
        <div className='border-t border-border/20 bg-background/40 p-4'>
          <pre className='whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground/80 max-h-48 overflow-y-auto'>
            {skill.content}
          </pre>
          {skill.author && (
            <p className='mt-2 font-mono text-[9px] text-muted-foreground/40'>
              By {skill.author}
              {skill.repo_url && (
                <> · <a href={skill.repo_url} target='_blank' rel='noopener noreferrer' className='underline underline-offset-2 hover:text-muted-foreground/70'>{skill.repo_url}</a></>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SkillsPage() {
  const { data: session } = useSession();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'official' | 'community'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    if (!session?.accessToken) return;
    api.setToken(session.accessToken);
    api.listSkills()
      .then((res) => setSkills(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  const categories = ['all', ...Array.from(new Set(skills.map((s) => s.category).filter(Boolean)))];

  const filtered = skills.filter((s) => {
    if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || (s.tags || []).some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  const officialCount = skills.filter((s) => s.source === 'official').length;
  const communityCount = skills.filter((s) => s.source === 'community').length;

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Header */}
      <div className='shrink-0 border-b border-border/50 px-6 py-4'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-[#9A66FF]/15'>
              <IconSparkles className='h-5 w-5 text-[#9A66FF]' />
            </div>
            <div>
              <h1 className='text-base font-bold'>Skill Library</h1>
              <p className='text-xs text-muted-foreground/60'>Procedural knowledge packs — assign to agents to teach them how to do specific tasks</p>
            </div>
          </div>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2 rounded-lg border border-border/40 bg-card/50 px-3 py-1.5'>
              <span className='font-mono text-[10px] text-muted-foreground/50'>TOTAL</span>
              <span className='font-mono text-sm font-black text-foreground'>{skills.length}</span>
            </div>
            <div className='flex items-center gap-2 rounded-lg border border-[#9A66FF]/30 bg-[#9A66FF]/10 px-3 py-1.5'>
              <IconShieldCheck className='h-3.5 w-3.5 text-[#9A66FF]' />
              <span className='font-mono text-sm font-black text-[#9A66FF]'>{officialCount}</span>
              <span className='font-mono text-[10px] text-[#9A66FF]/70'>official</span>
            </div>
            <div className='flex items-center gap-2 rounded-lg border border-[#14FFF7]/30 bg-[#14FFF7]/10 px-3 py-1.5'>
              <IconUsers className='h-3.5 w-3.5 text-[#14FFF7]' />
              <span className='font-mono text-sm font-black text-[#14FFF7]'>{communityCount}</span>
              <span className='font-mono text-[10px] text-[#14FFF7]/70'>community</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className='mt-3 flex items-center gap-3'>
          <div className='relative flex-1 max-w-xs'>
            <IconSearch className='absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50' />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search skills...'
              className='h-8 pl-9 text-xs'
            />
          </div>
          <div className='flex gap-1'>
            {(['all', 'official', 'community'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  sourceFilter === f
                    ? 'bg-[#9A66FF]/20 text-[#9A66FF] border border-[#9A66FF]/30'
                    : 'border border-transparent text-muted-foreground/50 hover:text-muted-foreground'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {categories.length > 2 && (
            <div className='flex gap-1 flex-wrap'>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`rounded-lg px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors capitalize ${
                    categoryFilter === c
                      ? 'bg-[#FFBF47]/20 text-[#FFBF47] border border-[#FFBF47]/30'
                      : 'border border-transparent text-muted-foreground/40 hover:text-muted-foreground/70'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className='flex-1'>
        <div className='p-6'>
          {loading ? (
            <div className='flex h-40 items-center justify-center'>
              <div className='h-6 w-6 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex flex-col items-center gap-3 py-20 text-center'>
              <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9A66FF]/10'>
                <IconSparkles className='h-6 w-6 text-[#9A66FF]/50' />
              </div>
              <p className='text-sm font-medium'>No skills found</p>
              <p className='text-xs text-muted-foreground/50'>Try adjusting your filters or search terms.</p>
            </div>
          ) : (
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {filtered.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
