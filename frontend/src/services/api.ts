const BASE = '/api';

export type Language = 'en' | 'fi';

let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_getToken) {
    const token = await _getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function authHeadersNoContent(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (_getToken) {
    const token = await _getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface ChatRequest {
  message: string;
  agent_id: string;
  session_id?: string;
  language: Language;
  voice_mode?: boolean;
  customer_id?: string;
  agent_definition_id?: string;
}

export interface ChatResponse {
  answer: string;
  session_id: string;
  sources: { filename: string; source_path: string; source_type: string }[];
  language: Language;
}

export interface Session {
  id: string;
  title: string;
  language: string;
  created_at: string;
  updated_at: string;
  messages?: { role: string; content: string; language: string; timestamp: string }[];
}

export interface ConnectorStatus {
  id: string;
  connector_id?: string;
  agent_id: string;
  google_email?: string;
  folder_url?: string;
  status: string;
  total_files: number;
  processed_files: number;
  last_sync?: string;
  error?: string;
  scope?: KnowledgeScope;
  customer_id?: string | null;
  agent_definition_id?: string | null;
}

export interface UploadResult {
  document_id: string;
  filename: string;
  status: string;
  chunks_created: number;
  scope?: KnowledgeScope;
  customer_id?: string | null;
}

export type KnowledgeScope = 'org_wide' | 'customer';

export interface KnowledgeSource {
  id: string;
  source_type: string;
  source_path: string;
  filename: string;
  scope: KnowledgeScope;
  customer_id?: string | null;
  agent_definition_id?: string | null;
  status: string;
  chunks_created: number;
  created_at?: string;
}

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  slug?: string;
  industry?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentDefinition {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  customer_id?: string | null;
  preferred_language: Language;
  instructions?: string;
  active_prompt_version_id?: string | null;
  scope_policy?: { include_org_wide: boolean; customer_ids: string[] };
}

export interface Agent {
  agent_id: string;
  name: string;
  preferred_language: Language;
}

export interface WorkSpec {
  id: string;
  agent_definition_id: string;
  customer_id?: string | null;
  spec: Record<string, any>;
  source_text?: string;
}

export interface PromptVersion {
  id: string;
  agent_definition_id: string;
  work_spec_id?: string;
  system_prompt: string;
}

export interface ToolDefinition {
  id: string;
  agent_definition_id: string;
  name: string;
  description: string;
  input_schema: Record<string, any>;
  output_schema: Record<string, any>;
  integration_notes?: string;
  status: string;
  mock_output: Record<string, any>;
}

export interface TestCase {
  id: string;
  category: string;
  scenario: string;
  conversation: Record<string, any>[];
  pass_criteria: string[];
}

export interface TestRun {
  id: string;
  status: string;
  pass_count: number;
  fail_count: number;
  results: Record<string, any>[];
  blind_spot_report?: Record<string, any>;
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function streamChat(
  req: ChatRequest,
  onMeta: (meta: { session_id: string; sources: ChatResponse['sources'] }) => void,
  onToken: (token: string) => void,
  onDone: () => void,
) {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await res.text());

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === 'meta') onMeta(data);
      else if (data.type === 'token') onToken(data.content);
      else if (data.type === 'done') onDone();
    }
  }
}

