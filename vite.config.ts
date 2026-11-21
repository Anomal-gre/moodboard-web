import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localMosaBridge } from './server/localBridge';

export default defineConfig({
  base: './',
  plugins: [react(), localMosaBridge()],
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-icons';
          }
        },
      },
    },
  },
});
