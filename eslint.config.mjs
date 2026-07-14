// ESLint v9 flat config
//
// 背景：原 `.eslintrc.cjs` 是 ESLint v8 rc 格式，项目升至 eslint@9 后全仓 12 个包的
// `lint` 脚本全部失败（报 "couldn't find an eslint.config.(js|mjs|cjs) file"）。
// 2026-07 迁移到 flat config，旧的 `--ext` 参数在 flat 模式下不再支持，改用 `files` glob。
//
// 等价于旧 .eslintrc.cjs：
//   root: true
//   parser: @typescript-eslint/parser
//   plugins: [@typescript-eslint]
//   extends: [eslint:recommended, plugin:@typescript-eslint/recommended]
//   ignorePatterns: [dist, build, node_modules]

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  // 全局忽略（替代旧 ignorePatterns）
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.tmp/**'],
  },

  // eslint:recommended 基线
  js.configs.recommended,

  // TS 文件：挂 parser + plugin + recommended 规则
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // flat/eslint-recommended：关闭与 TS 类型信息冲突的 JS 规则（如 no-undef）
      ...tseslint.configs['flat/eslint-recommended'].rules,
      // flat/recommended：TS 专属推荐规则（含 @typescript-eslint/no-unused-vars）
      ...tseslint.configs['flat/recommended'].rules,
      // 显式关闭 JS 版规则，避免与 TS 版重复报告（双保险：
      // 即使 eslint-recommended 未完全 disable，这里确保只用 @typescript-eslint/* 版本）
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  // 浏览器/扩展/桌面（Electron renderer）环境的 TS/TSX 文件：注入浏览器全局
  // 避免 no-undef 误报 React/document/localStorage/window 等
  {
    files: ['**/*.tsx', 'apps/extension/src/**/*.ts', 'apps/web-demo/src/**/*.ts', 'apps/desktop/src/**/*.ts', 'packages/ui/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
