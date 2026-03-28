-- Migration 015: widen mcp_servers.icon from VARCHAR(10) to TEXT.
-- VARCHAR(10) rejects icon values that are file paths (e.g. /assets/favicon.png).
ALTER TABLE mcp_servers ALTER COLUMN icon TYPE TEXT;
