import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3847' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
