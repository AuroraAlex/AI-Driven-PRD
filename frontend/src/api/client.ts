import axios from 'axios'

export const http = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// ── Types ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export type ResourceKind = 'file' | 'snippet' | 'document'
export type ResourceOriginType = 'upload' | 'manual' | 'chat_message' | 'canvas_card' | 'prd_template'
export type ResourceRagStatus = 'unindexed' | 'pending' | 'indexing' | 'indexed' | 'failed'

export interface ResourceBlock {
  id: string
  project_id: string
  kind: ResourceKind
  title: string
  summary: string | null
  markdown_content: string
  origin_type: ResourceOriginType
  origin_ref: Record<string, unknown> | unknown[] | string | null
  template_type: string | null
  tags: string[]
  is_in_kb: boolean
  rag_status: ResourceRagStatus
  // file-only fields
  storage_filename: string | null
  original_filename: string | null
  file_type: string | null
  file_size: number
  extracted_text: string | null
  created_at: string
  updated_at: string
}

/** @deprecated use ResourceBlock (kind='file') */
export type Attachment = ResourceBlock

export interface ChatMessageMeta {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  rag_sources?: Array<{ mode: string | null; context: string }>
  stopped?: boolean
  edited_at?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  model_used: string
  trace_id: string | null
  meta?: ChatMessageMeta | null
  created_at: string
}

export interface CanvasOut {
  id: string
  canvas_session_id: string
  elements_json: string
  app_state_json: string
  files_json: string
  updated_at: string
}

