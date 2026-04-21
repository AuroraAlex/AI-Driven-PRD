import { create } from 'zustand'
import type { PRDDocument } from '../api/client'

interface PRDState {
  documents: PRDDocument[]
  current: PRDDocument | null
  generating: boolean
  setDocuments: (d: PRDDocument[]) => void
  setCurrent: (d: PRDDocument | null) => void
  upsert: (d: PRDDocument) => void
  setGenerating: (v: boolean) => void
}

export const usePRDStore = create<PRDState>(set => ({
  documents: [],
  current: null,
  generating: false,
  setDocuments: documents => set({ documents }),
  setCurrent: current => set({ current }),
  upsert: d =>
    set(s => {
      const idx = s.documents.findIndex(x => x.id === d.id)
      const documents = idx >= 0
        ? s.documents.map(x => (x.id === d.id ? d : x))
        : [d, ...s.documents]
      return { documents, current: s.current?.id === d.id ? d : s.current }
    }),
  setGenerating: generating => set({ generating }),
}))
