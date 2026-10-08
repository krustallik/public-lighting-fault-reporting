import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertFrontendModuleGraph } from '../../scripts/assert-frontend-module-graph.mjs';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const frontendRoot = path.resolve(appRoot, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendRoot, '');
  const apiUrl = process.env.VITE_API_URL ?? env.VITE_API_URL ?? '/api';
  return {
  root: appRoot,
  envDir: frontendRoot,
  define: mode === 'development' ? { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) } : undefined,
  plugins: [react(), assertFrontendModuleGraph('public')],
  resolve: {
    alias: {
      '@': path.resolve(appRoot, 'src'),
      '@shared': path.resolve(frontendRoot, 'shared'),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Development-only proxy; production API topology remains configurable.
      '/api': { target: process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:5000', changeOrigin: false },
    },
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
      interval: 1000,
    },
    fs: { allow: [frontendRoot] },
  },
  build: {
    outDir: path.resolve(frontendRoot, 'dist/public'),
    emptyOutDir: true,
  },
  };
});
