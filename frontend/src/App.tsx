import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Home from './pages/Home'
import Workspace from './pages/Workspace'

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
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}
