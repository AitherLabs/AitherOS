'use client';
import React, { useEffect } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import { ActiveThemeProvider } from '../themes/active-theme';
import api from '@/lib/api';

function TokenSync() {
  const { data: session } = useSession();
  useEffect(() => {
    api.setToken((session as any)?.accessToken ?? null);
  }, [session]);
  return null;
}

export default function Providers({
  activeThemeValue,
  children
}: {
  activeThemeValue: string;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <TokenSync />
      <ActiveThemeProvider initialTheme={activeThemeValue}>
        {children}
      </ActiveThemeProvider>
    </SessionProvider>
  );
}
