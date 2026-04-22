import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage } from '../api/client'

export interface ChatSessionPrefs {
  includeCanvasContext: boolean
  canvasContextMode: 'full' | 'summary'
  canvasSessionIds: string[]
}

const defaultPrefs = (): ChatSessionPrefs => ({
  includeCanvasContext: true,
  canvasContextMode: 'full',
  canvasSessionIds: [],
})

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  streamBuffer: string
  provider: string               // e.g. 'openai' | 'anthropic' | 'dashscope'
  model: string                  // full LiteLLM id, e.g. 'dashscope/qwen-plus'
  customModels: Record<string, string>  // per-provider user-defined model id
  ragEnabled: boolean
  ragMode: string
  /** chat_session_id → preferences */
  sessionPrefs: Record<string, ChatSessionPrefs>
  setMessages: (m: ChatMessage[]) => void
  addMessage: (m: ChatMessage) => void
  setStreaming: (v: boolean) => void
  appendToken: (token: string) => void
  clearBuffer: () => void
  setProvider: (p: string) => void
  setModel: (m: string) => void
  setCustomModel: (provider: string, modelId: string) => void
  setRagEnabled: (v: boolean) => void
  setRagMode: (m: string) => void
  getPrefs: (sessionId: string) => ChatSessionPrefs
  updatePrefs: (sessionId: string, patch: Partial<ChatSessionPrefs>) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      streaming: false,
      streamBuffer: '',
      provider: '',
      model: '',
      customModels: {},
      ragEnabled: true,
      ragMode: 'hybrid',
      sessionPrefs: {},
      setMessages: messages => set({ messages }),
      addMessage: m => set(s => ({ messages: [...s.messages, m] })),
      setStreaming: streaming => set({ streaming }),
      appendToken: token => set(s => ({ streamBuffer: s.streamBuffer + token })),
      clearBuffer: () => set({ streamBuffer: '' }),
      setProvider: provider => set({ provider }),
      setModel: model => set({ model }),
      setCustomModel: (provider, modelId) =>
        set(s => ({ customModels: { ...s.customModels, [provider]: modelId } })),
      setRagEnabled: ragEnabled => set({ ragEnabled }),
      setRagMode: ragMode => set({ ragMode }),
      getPrefs: sessionId => get().sessionPrefs[sessionId] ?? defaultPrefs(),
      updatePrefs: (sessionId, patch) =>
        set(s => ({
          sessionPrefs: {
            ...s.sessionPrefs,
            [sessionId]: { ...(s.sessionPrefs[sessionId] ?? defaultPrefs()), ...patch },
          },
        })),
    }),
    {
      name: 'ai-prd-chat',
      partialize: (s) => ({
        provider: s.provider,
        model: s.model,
        customModels: s.customModels,
        ragEnabled: s.ragEnabled,
        ragMode: s.ragMode,
        sessionPrefs: s.sessionPrefs,
      }),
    },
  ),
)
