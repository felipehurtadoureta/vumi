import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { signInWithEmail, signInWithPassword } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { Loader2, Mail, CheckCircle, Lock } from 'lucide-react'

export default function Login() {
  const navigate = useNavigate()
  const { userId } = useStore()
  const [email, setEmail] = useState('felipehurtadoureta@gmail.com')
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(true)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (usePassword) {
      const { error } = await signInWithPassword(email, password)
      if (error) {
        setError(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message)
        setLoading(false)
        return
      }
      // Login exitoso: App.tsx actualiza userId vía el listener de sesión,
      // pero nada saca de /login automáticamente — hay que navegar a mano.
      setLoading(false)
      navigate('/', { replace: true })
      return
    }

    const { error } = await signInWithEmail(email)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  // Ya hay sesión activa (ej. al volver atrás con el navegador) — no quedarse en /login
  if (userId) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex items-center justify-center">
      <div className="card max-w-sm w-full text-center p-10">
        <div className="text-4xl font-bold text-green-700 mb-2">Vumi</div>
        <p className="text-gray-500 text-sm mb-8">Sistema de reembolsos médicos familiares</p>

        {sent ? (
          <div className="text-center">
            <CheckCircle size={40} className="text-green-500 mx-auto mb-4" />
            <p className="font-medium text-gray-900 mb-2">¡Revisa tu correo!</p>
            <p className="text-sm text-gray-500">
              Te enviamos un link de acceso a <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="text-left">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                required
              />
            </div>

            {usePassword && (
              <div className="text-left">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  required
                  autoFocus
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 text-left">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> {usePassword ? 'Entrando...' : 'Enviando...'}</>
              ) : usePassword ? (
                <><Lock size={18} /> Entrar</>
              ) : (
                <><Mail size={18} /> Entrar con magic link</>
              )}
            </button>

            <button
              type="button"
              onClick={() => { setUsePassword(!usePassword); setError('') }}
              className="text-xs text-gray-400 hover:text-green-600 underline underline-offset-2"
            >
              {usePassword ? 'Prefiero usar magic link' : 'Prefiero usar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
