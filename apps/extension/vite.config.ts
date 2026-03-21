import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  cpSync,
} from 'fs';

// Chrome Extension MV3 构建配置
export default defineConfig({
  plugins: [
    react(),
    // 构建后整理文件结构
    {
      name: 'extension-build',
      closeBundle() {
        if (!existsSync('dist')) mkdirSync('dist', { recursive: true });

        // 复制 manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json');

        // 复制 service-worker.js
        copyFileSync('public/service-worker.js', 'dist/service-worker.js');

        // 移动 sidepanel HTML：dist/src/sidepanel.html -> dist/sidepanel.html
        if (existsSync('dist/src/sidepanel.html')) {
          renameSync('dist/src/sidepanel.html', 'dist/sidepanel.html');
        }

        // 移动 offscreen 文件：dist/src/offscreen/* -> dist/offscreen/
        if (existsSync('dist/src/offscreen')) {
          if (!existsSync('dist/offscreen'))
            mkdirSync('dist/offscreen', { recursive: true });
          cpSync('dist/src/offscreen', 'dist/offscreen', { recursive: true });
        }

        // 清理 dist/src
        if (existsSync('dist/src')) {
          rmSync('dist/src', { recursive: true });
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
      output: {
        entryFileNames: '[name]/[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
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
    },
  },
});
