const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  total?: number;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      cache: 'no-store'
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Server error ${res.status}: unexpected response (not JSON)`);
    }

    if (!res.ok || !json.success) {
      throw new Error(json.error || json.message || `API error: ${res.status}`);
    }

    return json;
  }

  // ── Auth ──────────────────────────────────────────────
  async register(data: { email: string; username: string; password: string; display_name?: string }) {
    return this.request<User>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request<{ token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async me() {
    return this.request<User>('/api/v1/auth/me');
  }

  async updateMe(data: { display_name?: string; avatar_url?: string }) {
    return this.request<User>('/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async adminListBetaSignups() {
    return this.request<BetaSignup[]>('/api/v1/admin/beta/signups');
  }

  async adminUpdateBetaSignupStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
    return this.request<{ status: string }>(`/api/v1/admin/beta/signups/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }

  // ── Agents ────────────────────────────────────────────
  async listAgents() {
    return this.request<Agent[]>('/api/v1/agents');
  }

  async getAgent(id: string) {
    return this.request<Agent>(`/api/v1/agents/${id}`);
  }

  async createAgent(data: Partial<Agent>) {
    return this.request<Agent>('/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateAgent(id: string, data: Partial<Agent>) {
    return this.request<Agent>(`/api/v1/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteAgent(id: string) {
    return this.request<null>(`/api/v1/agents/${id}`, {
      method: 'DELETE'
    });
  }

  async debugAgent(
    id: string,
    message: string,
    inputs?: Record<string, string>,
    history?: { role: string; content: string }[],
    stream = false
  ) {
    return this.request<any>(`/api/v1/agents/${id}/debug`, {
      method: 'POST',
      body: JSON.stringify({ message, inputs: inputs || {}, history: history || [], stream })
    });
  }

  async listAgentChats(id: string) {
    return this.request<AgentChat[]>(`/api/v1/agents/${id}/chats`);
  }

  async createAgentChat(id: string, data: { role: string; content: string; tool_calls?: ToolCallRecord[] }) {
    return this.request<AgentChat>(`/api/v1/agents/${id}/chats`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async clearAgentChats(id: string) {
    return this.request<null>(`/api/v1/agents/${id}/chats`, {
      method: 'DELETE'
    });
  }

  // ── Workforces ────────────────────────────────────────
  async listWorkforces() {
    return this.request<Workforce[]>('/api/v1/workforces');
  }

  async getWorkforce(id: string) {
    return this.request<Workforce>(`/api/v1/workforces/${id}`);
  }

  async createWorkforce(data: Partial<Workforce>) {
    return this.request<Workforce>('/api/v1/workforces', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateWorkforce(id: string, data: Partial<Workforce>) {
    return this.request<Workforce>(`/api/v1/workforces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteWorkforce(id: string) {
    return this.request<null>(`/api/v1/workforces/${id}`, {
      method: 'DELETE'
    });
  }

  async provisionWorkspace(id: string) {
    return this.request<{ message: string; workspace_path: string }>(`/api/v1/workforces/${id}/provision`, {
      method: 'POST'
    });
  }

  // ── Kanban ────────────────────────────────────────────
  async listKanbanTasks(workforceId: string) {
    return this.request<KanbanTask[]>(`/api/v1/workforces/${workforceId}/kanban`);
  }

  async listWorkspaceFiles(workforceId: string) {
    return this.request<WorkspaceFileEntry[]>(`/api/v1/workforces/${workforceId}/workspace/ls`);
  }

  async createKanbanTask(workforceId: string, data: { title: string; description?: string; priority?: number; assigned_to?: string; created_by?: string; project_id?: string; attachments?: string[]; task_refs?: string[] }) {
    return this.request<KanbanTask>(`/api/v1/workforces/${workforceId}/kanban`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateKanbanTask(taskId: string, data: Partial<{ title: string; description: string; status: KanbanStatus; priority: number; assigned_to: string; execution_id: string; notes: string; qa_status: KanbanQAStatus; qa_notes: string; project_id: string; attachments: string[]; task_refs: string[] }>) {
    return this.request<KanbanTask>(`/api/v1/kanban/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteKanbanTask(taskId: string) {
    return this.request<null>(`/api/v1/kanban/${taskId}`, { method: 'DELETE' });
  }

  // ── Projects ──────────────────────────────────────────
  async listProjects(workforceId: string) {
    return this.request<Project[]>(`/api/v1/workforces/${workforceId}/projects`);
  }

  async createProject(workforceId: string, data: CreateProjectRequest) {
    return this.request<Project>(`/api/v1/workforces/${workforceId}/projects`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getProject(projectId: string) {
    return this.request<Project>(`/api/v1/projects/${projectId}`);
  }

  async updateProject(projectId: string, data: UpdateProjectRequest) {
    return this.request<Project>(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteProject(projectId: string) {
    return this.request<null>(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
  }

  async refreshProjectBrief(projectId: string) {
    return this.request<Project>(`/api/v1/projects/${projectId}/brief/refresh`, { method: 'POST' });
  }

  // ── Credentials ───────────────────────────────────────
  async listCredentials(workforceId: string) {
    return this.request<Credential[]>(`/api/v1/workforces/${workforceId}/credentials`);
  }

  async upsertCredential(workforceId: string, data: { service: string; key_name: string; value: string }) {
    return this.request<Credential>(`/api/v1/workforces/${workforceId}/credentials`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteCredential(workforceId: string, service: string, keyName: string) {
    return this.request<null>(`/api/v1/workforces/${workforceId}/credentials/${service}/${keyName}`, {
      method: 'DELETE'
    });
  }

  // ── Executions ────────────────────────────────────────
  async startExecution(
    workforceId: string,
    objective: string,
    inputs?: Record<string, string>,
    projectId?: string,
    mode: ExecutionMode = 'all_agents',
    agentId?: string
  ) {
    return this.request<Execution>(`/api/v1/workforces/${workforceId}/executions`, {
      method: 'POST',
      body: JSON.stringify({
        objective,
        inputs,
        project_id: projectId || undefined,
        mode,
        agent_id: mode === 'single_agent' ? agentId || undefined : undefined
      })
    });
  }

  async approveExecution(execId: string, approved = true, feedback?: string) {
    return this.request<any>(`/api/v1/executions/${execId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved, feedback: feedback || '' })
    });
  }

  async haltExecution(execId: string) {
    return this.request<Execution>(`/api/v1/executions/${execId}/halt`, {
      method: 'POST'
    });
  }

  async resumeExecution(execId: string) {
    return this.request<{ status: string }>(`/api/v1/executions/${execId}/resume`, {
      method: 'POST'
    });
  }

  async interveneExecution(execId: string, message: string) {
    return this.request<{ status: string }>(`/api/v1/executions/${execId}/intervene`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  }

  async getGlobalStats() {
    return this.request<{ total_missions: number; completed: number; failed: number; total_tokens: number }>('/api/v1/stats');
  }

  async listExecutions(workforceId: string) {
    return this.request<Execution[]>(`/api/v1/workforces/${workforceId}/executions`);
  }

  async listAllExecutions() {
    return this.request<ExecutionWithWorkforce[]>('/api/v1/executions');
  }

  async getExecution(workforceId: string, execId: string) {
    return this.request<Execution>(`/api/v1/workforces/${workforceId}/executions/${execId}`);
  }

  async getExecutionDirect(execId: string) {
    return this.request<Execution>(`/api/v1/executions/${execId}`);
  }

  async getMessages(execId: string) {
    return this.request<Message[]>(`/api/v1/executions/${execId}/messages`);
  }

  async getDiscussionMessages(execId: string) {
    return this.request<Message[]>(`/api/v1/executions/${execId}/discussion`);
  }

  async getReviewMessages(execId: string) {
    return this.request<Message[]>(`/api/v1/executions/${execId}/review`);
  }

  async listExecutionEvents(execId: string) {
    return this.request<ExecutionEvent[]>(`/api/v1/executions/${execId}/events`);
  }

  async listExecutionQA(execId: string) {
    return this.request<ExecutionQA[]>(`/api/v1/executions/${execId}/qa`);
  }

  async askExecutionQA(execId: string, question: string) {
    return this.request<ExecutionQA>(`/api/v1/executions/${execId}/qa`, {
      method: 'POST',
      body: JSON.stringify({ question })
    });
  }

  async executionChat(execId: string, mode: 'ask' | 'instruct', message: string, history: Array<{ role: string; content: string }> = []) {
    return this.request<ChatReply>(`/api/v1/executions/${execId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ mode, message, history })
    });
  }

  async preflightWorkforce(wfId: string) {
    return this.request<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }>(
      `/api/v1/workforces/${wfId}/preflight`
    );
  }

  async deleteExecution(execId: string) {
    return this.request<{ deleted: string }>(`/api/v1/executions/${execId}`, {
      method: 'DELETE'
    });
  }

  async updateExecutionMeta(execId: string, data: { title?: string; description?: string; image_url?: string }) {
    return this.request<Execution>(`/api/v1/executions/${execId}/meta`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async uploadFile(file: File): Promise<{ url: string; filename: string }> {
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080'}/api/v1/upload`, {
      method: 'POST',
      headers,
      body: form,
      cache: 'no-store'
    });
    let json: any;
    try { json = await res.json(); } catch { throw new Error('Upload failed: invalid response'); }
    if (!res.ok || !json.success) throw new Error(json.error || json.message || 'Upload failed');
    return json.data;
  }

  // ── Providers ─────────────────────────────────────────
  async listProviders() {
    return this.request<Provider[]>('/api/v1/providers');
  }

  async getProvider(id: string) {
    return this.request<Provider>(`/api/v1/providers/${id}`);
  }

  async createProvider(data: CreateProviderRequest) {
    return this.request<Provider>('/api/v1/providers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateProvider(id: string, data: UpdateProviderRequest) {
    return this.request<Provider>(`/api/v1/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteProvider(id: string) {
    return this.request<null>(`/api/v1/providers/${id}`, {
      method: 'DELETE'
    });
  }

  async getProviderSchemas() {
    return this.request<CredentialSchema[]>('/api/v1/providers/schemas');
  }

  async addProviderModel(providerId: string, data: CreateProviderModelRequest) {
    return this.request<ProviderModel>(`/api/v1/providers/${providerId}/models`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async removeProviderModel(providerId: string, modelId: string) {
    return this.request<null>(`/api/v1/providers/${providerId}/models/${modelId}`, {
      method: 'DELETE'
    });
  }

  async liveModels(providerId: string) {
    return this.request<string[]>(`/api/v1/providers/${providerId}/live-models`);
  }

  async testProvider(data: { base_url: string; api_key?: string; provider_type?: string }) {
    return this.request<{ ok: boolean; models: string[]; error: string }>(
      '/api/v1/providers/test',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  async embeddingStatus() {
    return this.request<{ ok: boolean; endpoint: string; model: string; dimensions?: number; error?: string }>(
      '/api/v1/knowledge/embedding-status'
    );
  }

  // ── MCP Servers ─────────────────────────────────────────
  async listMCPServers() {
    return this.request<MCPServer[]>('/api/v1/mcp/servers');
  }

  async getMCPServer(id: string) {
    return this.request<MCPServer>(`/api/v1/mcp/servers/${id}`);
  }

  async createMCPServer(data: CreateMCPServerRequest) {
    return this.request<MCPServer>('/api/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateMCPServer(id: string, data: UpdateMCPServerRequest) {
    return this.request<MCPServer>(`/api/v1/mcp/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  async deleteMCPServer(id: string) {
    return this.request<null>(`/api/v1/mcp/servers/${id}`, {
      method: 'DELETE'
    });
  }

  async discoverMCPTools(serverId: string) {
    return this.request<MCPToolDefinition[]>(`/api/v1/mcp/servers/${serverId}/discover`, {
      method: 'POST'
    });
  }

  async listMCPServerTools(serverId: string) {
    return this.request<MCPToolDefinition[]>(`/api/v1/mcp/servers/${serverId}/tools`);
  }

  // ── Workforce MCP ──
  async listWorkforceMCPServers(workforceId: string) {
    return this.request<MCPServer[]>(`/api/v1/workforces/${workforceId}/mcp`);
  }

  async attachMCPServer(workforceId: string, serverId: string) {
    return this.request<{ status: string }>(`/api/v1/workforces/${workforceId}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ server_id: serverId })
    });
  }

  async detachMCPServer(workforceId: string, serverId: string) {
    return this.request<{ status: string }>(`/api/v1/workforces/${workforceId}/mcp/${serverId}`, {
      method: 'DELETE'
    });
  }

  // ── Agent Tool Permissions ──
  async setAgentTools(agentId: string, serverId: string, tools: string[]) {
    return this.request<{ status: string }>('/api/v1/mcp/agent-tools', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, server_id: serverId, tools })
    });
  }

  async getAgentTools(agentId: string, serverId: string) {
    return this.request<string[]>(`/api/v1/mcp/agent-tools/${agentId}/${serverId}`);
  }

  async listAgentMCPServers(agentId: string) {
    return this.request<AgentMCPServerWithTools[]>(`/api/v1/agents/${agentId}/mcp-servers`);
  }

  async removeAgentTools(agentId: string, serverId: string) {
    return this.request<{ status: string }>(`/api/v1/mcp/agent-tools/${agentId}/${serverId}`, {
      method: 'DELETE'
    });
  }

  // ── Knowledge Base ─────────────────────────────────────
  async listKnowledge(workforceId: string, limit = 30, offset = 0) {
    return this.request<{ entries: KnowledgeEntry[]; total: number; limit: number; offset: number }>(
      `/api/v1/workforces/${workforceId}/knowledge?limit=${limit}&offset=${offset}`
    );
  }

  async createKnowledge(workforceId: string, data: { title: string; content: string }) {
    return this.request<KnowledgeEntry>(`/api/v1/workforces/${workforceId}/knowledge`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async searchKnowledge(workforceId: string, query: string, limit?: number) {
    return this.request<KnowledgeEntry[]>(`/api/v1/workforces/${workforceId}/knowledge/search`, {
      method: 'POST',
      body: JSON.stringify({ query, limit: limit || 5 })
    });
  }

  async deleteKnowledge(workforceId: string, entryId: string) {
    return this.request<string>(`/api/v1/workforces/${workforceId}/knowledge/${entryId}`, {
      method: 'DELETE'
    });
  }

  async countKnowledge(workforceId: string) {
    return this.request<{ count: number }>(`/api/v1/workforces/${workforceId}/knowledge/count`);
  }

  async listProjectKnowledge(projectId: string) {
    return this.request<KnowledgeEntry[]>(`/api/v1/projects/${projectId}/knowledge`);
  }

  // ── Skills ──────────────────────────────────────────────
  async listSkills() {
    return this.request<Skill[]>('/api/v1/skills');
  }

  async listAgentSkills(agentId: string) {
    return this.request<Skill[]>(`/api/v1/agents/${agentId}/skills`);
  }

  async assignSkill(agentId: string, data: AssignSkillRequest) {
    return this.request<Skill[]>(`/api/v1/agents/${agentId}/skills`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async removeSkill(agentId: string, skillId: string) {
    return this.request<Skill[]>(`/api/v1/agents/${agentId}/skills/${skillId}`, {
      method: 'DELETE'
    });
  }

  // ── Approvals ───────────────────────────────────────────
  async listApprovals(workforceId: string, status?: string) {
    const qs = status ? `?status=${status}` : '';
    return this.request<Approval[]>(`/api/v1/workforces/${workforceId}/approvals${qs}`);
  }

  async getApproval(approvalId: string) {
    return this.request<Approval>(`/api/v1/approvals/${approvalId}`);
  }

  async createApproval(workforceId: string, data: CreateApprovalRequest) {
    return this.request<Approval>(`/api/v1/workforces/${workforceId}/approvals`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async resolveApproval(approvalId: string, data: ResolveApprovalRequest) {
    return this.request<Approval>(`/api/v1/approvals/${approvalId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async countPendingApprovals(workforceId: string) {
    return this.request<{ count: number }>(`/api/v1/workforces/${workforceId}/approvals/pending-count`);
  }

  // ── Activity Events ─────────────────────────────────────
  async listActivity(workforceId?: string, limit?: number) {
    const qs = limit ? `?limit=${limit}` : '';
    if (workforceId) {
      return this.request<ActivityEvent[]>(`/api/v1/workforces/${workforceId}/activity${qs}`);
    }
    return this.request<ActivityEvent[]>(`/api/v1/activity${qs}`);
  }
}

// ── Types ─────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  role: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentVariable {
  name: string;
  label: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: string;
  options?: string[];
  max_length?: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  instructions: string;
  engine_type: string;
  engine_config: Record<string, string>;
  tools: string[];
  model: string;
  model_type?: string;
  provider_id?: string;
  variables: AgentVariable[];
  strategy: string;
  max_iterations: number;
  icon: string;
  color: string;
  avatar_url: string;
  status: string;
  skill_count: number;
  created_at: string;
  updated_at: string;
}

export interface Workforce {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: string;
  icon: string;
  color: string;
  avatar_url: string;
  budget_tokens: number;
  budget_time_s: number;
  leader_agent_id?: string;
  agent_ids: string[];
  agents?: Agent[];
  workspace_path?: string;
  autonomous_mode: boolean;
  heartbeat_interval_m: number;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  workforce_id: string;
  service: string;
  key_name: string;
  value: string; // always "****" from API
  created_at: string;
  updated_at: string;
}

export type KanbanStatus = 'open' | 'todo' | 'in_progress' | 'blocked' | 'done';
export type KanbanQAStatus = 'pending' | 'passed' | 'needs_review' | 'skipped';

export interface KanbanTask {
  id: string;
  workforce_id: string;
  project_id?: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: number; // 0=low 1=normal 2=high 3=urgent
  assigned_to?: string;
  created_by: string;
  execution_id?: string;
  notes: string;
  position: number;
  qa_status: KanbanQAStatus;
  qa_notes: string;
  started_at?: string;
  done_at?: string;
  created_at: string;
  updated_at: string;
  attachments: string[];
  task_refs: string[];
}

export interface ExecutionSubtask {
  id: string;
  agent_id: string;
  agent_name: string;
  subtask: string;
  depends_on: string[];
  status: 'pending' | 'running' | 'done' | 'blocked' | 'needs_help';
  output: string;
  error_msg?: string;
}

export type ExecutionMode = 'all_agents' | 'single_agent';

export interface DeliveryFile {
  path: string;       // workspace-relative, e.g. "content/report.md"
  size_bytes: number;
  ext: string;        // lowercase, no dot
}

export interface DeliveryAction {
  service: string;      // "Bluesky", "GitHub", "Dev.to", …
  description: string;  // human-readable summary
  method?: string;      // HTTP method if applicable
  url?: string;         // sanitised target URL
}

export interface DeliveryReport {
  files: DeliveryFile[];
  actions: DeliveryAction[];
}

export interface Execution {
  id: string;
  workforce_id: string;
  project_id?: string;
  objective: string;
  strategy: string;
  plan: ExecutionSubtask[];
  status: string;
  tokens_used: number;
  iterations: number;
  title: string;
  description: string;
  image_url: string;
  result: string;
  delivery_report?: DeliveryReport;
  error_message?: string;
  elapsed_s: number;
  inputs?: Record<string, string>;
  started_at?: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
  pending_approval?: Approval;
}

export interface ExecutionWithWorkforce extends Execution {
  workforce_name: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, any>;
  result: string;
}

export interface AgentChat {
  id: string;
  agent_id: string;
  user_id?: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  tool_calls: ToolCallRecord[];
  created_at: string;
}

export interface Message {
  id: string;
  execution_id: string;
  agent_id: string;
  agent_name?: string;
  role: string;
  phase: string;
  content: string;
  iteration: number;
  tokens_input: number;
  tokens_output: number;
  model: string;
  latency_ms: number;
  tool_calls?: ToolCallRecord[];
  created_at: string;
}

export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  is_enabled: boolean;
  is_default: boolean;
  models?: ProviderModel[];
  created_at: string;
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_name: string;
  model_type: string;
  is_enabled: boolean;
}

export interface CreateProviderRequest {
  name: string;
  provider_type: string;
  base_url?: string;
  api_key?: string;
  is_default?: boolean;
  config?: Record<string, any>;
}

export interface UpdateProviderRequest {
  name?: string;
  base_url?: string;
  api_key?: string;
  is_enabled?: boolean;
  is_default?: boolean;
  config?: Record<string, any>;
}

export interface CreateProviderModelRequest {
  model_name: string;
  model_type: string;
  config?: Record<string, any>;
}

export interface CredentialField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  default?: string;
  help_text?: string;
}

export interface CredentialSchema {
  provider_type: string;
  fields: CredentialField[];
}

// ── MCP Types ────────────────────────────────────────────

export interface MCPToolDefinition {
  id?: string;
  server_id?: string;
  name: string;
  description: string;
  input_schema: Record<string, any>;
  created_at?: string;
}

export interface MCPServer {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'sse' | 'streamable_http';
  command: string;
  args: string[];
  url: string;
  headers: Record<string, string>;
  env_vars: Record<string, string>;
  is_enabled: boolean;
  icon?: string;
  tools?: MCPToolDefinition[];
  created_at: string;
  updated_at: string;
}

export interface AgentMCPServerWithTools {
  server: MCPServer;
  tools: MCPToolDefinition[];
}

export interface CreateMCPServerRequest {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable_http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env_vars?: Record<string, string>;
}

export interface UpdateMCPServerRequest {
  name?: string;
  description?: string;
  transport?: 'stdio' | 'sse' | 'streamable_http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env_vars?: Record<string, string>;
  is_enabled?: boolean;
}

// ── Knowledge Types ──────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  workforce_id: string;
  project_id?: string;
  execution_id?: string;
  agent_id?: string;
  source_type: 'execution_result' | 'agent_message' | 'manual' | 'tool_result' | 'lesson' | 'project_fact';
  title: string;
  content: string;
  embedding?: number[] | null;
  metadata?: Record<string, any>;
  similarity?: number;
  created_at: string;
}

// ── Project Types ────────────────────────────────────────

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  workforce_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  icon: string;
  color: string;
  brief: string;
  brief_updated_at?: string;
  brief_interval_m: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  status?: ProjectStatus;
  icon?: string;
  color?: string;
  brief_interval_m?: number;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  icon?: string;
  color?: string;
  brief?: string;
  brief_interval_m?: number;
}

// ── Approval Types ───────────────────────────────────────

export interface Approval {
  id: string;
  workforce_id: string;
  execution_id?: string;
  agent_id?: string;
  action_type: string;
  title: string;
  description: string;
  confidence: number;
  rubric_scores: Record<string, number>;
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  reviewer_notes: string;
  requested_by: string;
  resolved_by: string;
  created_at: string;
  resolved_at?: string;
}

export interface CreateApprovalRequest {
  execution_id?: string;
  agent_id?: string;
  action_type: string;
  title: string;
  description?: string;
  confidence?: number;
  rubric_scores?: Record<string, number>;
  payload?: Record<string, any>;
  requested_by?: string;
}

export interface ResolveApprovalRequest {
  approved: boolean;
  reviewer_notes?: string;
  resolved_by?: string;
}

// ── Activity Types ───────────────────────────────────────

export interface ActivityEvent {
  id: string;
  workforce_id?: string;
  execution_id?: string;
  actor_type: 'user' | 'agent' | 'system';
  actor_id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string;
  summary: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ExecutionEvent {
  id: string;
  execution_id: string;
  agent_id?: string;
  agent_name?: string;
  type: string;
  message: string;
  data?: Record<string, any>;
  timestamp: string;
}

export interface ExecutionQA {
  id: string;
  execution_id: string;
  question: string;
  answer: string;
  created_at: string;
}

export interface ChatReply {
  kind: 'answer' | 'action';
  id: string;
  input: string;
  answer?: string;
  action?: {
    type: 'resumed' | 'new_execution' | 'intervened';
    execution_id: string;
    message: string;
  };
}

// ── Skill Types ──────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  content: string;
  category: string;
  source: 'official' | 'community';
  author: string;
  repo_url: string;
  version: string;
  icon: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AssignSkillRequest {
  skill_id: string;
  position?: number;
}

// ── Beta Signup Types ────────────────────────────────────

export interface WorkspaceFileEntry {
  path: string; // relative to workspace root, e.g. "content/report.md"
  size: number;
  ext: string;  // lowercase, no dot
}

export interface BetaSignup {
  id: string;
  email: string;
  name: string;
  company: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export const api = new ApiClient();
export default api;