export interface CanvasSession {
  id: string
  project_id: string
  title: string
  order_index: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ChatSession {
  id: string
  project_id: string
  title: string
  order_index: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type ReferenceNodeType = 'canvas_card' | 'chat_message' | 'prd_section' | 'rag_chunk' | 'file'
export type ReferenceRelation = 'cites' | 'derived_from' | 'mentions' | 'embedded_in'

export interface ReferenceEdge {
  id: string
  project_id: string
  source_type: ReferenceNodeType
  source_id: string
  source_session_id: string | null
  target_type: ReferenceNodeType
  target_id: string
  target_session_id: string | null
  relation: ReferenceRelation
  metadata_json: string | null
  created_at: string
}

export interface AICardSource {
  type: 'file' | 'canvas_card' | 'rag_chunk' | 'chat_message' | 'prd_section'
  id: string
  label: string
}

export interface AICardContent {
  schemaVersion: number
  markdown: string
  summary: string
  sources: AICardSource[]
  prompt: string
  model: string
  generated_at: number
  version: number
}

export interface RAGSource {
  id: string
  source_type: 'file' | 'canvas' | 'chat' | 'prd'
  source_session_id: string | null
  source_ref: string | null
  doc_id: string
  status: 'pending' | 'indexing' | 'indexed' | 'failed' | 'unindexed'
  indexed_at: string | null
  error_msg: string | null
}

/** Document resource — alias of ResourceBlock with kind='document'. */
export type PRDDocument = ResourceBlock

// ── Projects ──────────────────────────────────────────────────────────────

export const projectsApi = {
  list: () => http.get<Project[]>('/projects').then(r => r.data),
  get: (id: string) => http.get<Project>(`/projects/${id}`).then(r => r.data),
  create: (name: string, description = '') =>
    http.post<Project>('/projects', { name, description }).then(r => r.data),
  update: (id: string, data: Partial<{ name: string; description: string }>) =>
    http.patch<Project>(`/projects/${id}`, data).then(r => r.data),
  delete: (id: string) => http.delete(`/projects/${id}`),
}

// ── Canvas Sessions ───────────────────────────────────────────────────────

export const canvasSessionsApi = {
  list: (projectId: string) =>
    http.get<CanvasSession[]>(`/projects/${projectId}/canvas-sessions`).then(r => r.data),
  create: (projectId: string, title = '新画布'): Promise<CanvasSession> =>
    http.post<CanvasSession>(`/projects/${projectId}/canvas-sessions`, { title }).then(r => r.data),
  update: (projectId: string, sessionId: string, data: { title?: string; order_index?: number; archived?: boolean }) =>
    http.patch<CanvasSession>(`/projects/${projectId}/canvas-sessions/${sessionId}`, data).then(r => r.data),
  delete: (projectId: string, sessionId: string) =>
    http.delete(`/projects/${projectId}/canvas-sessions/${sessionId}`),
}

// ── Canvas (per-session) ──────────────────────────────────────────────────

export const canvasApi = {
  get: (projectId: string, sessionId: string): Promise<CanvasOut | null> =>
    http.get<CanvasOut | null>(`/projects/${projectId}/canvas-sessions/${sessionId}/canvas`).then(r => r.data),
  save: (projectId: string, sessionId: string, payload: { elements_json: string; app_state_json: string; files_json: string }): Promise<CanvasOut> =>
    http.put<CanvasOut>(`/projects/${projectId}/canvas-sessions/${sessionId}/canvas`, payload).then(r => r.data),
}

// ── Canvas Snapshots ──────────────────────────────────────────────────────

export interface CanvasSnapshotMeta {
  id: string
  label: string
  created_at: string
}

export interface CanvasSnapshotOut extends CanvasSnapshotMeta {
  elements_json: string
  app_state_json: string
}

export const canvasSnapshotApi = {
  create: (projectId: string, sessionId: string, elements_json: string, app_state_json: string, label = '快照'): Promise<CanvasSnapshotOut> =>
    http.post<CanvasSnapshotOut>(`/projects/${projectId}/canvas-sessions/${sessionId}/snapshots`, { elements_json, app_state_json, label }).then(r => r.data),
  list: (projectId: string, sessionId: string): Promise<CanvasSnapshotMeta[]> =>
    http.get<CanvasSnapshotMeta[]>(`/projects/${projectId}/canvas-sessions/${sessionId}/snapshots`).then(r => r.data),
  get: (projectId: string, sessionId: string, snapshotId: string): Promise<CanvasSnapshotOut> =>
    http.get<CanvasSnapshotOut>(`/projects/${projectId}/canvas-sessions/${sessionId}/snapshots/${snapshotId}`).then(r => r.data),
  restore: (projectId: string, sessionId: string, snapshotId: string): Promise<CanvasSnapshotOut> =>
    http.post<CanvasSnapshotOut>(`/projects/${projectId}/canvas-sessions/${sessionId}/snapshots/${snapshotId}/restore`).then(r => r.data),
}

// ── Chat Sessions ─────────────────────────────────────────────────────────

export const chatSessionsApi = {
  list: (projectId: string) =>
    http.get<ChatSession[]>(`/projects/${projectId}/chat-sessions`).then(r => r.data),
  create: (projectId: string, title = '新对话'): Promise<ChatSession> =>
    http.post<ChatSession>(`/projects/${projectId}/chat-sessions`, { title }).then(r => r.data),
  update: (projectId: string, sessionId: string, data: { title?: string; order_index?: number; archived?: boolean }) =>
    http.patch<ChatSession>(`/projects/${projectId}/chat-sessions/${sessionId}`, data).then(r => r.data),
  delete: (projectId: string, sessionId: string) =>
    http.delete(`/projects/${projectId}/chat-sessions/${sessionId}`),
}

// ── Resources (files + snippets + documents) ─────────────────────────────

export interface ResourceCreatePayload {
  kind: 'snippet' | 'document'
  title?: string
  markdown_content?: string
  summary?: string | null
  origin_type?: ResourceOriginType
  origin_ref?: Record<string, unknown> | null
  template_type?: string | null
  tags?: string[]
}

export interface ResourceUpdatePayload {
  title?: string
  markdown_content?: string
  summary?: string | null
  kind?: 'snippet' | 'document'
  tags?: string[]
}

export const resourcesApi = {
  list: (projectId: string, params: { kind?: ResourceKind; in_kb?: boolean } = {}) =>
    http.get<ResourceBlock[]>(`/projects/${projectId}/resources`, { params }).then(r => r.data),
  get: (projectId: string, resourceId: string) =>
    http.get<ResourceBlock>(`/projects/${projectId}/resources/${resourceId}`).then(r => r.data),
  create: (projectId: string, body: ResourceCreatePayload) =>
    http.post<ResourceBlock>(`/projects/${projectId}/resources`, body).then(r => r.data),
  update: (projectId: string, resourceId: string, body: ResourceUpdatePayload) =>
    http.patch<ResourceBlock>(`/projects/${projectId}/resources/${resourceId}`, body).then(r => r.data),
  delete: (projectId: string, resourceId: string) =>
    http.delete(`/projects/${projectId}/resources/${resourceId}`),
  upload: (projectId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<ResourceBlock>(`/projects/${projectId}/resources/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  index: (projectId: string, resourceId: string) =>
    http.post<ResourceBlock>(`/projects/${projectId}/resources/${resourceId}/index`).then(r => r.data),
  unindex: (projectId: string, resourceId: string) =>
    http.delete<ResourceBlock>(`/projects/${projectId}/resources/${resourceId}/index`).then(r => r.data),
}

/** @deprecated use resourcesApi */
export const filesApi = {
  list: (projectId: string) => resourcesApi.list(projectId, { kind: 'file' }),
  upload: (projectId: string, file: File) => resourcesApi.upload(projectId, file),
  delete: (projectId: string, fileId: string) => resourcesApi.delete(projectId, fileId),
}

// ── Chat ──────────────────────────────────────────────────────────────────

export interface ChatStreamOptions {
  message: string
  model: string
  ragMode: string
  ragEnabled?: boolean
  includeCanvasContext?: boolean
  canvasContextMode?: 'full' | 'summary'
  canvasSessionIds?: string[]
}

export const chatApi = {
  history: (projectId: string, sessionId: string) =>
    http.get<ChatMessage[]>(`/projects/${projectId}/chat-sessions/${sessionId}/messages`).then(r => r.data),
  /** Returns a fetch Response for SSE streaming. Pass `signal` to allow abort. */
  stream: (projectId: string, sessionId: string, opts: ChatStreamOptions, signal?: AbortSignal) =>
    fetch(`/api/projects/${projectId}/chat-sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        message: opts.message,
        model: opts.model,
        rag_mode: opts.ragMode,
        rag_enabled: opts.ragEnabled ?? true,
        include_canvas_context: opts.includeCanvasContext ?? true,
        canvas_context_mode: opts.canvasContextMode ?? 'full',
        canvas_session_ids: opts.canvasSessionIds ?? [],
      }),
    }),
  /** Re-stream from a given user message (deletes any messages after it). */
  regenerate: (projectId: string, sessionId: string, messageId: string, opts: ChatStreamOptions, signal?: AbortSignal) =>
    fetch(`/api/projects/${projectId}/chat-sessions/${sessionId}/messages/${messageId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        message: opts.message,
        model: opts.model,
        rag_mode: opts.ragMode,
        rag_enabled: opts.ragEnabled ?? true,
        include_canvas_context: opts.includeCanvasContext ?? true,
        canvas_context_mode: opts.canvasContextMode ?? 'full',
        canvas_session_ids: opts.canvasSessionIds ?? [],
      }),
    }),
  editMessage: (projectId: string, sessionId: string, messageId: string, content: string) =>
    http.patch<ChatMessage>(
      `/projects/${projectId}/chat-sessions/${sessionId}/messages/${messageId}`,
      { content },
    ).then(r => r.data),
  deleteMessage: (projectId: string, sessionId: string, messageId: string) =>
    http.delete(`/projects/${projectId}/chat-sessions/${sessionId}/messages/${messageId}`),
  /** Export a chat message (full or selected substring) into a resource block. */
  exportMessage: (
    projectId: string,
    sessionId: string,
    messageId: string,
    body: { target: 'canvas' | 'document'; selection?: string; title?: string; canvas_session_id?: string | null },
  ) =>
    http.post<{
      resource_id: string
      kind: 'snippet' | 'document'
      title: string
      markdown: string
      target: 'canvas' | 'document'
      canvas_payload: AICardContent | null
    }>(
      `/projects/${projectId}/chat-sessions/${sessionId}/messages/${messageId}/export`,
      body,
    ).then(r => r.data),
  /** Export multiple chat messages as a single Markdown document resource. */
  exportMessagesBatch: (
    projectId: string,
    sessionId: string,
    body: { message_ids: string[]; title?: string; include_role_labels?: boolean },
  ) =>
    http.post<{ resource_id: string; title: string; message_count: number }>(
      `/projects/${projectId}/chat-sessions/${sessionId}/messages/export-batch`,
      body,
    ).then(r => r.data),
}

// ── References ────────────────────────────────────────────────────────────

export const referencesApi = {
  list: (projectId: string, params: { node_type: ReferenceNodeType; node_id: string; direction?: 'outgoing' | 'incoming' | 'both' }) =>
    http.get<ReferenceEdge[]>(`/projects/${projectId}/references`, { params }).then(r => r.data),
  create: (projectId: string, data: {
    source_type: ReferenceNodeType; source_id: string; source_session_id?: string | null
    target_type: ReferenceNodeType; target_id: string; target_session_id?: string | null
    relation: ReferenceRelation; metadata_json?: string | null
  }) =>
    http.post<ReferenceEdge>(`/projects/${projectId}/references`, data).then(r => r.data),
  delete: (projectId: string, refId: string) =>
    http.delete(`/projects/${projectId}/references/${refId}`),
}

// ── AI Cards ──────────────────────────────────────────────────────────────

export interface AICardGenerateRequest {
  prompt: string
  model: string
  ragMode?: string
  ragEnabled?: boolean
  canvasSessionIds?: string[]
  canvasContextMode?: 'full' | 'summary'
}

export const aiCardsApi = {
  generate: (projectId: string, opts: AICardGenerateRequest) =>
    fetch(`/api/projects/${projectId}/ai-cards/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt,
        model: opts.model,
        rag_mode: opts.ragMode ?? 'hybrid',
        rag_enabled: opts.ragEnabled ?? true,
        canvas_session_ids: opts.canvasSessionIds ?? [],
        canvas_context_mode: opts.canvasContextMode ?? 'full',
      }),
    }),
}

