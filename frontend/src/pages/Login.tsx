import { useState } from 'react'
import { signInWithEmail } from '@/lib/supabase'
import { Loader2, Mail, CheckCircle } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('felipehurtadoureta@gmail.com')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await signInWithEmail(email)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

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

            {error && (
              <p className="text-sm text-red-600 text-left">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> Enviando...</>
              ) : (
                <><Mail size={18} /> Entrar con magic link</>
              )}
            </button>

            <p className="text-xs text-gray-400">
              Te enviaremos un link al correo — sin contraseña
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
