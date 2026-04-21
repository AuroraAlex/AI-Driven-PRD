import { create } from 'zustand'
import type { ChatMessage } from '../api/client'

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  streamBuffer: string
  model: string
  ragMode: string
  setMessages: (m: ChatMessage[]) => void
  addMessage: (m: ChatMessage) => void
  setStreaming: (v: boolean) => void
  appendToken: (token: string) => void
  clearBuffer: () => void
  setModel: (m: string) => void
  setRagMode: (m: string) => void
}

export const useChatStore = create<ChatState>(set => ({
  messages: [],
  streaming: false,
  streamBuffer: '',
  model: 'openai/gpt-4o',
  ragMode: 'hybrid',
  setMessages: messages => set({ messages }),
  addMessage: m => set(s => ({ messages: [...s.messages, m] })),
  setStreaming: streaming => set({ streaming }),
  appendToken: token => set(s => ({ streamBuffer: s.streamBuffer + token })),
  clearBuffer: () => set({ streamBuffer: '' }),
  setModel: model => set({ model }),
  setRagMode: ragMode => set({ ragMode }),
}))
