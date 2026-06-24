# Desktop V2 音频采集验收

## 目的

本文记录桌面端“真实音频输入验证”这一阶段的验收结论。本轮范围：

- 验证真实麦克风 / 系统声音能进入 AudioWorklet，frame 增长、采样率显示、RMS/Peak 与音量条可视化正常
- 验证停止能释放资源
- 跑完静态回归，确认本阶段改动没有破坏 desktop 生产包、smoke 以及 extension / web-demo 构建

**本轮不接真实 ASR。** 语义图谱仍由 mock transcript 驱动，真实音频帧只用于电平与帧计数可视化，不进入图谱。

本文是人工撰写的验收结论，不属于 `docs/plans/` 下的自动生成参考文档。

## 对照 roadmap MVP 6 步的完成度

对照 [多端产品路线](multi-platform-roadmap.md) 的桌面端 MVP 顺序：

| MVP 步骤 | 状态 | 说明 |
|---|---|---|
| 1. 建立桌面宿主应用和基础窗口 | ✅ 已完成 | Electron 39 + Vite + React，`apps/desktop/electron/main.ts` |
| 2. 复用现有图谱显示与 session UI | ✅ 已完成 | `apps/desktop/src/App.tsx` + `desktop-runtime.ts` |
| 3. 支持麦克风输入 | ✅ 已完成 | `MicrophoneAudioSource`（`getUserMedia`） |
| 4. 支持系统声音输入 | ✅ 已完成 | `SystemAudioSource`（`getDisplayMedia` + Electron loopback） |
| 5. 支持系统声音与麦克风混音 | ⬜ 未开始 | 当前为二选一，无混音路径 |
| 6. 完善本地权限、设备选择、错误恢复和打包发布 | 🟡 部分 | 有基础错误恢复（`ended`/`error` 事件 + 日志），无设备选择、无打包发布 |

本轮封口的范围是步骤 1–4 的“真实采集验证”，不包含步骤 5 混音与步骤 6 打包发布。

## 本轮已落到生产代码

关键实现位置（文件路径相对于 `apps/desktop/`）：

- **Electron loopback（系统声音）**：`electron/main.ts:46-64`，`setDisplayMediaRequestHandler` 返回 `audio: 'loopback'`，使 `getDisplayMedia` 能拿到系统回放音频。
- **AudioSource 抽象与真实采集**：`src/audio/desktop-audio-source.ts`
  - 麦克风：`MicrophoneAudioSource.requestStream()` 调 `getUserMedia`
  - 系统：`SystemAudioSource.requestStream()` 调 `getDisplayMedia({audio:true, video:true})`
  - 接入链路：`AudioContext({sampleRate:16000})` → `audioWorklet.addModule` → `createMediaStreamSource` → `AudioWorkletNode('desktop-audio-frame-processor')`
- **16kHz AudioWorklet 取帧与 RMS/Peak**：`src/audio/audio-frame-processor.worklet.ts`
  - 每帧自增 `frameIndex`（`:107`）
  - 帧内计算 `squareSum` / `peak` / `rms`（`:85-95`），随帧 post 出 `level: {rms, peak}`
- **Runtime 编排与停止释放**：`src/desktop-runtime.ts`
  - 开始：`startSession()`（`:119-182`）
  - 停止释放：`stopSession()`（`:184-204`）调 `source.stop()`；`stop()`（`desktop-audio-source.ts:143-170`）依次断开 workletNode / sourceNode、`track.stop()`、`audioContext.close()`
  - `track` 的 `ended` 事件监听：`desktop-audio-source.ts:87,159`；runtime 收到 `ended` 会置 `audioStatus='ended'`、记日志并自动 `stopSession()`（`desktop-runtime.ts:243-251`）
- **UI 音量条 / 计数 / 采样率显示**：`src/App.tsx`
  - 音量条 DOM：`:163-168`；dB→% 换算 `levelToMeterPercent`：`:44-50`
  - frameCount / RMS / Peak / sampleRate 显示：`:175-197`

无 `MediaRecorder`，本阶段只取帧与电平，没有录音落盘。

## 静态回归结论

本轮 UI 修正与音频层改动后，静态回归三条命令的实际结果：

| 命令 | 结果 | 判定依据 |
|---|---|---|
| `pnpm --filter desktop build` | ✅ 通过 | `tsc --noEmit && vite build && tsc -p tsconfig.electron.json` 全绿，产出 `dist/` 与 `dist-electron/main.js` |
| `pnpm --filter desktop smoke` | ✅ 通过 | 控制台出现 `[desktop-smoke] renderer loaded`，进程 exit 0 |
| `pnpm build`（全 workspace） | ✅ 通过 | Turborepo 11/11 packages 成功 |

