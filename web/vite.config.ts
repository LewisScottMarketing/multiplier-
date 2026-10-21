import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:3000';
// Everything the server owns is proxied in dev so cookies, previews and public pages all work from :5173.
const proxy = Object.fromEntries(['/api', '/p', '/t', '/tc', '/r', '/c', '/a', '/f', '/preview'].map((p) => [p, { target: API, changeOrigin: false }]));

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../src/shared') } },
  server: { port: 5173, proxy },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
});
