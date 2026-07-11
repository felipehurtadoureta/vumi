import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import Layout from '@/components/layout/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Cases from '@/pages/Cases'
import CaseDetail from '@/pages/CaseDetail'
import Resumen from '@/pages/Resumen'
import Papelera from '@/pages/Papelera'
import NewCase from '@/pages/NewCase'
import Patients from '@/pages/Patients'
import Documents from '@/pages/Documents'
import Upload from '@/pages/Upload'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { userId } = useStore()
  if (!userId) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const { setUserId } = useStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-green-600 text-sm">Cargando...</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/new" element={<NewCase />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="resumen" element={<Resumen />} />
          <Route path="papelera" element={<Papelera />} />
          <Route path="patients" element={<Patients />} />
          <Route path="documents" element={<Documents />} />
          <Route path="upload" element={<Upload />} />
        </Route>
     
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
