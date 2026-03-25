'use client';

import { useEffect, useState } from 'react';
import api, {
  MCPServer,
  CreateMCPServerRequest
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Plus,
  Server,
  Trash2,
  RefreshCw,
  Terminal,
  Globe,
  Wrench,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
  Pencil,
  Loader2,
  Key
} from 'lucide-react';
import { getMcpBrandIconUrl } from '@/lib/mcp-brands';

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MCPServer | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<MCPServer | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    transport: 'stdio' | 'sse' | 'streamable_http';
    command: string;
    url: string;
  }>({ name: '', description: '', transport: 'stdio', command: '', url: '' });
  const [editArgsText, setEditArgsText] = useState('');
  const [editEnvText, setEditEnvText] = useState('');
  const [editing, setEditing] = useState(false);

  // Create form state
  const [form, setForm] = useState<CreateMCPServerRequest>({
    name: '',
    description: '',
    transport: 'stdio',
    command: '',
    args: [],
    url: '',
    env_vars: {}
  });
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadServers();
  }, []);

  async function loadServers() {
    try {
      setLoading(true);
      const res = await api.listMCPServers();
      setServers(res.data || []);
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    try {
      setCreating(true);
      const args = argsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const envVars: Record<string, string> = {};
      envText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((line) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envVars[line.slice(0, idx)] = line.slice(idx + 1);
          }
        });

      await api.createMCPServer({
        ...form,
        args,
        env_vars: envVars
      });
      setCreateOpen(false);
      setForm({
        name: '',
        description: '',
        transport: 'stdio',
        command: '',
        args: [],
        url: '',
        env_vars: {}
      });
      setArgsText('');
      setEnvText('');
      loadServers();
    } catch (err) {
      console.error('Failed to create MCP server:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteMCPServer(deleteTarget.id);
      setDeleteTarget(null);
      loadServers();
    } catch (err) {
      console.error('Failed to delete MCP server:', err);
    }
  }

  async function handleDiscover(serverId: string) {
    try {
      setDiscovering(serverId);
      await api.discoverMCPTools(serverId);
      loadServers();
    } catch (err) {
      console.error('Failed to discover tools:', err);
    } finally {
      setDiscovering(null);
    }
  }

  function openEdit(srv: MCPServer) {
    setEditForm({
      name: srv.name,
      description: srv.description || '',
      transport: srv.transport,
      command: srv.command || '',
      url: srv.url || ''
    });
    setEditArgsText((srv.args || []).join('\n'));
    setEditEnvText(
      Object.entries(srv.env_vars || {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    );
    setEditTarget(srv);
  }

  async function handleEdit() {
    if (!editTarget) return;
    try {
      setEditing(true);
      const args = editArgsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const envVars: Record<string, string> = {};
      editEnvText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((line) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envVars[line.slice(0, idx)] = line.slice(idx + 1);
          }
        });
      await api.updateMCPServer(editTarget.id, {
        name: editForm.name,
        description: editForm.description,
        transport: editForm.transport,
        command: editForm.command,
        args,
        url: editForm.url,
        env_vars: envVars
      });
      setEditTarget(null);
      loadServers();
    } catch (err) {
      console.error('Failed to update MCP server:', err);
    } finally {
      setEditing(false);
    }
  }

  async function handleToggle(srv: MCPServer) {
    try {
      await api.updateMCPServer(srv.id, { is_enabled: !srv.is_enabled });
      loadServers();
    } catch (err) {
      console.error('Failed to toggle MCP server:', err);
    }
  }

  function serverIcon(srv: MCPServer) {
    const brandUrl = getMcpBrandIconUrl(srv.name || srv.description || '');
    if (brandUrl) {
      return (
        <img
          src={brandUrl}
          alt={srv.name}
          className='h-5 w-5 object-contain'
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      );
    }
    return transportIconFallback(srv.transport);
  }

  const transportIconFallback = (t: string) => {
    switch (t) {
      case 'stdio':
        return <Terminal className='h-4 w-4' />;
      case 'sse':
      case 'streamable_http':
        return <Globe className='h-4 w-4' />;
      default:
        return <Server className='h-4 w-4' />;
    }
  };

  return (
    <div className='space-y-6 p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>MCP Servers</h2>
          <p className='text-muted-foreground'>
            Manage Model Context Protocol servers that provide tools to your
            agents.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className='mr-2 h-4 w-4' />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent className='max-w-lg'>
            <DialogHeader>
              <DialogTitle>Add MCP Server</DialogTitle>
              <DialogDescription>
                Configure a new MCP server to provide tools for your agents.
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label>Name</Label>
                <Input
                  placeholder='GitHub MCP Server'
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className='space-y-2'>
                <Label>Description</Label>
                <Input
                  placeholder='GitHub API tools for code management'
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label>Transport</Label>
                <Select
                  value={form.transport}
                  onValueChange={(v: 'stdio' | 'sse' | 'streamable_http') =>
                    setForm({ ...form, transport: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='stdio'>
                      <span className='flex items-center gap-2'>
                        <Terminal className='h-3 w-3' /> Stdio (subprocess)
                      </span>
                    </SelectItem>
                    <SelectItem value='sse'>
                      <span className='flex items-center gap-2'>
                        <Globe className='h-3 w-3' /> SSE (HTTP)
                      </span>
                    </SelectItem>
                    <SelectItem value='streamable_http'>
                      <span className='flex items-center gap-2'>
                        <Globe className='h-3 w-3' /> Streamable HTTP
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.transport === 'stdio' ? (
                <>
                  <div className='space-y-2'>
                    <Label>Command</Label>
                    <Input
                      placeholder='npx'
                      value={form.command}
                      onChange={(e) =>
                        setForm({ ...form, command: e.target.value })
                      }
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label>Arguments (one per line)</Label>
                    <Textarea
                      placeholder={'-y\n@modelcontextprotocol/server-github'}
                      rows={3}
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className='space-y-2'>
                  <Label>URL</Label>
                  <Input
                    placeholder='http://localhost:8080/mcp'
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                </div>
              )}
              <div className='space-y-2'>
                <Label>
                  <span className='flex items-center gap-1'>
                    <Key className='h-3 w-3' /> Environment Variables (one per
                    line, KEY=VALUE)
                  </span>
                </Label>
                <Textarea
                  placeholder='GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...'
                  rows={3}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  className='font-mono text-xs'
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !form.name || !form.transport}
              >
                {creating && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                Create Server
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className='flex items-center justify-center py-12'>
          <Loader2 className='h-8 w-8 animate-spin opacity-50' />
        </div>
      ) : servers.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center justify-center py-12'>
            <Server className='text-muted-foreground mb-4 h-12 w-12 opacity-30' />
            <p className='text-muted-foreground text-lg font-medium'>
              No MCP servers configured
            </p>
            <p className='text-muted-foreground mt-1 text-sm'>
              Add an MCP server to give your agents tools like GitHub, file
              system access, and more.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-4'>
          {servers.map((srv) => (
            <Card key={srv.id}>
              <CardHeader className='pb-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${srv.is_enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                    >
                      {serverIcon(srv)}
                    </div>
                    <div>
                      <CardTitle className='flex items-center gap-2 text-lg'>
                        {srv.name}
                        <Badge
                          variant={srv.is_enabled ? 'default' : 'secondary'}
                          className='text-xs'
                        >
                          {srv.is_enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        <Badge variant='outline' className='text-xs'>
                          {srv.transport}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        {srv.description || 'No description'}
                      </CardDescription>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => openEdit(srv)}
                    >
                      <Pencil className='mr-1 h-3 w-3' />
                      Edit
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => handleDiscover(srv.id)}
                      disabled={discovering === srv.id}
                    >
                      {discovering === srv.id ? (
                        <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                      ) : (
                        <RefreshCw className='mr-1 h-3 w-3' />
                      )}
                      Discover Tools
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => handleToggle(srv)}
                    >
                      {srv.is_enabled ? (
                        <PowerOff className='mr-1 h-3 w-3' />
                      ) : (
                        <Power className='mr-1 h-3 w-3' />
                      )}
                      {srv.is_enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant='destructive'
                      size='sm'
                      onClick={() => setDeleteTarget(srv)}
                    >
                      <Trash2 className='h-3 w-3' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        setExpandedServer(
                          expandedServer === srv.id ? null : srv.id
                        )
                      }
                    >
                      {expandedServer === srv.id ? (
                        <ChevronUp className='h-4 w-4' />
                      ) : (
                        <ChevronDown className='h-4 w-4' />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expandedServer === srv.id && (
                <CardContent className='border-t pt-4'>
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                    <div className='space-y-2'>
                      <h4 className='text-sm font-semibold'>Configuration</h4>
                      <div className='bg-muted rounded-md p-3 text-xs'>
                        {srv.transport === 'stdio' ? (
                          <>
                            <div>
                              <span className='text-muted-foreground'>
                                Command:
                              </span>{' '}
                              <code>{srv.command}</code>
                            </div>
                            {srv.args?.length > 0 && (
                              <div>
                                <span className='text-muted-foreground'>
                                  Args:
                                </span>{' '}
                                <code>{srv.args.join(' ')}</code>
                              </div>
                            )}
                          </>
                        ) : (
                          <div>
                            <span className='text-muted-foreground'>
                              URL:
                            </span>{' '}
                            <code>{srv.url}</code>
                          </div>
                        )}
                        {Object.keys(srv.env_vars || {}).length > 0 && (
                          <div className='mt-2'>
                            <span className='text-muted-foreground'>
                              Env vars:
                            </span>
                            {Object.keys(srv.env_vars).map((key) => (
                              <div key={key} className='ml-2'>
                                <code>
                                  {key}=
                                  {key.toLowerCase().includes('token') ||
                                  key.toLowerCase().includes('secret') ||
                                  key.toLowerCase().includes('key')
                                    ? '••••••••'
                                    : srv.env_vars[key]}
                                </code>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className='space-y-2'>
                      <h4 className='text-sm font-semibold'>
                        Discovered Tools ({srv.tools?.length || 0})
                      </h4>
                      {srv.tools && srv.tools.length > 0 ? (
                        <div className='max-h-64 space-y-1 overflow-y-auto'>
                          {srv.tools.map((tool) => (
                            <div
                              key={tool.name}
                              className='bg-muted flex items-start gap-2 rounded-md p-2 text-xs'
                            >
                              <Wrench className='text-muted-foreground mt-0.5 h-3 w-3 shrink-0' />
                              <div>
                                <div className='font-medium'>{tool.name}</div>
                                <div className='text-muted-foreground'>
                                  {tool.description}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className='text-muted-foreground text-xs'>
                          No tools discovered yet. Click &quot;Discover
                          Tools&quot; to connect and list available tools.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.name}&quot; and
              remove it from all workforces. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit MCP Server Dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>Edit MCP Server</DialogTitle>
            <DialogDescription>
              Update the configuration for {editTarget?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label>Description</Label>
              <Input
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label>Transport</Label>
              <Select
                value={editForm.transport}
                onValueChange={(v: 'stdio' | 'sse' | 'streamable_http') =>
                  setEditForm({ ...editForm, transport: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='stdio'>
                    <span className='flex items-center gap-2'>
                      <Terminal className='h-3 w-3' /> Stdio (subprocess)
                    </span>
                  </SelectItem>
                  <SelectItem value='sse'>
                    <span className='flex items-center gap-2'>
                      <Globe className='h-3 w-3' /> SSE (HTTP)
                    </span>
                  </SelectItem>
                  <SelectItem value='streamable_http'>
                    <span className='flex items-center gap-2'>
                      <Globe className='h-3 w-3' /> Streamable HTTP
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.transport === 'stdio' ? (
              <>
                <div className='space-y-2'>
                  <Label>Command</Label>
                  <Input
                    value={editForm.command}
                    onChange={(e) =>
                      setEditForm({ ...editForm, command: e.target.value })
                    }
                  />
                </div>
                <div className='space-y-2'>
                  <Label>Arguments (one per line)</Label>
                  <Textarea
                    rows={3}
                    value={editArgsText}
                    onChange={(e) => setEditArgsText(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className='space-y-2'>
                <Label>URL</Label>
                <Input
                  value={editForm.url}
                  onChange={(e) =>
                    setEditForm({ ...editForm, url: e.target.value })
                  }
                />
              </div>
            )}
            <div className='space-y-2'>
              <Label>
                <span className='flex items-center gap-1'>
                  <Key className='h-3 w-3' /> Environment Variables (KEY=VALUE)
                </span>
              </Label>
              <Textarea
                rows={3}
                value={editEnvText}
                onChange={(e) => setEditEnvText(e.target.value)}
                className='font-mono text-xs'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEdit}
              disabled={editing || !editForm.name}
            >
              {editing && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
