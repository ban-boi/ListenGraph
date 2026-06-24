import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// 桌面端 Vitest 配置：Node 环境，源码别名与 vite.config.ts 对齐，
// 确保 workspace TypeScript 源（含 asr-runtime / providers）在测试中一致解析。
export default defineConfig({
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
      '@listen-graphic/asr-runtime': resolve(
        __dirname,
        '../../packages/asr-runtime/src',
      ),
      '@listen-graphic/providers': resolve(
        __dirname,
        '../../packages/providers/src',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
