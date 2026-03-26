'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconPlus,
  IconArrowRight,
  IconArrowLeft,
  IconLoader2,
  IconBrain,
  IconBolt,
  IconTool,
  IconStar,
  IconFlame
} from '@tabler/icons-react';
import api, { Agent, Provider } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';
import { IconPicker } from '@/components/icon-picker';
import { getAgentTier, getAgentStats } from '@/lib/agent-tier';

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='w-8 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70'>
        {label}
      </span>
      <div className='relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40'>
        <div
          className='h-full rounded-full transition-all duration-700'
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, ${color}99, ${color})`,
            boxShadow: `0 0 6px ${color}80`
          }}
        />
      </div>
      <span className='w-5 font-mono text-[9px] text-muted-foreground/60'>{value}</span>
    </div>
  );
}

const strategyColors: Record<string, string> = {
  react: 'bg-[#9A66FF]/20 text-[#9A66FF] border-[#9A66FF]/30',
  simple: 'bg-[#56D090]/20 text-[#56D090] border-[#56D090]/30',
  function_call: 'bg-[#14FFF7]/20 text-[#14FFF7] border-[#14FFF7]/30'
};

const strategies = [
  {
    value: 'simple',
    label: 'Simple',
    desc: 'Single prompt, direct response. Best for straightforward tasks like summarization or Q&A.',
    icon: IconBrain,
    color: '#56D090'
  },
  {
    value: 'react',
    label: 'ReAct',
    desc: 'Thought \u2192 Action \u2192 Observation loop. Best for complex reasoning and multi-step tasks.',
    icon: IconBolt,
    color: '#9A66FF'
  },
  {
    value: 'function_call',
    label: 'Function Call',
    desc: 'OpenAI-style tool use. Best for agents that need to call external APIs and tools.',
    icon: IconTool,
    color: '#14FFF7'
  }
];

export default function AgentsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formIcon, setFormIcon] = useState('🤖');
  const [formColor, setFormColor] = useState('#9A66FF');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStrategy, setFormStrategy] = useState('simple');
  const [formModel, setFormModel] = useState('gpt-4o');
  const [formProviderId, setFormProviderId] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formMaxIter, setFormMaxIter] = useState(10);

  const loadAgents = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [res, pvRes] = await Promise.all([
        api.listAgents(),
        api.listProviders()
      ]);
      setAgents(res.data || []);
      setProviders(pvRes.data || []);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  function openCreate() {
    setCreateStep(0);
    setFormIcon('🤖');
    setFormColor('#9A66FF');
    setFormName('');
    setFormDescription('');
    setFormStrategy('simple');
    setFormModel('gpt-4o');
    setFormProviderId('');
    setFormSystemPrompt('');
    setFormMaxIter(10);
    setCreateOpen(true);
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await api.createAgent({
        name: formName,
        description: formDescription,
        icon: formIcon,
        color: formColor,
        strategy: formStrategy,
        model: formModel,
        provider_id: formProviderId || undefined,
        system_prompt: formSystemPrompt,
        max_iterations: formMaxIter
      });
      setCreateOpen(false);
      if (res.data?.id) {
        router.push(`/dashboard/agents/${res.data.id}`);
      } else {
        await loadAgents();
      }
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className='space-y-6 p-6'>
        <div className='flex items-center justify-between'>
          <div className='space-y-2'>
            <div className='h-7 w-24 animate-pulse rounded-lg bg-muted/50' />
            <div className='h-4 w-64 animate-pulse rounded-md bg-muted/30' />
          </div>
          <div className='h-9 w-28 animate-pulse rounded-lg bg-muted/40' />
        </div>
        <div className='h-px bg-border/50' />
        <div className='grid gap-5 md:grid-cols-2 lg:grid-cols-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className='rounded-xl border border-border/30 bg-background/60 p-4 space-y-4'>
              <div className='flex items-start justify-between'>
                <div className='flex items-center gap-3'>
                  <div className='h-10 w-10 animate-pulse rounded-lg bg-muted/50' />
                  <div className='space-y-1.5'>
                    <div className='h-4 w-28 animate-pulse rounded bg-muted/50' />
                    <div className='h-3 w-20 animate-pulse rounded bg-muted/30' />
                  </div>
                </div>
                <div className='h-5 w-12 animate-pulse rounded bg-muted/40' />
              </div>
              <div className='flex gap-1'>
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className='h-1 flex-1 animate-pulse rounded-full bg-muted/40' />
                ))}
              </div>
              <div className='space-y-1.5'>
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className='flex items-center gap-2'>
                    <div className='h-2 w-6 animate-pulse rounded bg-muted/40' />
                    <div className='h-1.5 flex-1 animate-pulse rounded-full bg-muted/30' />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6 p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Agents</h2>
          <p className='text-muted-foreground'>
            AI agents configured in your workspace. Click to configure & debug.
          </p>
        </div>
        <Button onClick={openCreate} className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'>
          <IconPlus className='mr-2 h-4 w-4' />
          New Agent
        </Button>
      </div>
      <Separator />

      {agents.length === 0 ? (
        <div
          className='flex h-60 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/50 transition-colors hover:border-[#9A66FF]/40'
          onClick={openCreate}
        >
          <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-[#9A66FF]/10'>
            <IconPlus className='h-6 w-6 text-[#9A66FF]' />
          </div>
          <div className='text-center'>
            <p className='font-medium'>Create your first agent</p>
            <p className='text-sm text-muted-foreground'>
              Configure an AI agent with a role, personality, and strategy.
            </p>
          </div>
        </div>
      ) : (
        <div className='grid gap-5 md:grid-cols-2 lg:grid-cols-3'>
          {agents.map((agent) => {
            const tier = getAgentTier(agent);
            const stats = getAgentStats(agent);
            const accentColor = agent.color || '#9A66FF';

            return (
              <div
                key={agent.id}
                className='group relative cursor-pointer overflow-hidden rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--ac)]/50 hover:shadow-xl'
                style={{
                  '--ac': accentColor,
                  boxShadow: `0 0 0 0 ${accentColor}00`
                } as React.CSSProperties}
                onClick={() => router.push(`/dashboard/agents/${agent.id}`)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${accentColor}25, 0 0 0 1px ${accentColor}20`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 0 transparent';
                }}
              >
                {/* Colored top accent bar */}
                <div
                  className='h-0.5 w-full'
                  style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
                />

                {/* Subtle background glow */}
                <div
                  className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100'
                  style={{
                    background: `radial-gradient(ellipse at 50% 0%, ${accentColor}08 0%, transparent 70%)`
                  }}
                />

                <div className='p-4'>
                  {/* Header: avatar + name + tier */}
                  <div className='mb-4 flex items-start justify-between'>
                    <div className='flex items-center gap-3'>
                      {/* Avatar with pulsing ring on hover */}
                      <div className='relative'>
                        <div
                          className='absolute -inset-1 rounded-full opacity-0 blur-sm transition-all duration-300 group-hover:opacity-100'
                          style={{ background: `${accentColor}50` }}
                        />
                        <EntityAvatar icon={agent.icon} color={accentColor} avatarUrl={agent.avatar_url} name={agent.name} size='md' />
                      </div>
                      <div>
                        <h3 className='font-semibold leading-tight text-foreground'>{agent.name}</h3>
                        <p className='mt-0.5 font-mono text-[10px] text-muted-foreground/70'>{agent.model}</p>
                      </div>
                    </div>

                    {/* Tier + Strategy badges */}
                    <div className='flex flex-col items-end gap-1'>
                      <span
                        className='rounded px-1.5 py-0.5 font-mono text-[9px] font-black tracking-widest'
                        style={{ backgroundColor: tier.color + '20', color: tier.color, border: `1px solid ${tier.color}40` }}
                      >
                        {tier.label}
                      </span>
                      <Badge variant='outline' className={`text-[10px] ${strategyColors[agent.strategy] || 'bg-muted text-muted-foreground'}`}>
                        {agent.strategy}
                      </Badge>
                    </div>
                  </div>

                  {/* Tier rank pips */}
                  <div className='mb-3 flex items-center gap-1'>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className='h-1 flex-1 rounded-full transition-all duration-300'
                        style={{
                          backgroundColor: i < tier.rank
                            ? tier.color
                            : i === tier.rank
                            ? tier.color + '60'
                            : 'var(--border)',
                          boxShadow: i < tier.rank ? `0 0 4px ${tier.color}80` : 'none'
                        }}
                      />
                    ))}
                  </div>

                  {/* Description */}
                  <p className='mb-4 text-xs leading-relaxed text-muted-foreground line-clamp-2'>
                    {agent.description || 'No description provided.'}
                  </p>

                  {/* RPG Stat Bars */}
                  <div className='mb-4 space-y-1.5'>
                    <StatBar label='INT' value={stats.intelligence} color={accentColor} />
                    <StatBar label='AUT' value={stats.autonomy} color={accentColor} />
                    <StatBar label='SPD' value={stats.speed} color={accentColor} />
                    <StatBar label='ADP' value={stats.adaptability} color={accentColor} />
                  </div>

                  {/* Footer: variables, tools, iter count */}
                  <div className='flex items-center justify-between border-t border-border/30 pt-3'>
                    <div className='flex flex-wrap gap-1'>
                      {agent.variables?.slice(0, 2).map((v) => (
                        <span key={v.name} className='rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70'>
                          {'{{'}{v.name}{'}}'}
                        </span>
                      ))}
                      {(agent.variables?.length || 0) > 2 && (
                        <span className='rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/50'>
                          +{(agent.variables?.length || 0) - 2}
                        </span>
                      )}
                      {(agent.tools?.length || 0) > 0 && (
                        <span className='flex items-center gap-0.5 rounded border border-[#14FFF7]/20 bg-[#14FFF7]/5 px-1.5 py-0.5 text-[9px] text-[#14FFF7]/70'>
                          <IconTool className='h-2 w-2' />
                          {agent.tools.length}
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-1 text-[10px] text-muted-foreground/50'>
                      <IconFlame className='h-3 w-3' />
                      <span>{agent.max_iterations} iter</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Agent Dialog (Multi-Step) ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='max-w-2xl gap-0 p-0 max-h-[90vh] flex flex-col'>
          {/* Step Indicator */}
          <div className='shrink-0 flex items-center gap-2 border-b px-6 py-4'>
            {['Strategy', 'Identity', 'Configure'].map((label, i) => (
              <div key={label} className='flex items-center gap-2'>
                <button
                  type='button'
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    i === createStep
                      ? 'bg-[#9A66FF] text-white'
                      : i < createStep
                        ? 'bg-[#9A66FF]/20 text-[#9A66FF]'
                        : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => i < createStep && setCreateStep(i)}
                >
                  {i < createStep ? '\u2713' : i + 1}
                </button>
                <span className={`text-sm ${i === createStep ? 'font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </span>
                {i < 2 && <IconArrowRight className='h-3 w-3 text-muted-foreground/40' />}
              </div>
            ))}
          </div>

          <div className='overflow-y-auto flex-1 min-h-0 px-6 py-6'>
            {/* Step 0: Strategy Selection */}
            {createStep === 0 && (
              <div className='space-y-5'>
                <div>
                  <h3 className='text-lg font-semibold'>What type of agent do you want to create?</h3>
                  <p className='text-sm text-muted-foreground'>
                    Choose a reasoning strategy for your agent.
                  </p>
                </div>
                <div className='grid gap-3'>
                  {strategies.map((s) => {
                    const Icon = s.icon;
                    const selected = formStrategy === s.value;
                    return (
                      <button
                        key={s.value}
                        type='button'
                        className={`flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all ${
                          selected
                            ? 'border-[var(--s-color)] bg-[var(--s-color)]/5 shadow-md shadow-[var(--s-color)]/10'
                            : 'border-border/50 hover:border-border'
                        }`}
                        style={{ '--s-color': s.color } as React.CSSProperties}
                        onClick={() => setFormStrategy(s.value)}
                      >
                        <div
                          className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl'
                          style={{
                            backgroundColor: s.color + '15',
                            color: s.color
                          }}
                        >
                          <Icon className='h-5 w-5' />
                        </div>
                        <div className='flex-1'>
                          <div className='flex items-center gap-2'>
                            <span className='font-medium'>{s.label}</span>
                            {selected && (
                              <Badge
                                variant='outline'
                                className='text-[9px]'
                                style={{
                                  backgroundColor: s.color + '15',
                                  borderColor: s.color + '30',
                                  color: s.color
                                }}
                              >
                                Selected
                              </Badge>
                            )}
                          </div>
                          <p className='mt-0.5 text-sm text-muted-foreground'>
                            {s.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 1: Icon & Name */}
            {createStep === 1 && (
              <div className='space-y-6'>
                <div>
                  <h3 className='text-lg font-semibold'>Agent icon & name</h3>
                  <p className='text-sm text-muted-foreground'>
                    Give your agent an identity. You can always change this later.
                  </p>
                </div>
                <div className='flex items-center gap-5'>
                  <IconPicker
                    icon={formIcon}
                    color={formColor}
                    onIconChange={setFormIcon}
                    onColorChange={setFormColor}
                    size='lg'
                  />
                  <div className='flex-1 space-y-3'>
                    <div className='space-y-2'>
                      <Label>Name</Label>
                      <Input
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder='e.g. Research Analyst'
                        className='text-base'
                        autoFocus
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Description</Label>
                      <Input
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder='What does this agent do?'
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Configuration */}
            {createStep === 2 && (
              <ScrollArea className='max-h-[50vh] pr-2'>
                <div className='space-y-5'>
                  <div>
                    <h3 className='text-lg font-semibold'>Configure your agent</h3>
                    <p className='text-sm text-muted-foreground'>
                      Set up the model, provider, and system prompt. You can fine-tune everything on the detail page.
                    </p>
                  </div>
                  <div className='grid grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label>Model</Label>
                      <Input
                        value={formModel}
                        onChange={(e) => setFormModel(e.target.value)}
                        placeholder='gpt-4o'
                        className='font-mono text-sm'
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Max Iterations</Label>
                      <Input
                        type='number'
                        value={formMaxIter}
                        onChange={(e) => setFormMaxIter(parseInt(e.target.value) || 10)}
                      />
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <Label>Provider</Label>
                    <Select
                      value={formProviderId || '_none'}
                      onValueChange={(v) => setFormProviderId(v === '_none' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Select a provider...' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='_none'>Auto-detect provider</SelectItem>
                        {providers.map((pv) => (
                          <SelectItem key={pv.id} value={pv.id}>
                            {pv.name} ({pv.provider_type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='space-y-2'>
                    <Label>System Prompt</Label>
                    <Textarea
                      value={formSystemPrompt}
                      onChange={(e) => setFormSystemPrompt(e.target.value)}
                      placeholder='You are a helpful assistant that...'
                      rows={5}
                      className='font-mono text-xs'
                    />
                    <p className='text-[10px] text-muted-foreground'>
                      Define the agent's personality, capabilities, and constraints.
                    </p>
                  </div>
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer */}
          <div className='shrink-0 flex items-center justify-between border-t px-6 py-4'>
            <div>
              {createStep > 0 && (
                <Button variant='ghost' onClick={() => setCreateStep(createStep - 1)}>
                  <IconArrowLeft className='mr-1 h-4 w-4' />
                  Back
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              {createStep < 2 ? (
                <Button
                  className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  onClick={() => setCreateStep(createStep + 1)}
                  disabled={createStep === 1 && !formName.trim()}
                >
                  Continue
                  <IconArrowRight className='ml-1 h-4 w-4' />
                </Button>
              ) : (
                <Button
                  className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                  onClick={handleCreate}
                  disabled={saving || !formName.trim()}
                >
                  {saving && <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />}
                  {saving ? 'Creating...' : 'Create Agent'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