export async function transcribeAudio(audioBlob: Blob, language: Language, agentId: string): Promise<string> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.wav');
  formData.append('language', language);
  formData.append('agent_id', agentId);

  const res = await fetch(`${BASE}/voice/transcribe`, {
    method: 'POST',
    headers: await authHeadersNoContent(),
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.text;
}

export async function synthesizeSpeech(text: string, language: Language): Promise<Blob> {
  const res = await fetch(`${BASE}/voice/synthesize`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function uploadDocuments(
  files: File[],
  agentId: string,
  scope: KnowledgeScope = 'org_wide',
  customerId?: string,
  agentDefinitionId?: string,
): Promise<UploadResult[]> {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  formData.append('agent_id', agentId);
  formData.append('scope', scope);
  if (customerId) formData.append('customer_id', customerId);
  if (agentDefinitionId) formData.append('agent_definition_id', agentDefinitionId);

  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    headers: await authHeadersNoContent(),
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listKnowledgeSources(params: {
  scope?: KnowledgeScope;
  customerId?: string;
  agentDefinitionId?: string;
  limit?: number;
} = {}): Promise<KnowledgeSource[]> {
  const query = new URLSearchParams();
  if (params.scope) query.set('scope', params.scope);
  if (params.customerId) query.set('customer_id', params.customerId);
  if (params.agentDefinitionId) query.set('agent_definition_id', params.agentDefinitionId);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`${BASE}/documents/sources${qs}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getGoogleAuthUrl(agentId: string): Promise<{ auth_url: string; state: string }> {
  const res = await fetch(`${BASE}/connectors/google/auth-url?agent_id=${agentId}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function scanDrive(
  connectorId: string,
  agentId: string,
  folderUrl?: string,
  scope: KnowledgeScope = 'org_wide',
  customerId?: string,
  agentDefinitionId?: string,
): Promise<ConnectorStatus> {
  const res = await fetch(`${BASE}/connectors/google/scan/${connectorId}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      agent_id: agentId,
      folder_url: folderUrl || null,
      scope,
      customer_id: customerId || null,
      agent_definition_id: agentDefinitionId || null,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getConnectorStatus(connectorId: string, agentId: string): Promise<ConnectorStatus> {
  const res = await fetch(`${BASE}/connectors/status/${connectorId}?agent_id=${agentId}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listConnectors(agentId: string): Promise<ConnectorStatus[]> {
  const res = await fetch(`${BASE}/connectors/?agent_id=${agentId}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteConnector(connectorId: string): Promise<void> {
  const res = await fetch(`${BASE}/connectors/${connectorId}`, {
    method: 'DELETE',
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function listSessions(agentId: string): Promise<Session[]> {
  const res = await fetch(`${BASE}/history/sessions?agent_id=${agentId}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSession(sessionId: string, agentId: string): Promise<Session> {
  const res = await fetch(`${BASE}/history/sessions/${sessionId}?agent_id=${agentId}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSession(sessionId: string, agentId: string): Promise<void> {
  await fetch(`${BASE}/history/sessions/${sessionId}?agent_id=${agentId}`, {
    method: 'DELETE',
    headers: await authHeadersNoContent(),
  });
}

export async function listAgents(): Promise<AgentDefinition[]> {
  const res = await fetch(`${BASE}/agents/`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createOrUpdateAgent(agent: Partial<AgentDefinition> & { name: string }): Promise<AgentDefinition> {
  const res = await fetch(`${BASE}/agents/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listCustomers(): Promise<Customer[]> {
  const res = await fetch(`${BASE}/customers/`, { headers: await authHeadersNoContent() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCustomer(customer: { name: string; industry?: string; notes?: string }): Promise<Customer> {
  const res = await fetch(`${BASE}/customers/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(customer),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAgentDefinition(agent: {
  name: string;
  description?: string;
  customer_id?: string | null;
  preferred_language?: Language;
  instructions?: string;
}): Promise<AgentDefinition> {
  const res = await fetch(`${BASE}/agents/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateAgentDefinition(id: string, agent: Partial<AgentDefinition>): Promise<AgentDefinition> {
  const res = await fetch(`${BASE}/agents/${id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateWorkSpec(payload: {
  agent_definition_id: string;
  customer_id?: string | null;
  discovery_text: string;
  customer_name?: string;
  industry_hint?: string;
}): Promise<WorkSpec> {
  const res = await fetch(`${BASE}/builder/work-specs/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listWorkSpecs(agentDefinitionId?: string): Promise<WorkSpec[]> {
  const qs = agentDefinitionId ? `?agent_definition_id=${encodeURIComponent(agentDefinitionId)}` : '';
  const res = await fetch(`${BASE}/builder/work-specs${qs}`, { headers: await authHeadersNoContent() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generatePrompt(agentDefinitionId: string, workSpecId: string): Promise<PromptVersion> {
  const res = await fetch(`${BASE}/builder/prompts/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_definition_id: agentDefinitionId, work_spec_id: workSpecId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listPrompts(agentDefinitionId?: string): Promise<PromptVersion[]> {
  const qs = agentDefinitionId ? `?agent_definition_id=${encodeURIComponent(agentDefinitionId)}` : '';
  const res = await fetch(`${BASE}/builder/prompts${qs}`, { headers: await authHeadersNoContent() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateTools(agentDefinitionId: string, workSpecId: string): Promise<ToolDefinition[]> {
  const res = await fetch(`${BASE}/builder/tools/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_definition_id: agentDefinitionId, work_spec_id: workSpecId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTools(agentDefinitionId?: string): Promise<ToolDefinition[]> {
  const qs = agentDefinitionId ? `?agent_definition_id=${encodeURIComponent(agentDefinitionId)}` : '';
  const res = await fetch(`${BASE}/builder/tools${qs}`, { headers: await authHeadersNoContent() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateTestCases(agentDefinitionId: string, workSpecId: string, promptVersionId?: string): Promise<TestCase[]> {
  const res = await fetch(`${BASE}/builder/test-cases/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_definition_id: agentDefinitionId, work_spec_id: workSpecId, prompt_version_id: promptVersionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listTestCases(agentDefinitionId?: string): Promise<TestCase[]> {
  const qs = agentDefinitionId ? `?agent_definition_id=${encodeURIComponent(agentDefinitionId)}` : '';
  const res = await fetch(`${BASE}/builder/test-cases${qs}`, { headers: await authHeadersNoContent() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function runTestCases(agentDefinitionId: string, promptVersionId?: string): Promise<TestRun> {
  const res = await fetch(`${BASE}/builder/test-runs`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_definition_id: agentDefinitionId, prompt_version_id: promptVersionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPromptfooConfig(agentDefinitionId: string, promptVersionId?: string) {
  const query = new URLSearchParams({ agent_definition_id: agentDefinitionId });
  if (promptVersionId) query.set('prompt_version_id', promptVersionId);
  const res = await fetch(`${BASE}/builder/promptfoo?${query.toString()}`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createWhatsAppTestDeploy(agentDefinitionId: string, promptVersionId?: string, testNumber?: string) {
  const res = await fetch(`${BASE}/whatsapp/test-deploy`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_definition_id: agentDefinitionId, prompt_version_id: promptVersionId, test_number: testNumber }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
