import { NavItem } from '@/types';

/**
 * AitherOS Navigation Configuration
 * Used by sidebar and Cmd+K bar.
 */
export const navItems: NavItem[] = [
  {
    title: 'Overview',
    url: '/dashboard/overview',
    icon: 'dashboard',
    isActive: false,
    shortcut: ['d', 'd'],
    items: []
  },
  {
    title: 'Agents',
    url: '/dashboard/agents',
    icon: 'agents',
    shortcut: ['a', 'a'],
    isActive: false,
    items: []
  },
  {
    title: 'Workforces',
    url: '/dashboard/workforces',
    icon: 'workforces',
    shortcut: ['w', 'w'],
    isActive: false,
    items: []
  },
  {
    title: 'Executions',
    url: '/dashboard/executions',
    icon: 'executions',
    shortcut: ['e', 'e'],
    isActive: false,
    items: []
  },
  {
    title: 'Activity',
    url: '/dashboard/activity',
    icon: 'activity',
    shortcut: ['a', 'c'],
    isActive: false,
    items: []
  },
  {
    title: 'Providers',
    url: '/dashboard/providers',
    icon: 'providers',
    shortcut: ['p', 'p'],
    isActive: false,
    items: []
  },
  {
    title: 'MCP Servers',
    url: '/dashboard/mcp',
    icon: 'mcp',
    shortcut: ['m', 'm'],
    isActive: false,
    items: []
  },
  {
    title: 'Marketplace',
    url: '/dashboard/marketplace',
    icon: 'marketplace',
    shortcut: ['m', 'k'],
    isActive: false,
    items: []
  },
  {
    title: 'Settings',
    url: '#',
    icon: 'settings',
    isActive: false,
    items: [
      {
        title: 'Profile',
        url: '/dashboard/settings/profile',
        icon: 'profile',
        shortcut: ['s', 'p']
      }
    ]
  }
];
