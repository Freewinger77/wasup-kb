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
}

export interface UploadResult {
  document_id: string;
  filename: string;
  status: string;
  chunks_created: number;
}

export interface Agent {
  agent_id: string;
  name: string;
  preferred_language: Language;
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

export async function uploadDocuments(files: File[], agentId: string): Promise<UploadResult[]> {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  formData.append('agent_id', agentId);

  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    headers: await authHeadersNoContent(),
    body: formData,
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

export async function scanDrive(connectorId: string, agentId: string, folderUrl?: string): Promise<ConnectorStatus> {
  const res = await fetch(`${BASE}/connectors/google/scan/${connectorId}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ agent_id: agentId, folder_url: folderUrl || null }),
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

export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${BASE}/history/agents`, {
    headers: await authHeadersNoContent(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createOrUpdateAgent(agent: Agent): Promise<Agent> {
  const res = await fetch(`${BASE}/history/agents`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(agent),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
