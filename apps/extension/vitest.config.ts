import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
  resolve: {
    alias: {
      '@listen-graphic/schema': resolve(__dirname, '../../packages/schema/src'),
      '@listen-graphic/domain': resolve(__dirname, '../../packages/domain/src'),
      '@listen-graphic/providers': resolve(
        __dirname,
        '../../packages/providers/src',
      ),
      '@listen-graphic/graph-renderers': resolve(
        __dirname,
        '../../packages/graph-renderers/src',
      ),
      '@listen-graphic/storage': resolve(
        __dirname,
        '../../packages/storage/src',
      ),
      '@listen-graphic/ui': resolve(__dirname, '../../packages/ui/src'),
      '@listen-graphic/shared-utils': resolve(
        __dirname,
        '../../packages/shared-utils/src',
      ),
      '@listen-graphic/graph-fixtures': resolve(
        __dirname,
        '../../packages/graph-fixtures/src',
      ),
      '@listen-graphic/graph-fixtures/': `${resolve(__dirname, '../../packages/graph-fixtures/src')}/`,
    },
  },
});
