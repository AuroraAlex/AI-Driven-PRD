import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Home from './pages/Home'
import Workspace from './pages/Workspace'
import DocumentEditor from './pages/DocumentEditor'
import ProjectOverview from './pages/ProjectOverview'
import KnowledgeBase from './pages/KnowledgeBase'

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workspace/:projectId" element={<Workspace />} />
          <Route path="/projects/:projectId/overview" element={<ProjectOverview />} />
          <Route path="/projects/:projectId/knowledge" element={<KnowledgeBase />} />
          <Route path="/projects/:projectId/docs/:resourceId" element={<DocumentEditor />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}
