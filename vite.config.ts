import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4313,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4313,
    strictPort: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
