'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { IconDeviceFloppy, IconLoader2 } from '@tabler/icons-react';
import api, { User } from '@/lib/api';
import { AvatarUpload } from '@/components/avatar-upload';

export default function ProfilePage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

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
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

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
    </div>
  );
}
