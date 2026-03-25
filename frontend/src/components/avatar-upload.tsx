'use client';

import { useRef, useState } from 'react';
import { IconLoader2, IconPhoto, IconX } from '@tabler/icons-react';
import { api } from '@/lib/api';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

interface AvatarUploadProps {
  currentUrl?: string;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg';
  onUploaded: (url: string) => void;
  className?: string;
}

const sizes = {
  sm: 'h-12 w-12 text-lg',
  md: 'h-20 w-20 text-2xl',
  lg: 'h-28 w-28 text-4xl'
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export function AvatarUpload({ currentUrl, fallback = '?', size = 'md', onUploaded, className }: AvatarUploadProps) {
  const { data: session } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(currentUrl || '');

  const resolvedUrl = preview
    ? preview.startsWith('/uploads/')
      ? `${API_URL}${preview}`
      : preview
    : '';

  async function handleFile(file: File) {
    if (!file) return;
    setError('');
    setUploading(true);
    if (session?.accessToken) api.setToken(session.accessToken);
    try {
      const result = await api.uploadFile(file);
      setPreview(result.url);
      onUploaded(result.url);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleClear(ev: React.MouseEvent) {
    ev.stopPropagation();
    setPreview('');
    onUploaded('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <div className='relative'>
        <button
          type='button'
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            'group relative flex items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border/60 bg-muted/40 transition-all hover:border-primary/60 hover:bg-muted/60',
            sizes[size]
          )}
        >
          {uploading ? (
            <IconLoader2 className='h-5 w-5 animate-spin text-muted-foreground' />
          ) : resolvedUrl ? (
            <>
              <img src={resolvedUrl} alt='avatar' className='h-full w-full rounded-full object-cover' />
              <div className='absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100'>
                <IconPhoto className='h-4 w-4 text-white' />
              </div>
            </>
          ) : (
            <div className='flex flex-col items-center gap-1 text-muted-foreground'>
              <IconPhoto className='h-5 w-5' />
              <span className='text-[9px] font-medium uppercase tracking-wide'>Upload</span>
            </div>
          )}
        </button>

        {resolvedUrl && !uploading && (
          <button
            type='button'
            onClick={handleClear}
            className='absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white shadow-sm'
          >
            <IconX className='h-2.5 w-2.5' />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type='file'
        accept='image/jpeg,image/png,image/webp,image/gif'
        className='hidden'
        onChange={handleChange}
      />

      {error && <p className='text-[11px] text-destructive'>{error}</p>}
    </div>
  );
}