> 说明：smoke 只校验“build 成功 + Electron 主进程能起 + renderer bundle 加载完”，不含音频 / 图谱功能断言（这是 smoke 的既有设计）。`pnpm build` 中 extension 有一条既有的 vite dynamic-import 警告，属于既有行为，与本轮改动无关。

## 手动验收清单

> 麦克风权限、系统共享、设备指示灯等需要在真实窗口里操作，无法在 headless 环境替你验证。请按下列清单逐项核对并回填结果（✅ / ⬜ / 观察值）。**麦克风源与系统声音源各跑一遍。**

### 麦克风源

采集有效性：
- [ ] 点开始后进入 `capturing`，日志出现 `输入源: 麦克风 (真实采集)`
- [ ] frameCount 持续增长（有声音时）
- [ ] sampleRate 显示为有效数值（期望 16000 Hz）
- [ ] RMS/Peak 有数值，音量条随声音起伏（有声时 `.is-active`，peak<0.0005 时归零）

停止释放资源：
- [ ] 点停止后 frameCount **不再增长**（断言项）
- [ ] 音量条宽度归零（`audioLevel` 被置为 `EMPTY_LEVEL`，`audioStatus='idle'`）
- [ ] 系统 / 浏览器麦克风指示灯熄灭、权限指示消失

### 系统声音源

采集有效性：
- [ ] 点开始后进入 `capturing`，日志出现 `输入源: 系统声音 (真实采集)`
- [ ] frameCount 持续增长（有声音时）
- [ ] sampleRate 显示为有效数值（期望 16000 Hz）
- [ ] RMS/Peak 有数值，音量条随声音起伏

停止释放资源：
- [ ] 点停止后 frameCount **不再增长**（断言项）
- [ ] 音量条宽度归零，`audioStatus='idle'`
- [ ] 系统屏幕 / 音频共享提示条消失（getDisplayMedia 流被 `track.stop()`）
- [ ] 在系统侧主动停止共享时，UI 不崩溃，日志出现 `ended` 记录并自动 `stopSession`

## 当前限制

明确写清楚本轮不做、或尚未达成的点：

1. **图谱已由真实 ASR final 驱动（structurer 仍为 mock）**：~~`MOCK_TRANSCRIPTS` + 6 秒 `setInterval`~~ 已于「阶段二：共享 ASR 运行时」移除。当前图谱由 `LocalAsrSession` 的 `transcript.final` 事件经 `DesktopTranscriptPipeline` + `MockStructurerProvider` 产生；structurer 仍是 mock，图谱质量不代表真实语义抽取。
2. **真实 ASR 已接入到 Local Bridge**：`AudioSource -> ASR -> Structurer -> Merge -> Graph` 链路中，ASR 及 structurer 均已接通，详见下文「阶段二」。剩余未做项见该节末尾。
3. **停止后 `frameCount` / `sampleRate` 字段未清零**：`stopSession()` 不会重置这两个字段，停止后 UI 仍显示上一会话的累计帧数与采样率（如停在 248 帧、16000 Hz），直到下次 `startSession` 开头才重置。这是已知行为，非缺陷；本轮验收清单把“frameCount 不再增长”作为停止释放的唯一断言。
4. **smoke 不覆盖功能断言**：smoke 只校验 renderer 加载，没有音频 / 图谱的功能性断言。~~没有 `test` 脚本~~：阶段二已为 desktop 加 `vitest run` 入口与 9 个单测，但 smoke 本身仍未加功能断言。
5. **系统音频依赖平台 loopback**：系统声音捕获依赖 Electron `audio:'loopback'`，Windows / macOS 行为不同，当前未做平台分支处理。
6. **无混音**：麦克风与系统声音为二选一，无同时混音路径（roadmap MVP 步骤 5）。
7. **无打包发布**：仅源码 + dev/smoke，未做安装包（roadmap MVP 步骤 6）。

## 阶段二：共享 ASR 运行时（2026-06-24）

> 计划文档：`docs/superpowers/plans/2026-06-24-shared-asr-runtime.md`

### 范围

把 `lg-asr-ws-v1` 客户端从扩展 content-script 抽到共享包 `@listen-graphic/asr-runtime`，扩展与桌面端复用同一会话状态机；桌面端去掉 timer 驱动的 mock 转写图谱，改为「音频帧 → ASR → final → structurer → merge → 图谱」的真实链路（structurer 暂用 mock）。

### 已落到生产代码

