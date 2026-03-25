/**
 * Marketplace Catalog — Pre-packaged tool packs for AitherOS workforces.
 *
 * Each entry describes an MCP server that can be installed with one click.
 * The user only needs to supply credential values; the rest is pre-configured.
 */

export interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  helpText?: string;
  required: boolean;
  sensitive: boolean;
}

export interface CatalogTool {
  name: string;
  description: string;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  slug: string;
  icon: string;
  logoUrl?: string;
  color: string;
  category: MarketplaceCategory;
  author: string;
  description: string;
  longDescription: string;
  transport: 'stdio' | 'sse' | 'streamable_http';
  command: string;
  args: string[];
  url?: string;
  credentials: CredentialField[];
  tools: CatalogTool[];
  tags: string[];
  featured: boolean;
  docsUrl?: string;
}

export type MarketplaceCategory =
  | 'developer'
  | 'productivity'
  | 'data'
  | 'communication'
  | 'infrastructure'
  | 'ai';

export const categoryMeta: Record<
  MarketplaceCategory,
  { label: string; icon: string; color: string; description: string }
> = {
  developer: {
    label: 'Developer Tools',
    icon: '⚡',
    color: '#9A66FF',
    description: 'Code repositories, CI/CD, and developer workflows'
  },
  productivity: {
    label: 'Productivity',
    icon: '📋',
    color: '#56D090',
    description: 'Project management, docs, and team collaboration'
  },
  data: {
    label: 'Data & Analytics',
    icon: '📊',
    color: '#14FFF7',
    description: 'Databases, APIs, and data processing'
  },
  communication: {
    label: 'Communication',
    icon: '💬',
    color: '#FFBF47',
    description: 'Messaging, email, and notifications'
  },
  infrastructure: {
    label: 'Infrastructure',
    icon: '🔧',
    color: '#EF4444',
    description: 'Cloud, servers, and DevOps tooling'
  },
  ai: {
    label: 'AI & Models',
    icon: '🧠',
    color: '#EC4899',
    description: 'LLM providers, embeddings, and AI services'
  }
};

