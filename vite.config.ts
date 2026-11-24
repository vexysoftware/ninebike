import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  // Integração Supabase↔Vercel expõe NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (valores publicáveis).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  build: { outDir: 'dist', sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787', '/public/v1': 'http://127.0.0.1:8787' } },
});
