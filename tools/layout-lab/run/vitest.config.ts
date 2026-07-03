import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// 注意：此文件位于 tools/layout-lab/run/，与 node_modules 同级。
// root 指向 lab 根目录（../），让 include 的 src/** 能匹配测试文件。
// alias 多退一层（../../packages → ../../../packages）。
export default defineConfig({
  test: {
    root: resolve(__dirname, '..'),
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
  resolve: {
    alias: {
      '@listen-graphic/schema': resolve(__dirname, '../../../packages/schema/src/index.ts'),
      '@listen-graphic/graph-renderers': resolve(
        __dirname,
        '../../../packages/graph-renderers/src/index.ts',
      ),
    },
  },
});
