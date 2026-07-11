import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: [
      '@supabase/supabase-js',
      '@supabase/storage-js',
      '@supabase/functions-js',
      '@supabase/realtime-js',
      '@supabase/postgrest-js',
      '@supabase/auth-js',
    ],
    esbuildOptions: {
      target: 'es2020',
    },
  },
  build: {
    target: 'es2020',
  },
})
