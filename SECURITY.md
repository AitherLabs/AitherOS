# Security Policy

## Supported Versions

We provide security fixes for the latest release only.

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Send a report to **labs@aitheros.io** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if safe to share)
- The affected component (backend, frontend, database schema, etc.)
- Your contact information for follow-up

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation within 14 days for critical issues.

## Scope

Areas of particular interest:

- Authentication and session handling (NextAuth.js JWT)
- Credential vault (AES-256-GCM encrypted secrets stored per workforce)
- API authorization — workforce and execution access controls
- LLM prompt injection through user-supplied agent instructions
- MCP tool execution sandbox — command injection via `run_command`
- PostgreSQL query parameters — SQL injection
- WebSocket event bus — unauthorized event subscription

## Out of Scope

- Vulnerabilities in third-party LLM providers (OpenAI, Anthropic, etc.)
- Issues in self-hosted infrastructure that the operator controls (server config, firewall rules)
- Social engineering

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit reporters in the release notes (unless you prefer to remain anonymous).
