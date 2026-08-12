import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FolderOpen, BarChart2, Users, LogOut, Trash2, Library, Layers, HeartPulse,
} from 'lucide-react'
import { signOut } from '@/lib/supabase'
import clsx from 'clsx'

const nav = [
  { to: '/',            icon: LayoutDashboard, label: 'Inicio'          },
  { to: '/cases',       icon: FolderOpen,      label: 'Casos'           },
  { to: '/documents',   icon: Library,         label: 'Documentos'      },
  { to: '/resumen',     icon: BarChart2,       label: 'Resumen'         },
  { to: '/patients',    icon: Users,           label: 'Pacientes'       },
  { to: '/unir-pdf',    icon: Layers,          label: 'Unir PDF'        },
  { to: '/hoja-de-vida', icon: HeartPulse,     label: 'Hoja de Vida'    },
]

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 h-screen sticky top-0 bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="text-lg font-bold text-green-700">Vumi</span>
        <span className="text-xs text-gray-400 block">Reembolsos medicos</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-green-50 text-green-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-1">
        <NavLink
          to="/papelera"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-red-50 text-red-600 font-medium'
                : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            )
          }
        >
          <Trash2 size={16} />
          Papelera
        </NavLink>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <LogOut size={16} />
          Cerrar sesion
        </button>
      </div>
    </aside>
  )
}