- **共享包 `packages/asr-runtime`**：
  - `src/audio.ts`：主机无关的 `float32ToPcm16` / `bytesToBase64`（不依赖 Node Buffer，浏览器与 Node 双用）
  - `src/protocol.ts` + `src/protocol-parser.ts`：lg-asr-ws-v1 规范化事件类型与**严格解析器**（替代扩展原生的 `JSON.parse + cast`，畸形负载以稳定错误码 `INVALID_PROTOCOL_MESSAGE` 抛出）
  - `src/local-asr-session.ts`：单一 WebSocket 后端会话状态机，握手后才发帧、flush/stop 幂等、意外关闭发 `UNEXPECTED_CLOSE`
- **扩展迁移**：`content-script` 的 Local Bridge 分支改用 `LocalAsrSession`，腾讯分支保持原 `realtimeSocket` 路径不变
- **桌面端**：
  - `src/asr/desktop-transcript-pipeline.ts`：final 去重 + 串行 structurer + `mergeSegmentGraph`
  - `src/desktop-runtime.ts`：移除全部 mock，改为 ASR-first 启动（先握手再启音频）、音频帧送 ASR、final 喂管道、确定性停止清理

### 自动化门禁（实测）

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm --filter @listen-graphic/asr-runtime test` | ✅ 22 passed | codec 2 + parser 9 + session 11 |
| `pnpm --filter desktop test` | ✅ 9 passed | pipeline 5 + runtime 集成 4 |
| `pnpm --filter extension exec vitest run src/content-script/content-script.test.ts` | ✅ 8 passed | 含 Local Bridge 完整流程与 flush/stop 顺序 |
| `pnpm --filter extension exec vitest run src/service-worker/{provider-contract,realtime-asr,session-lifecycle,asr-realtime.local-bridge}.test.ts` | ✅ 18 passed / 8 skipped | ASR 契约未回归 |
| `pnpm typecheck` | ✅ 12/12 workspaces | |
| `pnpm build` | ✅ 12/12 workspaces | |

### Mock Bridge 协议闭环

- `pnpm dev:mock-asr-bridge` 启动成功，`http://127.0.0.1:15377/healthz` 返回 `{"ok":true,...}`。
- 协议闭环经单元测试覆盖：`local-asr-session.test.ts` 用真实 `LocalAsrSession` 驱动 FakeSocket 走通 `session.start → session.started → audio.frame → audio.flush → session.stop`，并验证 partial/final 转发；`desktop-runtime.test.ts` 验证音频帧确实送入 ASR、停止时发出 flush/stop。
- mock bridge 在 `audio.flush` 时回送固定 final `今天天气不错，我们开始测试本地 bridge。`，该文本会经 `DesktopTranscriptPipeline` 出现在图节点（与计划 Step 1 期望一致）。

### Sherpa 真实模型验收

> **状态：未由人工执行。** Sherpa 本地模型（`sherpa-onnx-streaming-paraformer-bilingual-zh-en`）与 Python 环境需用户本人在本机具备，并需真人发声或播放已知音频。自动化门禁不依赖它。

如需执行，按计划 Step 2：

```powershell
pnpm dev:sherpa-asr-bridge -- --encoder .tmp/sherpa-model/.../encoder.int8.onnx ^
  --decoder .tmp/sherpa-model/.../decoder.int8.onnx ^
  --tokens .tmp/sherpa-model/.../tokens.txt ^
  --model-name sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

预期 `/healthz` 协议为 `lg-asr-ws-v1`，说一句话后 final 文本应进入图节点。

### 阶段二当前限制

1. **structurer 仍为 mock**：`MockStructurerProvider` 只按节点数轮换类型/说话人，图谱语义质量不代表真实抽取。真实 structurer 接入是下一阶段。
2. **无混音、无设置 UI、无打包**：同阶段一限制 5/6/7。
3. **Sherpa 真实模型验收待人工执行**：见上节。
4. **既存非本次引入**：`App.fixture-sequence.test.tsx`（UI）失败与 `.real.test.ts`（需 Tencent 凭证）失败在阶段二之前即存在；`pnpm test:ext:contract` 脚本指向的 `src/service-worker/index.test.ts` 已不存在（项目重构遗留），实际契约测试在 `provider-contract.test.ts` 等文件，已单独验证通过。
5. **全仓 ESLint v9 与 `.eslintrc.cjs` 不兼容**：本机 ESLint 已升至 v9，`pnpm lint` 全仓 12 包均失败，属环境既存问题，非本次引入；本次以 `tsc --noEmit`（typecheck）作为等价静态门禁。

## 下一阶段

下一张任务卡推荐：

- 接入真实 structurer（替换 `MockStructurerProvider`），验证语义图谱质量
- 人工执行 Sherpa 真实模型验收，确认真实语音 → 图谱闭环
- 解决全仓 ESLint v9 flat-config 迁移

本验收文档随后续阶段继续更新。
