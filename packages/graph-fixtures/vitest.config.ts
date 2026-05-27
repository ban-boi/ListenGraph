import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@listen-graphic/schema': resolve(__dirname, '../schema/src'),
    },
  },
});
