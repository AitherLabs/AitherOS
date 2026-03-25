'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import api, { ActivityEvent } from '@/lib/api';
import { EntityAvatar } from '@/components/entity-avatar';

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ActivityPage() {
  const { data: session } = useSession();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivity = useCallback(async () => {
    try {
      if (session?.accessToken) api.setToken(session.accessToken);
      const res = await api.listActivity(undefined, 100);
      setEvents(res.data || []);
    } catch (err) {
      console.error('Failed to load activity:', err);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

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
        <h2 className='text-2xl font-bold tracking-tight'>Activity</h2>
        <p className='text-muted-foreground'>
          Global audit trail of all actions across workforces.
        </p>
      </div>
      <Separator />

      {events.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-lg border border-dashed border-border/50'>
          <p className='text-muted-foreground'>No activity recorded yet.</p>
        </div>
      ) : (
        <div className='relative ml-4 border-l border-border/40 pl-6'>
          {events.map((evt) => {
            const actionColor =
              (evt.action || '').includes('completed') ? '#56D090' :
              (evt.action || '').includes('failed') ? '#EF4444' :
              (evt.action || '').includes('approved') ? '#56D090' :
              (evt.action || '').includes('rejected') ? '#EF4444' :
              (evt.action || '').includes('started') ? '#9A66FF' :
              (evt.action || '').includes('halted') ? '#FFBF47' :
              (evt.action || '').includes('created') ? '#14FFF7' :
              '#888';
            const actorIcon =
              evt.actor_type === 'user' ? '👤' :
              evt.actor_type === 'agent' ? '🤖' : '⚙️';
            const actorColor =
              evt.actor_type === 'user' ? '#9A66FF' :
              evt.actor_type === 'agent' ? '#14FFF7' : '#FFBF47';
            return (
              <div key={evt.id} className='relative mb-5 pb-1'>
                <div
                  className='absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background'
                  style={{ backgroundColor: actionColor }}
                />
                <div className='flex items-start justify-between gap-4'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <EntityAvatar
                        icon={actorIcon}
                        color={actorColor}
                        name={evt.actor_name || evt.actor_type}
                        size='xs'
                      />
                      <Badge variant='outline' className='text-[10px]' style={{
                        backgroundColor: actionColor + '15',
                        borderColor: actionColor + '30',
                        color: actionColor
                      }}>
                        {(evt.action || '').replace(/\./g, ' ')}
                      </Badge>
                      {evt.actor_name && (
                        <span className='text-xs text-muted-foreground'>
                          by {evt.actor_name}
                        </span>
                      )}
                      {evt.resource_type && (
                        <span className='text-[10px] text-muted-foreground/60'>
                          on {evt.resource_type}
                        </span>
                      )}
                    </div>
                    <p className='mt-1 text-sm text-muted-foreground/80'>
                      {evt.summary || evt.action}
                    </p>
                    {evt.workforce_id && (
                      <p className='mt-0.5 text-[10px] text-muted-foreground/50 font-mono'>
                        workforce: {evt.workforce_id.slice(0, 8)}
                        {evt.execution_id && ` · exec: ${evt.execution_id.slice(0, 8)}`}
                      </p>
                    )}
                  </div>
                  <span className='shrink-0 text-xs text-muted-foreground/50'>
                    {timeAgo(evt.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
