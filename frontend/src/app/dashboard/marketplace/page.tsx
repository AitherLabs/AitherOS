'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconSearch,
  IconSparkles,
  IconTool
} from '@tabler/icons-react';
import api, { Agent, MCPServer, Workforce } from '@/lib/api';
import { EntityAvatar, EntityAvatarStack } from '@/components/entity-avatar';
import {
  marketplaceCatalog,
  categoryMeta,
  MarketplaceItem,
  MarketplaceCategory
} from '@/lib/marketplace-catalog';

export default function MarketplacePage() {
  const { data: session } = useSession();

  // Data
  const [workforces, setWorkforces] = useState<Workforce[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsMap, setAgentsMap] = useState<Record<string, Agent>>({});
  const [installedServers, setInstalledServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);

  // Browse state
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MarketplaceCategory | 'all'>('all');

  // Install dialog state
  const [installItem, setInstallItem] = useState<MarketplaceItem | null>(null);
  const [installStep, setInstallStep] = useState(0);
  const [installCreds, setInstallCreds] = useState<Record<string, string>>({});
  const [installWorkforceId, setInstallWorkforceId] = useState('');
  const [installAgentIds, setInstallAgentIds] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const [wfRes, agRes, mcpRes] = await Promise.all([
        api.listWorkforces(),
        api.listAgents(),
        api.listMCPServers()
      ]);
      setWorkforces(wfRes.data || []);
      setAgents(agRes.data || []);
      const map: Record<string, Agent> = {};
      for (const a of agRes.data || []) map[a.id] = a;
      setAgentsMap(map);
      setInstalledServers(mcpRes.data || []);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter catalog
  const filtered = marketplaceCatalog.filter((item) => {
    if (activeCategory !== 'all' && item.category !== activeCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q))
      );
    }
    return true;
  });

  const featured = marketplaceCatalog.filter((i) => i.featured);

  function isInstalled(item: MarketplaceItem): boolean {
    return installedServers.some(
      (s) => s.name.toLowerCase() === item.name.toLowerCase()
    );
  }

  function openInstall(item: MarketplaceItem) {
    setInstallItem(item);
    setInstallStep(0);
    setInstallCreds({});
    setInstallWorkforceId('');
    setInstallAgentIds([]);
    setInstallSuccess(false);
    setInstalling(false);
    setToolsExpanded(false);
  }

  function ToolLogo({ item, size = 'md' }: { item: MarketplaceItem; size?: 'sm' | 'md' | 'lg' }) {
    const dims = size === 'lg' ? 'h-16 w-16 rounded-2xl text-3xl' : size === 'md' ? 'h-12 w-12 rounded-xl text-2xl' : 'h-10 w-10 rounded-xl text-xl';
    const imgSize = size === 'lg' ? 28 : size === 'md' ? 22 : 18;
    return (
      <div
        className={`flex items-center justify-center ${dims} shrink-0`}
        style={{ backgroundColor: item.color + '18' }}
      >
        {item.logoUrl ? (
          <img
            src={item.logoUrl}
            alt={item.name}
            width={imgSize}
            height={imgSize}
            className='opacity-90'
            style={{ color: item.color }}
          />
        ) : (
          <span>{item.icon}</span>
        )}
      </div>
    );
  }

  function toggleInstallAgent(agentId: string) {
    setInstallAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  }

  async function handleInstall() {
    if (!installItem) return;
    setInstalling(true);
    try {
      // 1. Create the MCP server
      // Determine which credential keys are used as arg placeholders
      const argPlaceholderKeys = new Set<string>();
      for (const arg of installItem.args) {
        const matches = arg.match(/\{\{(\w+)\}\}/g);
        if (matches) {
          for (const m of matches) argPlaceholderKeys.add(m.slice(2, -2));
        }
      }

      // Only add credentials to env_vars if they're NOT used as arg placeholders
      const envVars: Record<string, string> = {};
      for (const cred of installItem.credentials) {
        if (installCreds[cred.key] && !argPlaceholderKeys.has(cred.key)) {
          envVars[cred.key] = installCreds[cred.key];
        }
      }

      // Substitute {{KEY}} placeholders in args with credential values
      const resolvedArgs = installItem.args.map((arg) => {
        let result = arg;
        for (const [key, value] of Object.entries(installCreds)) {
          result = result.replace(`{{${key}}}`, value);
        }
        return result;
      });

      const createRes = await api.createMCPServer({
        name: installItem.name,
        description: installItem.description,
        transport: installItem.transport,
        command: installItem.command,
        args: resolvedArgs,
        url: installItem.url,
        env_vars: Object.keys(envVars).length > 0 ? envVars : undefined
      });

      const serverId = createRes.data?.id;
      if (!serverId) throw new Error('Failed to create MCP server');

      // 2. Attach to workforce if selected
      if (installWorkforceId) {
        try {
          await api.attachMCPServer(installWorkforceId, serverId);
        } catch (err) {
          console.error('Attach to workforce failed:', err);
        }

        // 3. Grant tools to selected agents
        for (const agentId of installAgentIds) {
          try {
            await api.setAgentTools(agentId, serverId, []);
          } catch (err) {
            console.error(`Grant tools to agent ${agentId} failed:`, err);
          }
        }
      }

      // 4. Discover tools
      try {
        await api.discoverMCPTools(serverId);
      } catch {
        // Non-fatal — discovery may fail if server isn't reachable
      }

      setInstallSuccess(true);
      await loadData();
    } catch (err) {
      console.error('Install failed:', err);
    } finally {
      setInstalling(false);
    }
  }

  // Determine max steps based on item
  function getMaxSteps(): number {
    if (!installItem) return 0;
    const hasCreds = installItem.credentials.length > 0;
    // Steps: 0=overview, 1=creds (if needed), 2=workforce+agents, 3=confirm (not separate — part of last step)
    return hasCreds ? 2 : 1;
  }

  function canContinue(): boolean {
    if (!installItem) return false;
    const hasCreds = installItem.credentials.length > 0;

    if (installStep === 0) return true; // Overview → always continue

    if (hasCreds && installStep === 1) {
      // Check required creds
      return installItem.credentials
        .filter((c) => c.required)
        .every((c) => installCreds[c.key]?.trim());
    }
    return true;
  }

  if (loading) {
    return (
      <div className='flex h-[50vh] items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#9A66FF]/30 border-t-[#9A66FF]' />
      </div>
    );
  }

  return (
    <div className='space-y-8 p-6'>
      {/* Header */}
      <div className='flex items-end justify-between'>
        <div>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#9A66FF] to-[#EC4899] text-lg'>
              <IconSparkles className='h-5 w-5 text-white' />
            </div>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>Marketplace</h2>
              <p className='text-muted-foreground'>
                Pre-built tool packs for your workforces. Install with one click.
              </p>
            </div>
          </div>
        </div>
        <div className='relative w-72'>
          <IconSearch className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            placeholder='Search tools...'
            className='pl-9'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Featured Banner (only when no filters active) */}
      {activeCategory === 'all' && !search && featured.length > 0 && (
        <div className='grid gap-4 md:grid-cols-3'>
          {featured.map((item) => {
            const installed = isInstalled(item);
            return (
              <Card
                key={item.id}
                className='group relative cursor-pointer overflow-hidden border-border/50 transition-all hover:border-[var(--item-color)]/50 hover:shadow-lg hover:shadow-[var(--item-color)]/10'
                style={{ '--item-color': item.color } as React.CSSProperties}
                onClick={() => !installed && openInstall(item)}
              >
                <div
                  className='absolute inset-0 opacity-[0.03] transition-opacity group-hover:opacity-[0.06]'
                  style={{ background: `linear-gradient(135deg, ${item.color}, transparent)` }}
                />
                <CardHeader className='relative pb-2'>
                  <div className='flex items-center gap-3'>
                    <ToolLogo item={item} size='md' />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <CardTitle className='text-base'>{item.name}</CardTitle>
                        {installed && (
                          <Badge className='bg-[#56D090]/15 text-[#56D090] border-[#56D090]/30 text-[10px]'>
                            <IconCheck className='mr-0.5 h-3 w-3' /> Installed
                          </Badge>
                        )}
                      </div>
                      <CardDescription className='text-[10px]'>
                        by {item.author}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='relative'>
                  <p className='text-sm text-muted-foreground line-clamp-2'>
                    {item.description}
                  </p>
                  <div className='mt-3 flex items-center gap-2'>
                    <Badge variant='outline' className='text-[10px]'>
                      <IconTool className='mr-0.5 h-3 w-3' />
                      {item.tools.length} tools
                    </Badge>
                    <Badge
                      variant='outline'
                      className='text-[10px]'
                      style={{ borderColor: item.color + '40', color: item.color }}
                    >
                      {categoryMeta[item.category].label}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Category Tabs */}
      <div className='flex items-center gap-2 overflow-x-auto'>
        <button
          onClick={() => setActiveCategory('all')}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition-all ${
            activeCategory === 'all'
              ? 'bg-[#9A66FF] text-white'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
        >
          All Tools
        </button>
        {(Object.keys(categoryMeta) as MarketplaceCategory[]).map((cat) => {
          const meta = categoryMeta[cat];
          const count = marketplaceCatalog.filter((i) => i.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-all ${
                activeCategory === cat
                  ? 'text-white'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
              style={activeCategory === cat ? { backgroundColor: meta.color } : {}}
            >
              <span>{meta.icon}</span>
              {meta.label}
              <span className='text-xs opacity-60'>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Tool Grid */}
      {filtered.length === 0 ? (
        <div className='flex h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50'>
          <p className='text-muted-foreground'>No tools match your search.</p>
          <Button variant='link' onClick={() => { setSearch(''); setActiveCategory('all'); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {filtered.map((item) => {
            const installed = isInstalled(item);
            return (
              <Card
                key={item.id}
                className='group cursor-pointer border-border/50 transition-all hover:border-[var(--item-color)]/40 hover:shadow-md hover:shadow-[var(--item-color)]/5'
                style={{ '--item-color': item.color } as React.CSSProperties}
                onClick={() => !installed && openInstall(item)}
              >
                <CardHeader className='pb-2'>
                  <div className='flex items-center gap-3'>
                    <div className='transition-transform group-hover:scale-110'>
                      <ToolLogo item={item} size='sm' />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <CardTitle className='text-sm'>{item.name}</CardTitle>
                        {installed && (
                          <Badge className='bg-[#56D090]/15 text-[#56D090] border-[#56D090]/30 text-[9px] px-1.5'>
                            <IconCheck className='mr-0.5 h-2.5 w-2.5' /> Installed
                          </Badge>
                        )}
                      </div>
                      <CardDescription className='text-[10px]'>
                        {item.author}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className='mb-3 text-xs text-muted-foreground line-clamp-2'>
                    {item.description}
                  </p>
                  <div className='flex flex-wrap gap-1.5'>
                    <Badge variant='outline' className='text-[9px]'>
                      {item.tools.length} tools
                    </Badge>
                    {item.credentials.length > 0 && (
                      <Badge variant='outline' className='text-[9px] text-[#FFBF47] border-[#FFBF47]/30'>
                        🔑 Credentials
                      </Badge>
                    )}
                    {item.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant='outline' className='text-[9px]'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Install Dialog ── */}
      <Dialog open={!!installItem} onOpenChange={(open) => !open && setInstallItem(null)}>
        {installItem && (
          <DialogContent className='!grid-rows-none max-w-2xl gap-0 p-0 flex flex-col max-h-[85vh] overflow-hidden'>
            <DialogTitle className='sr-only'>{installItem.name}</DialogTitle>
            <DialogDescription className='sr-only'>Install {installItem.name} tool pack</DialogDescription>
            {/* Header */}
            <div className='flex items-center gap-3 border-b px-6 py-4 shrink-0'>
              <ToolLogo item={installItem} size='sm' />
              <div className='flex-1'>
                <h3 className='font-semibold'>{installItem.name}</h3>
                <p className='text-xs text-muted-foreground'>by {installItem.author}</p>
              </div>
              {isInstalled(installItem) && (
                <Badge className='bg-[#56D090]/15 text-[#56D090] border-[#56D090]/30 text-[10px]'>
                  <IconCheck className='mr-0.5 h-3 w-3' /> Already Installed
                </Badge>
              )}
            </div>

            {/* Step Indicator */}
            {!installSuccess && (
              <div className='flex items-center gap-2 border-b bg-muted/30 px-6 py-3 shrink-0'>
                {(() => {
                  const hasCreds = installItem.credentials.length > 0;
                  const labels = hasCreds
                    ? ['Overview', 'Credentials', 'Deploy']
                    : ['Overview', 'Deploy'];
                  return labels.map((label, i) => (
                    <div key={label} className='flex items-center gap-2'>
                      <div
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium transition-all ${
                          i === installStep
                            ? 'text-white'
                            : i < installStep
                              ? 'bg-[#56D090]/20 text-[#56D090]'
                              : 'bg-muted text-muted-foreground'
                        }`}
                        style={i === installStep ? { backgroundColor: installItem.color } : {}}
                      >
                        {i < installStep ? '\u2713' : i + 1}
                      </div>
                      <span className={`text-xs ${i === installStep ? 'font-medium' : 'text-muted-foreground'}`}>
                        {label}
                      </span>
                      {i < labels.length - 1 && (
                        <IconArrowRight className='h-3 w-3 text-muted-foreground/30' />
                      )}
                    </div>
                  ));
                })()}
              </div>
            )}

            {/* Content */}
            <ScrollArea className='flex-1 min-h-0'>
            <div className='px-6 py-6'>
              {installSuccess ? (
                /* ── Success ── */
                <div className='flex flex-col items-center gap-4 py-6 text-center'>
                  <ToolLogo item={installItem} size='lg' />
                  <div>
                    <h3 className='text-lg font-semibold'>{installItem.name} installed!</h3>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      The tool pack has been added to your MCP servers
                      {installWorkforceId ? ' and attached to your workforce' : ''}.
                    </p>
                  </div>
                  <div className='flex gap-2'>
                    <Button variant='outline' onClick={() => setInstallItem(null)}>
                      Close
                    </Button>
                    <Button
                      className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
                      onClick={() => {
                        setInstallItem(null);
                        window.location.href = '/dashboard/mcp';
                      }}
                    >
                      View MCP Servers
                    </Button>
                  </div>
                </div>
              ) : installStep === 0 ? (
                /* ── Step 0: Overview ── */
                <div className='space-y-5'>
                  <div>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {installItem.longDescription}
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <button
                      type='button'
                      className='flex w-full items-center justify-between py-1 text-left'
                      onClick={() => setToolsExpanded(!toolsExpanded)}
                    >
                      <h4 className='text-sm font-semibold'>
                        Included Tools ({installItem.tools.length})
                      </h4>
                      <IconChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${toolsExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {toolsExpanded && (
                      <div className='mt-3 grid gap-1.5'>
                        {installItem.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className='flex items-start gap-2.5 rounded-lg border border-border/30 px-3 py-2'
                          >
                            <IconTool
                              className='mt-0.5 h-3.5 w-3.5 shrink-0'
                              style={{ color: installItem.color }}
                            />
                            <div>
                              <p className='text-xs font-medium font-mono'>{tool.name}</p>
                              <p className='text-[10px] text-muted-foreground'>
                                {tool.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className='flex flex-wrap gap-1.5'>
                    {installItem.tags.map((tag) => (
                      <Badge key={tag} variant='outline' className='text-[10px]'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {installItem.docsUrl && (
                    <a
                      href={installItem.docsUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex items-center gap-1 text-xs text-muted-foreground hover:text-[#9A66FF] transition-colors'
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconExternalLink className='h-3 w-3' />
                      View documentation
                    </a>
                  )}
                </div>
              ) : installItem.credentials.length > 0 && installStep === 1 ? (
                /* ── Step 1: Credentials (only if needed) ── */
                <div className='space-y-5'>
                  <div>
                    <h4 className='text-lg font-semibold'>Configure credentials</h4>
                    <p className='text-sm text-muted-foreground'>
                      {installItem.name} requires API keys or tokens to function. These are stored
                      securely as environment variables.
                    </p>
                  </div>
                  <div className='space-y-4'>
                    {installItem.credentials.map((cred) => (
                      <div key={cred.key} className='space-y-2'>
                        <Label className='flex items-center gap-1.5'>
                          {cred.sensitive && <span className='text-[#FFBF47]'>🔑</span>}
                          {cred.label}
                          {cred.required && <span className='text-red-400'>*</span>}
                        </Label>
                        <Input
                          type={cred.sensitive ? 'password' : 'text'}
                          placeholder={cred.placeholder}
                          value={installCreds[cred.key] || ''}
                          onChange={(e) =>
                            setInstallCreds((prev) => ({ ...prev, [cred.key]: e.target.value }))
                          }
                          className='font-mono text-xs'
                        />
                        {cred.helpText && (
                          <p className='text-[10px] text-muted-foreground'>{cred.helpText}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── Last Step: Deploy (workforce + agents) ── */
                <div className='space-y-5'>
                  <div>
                    <h4 className='text-lg font-semibold'>Deploy to a workforce</h4>
                    <p className='text-sm text-muted-foreground'>
                      Optionally attach this tool pack to a workforce and grant access to specific agents.
                      You can also skip this and configure it later.
                    </p>
                  </div>

                  {/* Workforce selection */}
                  <div className='space-y-3'>
                    <Label>Workforce</Label>
                    {workforces.length === 0 ? (
                      <div className='rounded-lg border border-dashed border-border/50 p-4 text-center'>
                        <p className='text-xs text-muted-foreground'>
                          No workforces yet. The tool will be installed as an MCP server
                          that you can attach later.
                        </p>
                      </div>
                    ) : (
                      <div className='grid gap-2'>
                        {workforces.map((wf) => {
                          const selected = installWorkforceId === wf.id;
                          return (
                            <button
                              key={wf.id}
                              type='button'
                              className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
                                selected
                                  ? 'border-[var(--wf-color)] bg-[var(--wf-color)]/5'
                                  : 'border-border/50 hover:border-border'
                              }`}
                              style={{ '--wf-color': wf.color || '#9A66FF' } as React.CSSProperties}
                              onClick={() => {
                                if (selected) {
                                  setInstallWorkforceId('');
                                  setInstallAgentIds([]);
                                } else {
                                  setInstallWorkforceId(wf.id);
                                  setInstallAgentIds([]);
                                }
                              }}
                            >
                              <EntityAvatar
                                icon={wf.icon || '\ud83d\udc65'}
                                color={wf.color || '#9A66FF'}
                                size='md'
                              />
                              <div className='flex-1 min-w-0'>
                                <p className='text-sm font-medium'>{wf.name}</p>
                                <p className='text-[10px] text-muted-foreground line-clamp-1'>
                                  {wf.description || wf.objective}
                                </p>
                              </div>
                              <div
                                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                                  selected
                                    ? 'border-[var(--wf-color)] bg-[var(--wf-color)] text-white'
                                    : 'border-border'
                                }`}
                              >
                                {selected && <span className='text-[10px]'>\u2713</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Agent selection (only if workforce selected) */}
                  {installWorkforceId && (
                    <div className='space-y-3'>
                      <Label>Grant tool access to agents</Label>
                      {(() => {
                        const wf = workforces.find((w) => w.id === installWorkforceId);
                        const wfAgentIds = wf?.agent_ids || [];
                        const wfAgents = wfAgentIds.map((id) => agentsMap[id]).filter(Boolean);
                        if (wfAgents.length === 0) {
                          return (
                            <p className='text-xs text-muted-foreground'>
                              This workforce has no agents. Add agents first, then configure tool access from the workforce detail page.
                            </p>
                          );
                        }
                        return (
                          <div className='grid gap-2'>
                            <button
                              type='button'
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                                installAgentIds.length === wfAgents.length
                                  ? 'border-[#9A66FF] bg-[#9A66FF]/5'
                                  : 'border-border/50 hover:border-border'
                              }`}
                              onClick={() => {
                                if (installAgentIds.length === wfAgents.length) {
                                  setInstallAgentIds([]);
                                } else {
                                  setInstallAgentIds(wfAgents.map((a) => a.id));
                                }
                              }}
                            >
                              <div
                                className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                                  installAgentIds.length === wfAgents.length
                                    ? 'border-[#9A66FF] bg-[#9A66FF] text-white'
                                    : 'border-border'
                                }`}
                              >
                                {installAgentIds.length === wfAgents.length && (
                                  <span className='text-[8px]'>\u2713</span>
                                )}
                              </div>
                              <span className='font-medium'>Select all agents</span>
                            </button>
                            {wfAgents.map((agent) => {
                              const selected = installAgentIds.includes(agent.id);
                              return (
                                <button
                                  key={agent.id}
                                  type='button'
                                  className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition-all ${
                                    selected
                                      ? 'border-[var(--a-color)]/60 bg-[var(--a-color)]/5'
                                      : 'border-border/50 hover:border-border'
                                  }`}
                                  style={{ '--a-color': agent.color } as React.CSSProperties}
                                  onClick={() => toggleInstallAgent(agent.id)}
                                >
                                  <EntityAvatar icon={agent.icon} color={agent.color} size='sm' />
                                  <div className='flex-1 min-w-0'>
                                    <p className='text-xs font-medium'>{agent.name}</p>
                                    <p className='text-[10px] text-muted-foreground'>
                                      {agent.model} \u00b7 {agent.strategy}
                                    </p>
                                  </div>
                                  <div
                                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                                      selected
                                        ? 'border-[var(--a-color)] bg-[var(--a-color)] text-white'
                                        : 'border-border'
                                    }`}
                                  >
                                    {selected && <span className='text-[10px]'>\u2713</span>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {installAgentIds.length > 0 && (
                        <div className='flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2'>
                          <EntityAvatarStack
                            entities={installAgentIds
                              .map((id) => agentsMap[id])
                              .filter(Boolean)
                              .map((a) => ({ icon: a.icon, color: a.color, name: a.name, id: a.id }))}
                            size='xs'
                          />
                          <span className='text-xs text-muted-foreground'>
                            {installAgentIds.length} agent{installAgentIds.length !== 1 ? 's' : ''} will get
                            access to all {installItem.tools.length} tools
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            </ScrollArea>

            {/* Footer */}
            {!installSuccess && (
              <div className='flex items-center justify-between border-t px-6 py-4 shrink-0'>
                <div>
                  {installStep > 0 && (
                    <Button variant='ghost' onClick={() => setInstallStep(installStep - 1)}>
                      <IconArrowLeft className='mr-1 h-4 w-4' />
                      Back
                    </Button>
                  )}
                </div>
                <div className='flex gap-2'>
                  <Button variant='outline' onClick={() => setInstallItem(null)}>
                    Cancel
                  </Button>
                  {installStep < getMaxSteps() ? (
                    <Button
                      onClick={() => setInstallStep(installStep + 1)}
                      disabled={!canContinue()}
                      style={{ backgroundColor: installItem.color }}
                      className='hover:opacity-90 text-white'
                    >
                      Continue
                      <IconArrowRight className='ml-1 h-4 w-4' />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleInstall}
                      disabled={installing}
                      style={{ backgroundColor: installItem.color }}
                      className='hover:opacity-90 text-white'
                    >
                      {installing && <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />}
                      <IconDownload className='mr-1 h-4 w-4' />
                      {installing ? 'Installing...' : 'Install'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
