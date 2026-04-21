import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage } from '../api/client'

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  streamBuffer: string
  provider: string               // e.g. 'openai' | 'anthropic' | 'dashscope'
  model: string                  // full LiteLLM id, e.g. 'dashscope/qwen-plus'
  customModels: Record<string, string>  // per-provider user-defined model id
  ragEnabled: boolean
  ragMode: string
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
}

export const useChatStore = create<ChatState>()(
  persist(
    set => ({
      messages: [],
      streaming: false,
      streamBuffer: '',
      provider: '',
      model: '',
      customModels: {},
      ragEnabled: true,
      ragMode: 'hybrid',
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
    }),
    {
      name: 'ai-prd-chat',
      partialize: (s) => ({
        provider: s.provider,
        model: s.model,
        customModels: s.customModels,
        ragEnabled: s.ragEnabled,
        ragMode: s.ragMode,
      }),
    },
  ),
)
