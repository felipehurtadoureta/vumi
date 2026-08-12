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
import MergePdf from '@/pages/MergePdf'
import HojaDeVidaPacientes from '@/hoja-de-vida/pages/Pacientes'
import Historial from '@/hoja-de-vida/pages/Historial'
import SubirInforme from '@/hoja-de-vida/pages/SubirInforme'
import DetalleInforme from '@/hoja-de-vida/pages/DetalleInforme'
import Tendencias from '@/hoja-de-vida/pages/Tendencias'
import ResumenPaciente from '@/hoja-de-vida/pages/ResumenPaciente'

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
          <Route path="unir-pdf" element={<MergePdf />} />
          <Route path="hoja-de-vida" element={<HojaDeVidaPacientes />} />
          <Route path="hoja-de-vida/tendencias" element={<Tendencias />} />
          <Route path="hoja-de-vida/tendencias/:patientId" element={<Tendencias />} />
          <Route path="hoja-de-vida/resumen" element={<ResumenPaciente />} />
          <Route path="hoja-de-vida/resumen/:patientId" element={<ResumenPaciente />} />
          <Route path="hoja-de-vida/:patientId" element={<Historial />} />
          <Route path="hoja-de-vida/:patientId/subir" element={<SubirInforme />} />
          <Route path="hoja-de-vida/:patientId/informes/:id" element={<DetalleInforme />} />
          <Route path="hoja-de-vida/:patientId/informes/:id/procesar" element={<SubirInforme />} />
        </Route>
     
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
