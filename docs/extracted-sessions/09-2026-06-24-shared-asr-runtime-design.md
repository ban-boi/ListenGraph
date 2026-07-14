# Codex CLI — 共享 ASR Runtime 设计

- **工作线:** 业务逻辑
- **Session date**: 2026-06-24
- **来源:** `C:\Users\finni\.codex\sessions\2026\06\24\rollout-2026-06-24T17-22-52-019ef8f0-7e2b-7732-be4b-feb012f33cee.jsonl`
- **源文件大小:** 742 KB
- **提取消息数:** 24

> 已过滤：tool 输出、系统 Instructions、重复 assistant 副本。Compaction 块保留为摘要。

## User `2026-06-24T09:27:03`

<environment_context>
  <cwd>C:\Users\finni\Desktop\ListenGraph</cwd>
  <shell>powershell</shell>
  <current_date>2026-06-24</current_date>
  <timezone>Asia/Shanghai</timezone>
  <filesystem><workspace_roots><root>C:\Users\finni\Desktop\ListenGraph</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>C:\Users\finni\Desktop\ListenGraph</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>C:\Users\finni\Desktop\ListenGraph\.git</path></entry><entry access="read"><path>C:\Users\finni\Desktop\ListenGraph\.agents</path></entry><entry access="read"><path>C:\Users\finni\Desktop\ListenGraph\.codex</path></entry></file_system></permission_profile></filesystem>
</environment_context>

## User `2026-06-24T09:27:03`

现在这个项目 你觉得你能干点啥

## Assistant `2026-06-24T09:28:21`

能干，而且现在最值得做的不是继续搭壳，而是把它变成真正可用的产品。

我建议按价值排序：

1. **打通桌面端真实主链路，最推荐**
   `真实音频 -> ASR Bridge -> Transcript -> Structurer -> Graph`
   
   目前桌面端已经能采集麦克风和系统声音，但图谱仍由 mock 文本驱动。这是当前最关键的断点。

2. **收敛桌面端发布 UI**
   当前主界面仍有 Frame、RMS、Peak、日志等调试信息。可以改成轻薄的正式界面，将诊断信息放进抽屉或开发模式。

3. **补桌面端工程闭环**
   增加 runtime/audio 测试、功能 smoke、设备选择、权限错误恢复，以及 Windows 安装包。

4. **继续提高结构化质量**
   整理当前 Judge、fixture、replay 改动，校准真实语音样本，建立稳定的语义质量门禁。

5. **清理仓库状态**
   当前工作区有大量未提交文件，包括桌面端、结构化实验脚本，以及源码目录中的生成 `.js/.d.ts` 文件。可以先审计哪些该保留、忽略或删除，再形成干净提交。

我的明确建议：**先做第 1 项，让桌面端真实声音能够长出真实图谱**。第一步只接本地 ASR Bridge，不同时重构全部 provider 和 UI，风险最低、成果也最直观。

你想先打通真实桌面链路，还是先把当前这些改动整理干净？

## Assistant `2026-06-24T09:29:06`

我按 `superpowers:brainstorming` 先把桌面端真实链路的边界定清楚；这一阶段先不改代码，避免把桌面采音、ASR 和扩展 service-worker 一次性耦合起来。接下来我会核对现有 local bridge 协议和扩展端适配器，再只确认一个关键选择。

## Assistant `2026-06-24T09:29:24`

协议边界已经比较清楚：桌面 AudioWorklet 输出的是 16 kHz Float32 帧，现有 `lg-asr-ws-v1` 要求 16 kHz mono `pcm_s16le`，扩展端已有完整握手、发帧和 partial/final 语义。桌面端应复用协议语义，但不能直接搬 content-script 的 Chrome 生命周期代码。

## Assistant `2026-06-24T09:29:50`

先确认首轮成功标准：

你希望我直接以 **Sherpa 真实语音能生成真实图谱** 为验收，还是先用 **mock ASR Bridge 打通完整协议链路**，再切 Sherpa？

我推荐后者，两阶段更容易定位问题。

## Assistant `2026-06-24T09:30:07`

