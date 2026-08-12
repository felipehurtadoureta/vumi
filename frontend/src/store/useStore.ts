import { create } from 'zustand'
import type { Patient, MedicalCase, Document } from '@/lib/types'

interface AppState {
  // Auth
  userId: string | null
  setUserId: (id: string | null) => void

  // Patients
  patients: Patient[]
  setPatients: (p: Patient[]) => void

  // Cases
  cases: MedicalCase[]
  setCases: (c: MedicalCase[]) => void
  updateCase: (id: string, data: Partial<MedicalCase>) => void

  // Documents (inbox — sin caso asignado)
  unassignedDocs: Document[]
  setUnassignedDocs: (d: Document[]) => void

  // UI
  uploadOpen: boolean
  setUploadOpen: (open: boolean) => void

  // Hoja de Vida Médica — archivo(s) soltado(s) (drag&drop) en la pantalla de
  // historial, pendientes de procesar en la pantalla de subir informe.
  pendingHistorialFiles: File[]
  setPendingHistorialFiles: (f: File[]) => void
}

export const useStore = create<AppState>((set) => ({
  userId: null,
  setUserId: (id) => set({ userId: id }),

  patients: [],
  setPatients: (patients) => set({ patients }),

  cases: [],
  setCases: (cases) => set({ cases }),
  updateCase: (id, data) =>
    set((state) => ({
      cases: state.cases.map((c) => (c.id === id ? { ...c, ...data } : c)),
    })),

  unassignedDocs: [],
  setUnassignedDocs: (unassignedDocs) => set({ unassignedDocs }),

  uploadOpen: false,
  setUploadOpen: (uploadOpen) => set({ uploadOpen }),

  pendingHistorialFiles: [],
  setPendingHistorialFiles: (pendingHistorialFiles) => set({ pendingHistorialFiles }),
}))
