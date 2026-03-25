# Dify Analysis → AitherOS Backend Improvements

## What Dify Does Well (that we should adopt)

### 1. Model Provider System (HIGH PRIORITY)

**Dify's approach:**
- `Provider` model with `tenant_id`, `provider_name`, `provider_type` (custom/system), encrypted credentials
- `ProviderModel` — per-model configuration within a provider (e.g. "gpt-4o" under "openai")
- `ProviderCredential` — named credential sets (e.g. "Production Key", "Dev Key") with encrypted config
- `ProviderModelCredential` — model-specific credentials (for providers like Ollama where each model may need different config)
- `TenantDefaultModel` — workspace-level default model per type (LLM, embedding, rerank, TTS, STT)
- `ProviderModelSetting` — per-model enable/disable + load balancing toggle
- `ModelProviderFactory` — discovers available providers, validates credentials, returns typed model instances
- `ProviderManager` — orchestrates all of the above, handles credential caching in Redis

**What AitherOS currently has:**
- Single `LLMConfig` struct with one API base + key + model
- `EngineType` string on Agent (just "picoclaw" or "openclaw")
- No credential management, no multi-provider support

**Proposed improvement — `ModelProvider` system:**
- New `model_providers` table: id, name, provider_type (openai, ollama, openrouter, litellm, picoclaw, openclaw, custom_openai), base_url, api_key (encrypted), is_enabled, default_model, config JSONB
- New `provider_models` table: id, provider_id, model_name, model_type (llm, embedding, rerank), is_enabled, config JSONB  
- Agent.model changes from a plain string to `provider_id` + `model_name` (or a composite reference)
- Backend `ProviderRegistry` that validates credentials, lists available models per provider, and returns a unified `LLMClient` interface
- Support credential forms per provider type (OpenAI needs api_key; Ollama needs base_url; OpenRouter needs api_key + site_name)

### 2. Agent Variables / Input Form (HIGH PRIORITY)

**Dify's approach:**
- `user_input_form` — list of typed variables (text-input, select, paragraph, number, checkbox)
- Each variable has: `variable` (slug), `label`, `description`, `required`, `max_length`, `options`, `default`
- Variables are interpolated into the system prompt using `{{variable}}` template syntax
- The Debug & Preview panel shows input fields matching the variable definitions
- `pre_prompt` (system prompt) contains `{{target}}`, `{{technical_scope}}` etc. — exactly what you showed in screenshot 3

**What AitherOS currently has:**
- `SystemPrompt` and `Instructions` as plain strings
- No variable system, no template interpolation

**Proposed improvement — Agent Variables:**
- New `AgentVariable` struct: name (slug), label, type (text/select/paragraph/number), description, required, default, options[]
- Agent model gets `Variables []AgentVariable` field (stored as JSONB)
- System prompt supports `{{variable_name}}` Mustache-style interpolation
- When starting an execution or debug session, the frontend renders input fields from the variable definitions
- Orchestrator interpolates variables into the prompt before sending to the engine

### 3. Agent Strategy / Reasoning Mode (MEDIUM PRIORITY)

**Dify's approach:**
- `AgentEntity.Strategy`: FUNCTION_CALLING or CHAIN_OF_THOUGHT (ReAct)
- `AgentPromptEntity`: configurable `first_prompt` and `next_iteration` templates
- `max_iteration` per agent (default 10)
- Agent config stored in `agent_mode` JSON blob with: enabled, strategy, tools[], prompt

**What AitherOS currently has:**
- No agent-level strategy selection
- Orchestrator handles iteration logic globally, not per-agent

**Proposed improvement:**
- Add `Strategy` field to Agent: "function_call", "react", "simple" (just prompt, no tool loop)
- Add `MaxIterations` field to Agent (default 10)
- Let the orchestrator respect per-agent strategy when dispatching tasks

### 4. Tool Registry (MEDIUM PRIORITY)

**Dify's approach:**
- `ToolProviderType`: PLUGIN, BUILT_IN, WORKFLOW, API, APP, DATASET_RETRIEVAL, MCP
- `AgentToolEntity` with provider_type, provider_id, tool_name, tool_parameters, credential_id
- `ToolManager` that resolves tools at runtime
- Tools can be enabled/disabled per agent
- Each tool has typed parameters with schemas

**What AitherOS currently has:**
- `Tools []string` on Agent — just a list of tool name strings
- No tool registry, no parameter schemas, no per-tool credentials

**Proposed improvement — Tool definitions:**
- New `tools` table: id, name, display_name, description, provider_type (builtin/mcp/api), config JSONB, parameter_schema JSONB, is_enabled
- Agent.Tools becomes a list of `AgentTool` objects: tool_id, enabled, parameter_overrides
- This allows the frontend to render tool configuration panels per agent

### 5. Debug & Preview Mode (HIGH PRIORITY for frontend, backend support needed)

**Dify's approach:**
- `InvokeFrom.DEBUGGER` — special invocation mode for the studio
- `/apps/<id>/completion-messages` endpoint accepts `model_config` override + `inputs` (variable values) + `query`
- Streams response back via SSE
- Separate from production execution — doesn't create a full Execution record
- Conversation history per debug session

**What AitherOS currently has:**
- Only full WorkForce execution flow (planning → HitL → loop)
- No way to test a single agent in isolation

**Proposed improvement — Agent Debug endpoint:**
- `POST /api/v1/agents/{id}/debug` — sends a single message to the agent's engine, returns streamed response
- Accepts: `inputs` (variable values), `message` (user query), optional `model_override`, `provider_override`
- Returns SSE stream or WebSocket events
- No execution record created — lightweight, fast iteration
- This is what powers the "Debug & Preview" panel in the frontend

### 6. App Icon & Metadata (LOW PRIORITY)

**Dify's approach:**
- `icon_type` (emoji/image/link), `icon`, `icon_background` on App
- `max_active_requests` for rate limiting
- Tags system for organization

**Proposed improvement:**
- Add `icon` (emoji string) and `color` (hex) to Agent model
- Add `tags` to Agent and WorkForce for filtering

---

## Summary: Priority Implementation Order

| # | Improvement | Impact | Effort | Priority |
|---|------------|--------|--------|----------|
| 1 | **Model Provider system** | Unlocks multi-LLM support | High | 🔴 HIGH |
| 2 | **Agent Variables + template interpolation** | Required for usable agent studio | Medium | 🔴 HIGH |
| 3 | **Agent Debug endpoint** | Required for frontend dev/test UX | Low | 🔴 HIGH |
| 4 | **Agent Strategy selection** | Per-agent reasoning mode | Low | 🟡 MEDIUM |
| 5 | **Tool Registry** | Structured tool management | Medium | 🟡 MEDIUM |
| 6 | **Agent icons/tags** | UI polish | Low | 🟢 LOW |

## Recommended Implementation Plan

**Phase 1 (do now, before frontend):**
- Model Provider CRUD + provider registry
- Agent Variables + prompt interpolation
- Agent Debug endpoint (single-agent testing)

**Phase 2 (with frontend):**
- Tool Registry + parameter schemas
- Agent Strategy field
- Agent icons/tags/metadata
