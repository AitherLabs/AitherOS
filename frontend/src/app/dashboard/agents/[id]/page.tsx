'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconSend,
  IconTool,
  IconTrash,
  IconX,
  IconBrain,
  IconBolt,
  IconDatabase,
  IconMessage,
  IconChevronDown,
  IconChevronRight,
  IconHistory,
  IconExternalLink
} from '@tabler/icons-react';
import api, { Agent, AgentVariable, MCPServer, MCPToolDefinition, Provider } from '@/lib/api';
import { AvatarUpload } from '@/components/avatar-upload';
import { EntityAvatar } from '@/components/entity-avatar';
import { IconPicker } from '@/components/icon-picker';
import { getAgentTier, getAgentStats } from '@/lib/agent-tier';

interface ToolCallInfo {
  name: string;
  result?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallInfo[];
}

// ── Highlighted Prompt Editor ─────────────────────────────────────────────────

function HighlightedTextarea({
  value,
  onChange,
  placeholder,
  rows = 6
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function syncScroll() {
    if (overlayRef.current && taRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop;
    }
  }

  function highlight(text: string) {
    return text.split(/(\{\{[^}]*\}\})/g).map((part, i) => {
      if (/^\{\{[^}]*\}\}$/.test(part)) {
        const varName = part.slice(2, -2);
        return (
          <span
            key={i}
            title={`Variable: ${varName} — filled at runtime`}
            style={{ backgroundColor: '#FFBF4728', color: '#FFBF47', borderRadius: '3px', padding: '0 2px' }}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  const minH = `${rows * 1.6 + 0.5}rem`;

  return (
    <div className='relative overflow-hidden rounded-md border border-input' style={{ minHeight: minH }}>
      <div
        ref={overlayRef}
        className='pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words bg-input p-3 font-mono text-xs leading-relaxed'
        aria-hidden='true'
        style={{ color: 'var(--foreground)' }}
      >
        {highlight(value || '')}{' '}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        className='relative w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none'
        style={{ color: 'transparent', caretColor: 'var(--foreground)', minHeight: minH }}
      />
    </div>
  );
}

export default function AgentDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [strategy, setStrategy] = useState('simple');
  const [maxIterations, setMaxIterations] = useState(10);
  const [icon, setIcon] = useState('🤖');
  const [color, setColor] = useState('#9A66FF');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [variables, setVariables] = useState<AgentVariable[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [providerId, setProviderId] = useState<string>('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mcpTools, setMcpTools] = useState<{ server: MCPServer; tools: MCPToolDefinition[] }[]>([]);

  // Debug chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [varInputs, setVarInputs] = useState<Record<string, string>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Right panel tabs + tool expansion
  const [rightTab, setRightTab] = useState<'debug' | 'tools' | 'memory'>('debug');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const loadAgent = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [res, pvRes] = await Promise.all([
        api.getAgent(agentId),
        api.listProviders()
      ]);
      setProviders(pvRes.data || []);
      const a = res.data;
      if (!a) return;
      setAgent(a);
      setName(a.name);
      setDescription(a.description);
      setSystemPrompt(a.system_prompt);
      setInstructions(a.instructions);
      setModel(a.model);
      setStrategy(a.strategy);
      setMaxIterations(a.max_iterations);
      setIcon(a.icon || '🤖');
      setColor(a.color || '#9A66FF');
      setAvatarUrl(a.avatar_url || '');
      setVariables(a.variables || []);
      setTools(a.tools || []);
      setProviderId(a.provider_id || '');
      setHasChanges(false);

      // Load MCP tools from workforces this agent belongs to
      try {
        const wfRes = await api.listWorkforces();
        const agentWorkforces = (wfRes.data || []).filter((wf) =>
          (wf.agent_ids || []).includes(agentId)
        );
        const mcpEntries: { server: MCPServer; tools: MCPToolDefinition[] }[] = [];
        const seenServers = new Set<string>();
        for (const wf of agentWorkforces) {
          try {
            const srvRes = await api.listWorkforceMCPServers(wf.id);
            for (const srv of srvRes.data || []) {
              if (seenServers.has(srv.id)) continue;
              try {
                const perms = await api.getAgentTools(agentId, srv.id);
                if ((perms.data || []).length > 0) {
                  const toolsRes = await api.listMCPServerTools(srv.id);
                  seenServers.add(srv.id);
                  mcpEntries.push({ server: srv, tools: toolsRes.data || [] });
                }
              } catch { /* no permissions */ }
            }
          } catch { /* */ }
        }
        setMcpTools(mcpEntries);
      } catch { /* MCP load optional */ }
    } catch (err) {
      console.error('Failed to load agent:', err);
    } finally {
      setLoading(false);
    }
  }, [session, agentId]);

  // Load chat history from database
  useEffect(() => {
    if (!agentId || !session?.accessToken) return;
    api.setToken(session.accessToken);
    api.listAgentChats(agentId)
      .then((res) => {
        const chats = res.data || [];
        setMessages(chats.map((c) => ({
          role: c.role,
          content: c.content,
          timestamp: new Date(c.created_at),
          toolCalls: (c.tool_calls || []).map((tc: any) => ({ name: tc.name, result: tc.result }))
        })));
      })
      .catch(() => { /* chat load is non-critical */ });
  }, [agentId, session]);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function markChanged() {
    setHasChanges(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAgent(agentId, {
        name,
        description,
        avatar_url: avatarUrl,
        system_prompt: systemPrompt,
        instructions,
        model,
        provider_id: providerId || undefined,
        strategy,
        max_iterations: maxIterations,
        icon,
        color,
        variables,
        tools
      });
      setHasChanges(false);
      await loadAgent();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteAgent(agentId);
      router.push('/dashboard/agents');
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function handleSendMessage() {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = {
      role: 'user',
      content: chatInput,
      timestamp: new Date()
    };
    const input = chatInput;
    setChatInput('');
    setChatLoading(true);

    // Build history from previous user/assistant messages (exclude errors)
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as string, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await api.debugAgent(agentId, input, varInputs, history);
      const data = res.data;
      const content = data?.content || JSON.stringify(data, null, 2);
      const toolCalls: ToolCallInfo[] = (data?.tool_calls || []).map(
        (tc: any) => ({ name: tc.name, result: tc.result })
      );
      const assistantMsg: ChatMessage = { role: 'assistant', content, timestamp: new Date(), toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
      setMessages((prev) => [...prev, assistantMsg]);
      // Persist both messages to DB (fire-and-forget)
      api.createAgentChat(agentId, { role: 'user', content: input }).catch(() => {});
      api.createAgentChat(agentId, {
        role: 'assistant',
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls.map((tc) => ({ name: tc.name, args: {}, result: tc.result || '' })) : []
      }).catch(() => {});
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'error',
          content: `Error: ${err.message}`,
          timestamp: new Date()
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function addVariable() {
    setVariables([
      ...variables,
      { name: '', label: '', type: 'text', description: '', required: false }
    ]);
    markChanged();
  }

  function updateVariable(idx: number, field: string, value: any) {
    const updated = [...variables];
    (updated[idx] as any)[field] = value;
    setVariables(updated);
    markChanged();
  }

  function removeVariable(idx: number) {
    setVariables(variables.filter((_, i) => i !== idx));
    markChanged();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  if (loading) {
    return (
      <div className='flex h-[80vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className='flex h-[80vh] flex-col items-center justify-center gap-4'>
        <p className='text-muted-foreground'>Agent not found.</p>
        <Button variant='outline' onClick={() => router.push('/dashboard/agents')}>
          <IconArrowLeft className='mr-2 h-4 w-4' />
          Back to Agents
        </Button>
      </div>
    );
  }

  const tier = getAgentTier({ model, strategy, max_iterations: maxIterations, tools, variables, system_prompt: systemPrompt });
  const agentStats = getAgentStats({ model, strategy, max_iterations: maxIterations, tools, variables, system_prompt: systemPrompt });
  const statDefs = [
    { label: 'INT', value: agentStats.intelligence, color: '#9A66FF' },
    { label: 'AUT', value: agentStats.autonomy,     color: '#14FFF7' },
    { label: 'SPD', value: agentStats.speed,        color: '#56D090' },
    { label: 'ADP', value: agentStats.adaptability, color: '#FFBF47' }
  ];

  return (
    <div className='flex h-[calc(100vh-64px)] flex-col'>
      {/* Top Bar */}
      <div className='flex items-center justify-between border-b border-border/50 px-6 py-3'>
        <div className='flex items-center gap-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => router.push('/dashboard/agents')}
            className='h-8 w-8'
          >
            <IconArrowLeft className='h-4 w-4' />
          </Button>
          <EntityAvatar icon={icon} color={color} avatarUrl={avatarUrl} size='sm' />
          <div>
            <h1 className='text-sm font-semibold'>{name || 'Untitled Agent'}</h1>
            <p className='text-xs text-muted-foreground'>
              {model} · {strategy}
            </p>
          </div>
          {hasChanges && (
            <Badge className='ml-2 bg-[#FFBF47]/20 text-[#FFBF47] border-[#FFBF47]/30'>
              Unsaved
            </Badge>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='text-red-400 hover:text-red-400'
            onClick={() => setDeleteOpen(true)}
          >
            <IconTrash className='mr-1 h-3.5 w-3.5' />
            Delete
          </Button>
          <Button
            size='sm'
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
          >
            {saving ? (
              <IconLoader2 className='mr-1 h-3.5 w-3.5 animate-spin' />
            ) : (
              <IconDeviceFloppy className='mr-1 h-3.5 w-3.5' />
            )}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Main Content: Three-Column Character Sheet */}
      <div className='flex flex-1 overflow-hidden'>

        {/* ── Col 1: Character Card (260px) ── */}
        <div className='flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-border/50 bg-card/40'>
          <div className='space-y-4 p-4'>

            {/* Avatar + Tier Badge */}
            <div className='flex flex-col items-center gap-2 pb-2 pt-3'>
              <div className='relative'>
                <div className='absolute -inset-2 rounded-full blur-lg opacity-40' style={{ background: tier.glow }} />
                {avatarUrl ? (
                  <AvatarUpload
                    currentUrl={avatarUrl}
                    size='lg'
                    onUploaded={async (url) => {
                      setAvatarUrl(url);
                      try { await api.updateAgent(agentId, { avatar_url: url }); } catch { /* non-critical */ }
                    }}
                  />
                ) : (
                  <>
                    <IconPicker
                      icon={icon} color={color}
                      onIconChange={(v) => { setIcon(v); markChanged(); }}
                      onColorChange={(v) => { setColor(v); markChanged(); }}
                      size='lg'
                    />
                  </>
                )}
              </div>
              {!avatarUrl && (
                <AvatarUpload
                  currentUrl={avatarUrl}
                  size='sm'
                  onUploaded={async (url) => {
                    setAvatarUrl(url);
                    try { await api.updateAgent(agentId, { avatar_url: url }); } catch { /* non-critical */ }
                  }}
                  className='mt-1'
                />
              )}
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); markChanged(); }}
                className='mt-1 text-center font-mono text-sm font-bold'
                placeholder='Agent name'
              />
              <span
                className='rounded-full px-3 py-0.5 font-mono text-[10px] font-black tracking-widest'
                style={{ color: tier.color, backgroundColor: tier.glow, border: `1px solid ${tier.color}40` }}
              >
                {tier.label}
              </span>
            </div>

            {/* RPG Stats */}
            <div className='space-y-2 rounded-lg border border-border/30 bg-background/30 p-3'>
              <p className='mb-2 font-mono text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50'>ATTRIBUTES</p>
              {statDefs.map((s) => (
                <div key={s.label} className='flex items-center gap-2'>
                  <span className='w-7 font-mono text-[9px] font-bold' style={{ color: s.color }}>{s.label}</span>
                  <div className='relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40'>
                    <div
                      className='h-full rounded-full'
                      style={{ width: `${s.value}%`, background: `linear-gradient(90deg, ${s.color}80, ${s.color})`, boxShadow: `0 0 4px ${s.color}80` }}
                    />
                  </div>
                  <span className='w-5 font-mono text-[9px] text-muted-foreground/50'>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Description */}
            <div className='space-y-1.5'>
              <Label className='text-[10px] uppercase tracking-wider text-muted-foreground/60'>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); markChanged(); }}
                placeholder='What does this agent do?'
                rows={3}
                className='resize-none text-xs'
              />
            </div>

            <Separator className='opacity-30' />

            {/* Engine Config */}
            <div className='space-y-3'>
              <p className='font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50'>ENGINE</p>
              <div className='space-y-1.5'>
                <Label className='text-[10px]'>Provider</Label>
                <Select value={providerId || '_none'} onValueChange={(v) => { setProviderId(v === '_none' ? '' : v); markChanged(); }}>
                  <SelectTrigger className='h-7 text-xs'><SelectValue placeholder='Auto-detect' /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='_none'>Auto-detect</SelectItem>
                    {providers.map((pv) => (
                      <SelectItem key={pv.id} value={pv.id}>{pv.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label className='text-[10px]'>Model</Label>
                {(() => {
                  const selectedProvider = providers.find((p) => p.id === providerId);
                  const llmModels = selectedProvider?.models?.filter((m) => m.model_type === 'llm') ?? [];
                  return llmModels.length > 0 ? (
                    <Select value={model} onValueChange={(v) => { setModel(v); markChanged(); }}>
                      <SelectTrigger className='h-7 font-mono text-xs'><SelectValue placeholder='Select model...' /></SelectTrigger>
                      <SelectContent>
                        {llmModels.map((m) => (
                          <SelectItem key={m.id} value={m.model_name} className='font-mono text-xs'>
                            {m.model_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={model} onChange={(e) => { setModel(e.target.value); markChanged(); }} placeholder='gpt-4o' className='h-7 font-mono text-xs' />
                  );
                })()}
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <div className='space-y-1.5'>
                  <Label className='text-[10px]'>Strategy</Label>
                  <Select value={strategy} onValueChange={(v) => { setStrategy(v); markChanged(); }}>
                    <SelectTrigger className='h-7 text-xs'><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='simple'>Simple</SelectItem>
                      <SelectItem value='react'>ReAct</SelectItem>
                      <SelectItem value='function_call'>Func Call</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-[10px]'>Max Iter.</Label>
                  <Input type='number' value={maxIterations} onChange={(e) => { setMaxIterations(parseInt(e.target.value) || 10); markChanged(); }} className='h-7 text-xs' />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Col 2: Prompts + Variables (flex-1) ── */}
        <div className='flex-1 overflow-y-auto border-r border-border/50'>
          <div className='space-y-5 p-5'>

            {/* System Prompt */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <IconBrain className='h-3.5 w-3.5 text-[#9A66FF]' />
                  <h3 className='font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground'>System Prompt</h3>
                </div>
                <span className='font-mono text-[10px] text-muted-foreground/50'>{systemPrompt.length} chars</span>
              </div>
              {/* Variable pills detected in prompt */}
              {systemPrompt.match(/\{\{[^}]+\}\}/g) && (
                <div className='flex flex-wrap gap-1'>
                  {Array.from(new Set(systemPrompt.match(/\{\{[^}]+\}\}/g) || [])).map((v) => (
                    <span key={v} className='inline-flex items-center gap-1 rounded-full border border-[#FFBF47]/30 bg-[#FFBF47]/10 px-2 py-0.5 font-mono text-[9px] text-[#FFBF47]'>
                      {v}
                    </span>
                  ))}
                </div>
              )}
              <HighlightedTextarea
                value={systemPrompt}
                onChange={(v) => { setSystemPrompt(v); markChanged(); }}
                placeholder='You are a helpful assistant...'
                rows={10}
              />
            </div>

            <Separator className='opacity-30' />

            {/* Instructions */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <IconBolt className='h-3.5 w-3.5 text-[#FFBF47]' />
                  <h3 className='font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground'>Instructions</h3>
                </div>
                <span className='font-mono text-[10px] text-muted-foreground/50'>{instructions.length} chars</span>
              </div>
              {instructions.match(/\{\{[^}]+\}\}/g) && (
                <div className='flex flex-wrap gap-1'>
                  {Array.from(new Set(instructions.match(/\{\{[^}]+\}\}/g) || [])).map((v) => (
                    <span key={v} className='inline-flex items-center gap-1 rounded-full border border-[#FFBF47]/30 bg-[#FFBF47]/10 px-2 py-0.5 font-mono text-[9px] text-[#FFBF47]'>
                      {v}
                    </span>
                  ))}
                </div>
              )}
              <HighlightedTextarea
                value={instructions}
                onChange={(v) => { setInstructions(v); markChanged(); }}
                placeholder='Step-by-step instructions...'
                rows={7}
              />
            </div>

            <Separator className='opacity-30' />

            {/* Variables */}
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <span className='font-mono text-xs text-[#FFBF47]'>{'{{}}'}</span>
                  <h3 className='font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground'>Variables</h3>
                </div>
                <Button variant='ghost' size='sm' onClick={addVariable} className='h-7 text-xs'>
                  <IconPlus className='mr-1 h-3 w-3' /> Add
                </Button>
              </div>
              <p className='text-[11px] text-muted-foreground/60'>
                Use <code className='rounded bg-[#FFBF47]/10 px-1 py-0.5 font-mono text-[#FFBF47]'>{'{{variable_name}}'}</code> in prompts above — they glow amber.
              </p>
              {variables.length === 0 ? (
                <p className='rounded-lg border border-dashed border-border/40 py-4 text-center text-xs text-muted-foreground/50'>No variables defined.</p>
              ) : (
                <div className='space-y-2'>
                  {variables.map((v, idx) => (
                    <div key={idx} className='flex items-start gap-2 rounded-lg border border-border/40 bg-background/40 p-3'>
                      <div className='grid flex-1 grid-cols-3 gap-2'>
                        <Input value={v.name} onChange={(e) => updateVariable(idx, 'name', e.target.value)} placeholder='name' className='font-mono text-xs' />
                        <Input value={v.label} onChange={(e) => updateVariable(idx, 'label', e.target.value)} placeholder='Label' className='text-xs' />
                        <Select value={v.type || 'text'} onValueChange={(val) => updateVariable(idx, 'type', val)}>
                          <SelectTrigger className='text-xs'><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value='text'>Text</SelectItem>
                            <SelectItem value='paragraph'>Paragraph</SelectItem>
                            <SelectItem value='select'>Select</SelectItem>
                            <SelectItem value='number'>Number</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant='ghost' size='icon' className='h-8 w-8 text-muted-foreground hover:text-red-400' onClick={() => removeVariable(idx)}>
                        <IconX className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Col 3: Tabbed Panel (400px) ── */}
        <div className='flex w-[400px] shrink-0 flex-col overflow-hidden'>
          {/* Tab Headers */}
          <div className='flex shrink-0 border-b border-border/50'>
            {([
              { id: 'debug',  label: 'Debug',  Icon: IconMessage },
              { id: 'tools',  label: 'Tools',  Icon: IconTool    },
              { id: 'memory', label: 'Memory', Icon: IconHistory }
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  rightTab === id
                    ? 'border-[#9A66FF] text-[#9A66FF]'
                    : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground'
                }`}
              >
                <Icon className='h-3 w-3' />
                {label}
                {id === 'tools' && mcpTools.length > 0 && (
                  <span className='rounded-full bg-[#9A66FF]/20 px-1.5 py-0 text-[8px] text-[#9A66FF]'>
                    {mcpTools.reduce((s, e) => s + e.tools.length, 0)}
                  </span>
                )}
                {id === 'memory' && messages.length > 0 && (
                  <span className='rounded-full bg-[#56D090]/20 px-1.5 py-0 text-[8px] text-[#56D090]'>
                    {messages.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Debug Tab ── */}
          {rightTab === 'debug' && (
            <div className='flex flex-1 flex-col overflow-hidden'>
              {/* Variable Inputs */}
              {variables.length > 0 && (
                <div className='shrink-0 border-b border-border/50 p-3'>
                  <p className='mb-2 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50'>Variables</p>
                  <div className='space-y-1.5'>
                    {variables.map((v) => (
                      <div key={v.name} className='flex items-center gap-2'>
                        <span className='w-20 truncate font-mono text-[10px] text-[#FFBF47]'>{v.label || v.name}</span>
                        <Input
                          value={varInputs[v.name] || ''}
                          onChange={(e) => setVarInputs({ ...varInputs, [v.name]: e.target.value })}
                          placeholder={v.description || v.name}
                          className='h-7 text-xs'
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Chat */}
              <ScrollArea className='min-h-0 flex-1 p-3'>
                <div className='space-y-3'>
                  {messages.length === 0 && (
                    <div className='flex h-40 flex-col items-center justify-center gap-2 text-center'>
                      <div className='flex h-12 w-12 items-center justify-center rounded-xl text-2xl' style={{ backgroundColor: color + '20' }}>{icon}</div>
                      <p className='text-xs text-muted-foreground/60'>Send a message to test this agent.</p>
                    </div>
                  )}
                  {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[92%] rounded-lg px-3 py-2 text-xs ${
                        msg.role === 'user' ? 'bg-[#9A66FF]/20 text-foreground'
                        : msg.role === 'error' ? 'border border-red-500/30 bg-red-500/10 text-red-400'
                        : 'border border-border/50 bg-background/60 text-foreground/90'
                      }`}>
                        {msg.role !== 'user' && (
                          <div className='mb-1.5 flex flex-wrap items-center gap-1.5'>
                            <span className='text-[10px] font-medium' style={{ color }}>{name}</span>
                            {(msg.toolCalls || []).map((tc, ti) => (
                              <span key={ti} className='inline-flex items-center gap-1 rounded-sm border border-[#14FFF7]/30 bg-[#14FFF7]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#14FFF7]'>
                                <IconTool className='h-2.5 w-2.5' />{tc.name}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className='break-words whitespace-pre-wrap font-mono leading-relaxed'>{msg.content}</div>
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className='flex justify-start'>
                      <div className='flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2'>
                        <IconLoader2 className='h-3.5 w-3.5 animate-spin' style={{ color }} />
                        <span className='text-xs text-muted-foreground'>Thinking...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </ScrollArea>
              <div className='shrink-0 border-t border-border/50 p-3'>
                <div className='flex items-end gap-2'>
                  <Textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={handleKeyDown} placeholder='Talk to agent...' rows={1} className='min-h-[36px] resize-none text-xs' />
                  <div className='flex flex-col gap-1'>
                    <Button size='icon' onClick={handleSendMessage} disabled={chatLoading || !chatInput.trim()} className='h-9 w-9 shrink-0 bg-[#9A66FF] hover:bg-[#9A66FF]/90'>
                      <IconSend className='h-4 w-4' />
                    </Button>
                    <Button size='icon' variant='ghost' className='h-7 w-9 shrink-0' title='Clear chat'
                      onClick={() => { setMessages([]); api.clearAgentChats(agentId).catch(() => {}); }}>
                      <IconRefresh className='h-3 w-3' />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tools Tab ── */}
          {rightTab === 'tools' && (
            <ScrollArea className='flex-1'>
              <div className='space-y-3 p-3'>
                {mcpTools.length === 0 ? (
                  <div className='flex flex-col items-center gap-3 py-10 text-center'>
                    <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-[#9A66FF]/10'>
                      <IconTool className='h-5 w-5 text-[#9A66FF]/50' />
                    </div>
                    <div>
                      <p className='text-xs font-medium'>No tools assigned</p>
                      <p className='mt-0.5 text-[11px] text-muted-foreground/60'>Grant MCP tool access in the Workforce page.</p>
                    </div>
                  </div>
                ) : (
                  mcpTools.map(({ server, tools: srvTools }) => (
                    <div key={server.id}>
                      <div className='mb-2 flex items-center gap-2'>
                        <div className='flex h-5 w-5 items-center justify-center rounded bg-[#9A66FF]/15'>
                          <IconTool className='h-3 w-3 text-[#9A66FF]' />
                        </div>
                        <span className='font-mono text-[11px] font-bold text-[#9A66FF]'>{server.name}</span>
                        <span className='ml-auto rounded-sm bg-[#56D090]/10 px-1.5 font-mono text-[9px] text-[#56D090]'>MCP · {srvTools.length}</span>
                      </div>
                      <div className='space-y-1'>
                        {srvTools.map((t) => {
                          const toolKey = t.name;
                          const isExpanded = expandedTool === toolKey;
                          const schema = (t as any).input_schema || {};
                          const props = schema.properties || {};
                          return (
                            <div key={toolKey} className='overflow-hidden rounded-lg border border-border/40 bg-background/40'>
                              <button
                                className='flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30'
                                onClick={() => setExpandedTool(isExpanded ? null : toolKey)}
                              >
                                <span className='flex-1 font-mono text-[11px] font-medium'>{t.name}</span>
                                {isExpanded ? <IconChevronDown className='h-3 w-3 text-muted-foreground/50' /> : <IconChevronRight className='h-3 w-3 text-muted-foreground/50' />}
                              </button>
                              {isExpanded && (
                                <div className='border-t border-border/30 px-3 pb-3 pt-2'>
                                  {t.description && (
                                    <p className='mb-2 text-[11px] leading-relaxed text-muted-foreground/70'>{t.description}</p>
                                  )}
                                  {Object.keys(props).length > 0 && (
                                    <div className='mb-2 space-y-1'>
                                      <p className='font-mono text-[8px] font-bold uppercase tracking-widest text-muted-foreground/40'>Parameters</p>
                                      {Object.entries(props).map(([key, prop]: [string, any]) => (
                                        <div key={key} className='flex items-start gap-2 rounded bg-muted/20 px-2 py-1'>
                                          <span className='font-mono text-[10px] font-bold text-[#14FFF7]'>{key}</span>
                                          <span className='font-mono text-[9px] text-muted-foreground/40'>{prop.type}</span>
                                          {prop.description && <span className='text-[10px] text-muted-foreground/60'>{prop.description}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <Button
                                    size='sm'
                                    variant='outline'
                                    className='h-6 text-[10px] border-[#9A66FF]/30 text-[#9A66FF] hover:bg-[#9A66FF]/10'
                                    onClick={() => { setChatInput(`Use ${t.name} to `); setRightTab('debug'); }}
                                  >
                                    <IconMessage className='mr-1 h-2.5 w-2.5' />
                                    Try in Chat
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
                {tools.length > 0 && (
                  <div>
                    <p className='mb-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40'>Legacy Tools</p>
                    <div className='flex flex-wrap gap-1.5'>
                      {tools.map((t, i) => (
                        <span key={i} className='flex items-center gap-1 rounded-md border border-[#14FFF7]/30 bg-[#14FFF7]/10 px-2 py-0.5 font-mono text-[10px] text-[#14FFF7]'>
                          {t}
                          <button onClick={() => { setTools(tools.filter((_, j) => j !== i)); markChanged(); }}>
                            <IconX className='h-2.5 w-2.5 opacity-50 hover:opacity-100' />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* ── Memory Tab ── */}
          {rightTab === 'memory' && (
            <ScrollArea className='flex-1'>
              <div className='space-y-4 p-3'>
                {/* Session Summary */}
                <div className='rounded-lg border border-border/40 bg-background/40 p-3'>
                  <div className='mb-2 flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <IconDatabase className='h-3.5 w-3.5 text-[#56D090]' />
                      <span className='font-mono text-[10px] font-bold uppercase tracking-wider text-[#56D090]'>Chat Memory</span>
                    </div>
                    {messages.length > 0 && (
                      <Button size='sm' variant='ghost' className='h-6 text-[9px] text-muted-foreground/50'
                        onClick={() => { setMessages([]); api.clearAgentChats(agentId).catch(() => {}); }}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className='grid grid-cols-3 gap-2 text-center'>
                    {[
                      { label: 'Messages', value: messages.length },
                      { label: 'You', value: messages.filter((m) => m.role === 'user').length },
                      { label: 'Agent', value: messages.filter((m) => m.role === 'assistant').length }
                    ].map((s) => (
                      <div key={s.label} className='rounded bg-muted/20 py-1.5'>
                        <p className='font-mono text-sm font-black text-foreground'>{s.value}</p>
                        <p className='font-mono text-[8px] text-muted-foreground/50'>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Message Timeline */}
                {messages.length === 0 ? (
                  <div className='flex flex-col items-center gap-2 py-8 text-center'>
                    <IconHistory className='h-8 w-8 text-muted-foreground/20' />
                    <p className='text-xs text-muted-foreground/50'>No conversations yet. Start chatting in the Debug tab.</p>
                  </div>
                ) : (
                  <div className='space-y-2'>
                    <p className='font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40'>Session History</p>
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`rounded-lg border px-3 py-2 ${
                        msg.role === 'user' ? 'border-[#9A66FF]/20 bg-[#9A66FF]/5'
                        : msg.role === 'error' ? 'border-red-500/20 bg-red-500/5'
                        : 'border-border/30 bg-background/30'
                      }`}>
                        <div className='mb-1 flex items-center gap-2'>
                          <span className={`font-mono text-[9px] font-bold uppercase ${msg.role === 'user' ? 'text-[#9A66FF]' : msg.role === 'error' ? 'text-red-400' : 'text-muted-foreground/60'}`}>
                            {msg.role === 'user' ? 'You' : msg.role === 'error' ? 'Error' : name}
                          </span>
                          <span className='ml-auto font-mono text-[8px] text-muted-foreground/30'>
                            {msg.timestamp instanceof Date ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <p className='text-[11px] leading-relaxed text-muted-foreground/70 line-clamp-3'>{msg.content}</p>
                        {(msg.toolCalls || []).length > 0 && (
                          <div className='mt-1.5 flex flex-wrap gap-1'>
                            {(msg.toolCalls || []).map((tc, ti) => (
                              <span key={ti} className='inline-flex items-center gap-1 rounded border border-[#14FFF7]/20 bg-[#14FFF7]/8 px-1.5 font-mono text-[9px] text-[#14FFF7]'>
                                <IconTool className='h-2 w-2' />{tc.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Workforce Link */}
                <div className='rounded-lg border border-border/30 p-3'>
                  <p className='mb-1 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40'>Workforce Executions</p>
                  <p className='text-[11px] text-muted-foreground/50'>Full execution history is available on the Workforce page.</p>
                  <button
                    className='mt-2 flex items-center gap-1 font-mono text-[10px] text-[#9A66FF] hover:underline'
                    onClick={() => router.push('/dashboard/workforces')}
                  >
                    <IconExternalLink className='h-3 w-3' /> View Workforces
                  </button>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className='font-semibold'>{name}</span>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
