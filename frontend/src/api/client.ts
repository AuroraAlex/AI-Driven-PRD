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

export interface Attachment {
  id: string
  filename: string
  original_name: string
  file_type: string
  file_size: number
  rag_status: 'pending' | 'indexing' | 'indexed' | 'failed'
  uploaded_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  model_used: string
  trace_id: string | null
  created_at: string
}

export interface CanvasOut {
  id: string
  project_id: string
  elements_json: string
  app_state_json: string
  files_json: string
  updated_at: string
}

export interface PRDDocument {
  id: string
  project_id: string
  template_type: string
  title: string
  content_html: string
  created_at: string
  updated_at: string
}

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

// ── Canvas ────────────────────────────────────────────────────────────────

export const canvasApi = {
  get: (projectId: string): Promise<CanvasOut | null> =>
    http.get<CanvasOut | null>(`/projects/${projectId}/canvas`).then(r => r.data),
  save: (projectId: string, payload: { elements_json: string; app_state_json: string; files_json: string }): Promise<CanvasOut> =>
    http.put<CanvasOut>(`/projects/${projectId}/canvas`, payload).then(r => r.data),
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
  create: (projectId: string, elements_json: string, app_state_json: string, label = '快照'): Promise<CanvasSnapshotOut> =>
    http.post<CanvasSnapshotOut>(`/projects/${projectId}/canvas/snapshots`, { elements_json, app_state_json, label }).then(r => r.data),
  list: (projectId: string): Promise<CanvasSnapshotMeta[]> =>
    http.get<CanvasSnapshotMeta[]>(`/projects/${projectId}/canvas/snapshots`).then(r => r.data),
  get: (projectId: string, snapshotId: string): Promise<CanvasSnapshotOut> =>
    http.get<CanvasSnapshotOut>(`/projects/${projectId}/canvas/snapshots/${snapshotId}`).then(r => r.data),
  restore: (projectId: string, snapshotId: string): Promise<CanvasSnapshotOut> =>
    http.post<CanvasSnapshotOut>(`/projects/${projectId}/canvas/snapshots/${snapshotId}/restore`).then(r => r.data),
}

// ── Files ─────────────────────────────────────────────────────────────────

export const filesApi = {
  list: (projectId: string) =>
    http.get<Attachment[]>(`/projects/${projectId}/files`).then(r => r.data),
  upload: (projectId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<Attachment>(`/projects/${projectId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  delete: (projectId: string, fileId: string) =>
    http.delete(`/projects/${projectId}/files/${fileId}`),
}

// ── Chat ──────────────────────────────────────────────────────────────────

export const chatApi = {
  history: (projectId: string) =>
    http.get<ChatMessage[]>(`/projects/${projectId}/chat/history`).then(r => r.data),
  /** Returns a fetch Response for SSE streaming */
  stream: (
    projectId: string,
    message: string,
    model: string,
    ragMode: string,
    ragEnabled: boolean = true,
  ) =>
    fetch(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model, rag_mode: ragMode, rag_enabled: ragEnabled }),
    }),
}

// ── PRD ───────────────────────────────────────────────────────────────────

export const prdApi = {
  list: (projectId: string) =>
    http.get<PRDDocument[]>(`/projects/${projectId}/prd`).then(r => r.data),
  get: (projectId: string, prdId: string) =>
    http.get<PRDDocument>(`/projects/${projectId}/prd/${prdId}`).then(r => r.data),
  update: (projectId: string, prdId: string, data: { title?: string; content_html?: string }) =>
    http.put<PRDDocument>(`/projects/${projectId}/prd/${prdId}`, data).then(r => r.data),
  generate: (projectId: string, templateType: string, model: string) =>
    fetch(`/api/projects/${projectId}/prd/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_type: templateType, model }),
    }),
}

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
