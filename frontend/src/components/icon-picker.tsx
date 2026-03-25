'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: 'Robots & Tech',
    icons: [
      '🤖', '🧠', '⚡', '🔮', '💎', '🛡️', '🔬', '🧬', '💻', '🖥️',
      '📡', '🛰️', '🔧', '⚙️', '🔩', '🤯', '🧪', '🔭', '📊', '🧮'
    ]
  },
  {
    label: 'People & Roles',
    icons: [
      '👤', '👥', '🧑‍💻', '🧑‍🔬', '🧑‍🎨', '🧑‍💼', '🧑‍🏫', '🧑‍⚕️', '🕵️', '🦸',
      '🧙', '🥷', '👁️', '🎯', '🏆', '👑', '🎭', '🎪', '🎩', '💂'
    ]
  },
  {
    label: 'Nature & Animals',
    icons: [
      '🐉', '🦅', '🐺', '🦊', '🐻', '🦁', '🐙', '🦋', '🐝', '🦉',
      '🐋', '🦈', '🐍', '🦎', '🕷️', '🌟', '🌊', '🔥', '🌸', '🍀'
    ]
  },
  {
    label: 'Objects & Symbols',
    icons: [
      '📝', '📋', '🗂️', '📁', '🗃️', '🔑', '🔒', '🔓', '💡', '🎵',
      '🚀', '✨', '⭐', '🌐', '🔗', '📌', '🏷️', '📦', '🧩', '🎲'
    ]
  }
];

const PRESET_COLORS = [
  '#9A66FF', '#7C3AED', '#6366F1', '#3B82F6', '#0EA5E9',
  '#14FFF7', '#10B981', '#56D090', '#84CC16', '#EAB308',
  '#FFBF47', '#F97316', '#EF4444', '#EC4899', '#F43F5E',
  '#8B5CF6', '#A855F7', '#D946EF', '#F472B6', '#64748B'
];

interface IconPickerProps {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

export function IconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  size = 'lg'
}: IconPickerProps) {
  const [open, setOpen] = useState(false);

  const sizeClasses = {
    sm: 'h-10 w-10 text-lg',
    md: 'h-14 w-14 text-2xl',
    lg: 'h-20 w-20 text-4xl'
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className={cn(
            'group relative flex items-center justify-center rounded-2xl border-2 border-dashed border-border/60 transition-all hover:border-[var(--picker-color)] hover:shadow-lg hover:shadow-[var(--picker-color)]/10 focus:outline-none focus:ring-2 focus:ring-[var(--picker-color)]/40',
            sizeClasses[size]
          )}
          style={
            {
              '--picker-color': color,
              backgroundColor: color + '15'
            } as React.CSSProperties
          }
        >
          <span className='transition-transform group-hover:scale-110'>
            {icon}
          </span>
          <div className='absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-muted text-[8px] opacity-0 transition-opacity group-hover:opacity-100'>
            ✏️
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className='w-80 p-0'
        align='start'
        sideOffset={8}
      >
        <div className='p-3 pb-2'>
          <p className='text-xs font-medium text-muted-foreground'>
            Choose an icon
          </p>
        </div>
        <ScrollArea className='h-[240px] px-3'>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} className='mb-3'>
              <p className='mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60'>
                {cat.label}
              </p>
              <div className='grid grid-cols-10 gap-0.5'>
                {cat.icons.map((emoji) => (
                  <button
                    key={emoji}
                    type='button'
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-md text-base transition-all hover:bg-accent hover:scale-110',
                      icon === emoji && 'bg-accent ring-1 ring-[var(--picker-color)]'
                    )}
                    style={{ '--picker-color': color } as React.CSSProperties}
                    onClick={() => {
                      onIconChange(emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </ScrollArea>
        <div className='border-t p-3'>
          <p className='mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60'>
            Color
          </p>
          <div className='grid grid-cols-10 gap-1'>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type='button'
                className={cn(
                  'h-6 w-6 rounded-full transition-all hover:scale-110',
                  color === c && 'ring-2 ring-offset-2 ring-offset-background ring-white/60'
                )}
                style={{ backgroundColor: c }}
                onClick={() => onColorChange(c)}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