成功标准确定为两阶段：先让桌面真实音频通过 mock bridge 产生 transcript 并更新图谱，再保持同一协议切换 Sherpa。现在我补齐 transcript 到 structurer/merge 的现有复用接口，然后给你接入方案和推荐设计。

## Assistant `2026-06-24T09:30:58`

**方案选择**

1. **桌面端独立接入，推荐**
   在 `apps/desktop` 新增轻量 `LocalAsrClient`，实现 `lg-asr-ws-v1`。复用协议，不复用 Chrome 生命周期代码。改动集中、风险最低。

2. **先抽共享 ASR runtime 包**
   将扩展端 WebSocket、编码、协议状态机抽到 `packages/providers`。长期复用更好，但会同时改动 extension，首轮范围偏大。

3. **复制 content-script 实现**
   最快，但会复制约 300 行强耦合代码，后续两端容易漂移，不建议。

**推荐设计**

数据流：

```text
DesktopAudioSource Float32Array
  -> Float32 转 PCM16
  -> LocalAsrClient
  -> ws://127.0.0.1:15377/ws
  -> transcript.partial / transcript.final
  -> MockStructurerProvider
  -> mergeSegmentGraph
  -> DesktopRuntime.graph
  -> GraphArea
```

关键约束：

- partial 只显示转写状态，不更新图谱。
- final 才进入 structurer，避免节点反复抖动。
- 删除现有 `MOCK_TRANSCRIPTS` 定时器，不再生成假图谱。
- 停止时依次发送 `audio.flush`、`session.stop`，然后释放音频源。
- Bridge 连接失败时明确报错，不偷偷回退到 mock transcript。
- 首轮 endpoint 固定为本地默认值，暂不增加复杂设置页面。

验收分两层：

1. `mock-asr-bridge`：真实麦克风/系统音频帧进入 bridge，固定 transcript 返回并生成图谱。
2. Sherpa：不改桌面代码，只替换 bridge，真实讲话内容进入图谱。

测试覆盖协议握手、PCM16 编码、partial/final、停止清理、bridge 错误，以及 desktop build/smoke。

这个设计可以确认吗？确认后我会写设计文档，再形成实施计划。

## User `2026-06-24T09:32:30`

先抽共享 ASR runtime 包

## Assistant `2026-06-24T09:32:36`

方向改为先抽共享层，这会同时影响 extension 和 desktop；我会把 Chrome 消息、Electron 采音留在宿主侧，只共享 PCM 编码、`lg-asr-ws-v1` 客户端和事件状态机。这里还需要确定共享层的归属。

## Assistant `2026-06-24T09:32:38`

共享 ASR runtime 你希望：

- 新建独立的 `packages/asr-runtime`，边界最清晰，我推荐这个。
- 放进现有 `packages/providers`，包更少，但 transport/runtime 与 provider 配置会混在一起。

选哪个？

## Assistant `2026-06-24T09:32:55`

确定新建 `packages/asr-runtime`。它只负责实时 ASR 协议与传输，不依赖 Chrome、Electron、React、存储或具体 ASR 引擎；extension 和 desktop 分别负责音频来源及消费 transcript。

## Assistant `2026-06-24T09:33:08`

**设计草案**

新建 `packages/asr-runtime`，提供三部分能力：

1. **音频编码**
   - `float32ToPcm16`
   - 16 kHz、mono、`pcm_s16le`
   - 不负责采音和重采样

2. **协议模型**
   - `lg-asr-ws-v1` 请求、响应类型
   - `session.start`、`audio.frame`、`audio.flush`、`session.stop`
   - status、partial、final、error 事件

3. **WebSocket 客户端**
   - `LocalAsrSession`
   - 管理连接、握手、发帧、结束和异常
   - 通过注入 `WebSocketFactory` 保持可测试，不绑定浏览器全局对象

迁移顺序：

1. 先为共享包写协议与状态机测试。
2. 把 extension 的 Local Bridge 实现迁移到共享包，确保契约/replay 不变。
3. desktop 接入共享包，移除 `MOCK_TRANSCRIPTS`。
4. mock bridge 验证完整图谱链路。
5. 切换 Sherpa 做真实语音验收。

