'use client';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar
} from '@/components/ui/sidebar';
import { navItems } from '@/config/nav-config';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useFilteredNavItems } from '@/hooks/use-nav';
import {
  IconChevronRight,
  IconChevronsDown,
  IconLogout,
  IconSettings
} from '@tabler/icons-react';
import { useSession, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';
function resolveAvatarUrl(url?: string) {
  if (!url) return '';
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

export default function AppSidebar() {
  const pathname = usePathname();
  const { isOpen } = useMediaQuery();
  const { state: sidebarState } = useSidebar();
  const itemsToShow = useFilteredNavItems(navItems);
  const { data: session } = useSession();
  const [xp, setXp] = useState(0);
  const [xpLoaded, setXpLoaded] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');

  const fetchProfile = React.useCallback(async () => {
    if (!session?.accessToken) return;
    try {
      api.setToken(session.accessToken);
      const res = await api.me();
      if (res.data) {
        setProfileName(res.data.display_name || res.data.username || '');
        setProfileAvatar(res.data.avatar_url || '');
      }
    } catch {}
  }, [session]);

  React.useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  React.useEffect(() => {
    const handler = () => fetchProfile();
    window.addEventListener('profileUpdated', handler);
    return () => window.removeEventListener('profileUpdated', handler);
  }, [fetchProfile]);

  useEffect(() => {
    if (!session?.accessToken) return;
    api.setToken(session.accessToken);
    Promise.all([api.listAgents(), api.listWorkforces(), api.listMCPServers()])
      .then(([agRes, wfRes, mcpRes]) => {
        const ag = (agRes.data || []).length;
        const wf = (wfRes.data || []).length;
        const mcp = (mcpRes.data || []).length;
        setXp(ag * 200 + wf * 300 + mcp * 100);
        setXpLoaded(true);
      })
      .catch(() => setXpLoaded(true));
  }, [session]);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' asChild>
              <Link href='/dashboard/overview'>
                <div className='flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden'>
                  <img src='/assets/favicon.png' alt='AitherOS' className='size-8 object-contain' />
                </div>
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-mono font-semibold text-[#9A66FF]'>
                    AitherOS
                  </span>
                  <span className='truncate text-xs text-muted-foreground'>
                    Workforce Orchestration
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {itemsToShow.map((item) => {
              const Icon = item.icon ? Icons[item.icon] : Icons.logo;
              return item?.items && item?.items?.length > 0 ? (
                <Collapsible
                  key={item.title}
                  asChild
                  defaultOpen={item.isActive}
                  className='group/collapsible'
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={pathname === item.url}
                      >
                        {item.icon && <Icon />}
                        <span>{item.title}</span>
                        <IconChevronRight className='ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === subItem.url}
                            >
                              <Link href={subItem.url}>
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    isActive={pathname === item.url}
                  >
                    <Link href={item.url}>
                      <Icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {/* ── Operator Level Widget ── */}
        {xpLoaded && sidebarState === 'expanded' && (() => {
          const LEVELS = [
            { min: 0,    label: 'INITIATE',  color: '#888899' },
            { min: 300,  label: 'CADET',     color: '#56D090' },
            { min: 800,  label: 'OPERATOR',  color: '#14FFF7' },
            { min: 1600, label: 'PILOT',     color: '#9A66FF' },
            { min: 3500, label: 'NAVIGATOR', color: '#FFBF47' },
            { min: 7000, label: 'COMMANDER', color: '#FF9900' }
          ];
          const lvIdx = LEVELS.reduce((best, l, i) => xp >= l.min ? i : best, 0);
          const level = LEVELS[lvIdx];
          const next = LEVELS[lvIdx + 1];
          const pct = next ? Math.round(((xp - level.min) / (next.min - level.min)) * 100) : 100;
          return (
            <div className='mx-2 mb-1 rounded-lg border border-border/30 bg-background/40 p-2.5'>
              <div className='mb-1.5 flex items-center justify-between'>
                <div className='flex items-center gap-1.5'>
                  <div className='h-1.5 w-1.5 rounded-full' style={{ backgroundColor: level.color, boxShadow: `0 0 5px ${level.color}` }} />
                  <span className='font-mono text-[10px] font-bold tracking-widest' style={{ color: level.color }}>
                    LVL {lvIdx + 1} · {level.label}
                  </span>
                </div>
                <span className='font-mono text-[9px] text-muted-foreground/50'>{xp.toLocaleString()} XP</span>
              </div>
              <div className='relative h-1 overflow-hidden rounded-full bg-muted/40'>
                <div
                  className='h-full rounded-full transition-all duration-1000'
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${level.color}80, ${level.color})`,
                    boxShadow: `0 0 6px ${level.color}60`
                  }}
                />
              </div>
              {next && (
                <p className='mt-1 text-right font-mono text-[8px] text-muted-foreground/40'>
                  {(next.min - xp).toLocaleString()} XP → {next.label}
                </p>
              )}
            </div>
          );
        })()}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                >
                  {resolveAvatarUrl(profileAvatar) ? (
                    <img
                      src={resolveAvatarUrl(profileAvatar)}
                      alt={profileName}
                      className='aspect-square size-8 rounded-full object-cover'
                    />
                  ) : (
                    <div className='flex aspect-square size-8 items-center justify-center rounded-full bg-[#9A66FF]/20 text-[#9A66FF]'>
                      <span className='text-sm font-bold'>
                        {(profileName || session?.user?.name || '?')[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className='grid flex-1 text-left text-sm leading-tight'>
                    <span className='truncate font-semibold'>
                      {profileName || session?.user?.name || 'Guest'}
                    </span>
                    <span className='truncate text-xs text-muted-foreground'>
                      {session?.user?.email || 'Not signed in'}
                    </span>
                  </div>
                  <IconChevronsDown className='ml-auto size-4' />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
                side='bottom'
                align='end'
                sideOffset={4}
              >
                <DropdownMenuLabel className='p-0 font-normal'>
                  <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
                    {resolveAvatarUrl(profileAvatar) ? (
                      <img
                        src={resolveAvatarUrl(profileAvatar)}
                        alt={profileName}
                        className='aspect-square size-8 rounded-full object-cover'
                      />
                    ) : (
                      <div className='flex aspect-square size-8 items-center justify-center rounded-full bg-[#9A66FF]/20 text-[#9A66FF]'>
                        <span className='text-sm font-bold'>
                          {(profileName || session?.user?.name || '?')[0].toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className='grid flex-1 text-left text-sm leading-tight'>
                      <span className='truncate font-semibold'>
                        {profileName || session?.user?.name || 'Guest'}
                      </span>
                      <span className='truncate text-xs text-muted-foreground'>
                        {(session?.user as any)?.role || 'user'}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href='/dashboard/settings/profile'>
                    <IconSettings className='mr-2 h-4 w-4' />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/auth/sign-in` })}
                >
                  <IconLogout className='mr-2 h-4 w-4' />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
