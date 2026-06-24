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

1. **图谱仍由 mock transcript 驱动**：`MOCK_TRANSCRIPTS`（`desktop-runtime.ts:36-42`）+ 6 秒 `setInterval`（`:159-160`）。真实音频帧只更新电平 / frameCount / sampleRate，不进入图谱。
2. **真实 ASR 未接入**：下游 `AudioSource -> ASR -> Structurer -> Merge -> Graph` 链路中，ASR 及之后在本轮未接通。
3. **停止后 `frameCount` / `sampleRate` 字段未清零**：`stopSession()` 不会重置这两个字段，停止后 UI 仍显示上一会话的累计帧数与采样率（如停在 248 帧、16000 Hz），直到下次 `startSession` 开头才重置。这是已知行为，非缺陷；本轮验收清单把“frameCount 不再增长”作为停止释放的唯一断言。
4. **smoke 不覆盖功能断言**：smoke 只校验 renderer 加载，没有音频 / 图谱的功能性断言，也没有 `test` 脚本（`apps/desktop/package.json` 未暴露 vitest 入口，尽管 devDeps 已装）。
5. **系统音频依赖平台 loopback**：系统声音捕获依赖 Electron `audio:'loopback'`，Windows / macOS 行为不同，当前未做平台分支处理。
6. **无混音**：麦克风与系统声音为二选一，无同时混音路径（roadmap MVP 步骤 5）。
7. **无打包发布**：仅源码 + dev/smoke，未做安装包（roadmap MVP 步骤 6）。

## 下一阶段

下一张任务卡再做“desktop audio frames -> ASR bridge -> transcript”。推荐路线：

- 把 `DesktopAudioSource` 的 frame 事件接到已有 ASR transport / 本地 bridge
- 先走 local mock bridge 或 local ASR bridge，不要直接把 provider、结构化、桌面 UI 一次性全串起来
- 待运行时边界稳定后，再逐步接 structurer、merge、图谱

本验收文档在真实 ASR 接入后应随之更新或由新阶段文档取代。
