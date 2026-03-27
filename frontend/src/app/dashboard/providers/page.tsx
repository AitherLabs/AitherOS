'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
import { Switch } from '@/components/ui/switch';
import {
  IconAlertTriangle,
  IconCheck,
  IconDotsVertical,
  IconLoader2,
  IconPencil,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import api, { Provider, CreateProviderRequest } from '@/lib/api';

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'litellm', label: 'LiteLLM' },
  { value: 'picoclaw', label: 'PicoClaw' },
  { value: 'openclaw', label: 'OpenClaw' }
];

const PROVIDER_DEFAULTS: Record<string, { base_url: string; placeholder: string }> = {
  openai:           { base_url: 'https://api.openai.com/v1',                                   placeholder: 'sk-...' },
  openrouter:       { base_url: 'https://openrouter.ai/api/v1',                                placeholder: 'sk-or-...' },
  gemini:           { base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',     placeholder: 'AIza...' },
  ollama:           { base_url: 'http://localhost:11434/v1',                                   placeholder: '(no key needed)' },
  litellm:          { base_url: 'http://localhost:4000/v1',                                    placeholder: 'sk-...' },
  openai_compatible:{ base_url: '',                                                             placeholder: 'API key' },
  picoclaw:         { base_url: 'http://localhost:55000',                                      placeholder: '(no key needed)' },
  openclaw:         { base_url: '',                                                             placeholder: 'API key' },
};

const MODEL_TYPES = [
  { value: 'llm', label: 'LLM' },
  { value: 'embedding', label: 'Embedding' },
  { value: 'rerank', label: 'Rerank' },
  { value: 'tts', label: 'TTS' },
  { value: 'stt', label: 'STT' }
];

export default function ProvidersPage() {
  const { data: session } = useSession();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<Provider | null>(null);
  const [addModelProvider, setAddModelProvider] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form
  const [formData, setFormData] = useState<CreateProviderRequest>({
    name: '',
    provider_type: 'openai',
    base_url: '',
    api_key: '',
    is_default: false
  });

  // Edit form
  const [editData, setEditData] = useState({
    name: '',
    base_url: '',
    api_key: '',
    is_enabled: true,
    is_default: false
  });

  // Embedding status
  const [embedStatus, setEmbedStatus] = useState<{ ok: boolean; endpoint: string; model: string; dimensions?: number; error?: string } | null>(null);
  const [checkingEmbed, setCheckingEmbed] = useState(false);

  // Add model form
  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState('llm');
  const [liveModelsList, setLiveModelsList] = useState<string[]>([]);
  const [fetchingLive, setFetchingLive] = useState(false);

  // Create dialog — connection test state
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testModels, setTestModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  const loadProviders = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const res = await api.listProviders();
      setProviders(res.data || []);
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  async function checkEmbedding() {
    setCheckingEmbed(true);
    try {
      const res = await api.embeddingStatus();
      setEmbedStatus(res.data ?? null);
    } catch {
      setEmbedStatus({ ok: false, endpoint: '', model: '', error: 'Failed to reach backend' });
    } finally {
      setCheckingEmbed(false);
    }
  }

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  function openCreate() {
    setFormData({
      name: '',
      provider_type: 'openai',
      base_url: PROVIDER_DEFAULTS['openai'].base_url,
      api_key: '',
      is_default: false
    });
    setTestStatus('idle');
    setTestError('');
    setTestModels([]);
    setSelectedModels(new Set());
    setCreateOpen(true);
  }

  function handleProviderTypeChange(type: string) {
    const defaults = PROVIDER_DEFAULTS[type] ?? { base_url: '', placeholder: 'API key' };
    setFormData((f) => ({ ...f, provider_type: type, base_url: defaults.base_url }));
    setTestStatus('idle');
    setTestModels([]);
    setSelectedModels(new Set());
  }

  async function handleTestConnection() {
    if (!formData.base_url) return;
    setTestStatus('testing');
    setTestError('');
    setTestModels([]);
    setSelectedModels(new Set());
    try {
      const res = await api.testProvider({ base_url: formData.base_url, api_key: formData.api_key });
      if (res.data?.ok) {
        setTestStatus('ok');
        const models = res.data.models ?? [];
        setTestModels(models);
        setSelectedModels(new Set(models));
      } else {
        setTestStatus('error');
        setTestError(res.data?.error ?? 'Connection failed');
      }
    } catch {
      setTestStatus('error');
      setTestError('Request failed — check the URL and try again');
    }
  }

  function toggleModel(m: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  function openEdit(p: Provider) {
    setEditData({
      name: p.name,
      base_url: p.base_url,
      api_key: '',
      is_enabled: p.is_enabled,
      is_default: p.is_default
    });
    setEditProvider(p);
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const created = await api.createProvider(formData);
      if (created.data && selectedModels.size > 0) {
        await Promise.allSettled(
          Array.from(selectedModels).map((name) =>
            api.addProviderModel(created.data!.id, { model_name: name, model_type: 'llm' })
          )
        );
      }
      setCreateOpen(false);
      await loadProviders();
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editProvider) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: editData.name,
        base_url: editData.base_url,
        is_enabled: editData.is_enabled,
        is_default: editData.is_default
      };
      if (editData.api_key) {
        payload.api_key = editData.api_key;
      }
      await api.updateProvider(editProvider.id, payload);
      setEditProvider(null);
      await loadProviders();
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteProvider) return;
    try {
      await api.deleteProvider(deleteProvider.id);
      setDeleteProvider(null);
      await loadProviders();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function handleAddModel() {
    if (!addModelProvider || !modelName.trim()) return;
    setSaving(true);
    try {
      await api.addProviderModel(addModelProvider.id, {
        model_name: modelName,
        model_type: modelType
      });
      setModelName('');
      setModelType('llm');
      await loadProviders();
    } catch (err) {
      console.error('Add model failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function fetchLiveModels(provider: Provider) {
    setFetchingLive(true);
    setLiveModelsList([]);
    try {
      const res = await api.liveModels(provider.id);
      setLiveModelsList(res.data || []);
    } catch (err) {
      console.error('Failed to fetch live models:', err);
    } finally {
      setFetchingLive(false);
    }
  }

  async function handleSyncAll() {
    if (!addModelProvider || liveModelsList.length === 0) return;
    setSaving(true);
    try {
      // Refresh provider state before filtering to avoid stale-model misses
      const fresh = await api.getProvider(addModelProvider.id);
      const registered = new Set(fresh.data?.models?.map((m) => m.model_name) ?? []);
      const toAdd = liveModelsList.filter((m) => !registered.has(m));
      await Promise.allSettled(
        toAdd.map((name) =>
          api.addProviderModel(addModelProvider.id, { model_name: name, model_type: 'llm' })
        )
      );
      await loadProviders();
    } catch (err) {
      console.error('Sync all failed:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveModel(providerId: string, modelId: string) {
    try {
      await api.removeProviderModel(providerId, modelId);
      await loadProviders();
    } catch (err) {
      console.error('Remove model failed:', err);
    }
  }

  if (loading) {
    return (
      <div className='flex h-[50vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  return (
    <div className='space-y-6 p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Model Providers</h2>
          <p className='text-muted-foreground'>
            LLM backends and API connections powering your agents.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className='bg-[#14FFF7] text-[#0A0D11] hover:bg-[#14FFF7]/90'
        >
          <IconPlus className='mr-2 h-4 w-4' />
          New Provider
        </Button>
      </div>
      <Separator />

      {/* Embedding status banner */}
      <div className='rounded-lg border border-border/50 bg-muted/20 p-4'>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0 flex-1'>
            <p className='mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60'>Embedding Endpoint</p>
            {!embedStatus ? (
              <p className='text-sm text-muted-foreground'>
                Used for knowledge base / RAG. Click check to verify your current configuration.
              </p>
            ) : embedStatus.ok ? (
              <div className='space-y-0.5'>
                <div className='flex items-center gap-1.5 text-sm text-[#56D090]'>
                  <IconCheck className='h-3.5 w-3.5 shrink-0' />
                  <span className='font-medium'>Connected</span>
                  {embedStatus.dimensions && (
                    <span className='text-xs text-muted-foreground'>· {embedStatus.dimensions} dimensions</span>
                  )}
                </div>
                <p className='font-mono text-[11px] text-muted-foreground'>{embedStatus.model} @ {embedStatus.endpoint}</p>
              </div>
            ) : (
              <div className='space-y-1'>
                <div className='flex items-center gap-1.5 text-sm text-red-400'>
                  <IconAlertTriangle className='h-3.5 w-3.5 shrink-0' />
                  <span className='font-medium'>Embedding unavailable — knowledge base disabled</span>
                </div>
                <p className='text-xs text-muted-foreground'>{embedStatus.error}</p>
                {embedStatus.error?.includes('OpenRouter') || embedStatus.error?.includes('404') ? (
                  <div className='mt-2 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-400'>
                    <strong>Suggestion:</strong> Set <code className='font-mono'>EMBEDDING_API_BASE</code> to a provider that supports embeddings:
                    <ul className='mt-1 space-y-0.5 pl-3'>
                      <li><code className='font-mono text-[#14FFF7]'>https://api.openai.com/v1</code> + <code className='font-mono text-[#14FFF7]'>text-embedding-3-small</code></li>
                      <li><code className='font-mono text-[#14FFF7]'>http://localhost:11434/v1</code> + <code className='font-mono text-[#14FFF7]'>nomic-embed-text</code> (Ollama, free &amp; local)</li>
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <Button
            variant='outline'
            size='sm'
            className='shrink-0 text-xs'
            disabled={checkingEmbed}
            onClick={checkEmbedding}
          >
            {checkingEmbed
              ? <><IconLoader2 className='mr-1 h-3 w-3 animate-spin' />Checking...</>
              : <><IconRefresh className='mr-1 h-3 w-3' />{embedStatus ? 'Recheck' : 'Check'}</>
            }
          </Button>
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {providers.map((provider) => (
          <Card
            key={provider.id}
            className='group border-border/50 transition-colors hover:border-[#14FFF7]/40'
          >
            <CardHeader className='pb-3'>
              <div className='flex items-start justify-between'>
                <CardTitle className='text-base'>{provider.name}</CardTitle>
                <div className='flex items-center gap-1'>
                  <Badge
                    variant='outline'
                    className={
                      provider.is_enabled
                        ? 'border-[#56D090]/30 bg-[#56D090]/20 text-[#56D090]'
                        : 'bg-muted text-muted-foreground'
                    }
                  >
                    {provider.is_enabled ? 'Active' : 'Disabled'}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 opacity-0 group-hover:opacity-100'
                      >
                        <IconDotsVertical className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={() => {
                          setAddModelProvider(provider);
                          setModelName('');
                          setModelType('llm');
                        }}
                      >
                        <IconPlus className='mr-2 h-4 w-4' />
                        Add Model
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(provider)}>
                        <IconPencil className='mr-2 h-4 w-4' />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteProvider(provider)}
                        className='text-red-400 focus:text-red-400'
                      >
                        <IconTrash className='mr-2 h-4 w-4' />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className='space-y-2 text-xs text-muted-foreground'>
                <div className='flex justify-between'>
                  <span>Type</span>
                  <span className='font-mono'>{provider.provider_type}</span>
                </div>
                {provider.base_url && (
                  <div className='flex justify-between'>
                    <span>URL</span>
                    <span className='max-w-[200px] truncate font-mono'>
                      {provider.base_url}
                    </span>
                  </div>
                )}
                {provider.is_default && (
                  <Badge
                    variant='outline'
                    className='mt-1 border-[#9A66FF]/30 bg-[#9A66FF]/10 text-[#9A66FF]'
                  >
                    Default
                  </Badge>
                )}
              </div>
              {provider.models && provider.models.length > 0 && (
                <div className='mt-3 flex flex-wrap gap-1'>
                  {provider.models.map((m) => (
                    <Badge
                      key={m.id}
                      variant='secondary'
                      className='group/model font-mono text-[10px]'
                    >
                      {m.model_name}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveModel(provider.id, m.id);
                        }}
                        className='ml-1 hidden rounded-full hover:text-red-400 group-hover/model:inline-flex'
                      >
                        <IconX className='h-3 w-3' />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {providers.length === 0 && (
        <div className='flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50'>
          <p className='text-muted-foreground'>No providers configured.</p>
        </div>
      )}

      {/* Create Provider Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className='flex max-h-[90vh] max-w-lg flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>
              Connect a new LLM backend to power your agents.
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 flex-1 space-y-4 overflow-y-auto py-2'>
            <div className='space-y-2'>
              <Label>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder='My OpenAI Key'
              />
            </div>
            <div className='space-y-2'>
              <Label>Provider Type</Label>
              <Select value={formData.provider_type} onValueChange={handleProviderTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      {pt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>Base URL</Label>
              <Input
                value={formData.base_url || ''}
                onChange={(e) => {
                  setFormData({ ...formData, base_url: e.target.value });
                  setTestStatus('idle');
                }}
                placeholder='https://api.openai.com/v1'
              />
            </div>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label>API Key</Label>
                {formData.base_url && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs text-[#14FFF7] hover:text-[#14FFF7]'
                    disabled={testStatus === 'testing'}
                    onClick={handleTestConnection}
                  >
                    {testStatus === 'testing' ? (
                      <><IconLoader2 className='mr-1 h-3 w-3 animate-spin' />Testing...</>
                    ) : (
                      <><IconPlug className='mr-1 h-3 w-3' />Test Connection</>
                    )}
                  </Button>
                )}
              </div>
              <Input
                type='password'
                value={formData.api_key || ''}
                onChange={(e) => {
                  setFormData({ ...formData, api_key: e.target.value });
                  setTestStatus('idle');
                }}
                placeholder={PROVIDER_DEFAULTS[formData.provider_type]?.placeholder ?? 'API key'}
              />
            </div>

            {/* Test result */}
            {testStatus === 'ok' && (
              <div className='rounded-md border border-[#56D090]/30 bg-[#56D090]/10 p-3'>
                <div className='mb-2 flex items-center gap-2 text-xs font-medium text-[#56D090]'>
                  <IconCheck className='h-3.5 w-3.5' />
                  Connected · {testModels.length} model{testModels.length !== 1 ? 's' : ''} available
                </div>
                {testModels.length > 0 && (
                  <>
                    <p className='mb-2 text-[11px] text-muted-foreground'>
                      Select models to register (all selected by default):
                    </p>
                    <div className='flex flex-wrap gap-1.5'>
                      {testModels.map((m) => (
                        <button
                          key={m}
                          onClick={() => toggleModel(m)}
                          className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                            selectedModels.has(m)
                              ? 'bg-[#14FFF7]/20 text-[#14FFF7] ring-1 ring-[#14FFF7]/40'
                              : 'bg-muted/50 text-muted-foreground line-through'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <p className='mt-2 text-[10px] text-muted-foreground'>
                      {selectedModels.size} of {testModels.length} selected
                    </p>
                  </>
                )}
              </div>
            )}
            {testStatus === 'error' && (
              <div className='rounded-md border border-red-500/30 bg-red-500/10 p-3'>
                <p className='text-xs text-red-400'>
                  <span className='font-medium'>Connection failed: </span>{testError}
                </p>
              </div>
            )}

            <div className='flex items-center gap-2'>
              <Switch
                checked={formData.is_default || false}
                onCheckedChange={(v) => setFormData({ ...formData, is_default: v })}
              />
              <Label>Set as default provider</Label>
            </div>
          </div>
          <DialogFooter className='shrink-0'>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !formData.name || !formData.provider_type}
              className='bg-[#14FFF7] text-[#0A0D11] hover:bg-[#14FFF7]/90'
            >
              {saving ? 'Creating...' : selectedModels.size > 0 ? `Create + ${selectedModels.size} model${selectedModels.size !== 1 ? 's' : ''}` : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Provider Dialog */}
      <Dialog
        open={!!editProvider}
        onOpenChange={(o) => !o && setEditProvider(null)}
      >
        <DialogContent className='max-w-lg max-h-[90vh] flex flex-col'>
          <DialogHeader className='shrink-0'>
            <DialogTitle>Edit Provider</DialogTitle>
            <DialogDescription>
              Update provider configuration. Leave API key blank to keep
              existing.
            </DialogDescription>
          </DialogHeader>
          <div className='overflow-y-auto flex-1 min-h-0 space-y-4 py-2'>
            <div className='space-y-2'>
              <Label>Name</Label>
              <Input
                value={editData.name}
                onChange={(e) =>
                  setEditData({ ...editData, name: e.target.value })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label>Base URL</Label>
              <Input
                value={editData.base_url}
                onChange={(e) =>
                  setEditData({ ...editData, base_url: e.target.value })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label>API Key (leave blank to keep existing)</Label>
              <Input
                type='password'
                value={editData.api_key}
                onChange={(e) =>
                  setEditData({ ...editData, api_key: e.target.value })
                }
                placeholder='••••••••'
              />
            </div>
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <Switch
                  checked={editData.is_enabled}
                  onCheckedChange={(v) =>
                    setEditData({ ...editData, is_enabled: v })
                  }
                />
                <Label>Enabled</Label>
              </div>
              <div className='flex items-center gap-2'>
                <Switch
                  checked={editData.is_default}
                  onCheckedChange={(v) =>
                    setEditData({ ...editData, is_default: v })
                  }
                />
                <Label>Default</Label>
              </div>
            </div>
          </div>
          <DialogFooter className='shrink-0'>
            <Button
              variant='outline'
              onClick={() => setEditProvider(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={saving || !editData.name}
              className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
            >
              {saving ? 'Saving...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteProvider}
        onOpenChange={(o) => !o && setDeleteProvider(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Provider</DialogTitle>
            <DialogDescription>
              Delete{' '}
              <span className='font-semibold'>{deleteProvider?.name}</span>?
              Agents using this provider will need to be reconfigured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setDeleteProvider(null)}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Model Dialog */}
      <Dialog
        open={!!addModelProvider}
        onOpenChange={(o) => {
          if (!o) {
            setAddModelProvider(null);
            setLiveModelsList([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add Model to {addModelProvider?.name}
            </DialogTitle>
            <DialogDescription>
              Register a model that this provider makes available.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-2'>
            {/* Live model fetch */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label className='text-xs text-muted-foreground'>Available from endpoint</Label>
                <div className='flex items-center gap-1'>
                  {liveModelsList.length > 0 && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 px-2 text-xs text-[#56D090]'
                      disabled={saving}
                      onClick={handleSyncAll}
                    >
                      {saving ? 'Syncing...' : `Sync All (${liveModelsList.filter((m) => !addModelProvider?.models?.some((pm) => pm.model_name === m)).length} new)`}
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs text-[#14FFF7]'
                    disabled={fetchingLive}
                    onClick={() => addModelProvider && fetchLiveModels(addModelProvider)}
                  >
                    <IconRefresh className={`mr-1 h-3 w-3 ${fetchingLive ? 'animate-spin' : ''}`} />
                    {fetchingLive ? 'Fetching...' : 'Fetch'}
                  </Button>
                </div>
              </div>
              {liveModelsList.length > 0 && (
                <div className='flex flex-wrap gap-1.5 rounded-md border border-border/40 bg-muted/20 p-2'>
                  {liveModelsList.map((m) => {
                    const alreadyAdded = addModelProvider?.models?.some((pm) => pm.model_name === m);
                    return (
                      <button
                        key={m}
                        disabled={alreadyAdded}
                        onClick={() => { if (!alreadyAdded) setModelName(m); }}
                        className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          alreadyAdded
                            ? 'cursor-default bg-muted/40 text-muted-foreground/40 line-through'
                            : modelName === m
                              ? 'bg-[#14FFF7]/20 text-[#14FFF7] ring-1 ring-[#14FFF7]/40'
                              : 'bg-muted/50 text-foreground hover:bg-[#14FFF7]/10 hover:text-[#14FFF7]'
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className='space-y-2'>
              <Label>Model Name</Label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder='gpt-4o'
                className='font-mono'
              />
            </div>
            <div className='space-y-2'>
              <Label>Model Type</Label>
              <Select value={modelType} onValueChange={setModelType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((mt) => (
                    <SelectItem key={mt.value} value={mt.value}>
                      {mt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => { setAddModelProvider(null); setLiveModelsList([]); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddModel}
              disabled={saving || !modelName.trim()}
              className='bg-[#14FFF7] text-[#0A0D11] hover:bg-[#14FFF7]/90'
            >
              {saving ? 'Adding...' : 'Add Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
