import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@listen-graphic/schema': resolve(__dirname, '../../packages/schema/src'),
      '@listen-graphic/domain': resolve(__dirname, '../../packages/domain/src'),
      '@listen-graphic/graph-renderers': resolve(
        __dirname,
        '../../packages/graph-renderers/src',
      ),
      '@listen-graphic/ui': resolve(__dirname, '../../packages/ui/src'),
      '@listen-graphic/shared-utils': resolve(
        __dirname,
        '../../packages/shared-utils/src',
      ),
    },
  },
});
