thread_id: 019ed5d8-827b-7921-a825-0daaac262b84
updated_at: 2026-06-17T15:59:32+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\06\17\rollout-2026-06-17T21-49-57-019ed5d8-827b-7921-a825-0daaac262b84.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph
git_branch: main

# ListenGraph 多端路线明确后，先落地桌面端 V1，并开始摸底 V2-ish 真实音频输入方向

Rollout context: 用户先确认 ListenGraph 的多端产品形态：浏览器插件当前聚焦浏览器内声音，桌面端优先，手机端后置，网页端偏查看/导入/轻量入口。随后用户要求先写产品路线文档，再“Implement the plan.”，最后确认 V1 已完成，并提出准备做 V2-ish：把 microphone 先接成真实音频输入，或者直接做 system 输入验证。整个 rollout 里还包含一次把桌面 Electron binary 修复到可正常启动的环境问题处理，以及对桌面端真实音频输入方案的只读摸底与提案。

## Task 1: 写多端产品路线文档

Outcome: success

Preference signals:
- when the user said “我当前是这样子去想的…桌面端和手机端的应用程序…网页端的它可能跟桌面端APP趋近于完全一样”, 后续对齐成了“UI 和图谱体验可以趋近一样，但音频采集能力不一样”这一边界 -> future docs/reviews should separate UI 复用与音频能力边界，不要把网页端/桌面端/手机端写成同一能力集合。
- when the user said “行，你先这样吧。你先写文档，按照现在的文档结构，把我们接下来的产品路线先写出来”, they wanted the路线文档按现有 docs 结构落位，而不是塞进临时计划区 -> future roadmap docs should go into a durable docs/product area and be挂到 docs/README 导航里。
- when the user said “然后我们接下来就开始做这个桌面端”, the roadmap should explicitly point to desktop as the next implementation target rather than remaining neutral.

Reusable knowledge:
- The repo already has a shared UI layer (`packages/ui`) and shared graph/domain packages that support跨端复用; the路线文档 encoded the reusable chain as `AudioSource -> ASR -> Structurer -> Merge -> Graph -> UI` and kept host-specific differences in `AudioSource`.
- The documented/current extension runtime mainline is `sidepanel -> service-worker -> content-script -> getDisplayMedia -> AudioWorklet -> service-worker -> sidepanel`; the roadmap used this to argue browser plugin stays browser-sound-specific and is not a full-device capture product.
- The new roadmap doc is stored at `docs/product/multi-platform-roadmap.md` and `docs/README.md` now links it in the “当前有效” section and in the recommended reading order.

Failures and how to do differently:
- No major failure in the doc task; the only pitfall was treating “网页端跟桌面端趋近于完全一样” too literally. The finalized doc fixed this by separating UI parity from capture capability parity.

References:
- `docs/product/multi-platform-roadmap.md` — explicitly records browser plugin / desktop / web / mobile positioning, input model, desktop priority, and `AudioSource` abstraction.
- `docs/README.md` — added “产品路线与端形态” entry and moved the reading order to start with the multi-platform roadmap.

## Task 2: 落地桌面端 V1（可运行壳 + 输入骨架 + mock session）

Outcome: success

Preference signals:
- when the user said “准备做桌面端”, the next step should be implementation of a desktop app rather than more discussion.
- when the user previously chose Electron, Windows first, and microphone/system source as the first scope, that set the default for the v1 implementation -> future desktop work should keep Electron/Windows-first as the baseline unless the user changes it.
- the user later asked “所以现在V1就是完全完成了？” and accepted the answer that V1 meant “可运行壳 + 输入骨架 + mock session” -> future agents should use that as the completion boundary for the current V1 phase, not require real ASR/audio capture to call V1 done.

