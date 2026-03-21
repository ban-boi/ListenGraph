import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 扩展的 dist 目录
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

test.describe('Build Verification Tests', () => {
  test('dist 目录应该包含所有必需文件', () => {
    const requiredFiles = [
      'manifest.json',
      'service-worker.js',
      'sidepanel.html',
      'sidepanel/sidepanel.js',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(EXTENSION_PATH, file);
      expect(fs.existsSync(filePath), `${file} 应该存在于 dist/`).toBeTruthy();
    }
  });

  test('manifest.json 应该配置正确', () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain('tabCapture');
    expect(manifest.permissions).toContain('offscreen');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  });

  test('service-worker.js 应该使用正确的架构', () => {
    const swPath = path.join(EXTENSION_PATH, 'service-worker.js');
    const content = fs.readFileSync(swPath, 'utf-8');

    // 应该包含正确的函数
    expect(content).toContain('startSession');
    expect(content).toContain('handleAudioChunk');
    expect(content).toContain('stopSession');

    // 不应该在 service worker 中直接调用 chrome.tabCapture.capture
    expect(content).not.toContain('chrome.tabCapture.capture');
  });

  test('offscreen 目录应该存在', () => {
    // 检查 offscreen 可能在不同位置
    const offscreenPaths = [
      path.join(EXTENSION_PATH, 'offscreen'),
      path.join(EXTENSION_PATH, 'src/offscreen'),
    ];

    const offscreenExists = offscreenPaths.some((p) => fs.existsSync(p));
    expect(offscreenExists, 'offscreen 目录应该存在').toBeTruthy();
  });
});
