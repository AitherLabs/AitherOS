'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard/overview';
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      login,
      password,
      redirect: false
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid credentials. Please try again.');
      return;
    }

    router.push(callbackUrl);
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[#0A0D11]'>
      <div className='w-full max-w-sm space-y-8 px-6'>
        {/* Logo / Brand */}
        <div className='text-center'>
          <div className='mb-4 font-mono text-3xl font-bold tracking-tight text-[#9A66FF]'>
            AitherOS
          </div>
          <p className='text-sm text-[#EAEAEA]/60'>
            Autonomous AI Workforce Orchestration
          </p>
        </div>

        {/* Sign-in card */}
        <div className='rounded-lg border border-[#9A66FF]/20 bg-[#1C1F26] p-6 shadow-xl'>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div className='space-y-2'>
              <Label
                htmlFor='login'
                className='text-sm text-[#EAEAEA]/80'
              >
                Username or Email
              </Label>
              <Input
                id='login'
                type='text'
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder='aitherlabs'
                required
                className='border-[#9A66FF]/20 bg-[#0A0D11] text-[#EAEAEA] placeholder:text-[#EAEAEA]/30 focus:border-[#9A66FF]/50 focus:ring-[#9A66FF]/30'
              />
            </div>

            <div className='space-y-2'>
              <Label
                htmlFor='password'
                className='text-sm text-[#EAEAEA]/80'
              >
                Password
              </Label>
              <Input
                id='password'
                type='password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='••••••••'
                required
                className='border-[#9A66FF]/20 bg-[#0A0D11] text-[#EAEAEA] placeholder:text-[#EAEAEA]/30 focus:border-[#9A66FF]/50 focus:ring-[#9A66FF]/30'
              />
            </div>

            {error && (
              <p className='text-sm text-red-400'>{error}</p>
            )}

            <Button
              type='submit'
              disabled={loading}
              className='w-full bg-[#9A66FF] text-white hover:bg-[#9A66FF]/90 disabled:opacity-50'
            >
              {loading ? (
                <span className='flex items-center gap-2'>
                  <span className='h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white' />
                  Authenticating...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className='text-center text-xs text-[#EAEAEA]/30'>
          AitherLabs &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