Reusable knowledge:
- A new workspace `apps/desktop` was added with Electron + Vite + React, reusing `@listen-graphic/ui`, `@listen-graphic/domain`, `@listen-graphic/graph-renderers`, and `@listen-graphic/schema`.
- Desktop runtime currently lives inside the desktop app as `DesktopRuntime` with a mock session loop that emits logs and mock graph updates; it is not yet a real audio pipeline.
- Desktop UI includes a single input-source chooser (`麦克风` / `系统声音`) and reuses the existing graph toolbar, view switcher, graph area, log panel, and status bar patterns.
- Validation that passed: `pnpm --filter desktop lint`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop build`, `pnpm --filter desktop smoke`, and later `pnpm build` at the repo root. `pnpm --filter desktop smoke` successfully printed `[desktop-smoke] renderer loaded` and exited 0.
- Electron install in this environment was initially broken because pnpm’s Electron postinstall left an incomplete `dist`/missing `path.txt`; the working repair path was to run the package’s installer and then verify `pnpm --filter desktop exec electron --version` until it returned `v39.8.10`.
- Because ESLint v9 was being used with a repo that still relies on `.eslintrc.cjs`, the desktop lint script was made Windows-friendly with `cross-env ESLINT_USE_FLAT_CONFIG=false ...`; this produced only a deprecation warning, not a failure.
- `apps/desktop/.gitignore` was added to keep `dist-electron` and `*.tsbuildinfo` out of the repo.
- `apps/desktop/scripts/dev.mjs` now checks for Electron installation and gives a direct repair hint; `apps/desktop/electron/main.ts` has a `LISTEN_GRAPH_DESKTOP_SMOKE=1` branch to auto-quit after renderer load for smoke tests.

Failures and how to do differently:
- The first desktop tsconfig attempt used `composite`, which caused TS6307 project-file-list errors when aliasing directly to workspace source. The fix was to remove `composite` and follow the existing Vite alias-to-source pattern used elsewhere in the monorepo.
- Electron binary installation was not initially reliable in this environment; the visible symptom was `Command "electron" not found` / `Electron failed to install correctly`. The working diagnostic was to inspect `node_modules/.pnpm/electron@.../dist` and `path.txt`, then repair the missing binary before retrying `electron --version`.
- The smoke command needed a dedicated hidden-window path to avoid GUI/manual verification ambiguity. After adding `LISTEN_GRAPH_DESKTOP_SMOKE=1`, smoke became a repeatable non-interactive check.

References:
- `apps/desktop/package.json` — scripts: `dev`, `ensure-electron`, `postinstall`, `build`, `typecheck`, `lint`, `smoke`.
- `apps/desktop/electron/main.ts` — Electron main window, `desktopCapturer`/`setDisplayMediaRequestHandler`, smoke auto-exit behavior.
- `apps/desktop/electron/preload.ts` — exposes `window.listenGraphDesktop.platform`.
- `apps/desktop/scripts/dev.mjs` — dev launcher for Vite + Electron, with explicit Electron-install guard.
- `apps/desktop/src/desktop-runtime.ts` — mock runtime/session and graph/log emission.
- `apps/desktop/src/App.tsx` — desktop workbench UI with input-source radio buttons and shared graph UI.
- `apps/desktop/src/graph-layout.ts` — desktop-side layout reuse for the shared graph renderer output.
- `apps/desktop/src/styles.css` — desktop shell layout and responsive log pane.
- `apps/desktop/.gitignore` — ignores `dist-electron` and `*.tsbuildinfo`.
- Root `package.json` — added `dev:desktop`, `ensure:electron`, and `pnpm.onlyBuiltDependencies: ["electron"]`.

## Task 3: 向真实音频输入推进 V2-ish，先摸底再定刀口

Outcome: uncertain / partial

Preference signals:
- when the user said “准备做 V2-ish：把 microphone 先接成真实音频输入，或者直接做 system 输入验证”, they wanted actual audio-input work to start rather than more desktop-shell work -> future agents should pivot from shell/runtime scaffolding to real audio-source integration once v1 is accepted.
- the user chose `v2_runtime_shape = desktop 内部`, `v2_success_depth = 采到音频+可视化`, and `v2_first_source = 两者都做` in the question flow, which indicates a preference for keeping the new audio-source layer local to the desktop app and not immediately extracting a shared runtime package.
- the only explicit success boundary for this step was still below ASR: “真实 MediaStream 进入 AudioWorklet + 音量/帧计数可视化 + 状态日志”, not end-to-end provider integration.

Reusable knowledge:
- The extension already has a mature audio pipeline to borrow from: `apps/extension/src/shared/audio.ts` provides 16k mono PCM/WAV helpers, and `apps/extension/src/offscreen/audio-processor.worklet.ts` already emits `AUDIO_CHUNK` / `AUDIO_FRAME` from an AudioWorklet.
- The extension content-script path also already distinguishes display-media capture from realtime frame mode and routes audio frames/chunks onward; that makes it a strong reference for desktop’s real audio-source layer.
- The desktop app currently does not yet have a real `AudioSource` layer; it still uses `DesktopRuntime` mock transcript generation. The intended next implementation shape is a desktop-internal `AudioSource` abstraction feeding `AudioWorklet`/level metering before ASR.

Failures and how to do differently:
- This phase did not yet land code changes; it stayed in摸底/decision mode because the repo needed a clear choice on whether to wire mic first, system first, or both.
- The user’s answers imply both inputs should be supported in V2-ish, but the most reusable implementation path is still to build them under one desktop-local abstraction first, then consider extraction later.

References:
- `apps/extension/src/shared/audio.ts` — `CAPTURE_SAMPLE_RATE`, `float32ToPcm16`, `encodePcm16AsWav`.
- `apps/extension/src/offscreen/audio-processor.worklet.ts` — existing frame/chunk AudioWorklet processor.
- `apps/extension/src/content-script/content-script.ts` — current browser capture pipeline and realtime/batch split.
- `apps/desktop/src/desktop-runtime.ts` — current mock-only runtime to be replaced by a real audio source layer.
- `docs/product/multi-platform-roadmap.md` — current durable route map for the `AudioSource -> ASR -> Structurer -> Merge -> Graph -> UI` split.
