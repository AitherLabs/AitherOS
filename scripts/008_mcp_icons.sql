-- Add icon and avatar_url to MCP servers for visual identity in UI

ALTER TABLE mcp_servers
  ADD COLUMN icon VARCHAR(10) DEFAULT '🔧',
  ADD COLUMN avatar_url TEXT DEFAULT '';

-- Update existing Aither-Tools servers with the icon
UPDATE mcp_servers SET icon = '⚙️' WHERE name = 'Aither-Tools';