边界：

- `packages/asr-runtime` 不处理 structurer、merge、graph。
- extension 保留 Chrome 消息和 content-script 生命周期。
- desktop 保留 AudioWorklet、权限和音频源。
- final transcript 才进入结构化链路。
- 第一轮不做 UI 设置、设备选择、混音和安装包。

验证顺序：

```text
asr-runtime unit tests
-> extension contract
-> extension replay
-> desktop tests/build/smoke
-> mock bridge 手动闭环
-> Sherpa 手动闭环
```

这个设计是否确认？确认后我会写入设计文档并进行自审。

## Assistant `2026-06-24T09:33:20`

我现在把确认后的方案写入 `docs/superpowers/specs/2026-06-24-shared-asr-runtime-design.md`，内容会明确包边界、extension 迁移、desktop 接入、错误处理和分层验收。只提交这份设计文档，不会碰或带入当前工作区的其他未提交改动。

## Assistant `2026-06-24T09:35:00`

自审发现公共 API 命名仍留了“实现时可调整”的模糊口子，这会削弱计划和测试的约束。我会把 `LocalAsrSession`、`LocalAsrSessionOptions`、`LocalAsrEvent`、`WebSocketFactory` 固定为设计契约，其余范围没有冲突。

## Assistant `2026-06-24T09:36:42`

设计文档已作为独立提交落下，提交只包含该文件，没有混入现有 extension、desktop 或生成文件改动。最后我会核对提交内容和文档路径，然后交给你做书面确认。

## Assistant `2026-06-24T09:37:00`

设计文档已提交：

[2026-06-24-shared-asr-runtime-design.md](C:/Users/finni/Desktop/ListenGraph/docs/superpowers/specs/2026-06-24-shared-asr-runtime-design.md)

提交：`4e2fcf1 docs: design shared asr runtime`

请审阅文档。确认无修改后，我再编写详细实施计划。

## Assistant `2026-06-24T09:37:14`

我现在用 `superpowers:writing-plans` 把已确认设计拆成可执行任务，包含精确文件、TDD 顺序、extension 回归门和 desktop 验收点。

## Assistant `2026-06-24T09:38:30`

文件边界已经锁定：新包可沿用现有 workspace 包模式；extension 的 Local Bridge 与腾讯 realtime 目前共用一个 `realtimeSocket`，计划中会先拆出 `localAsrSession`，只迁移 external 分支，避免影响腾讯路径。desktop 则新增独立 transcript pipeline，防止 `desktop-runtime.ts` 继续膨胀。

## Assistant `2026-06-24T09:43:55`

`apply_patch` 的 Windows 沙箱辅助进程连续失败，计划文件已创建但自审修订无法落盘。我会用一次受控的 PowerShell 精确替换，只改这份计划中的两处不可执行表述，不触碰源码。

## Assistant `2026-06-24T09:45:19`

第二轮自审发现测试片段引用了未定义的 `baseOptions`、fixture helper 和 `formatError`，这不符合“拿到计划即可执行”的要求。我会把这些 helper 的完整定义补进对应任务，再做最后一次占位符和 diff 检查。

## Assistant `2026-06-24T09:46:55`

最后一轮自审还发现三处“补测试”只有文字，没有完整断言。我正在把状态机异常、重复 final、desktop 编排失败路径改成具体 Vitest 用例，避免执行者自行猜测验收行为。

## Assistant `2026-06-24T09:50:19`

实施计划已经覆盖共享包、extension 迁移、desktop transcript pipeline、运行时接入和两阶段验收。还特别记录了当前 `apps/desktop` 未提交，执行时不能从 `HEAD` 新建隔离 worktree 后误以为桌面代码存在。

## Assistant `2026-06-24T09:50:29`

计划已保存至：

[2026-06-24-shared-asr-runtime.md](C:/Users/finni/Desktop/ListenGraph/docs/superpowers/plans/2026-06-24-shared-asr-runtime.md)

执行方式：

1. **子任务驱动，推荐**：每个任务由独立子代理实现，并逐项审查。
2. **当前会话执行**：分批实施，在阶段节点检查。

选哪种？
