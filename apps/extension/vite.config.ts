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
  readFileSync,
} from 'fs';

const extensionPackageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };
const extensionBuildId = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, '')
  .slice(0, 14);

// Chrome Extension MV3 构建配置
export default defineConfig({
  define: {
    __LISTEN_GRAPHIC_VERSION__: JSON.stringify(extensionPackageJson.version),
    __LISTEN_GRAPHIC_BUILD_ID__: JSON.stringify(extensionBuildId),
  },
  plugins: [
    react(),
    // 构建后整理文件结构
    {
      name: 'extension-build',
      closeBundle() {
        if (!existsSync('dist')) mkdirSync('dist', { recursive: true });

        // 复制 manifest.json
        copyFileSync('public/manifest.json', 'dist/manifest.json');

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

        // 移动 content-script：dist/src/content-script/* -> dist/src/content-script/
        if (existsSync('dist/src/content-script')) {
          // content-script 已经在正确位置了
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
        'service-worker': resolve(__dirname, 'src/service-worker/index.ts'),
        'content-script': resolve(
          __dirname,
          'src/content-script/content-script.ts',
        ),
        'audio-processor.worklet': resolve(
          __dirname,
          'src/offscreen/audio-processor.worklet.ts',
        ),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          switch (chunkInfo.name) {
            case 'service-worker':
              return 'service-worker.js';
            case 'content-script':
              return 'content-script/content-script.js';
            case 'audio-processor.worklet':
              return 'offscreen/audio-processor.worklet.js';
            default:
              return '[name]/[name].js';
          }
        },
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
