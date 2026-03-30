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
import { useFilteredNavItems } from '@/hooks/use-nav';
import {
  IconChevronRight,
  IconChevronsDown,
  IconDoorEnter,
  IconLogout,
  IconSettings
} from '@tabler/icons-react';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
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
  const { state: sidebarState } = useSidebar();
  const itemsToShow = useFilteredNavItems(navItems);
  const { data: session } = useSession();
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

  const getSignOutCallbackUrl = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/auth/sign-in`;
    }
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (configuredAppUrl) {
      return `${configuredAppUrl.replace(/\/$/, '')}/auth/sign-in`;
    }
    return '/auth/sign-in';
  }, []);

  const handleSignOut = React.useCallback(async () => {
    await signOut({ redirect: false, callbackUrl: getSignOutCallbackUrl() });
    if (typeof window !== 'undefined') {
      window.location.assign('/auth/sign-in');
    }
  }, [getSignOutCallbackUrl]);

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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip='Enter your Office'
              className='mb-1 h-auto border border-[#14FFF7]/20 bg-[#14FFF7]/7 px-2.5 py-2.5 hover:bg-[#14FFF7]/12 hover:text-foreground'
            >
              <Link href='/dashboard/office'>
                <div className='flex size-8 shrink-0 items-center justify-center rounded-md bg-[#14FFF7]/16 text-[#14FFF7]'>
                  <IconDoorEnter className='size-4' />
                </div>
                {sidebarState === 'expanded' && (
                  <div className='grid flex-1 text-left leading-tight'>
                    <span className='truncate text-[11px] font-semibold text-[#14FFF7]'>
                      Enter your Office
                    </span>
                    <span className='truncate text-[10px] text-muted-foreground/70'>
                      See your teams in-room
                    </span>
                  </div>
                )}
                {sidebarState === 'expanded' && (
                  <IconChevronRight className='ml-auto size-3.5 text-muted-foreground/50' />
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
                  onClick={handleSignOut}
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
