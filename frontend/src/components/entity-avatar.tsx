'use client';

import { cn } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

function resolveAvatarUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}

interface EntityAvatarProps {
  icon: string;
  color: string;
  avatarUrl?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

const sizeMap = {
  xs: { box: 'h-6 w-6 rounded-md', text: 'text-xs' },
  sm: { box: 'h-8 w-8 rounded-lg', text: 'text-sm' },
  md: { box: 'h-10 w-10 rounded-lg', text: 'text-lg' },
  lg: { box: 'h-14 w-14 rounded-xl', text: 'text-2xl' },
  xl: { box: 'h-20 w-20 rounded-2xl', text: 'text-4xl' }
};

export function EntityAvatar({
  icon,
  color,
  avatarUrl,
  name,
  size = 'md',
  className,
  onClick
}: EntityAvatarProps) {
  const s = sizeMap[size];
  const resolved = resolveAvatarUrl(avatarUrl);

  if (resolved) {
    return (
      <div
        className={cn('shrink-0 select-none overflow-hidden', s.box, onClick && 'cursor-pointer', className)}
        title={name}
        onClick={onClick}
      >
        <img src={resolved} alt={name || ''} className='h-full w-full object-cover' loading='lazy' decoding='async' />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0 select-none',
        s.box,
        s.text,
        onClick && 'cursor-pointer',
        className
      )}
      style={{ backgroundColor: color + '20', color: color }}
      title={name}
      onClick={onClick}
    >
      {icon || '🤖'}
    </div>
  );
}

interface EntityAvatarStackProps {
  entities: { icon: string; color: string; avatarUrl?: string; name?: string; id?: string }[];
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}

export function EntityAvatarStack({
  entities,
  max = 5,
  size = 'sm'
}: EntityAvatarStackProps) {
  const visible = entities.slice(0, max);
  const overflow = entities.length - max;

  return (
    <div className='flex items-center'>
      <div className='flex -space-x-2'>
        {visible.map((e, i) => (
          <EntityAvatar
            key={e.id || i}
            icon={e.icon}
            color={e.color}
            avatarUrl={e.avatarUrl}
            name={e.name}
            size={size}
            className='border-2 border-background'
          />
        ))}
      </div>
      {overflow > 0 && (
        <span className='ml-1.5 text-[10px] text-muted-foreground'>
          +{overflow}
        </span>
      )}
    </div>
  );
}
