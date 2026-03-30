'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { IconDeviceFloppy, IconLoader2, IconUsers } from '@tabler/icons-react';
import api, { BetaSignup, User } from '@/lib/api';
import { AvatarUpload } from '@/components/avatar-upload';

export default function ProfilePage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Admin: beta signups
  const [betaSignups, setBetaSignups] = useState<BetaSignup[]>([]);
  const [betaLoading, setBetaLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!session?.accessToken) {
      setLoading(false);
      return;
    }
    api.setToken(session.accessToken);
    try {
      const res = await api.me();
      const u = res.data;
      if (u) {
        setUser(u);
        setDisplayName(u.display_name || '');
        setAvatarUrl(u.avatar_url || '');
        if (u.role === 'admin') {
          setBetaLoading(true);
          api.adminListBetaSignups()
            .then(r => setBetaSignups(r.data || []))
            .catch(() => {})
            .finally(() => setBetaLoading(false));
        }
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  async function handleBetaStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
    setUpdatingId(id);
    try {
      await api.adminUpdateBetaSignupStatus(id, status);
      setBetaSignups(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setUpdatingId(null);
    }
  }

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateMe({
        display_name: displayName,
        avatar_url: avatarUrl || undefined
      });
      setHasChanges(false);
      await loadProfile();
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
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
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Profile</h2>
        <p className='text-muted-foreground'>
          Manage your account settings.
        </p>
      </div>
      <Separator />

      <div className='max-w-2xl space-y-6'>
        {/* Account Info (read-only) */}
        <Card className='border-border/50'>
          <CardHeader>
            <CardTitle className='text-base'>Account</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label className='text-muted-foreground'>Email</Label>
                <p className='text-sm font-mono'>{user?.email || '—'}</p>
              </div>
              <div className='space-y-2'>
                <Label className='text-muted-foreground'>Username</Label>
                <p className='text-sm font-mono'>{user?.username || '—'}</p>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label className='text-muted-foreground'>Role</Label>
                <Badge variant='outline' className='text-xs'>
                  {user?.role || 'user'}
                </Badge>
              </div>
              <div className='space-y-2'>
                <Label className='text-muted-foreground'>Status</Label>
                <Badge
                  variant='outline'
                  className='text-xs'
                  style={{
                    backgroundColor: user?.is_active ? '#56D09015' : '#EF444415',
                    borderColor: user?.is_active ? '#56D09030' : '#EF444430',
                    color: user?.is_active ? '#56D090' : '#EF4444'
                  }}
                >
                  {user?.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
            {user?.last_login_at && (
              <div className='space-y-2'>
                <Label className='text-muted-foreground'>Last Login</Label>
                <p className='text-xs text-muted-foreground'>
                  {new Date(user.last_login_at).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editable Fields */}
        <Card className='border-border/50'>
          <CardHeader>
            <CardTitle className='text-base'>Profile</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              <Label>Display Name</Label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setHasChanges(true);
                }}
                placeholder='Your display name'
              />
            </div>
            <div className='space-y-2'>
              <Label>Profile Photo</Label>
              <AvatarUpload
                currentUrl={avatarUrl}
                size='md'
                onUploaded={(url) => { setAvatarUrl(url); setHasChanges(true); }}
              />
            </div>
            <div className='flex justify-end'>
              <Button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className='bg-[#9A66FF] hover:bg-[#9A66FF]/90'
              >
                {saving ? (
                  <IconLoader2 className='mr-1 h-4 w-4 animate-spin' />
                ) : (
                  <IconDeviceFloppy className='mr-1 h-4 w-4' />
                )}
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin-only: Beta Waitlist */}
      {user?.role === 'admin' && (
        <>
          <Separator />
          <div className='max-w-4xl space-y-4'>
            <div className='flex items-center gap-2'>
              <IconUsers className='h-5 w-5 text-[#9A66FF]' />
              <div>
                <h3 className='text-base font-semibold'>Beta Waitlist</h3>
                <p className='text-sm text-muted-foreground'>Closed beta signups from aither.systems</p>
              </div>
              <Badge variant='outline' className='ml-auto text-xs'>
                {betaSignups.length} {betaSignups.length === 1 ? 'signup' : 'signups'}
              </Badge>
            </div>

            <Card className='border-border/50'>
              <CardContent className='p-0'>
                {betaLoading ? (
                  <div className='flex items-center justify-center py-10'>
                    <IconLoader2 className='h-5 w-5 animate-spin text-muted-foreground/50' />
                  </div>
                ) : betaSignups.length === 0 ? (
                  <p className='py-10 text-center text-sm text-muted-foreground/50'>No signups yet.</p>
                ) : (
                  <div className='divide-y divide-border/40'>
                    {betaSignups.map(s => (
                      <div key={s.id} className='flex items-center gap-4 px-4 py-3'>
                        <div className='min-w-0 flex-1 space-y-0.5'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium truncate'>{s.name || '—'}</span>
                            {s.company && (
                              <span className='text-xs text-muted-foreground truncate'>· {s.company}</span>
                            )}
                          </div>
                          <p className='text-xs font-mono text-muted-foreground truncate'>{s.email}</p>
                          <p className='text-[10px] text-muted-foreground/50'>
                            {new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          <Badge
                            variant='outline'
                            className='text-[10px]'
                            style={{
                              backgroundColor: s.status === 'approved' ? '#56D09015' : s.status === 'rejected' ? '#EF444415' : '#FFBF4715',
                              borderColor: s.status === 'approved' ? '#56D09040' : s.status === 'rejected' ? '#EF444440' : '#FFBF4740',
                              color: s.status === 'approved' ? '#56D090' : s.status === 'rejected' ? '#EF4444' : '#FFBF47',
                            }}
                          >
                            {s.status}
                          </Badge>
                          {s.status !== 'approved' && (
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 text-[11px] border-[#56D090]/30 text-[#56D090] hover:bg-[#56D090]/10'
                              disabled={updatingId === s.id}
                              onClick={() => handleBetaStatus(s.id, 'approved')}
                            >
                              {updatingId === s.id ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Approve'}
                            </Button>
                          )}
                          {s.status !== 'rejected' && (
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10'
                              disabled={updatingId === s.id}
                              onClick={() => handleBetaStatus(s.id, 'rejected')}
                            >
                              {updatingId === s.id ? <IconLoader2 className='h-3 w-3 animate-spin' /> : 'Reject'}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