export const marketplaceCatalog: MarketplaceItem[] = [
  // ── GitHub ────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    slug: 'github',
    icon: '🐙',
    logoUrl: '/marketplace/github.svg',
    color: '#8B5CF6',
    category: 'developer',
    author: 'Anthropic (MCP)',
    description:
      'Full GitHub integration — repositories, pull requests, issues, code search, and more.',
    longDescription:
      'Give your agents the ability to interact with GitHub repositories. They can read code from public and private repos, create and review pull requests, open and comment on issues, search code across your organization, manage branches, and much more. Perfect for code review automation, documentation generation, and development workflow orchestration.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    credentials: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        helpText:
          'Create a fine-grained PAT at github.com/settings/tokens with repo, issues, and pull_requests scopes.',
        required: true,
        sensitive: true
      }
    ],
    tools: [
      { name: 'create_or_update_file', description: 'Create or update a single file in a repository' },
      { name: 'search_repositories', description: 'Search for GitHub repositories' },
      { name: 'create_repository', description: 'Create a new GitHub repository' },
      { name: 'get_file_contents', description: 'Get contents of a file or directory' },
      { name: 'push_files', description: 'Push multiple files in a single commit' },
      { name: 'create_issue', description: 'Create a new issue in a repository' },
      { name: 'create_pull_request', description: 'Create a new pull request' },
      { name: 'fork_repository', description: 'Fork a repository to your account' },
      { name: 'create_branch', description: 'Create a new branch in a repository' },
      { name: 'list_issues', description: 'List issues with filters' },
      { name: 'update_issue', description: 'Update an existing issue' },
      { name: 'add_issue_comment', description: 'Add a comment to an issue or PR' },
      { name: 'search_code', description: 'Search code across GitHub repositories' },
      { name: 'list_commits', description: 'List commits on a branch' },
      { name: 'get_issue', description: 'Get details of a specific issue' },
      { name: 'get_pull_request', description: 'Get details of a pull request' },
      { name: 'list_pull_requests', description: 'List pull requests with filters' },
      { name: 'create_pull_request_review', description: 'Create a review on a pull request' }
    ],
    tags: ['git', 'code', 'repos', 'pull-requests', 'issues', 'ci-cd'],
    featured: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
  },

  // ── Filesystem ────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    slug: 'filesystem',
    icon: '📁',
    color: '#FFBF47',
    category: 'developer',
    author: 'Anthropic (MCP)',
    description:
      'Secure filesystem access — read, write, search, and manage files within allowed directories.',
    longDescription:
      'Allow agents to interact with the local filesystem in a controlled manner. They can read and write files, create directories, move/rename files, search by content or name, and get file metadata. Access is sandboxed to explicitly allowed directories for security.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/aitheros-workspace'],
    credentials: [],
    tools: [
      { name: 'read_file', description: 'Read complete contents of a file' },
      { name: 'read_multiple_files', description: 'Read multiple files simultaneously' },
      { name: 'write_file', description: 'Create or overwrite a file' },
      { name: 'edit_file', description: 'Make selective edits using advanced pattern matching' },
      { name: 'create_directory', description: 'Create a new directory or nested directories' },
      { name: 'list_directory', description: 'List directory contents with metadata' },
      { name: 'move_file', description: 'Move or rename files and directories' },
      { name: 'search_files', description: 'Recursively search for files by name pattern' },
      { name: 'get_file_info', description: 'Get detailed metadata about a file' },
      { name: 'list_allowed_directories', description: 'List directories the server can access' }
    ],
    tags: ['files', 'local', 'read', 'write', 'search'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
  },

  // ── Brave Search ──────────────────────────────────────
  {
    id: 'brave-search',
    name: 'Brave Search',
    slug: 'brave-search',
    icon: '🔍',
    logoUrl: '/marketplace/brave.svg',
    color: '#FF6B2B',
    category: 'data',
    author: 'Anthropic (MCP)',
    description:
      'Web and local search powered by Brave — search the internet and find local businesses.',
    longDescription:
      'Enable your agents to search the web using Brave Search API. Supports both general web search with pagination and filtering, and local search for finding businesses, restaurants, and services. Great for research tasks, competitive analysis, and gathering real-time information.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    credentials: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        placeholder: 'BSA_xxxxxxxxxxxxxxxxxxxx',
        helpText: 'Get your API key at brave.com/search/api',
        required: true,
        sensitive: true
      }
    ],
    tools: [
      { name: 'brave_web_search', description: 'Search the web using Brave Search' },
      { name: 'brave_local_search', description: 'Search for local businesses and places' }
    ],
    tags: ['search', 'web', 'internet', 'research'],
    featured: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
  },

  // ── Slack ─────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    slug: 'slack',
    icon: '💬',
    logoUrl: '/marketplace/slack.svg',
    color: '#4A154B',
    category: 'communication',
    author: 'Anthropic (MCP)',
    description:
      'Slack workspace integration — channels, messages, users, and reactions.',
    longDescription:
      'Connect your agents to Slack workspaces. They can list channels, read message history, post messages, reply in threads, add reactions, and manage channel membership. Ideal for automated team communication, status updates, and notification workflows.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    credentials: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Slack Bot Token',
        placeholder: 'xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx',
        helpText: 'Create a Slack app at api.slack.com/apps and add a Bot Token with channels:read, chat:write scopes.',
        required: true,
        sensitive: true
      },
      {
        key: 'SLACK_TEAM_ID',
        label: 'Team ID',
        placeholder: 'T0XXXXXXX',
        helpText: 'Your Slack workspace Team ID. Find it in workspace settings.',
        required: true,
        sensitive: false
      }
    ],
    tools: [
      { name: 'list_channels', description: 'List public channels in the workspace' },
      { name: 'post_message', description: 'Post a message to a channel' },
      { name: 'reply_to_thread', description: 'Reply to a specific message thread' },
      { name: 'add_reaction', description: 'Add an emoji reaction to a message' },
      { name: 'get_channel_history', description: 'Get recent messages from a channel' },
      { name: 'get_thread_replies', description: 'Get all replies in a thread' },
      { name: 'get_users', description: 'List users in the workspace' },
      { name: 'get_user_profile', description: 'Get profile information for a user' }
    ],
    tags: ['chat', 'messaging', 'team', 'notifications'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack'
  },

  // ── PostgreSQL ────────────────────────────────────────
  {
    id: 'postgres',
    name: 'PostgreSQL',
    slug: 'postgres',
    icon: '🐘',
    logoUrl: '/marketplace/postgresql.svg',
    color: '#336791',
    category: 'data',
    author: 'Anthropic (MCP)',
    description:
      'Query PostgreSQL databases — read-only access with schema inspection.',
    longDescription:
      'Give your agents read-only access to PostgreSQL databases. They can inspect schemas, list tables, and run SELECT queries. Perfect for data analysis, report generation, and database documentation tasks. Queries are executed in read-only mode for safety.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '{{POSTGRES_CONNECTION_STRING}}'],
    credentials: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'Connection String',
        placeholder: 'postgresql://user:password@host:5432/dbname',
        helpText: 'Full PostgreSQL connection URI. Only read-only queries will be executed. This value is passed as a CLI argument to the server.',
        required: true,
        sensitive: true
      }
    ],
    tools: [
      { name: 'query', description: 'Execute a read-only SQL query against the database' },
      { name: 'list_tables', description: 'List all tables in the database' },
      { name: 'describe_table', description: 'Get column details for a specific table' }
    ],
    tags: ['database', 'sql', 'analytics', 'query'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres'
  },

  // ── Puppeteer ─────────────────────────────────────────
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    slug: 'puppeteer',
    icon: '🌐',
    logoUrl: '/marketplace/puppeteer.svg',
    color: '#00D8A2',
    category: 'data',
    author: 'Anthropic (MCP)',
    description:
      'Browser automation — navigate, screenshot, click, fill forms, and extract content from web pages.',
    longDescription:
      'Enable your agents to control a headless browser. They can navigate to URLs, take screenshots, click elements, fill out forms, extract page content, and execute JavaScript. Great for web scraping, testing, and interacting with web applications programmatically.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    credentials: [],
    tools: [
      { name: 'puppeteer_navigate', description: 'Navigate to a URL in the browser' },
      { name: 'puppeteer_screenshot', description: 'Take a screenshot of the current page' },
      { name: 'puppeteer_click', description: 'Click an element on the page' },
      { name: 'puppeteer_fill', description: 'Fill out an input field' },
      { name: 'puppeteer_select', description: 'Select an option from a dropdown' },
      { name: 'puppeteer_hover', description: 'Hover over an element' },
      { name: 'puppeteer_evaluate', description: 'Execute JavaScript in the browser console' }
    ],
    tags: ['browser', 'scraping', 'automation', 'web'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer'
  },

  // ── Google Maps ───────────────────────────────────────
  {
    id: 'google-maps',
    name: 'Google Maps',
    slug: 'google-maps',
    icon: '🗺️',
    logoUrl: '/marketplace/googlemaps.svg',
    color: '#4285F4',
    category: 'data',
    author: 'Anthropic (MCP)',
    description:
      'Google Maps Platform — geocoding, directions, place search, and elevation data.',
    longDescription:
      'Connect your agents to Google Maps APIs. They can geocode addresses, get driving/walking/transit directions, search for places and businesses, get place details, compute distance matrices, and look up elevation data. Useful for logistics, travel planning, and location-based analysis.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    credentials: [
      {
        key: 'GOOGLE_MAPS_API_KEY',
        label: 'Google Maps API Key',
        placeholder: 'AIzaSy...',
        helpText: 'Get your API key from the Google Cloud Console. Enable Maps, Places, Geocoding, and Directions APIs.',
        required: true,
        sensitive: true
      }
    ],
    tools: [
      { name: 'maps_geocode', description: 'Convert an address to coordinates' },
      { name: 'maps_reverse_geocode', description: 'Convert coordinates to an address' },
      { name: 'maps_search_places', description: 'Search for places by query' },
      { name: 'maps_place_details', description: 'Get detailed info about a specific place' },
      { name: 'maps_directions', description: 'Get directions between two locations' },
      { name: 'maps_distance_matrix', description: 'Calculate distances between multiple origins and destinations' },
      { name: 'maps_elevation', description: 'Get elevation data for locations' }
    ],
    tags: ['maps', 'location', 'directions', 'places', 'geocoding'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps'
  },

  // ── Memory ────────────────────────────────────────────
  {
    id: 'memory',
    name: 'Memory',
    slug: 'memory',
    icon: '🧠',
    color: '#EC4899',
    category: 'ai',
    author: 'Anthropic (MCP)',
    description:
      'Persistent knowledge graph memory — entities, relations, and observations.',
    longDescription:
      'Give your agents a persistent memory system based on knowledge graphs. They can create entities, add observations about them, establish relations between entities, and search through the knowledge graph. Memories persist across conversations, making agents more capable over time.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    credentials: [],
    tools: [
      { name: 'create_entities', description: 'Create new entities in the knowledge graph' },
      { name: 'create_relations', description: 'Create relations between entities' },
      { name: 'add_observations', description: 'Add observations to existing entities' },
      { name: 'delete_entities', description: 'Remove entities from the knowledge graph' },
      { name: 'delete_observations', description: 'Remove observations from entities' },
      { name: 'delete_relations', description: 'Remove relations between entities' },
      { name: 'read_graph', description: 'Read the entire knowledge graph' },
      { name: 'search_nodes', description: 'Search for entities by query' },
      { name: 'open_nodes', description: 'Open specific entities by name' }
    ],
    tags: ['memory', 'knowledge-graph', 'persistence', 'entities'],
    featured: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
  },

  // ── Fetch ─────────────────────────────────────────────
  {
    id: 'fetch',
    name: 'Web Fetch',
    slug: 'fetch',
    icon: '🌍',
    color: '#06B6D4',
    category: 'data',
    author: 'Anthropic (MCP)',
    description:
      'Fetch and extract content from any URL — web pages, APIs, and raw data.',
    longDescription:
      'Allow agents to fetch content from any URL and convert it into clean, readable text or markdown. Supports HTML pages (automatically extracts main content), JSON APIs, and raw text. Includes configurable request size limits and robots.txt compliance.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    credentials: [],
    tools: [
      { name: 'fetch', description: 'Fetch a URL and extract its content as markdown or text' }
    ],
    tags: ['http', 'web', 'api', 'scraping', 'fetch'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch'
  },

  // ── Sequential Thinking ───────────────────────────────
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    slug: 'sequential-thinking',
    icon: '💭',
    color: '#8B5CF6',
    category: 'ai',
    author: 'Anthropic (MCP)',
    description:
      'Structured chain-of-thought reasoning with branching, revision, and dynamic depth.',
    longDescription:
      'Enhance your agents with structured reasoning capabilities. This tool provides a framework for step-by-step thinking with the ability to branch into alternative paths, revise earlier steps, and dynamically adjust the depth of analysis. Ideal for complex problem-solving, planning, and multi-step analysis tasks.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    credentials: [],
    tools: [
      { name: 'sequentialthinking', description: 'A tool for dynamic, step-by-step reasoning with branching and revision' }
    ],
    tags: ['reasoning', 'thinking', 'chain-of-thought', 'planning'],
    featured: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking'
  }
];