// ── Knowledge / RAG ───────────────────────────────────────────────────────

export const knowledgeApi = {
  status: (projectId: string) =>
    http.get<Array<{ file_id: string; filename: string; rag_status: string }>>(`/projects/${projectId}/rag/status`).then(r => r.data),
  sources: (projectId: string) =>
    http.get<RAGSource[]>(`/projects/${projectId}/rag/sources`).then(r => r.data),
  sync: (projectId: string, data: { source_type: 'canvas' | 'chat' | 'prd'; session_ids?: string[] }) =>
    http.post<{ indexed: string[]; failed: { doc_id: string; error: string }[] }>(`/projects/${projectId}/rag/sync`, data).then(r => r.data),
  rebuild: (projectId: string) =>
    http.post<{ message: string }>(`/projects/${projectId}/rag/rebuild`).then(r => r.data),
  reset: (projectId: string) =>
    http.post<{ message: string }>(`/projects/${projectId}/rag/reset`).then(r => r.data),
  query: (projectId: string, data: { query: string; mode?: string; model?: string }) =>
    http.post<{ query: string; mode: string; results: unknown[] }>(`/projects/${projectId}/rag/query`, data).then(r => r.data),
}

// ── Documents (Markdown PRDs / docs) ──────────────────────────────────────

export const documentsApi = {
  list: (projectId: string) => resourcesApi.list(projectId, { kind: 'document' }),
  get: (projectId: string, id: string) => resourcesApi.get(projectId, id),
  update: (projectId: string, id: string, data: { title?: string; markdown_content?: string }) =>
    resourcesApi.update(projectId, id, data),
  generate: (projectId: string, templateType: string, model: string) =>
    fetch(`/api/projects/${projectId}/prd/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_type: templateType, model }),
    }),
}

/** @deprecated use documentsApi */
export const prdApi = documentsApi

// ── Export ────────────────────────────────────────────────────────────────

export const exportApi = {
  docx: (prdId: string) => `/api/prd/${prdId}/export/docx`,
  pdf: (prdId: string) => `/api/prd/${prdId}/export/pdf`,
  pptx: (prdId: string, templateId?: string) =>
    http.post(`/prd/${prdId}/export/pptx`, { template_id: templateId ?? null }, {
      responseType: 'blob',
    }).then(r => r.data as Blob),
}

// ── Settings ──────────────────────────────────────────────────────────────

export interface ProviderStatus {
  configured: boolean
  preview: string
}

export interface SettingsOut {
  openai: ProviderStatus
  anthropic: ProviderStatus
  dashscope: ProviderStatus
}

export interface SettingsIn {
  openai_api_key?: string | null
  anthropic_api_key?: string | null
  dashscope_api_key?: string | null
}

export interface ModelInfo {
  label: string
  value: string
  provider: string
}

export const settingsApi = {
  get: () => http.get<SettingsOut>('/settings').then(r => r.data),
  update: (data: SettingsIn) => http.put<SettingsOut>('/settings', data).then(r => r.data),
  models: () => http.get<{ models: ModelInfo[] }>('/settings/models').then(r => r.data.models),
  verify: (provider: string, api_key: string) =>
    http.post<{ valid: boolean; message: string }>('/settings/verify', { provider, api_key }).then(r => r.data),
  verifyModel: (model: string) =>
    http.post<{ valid: boolean; message: string }>('/settings/verify-model', { model }).then(r => r.data),
}
