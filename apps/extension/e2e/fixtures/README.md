# Real E2E Fixture Baseline

这组 fixture 不是“随便能播的一组音频”，而是 extension headless real E2E 的长期基线资产。

它的目标不是做逐字稿金标准，而是稳定验证这条链路：

- `fixture -> ws -> final -> graph`

## 为什么这组 fixture 要单独维护

之前踩过的坑很明确：

- fixture 自己能播
- ws 也能连
- 但换一个本地 ASR 模型后，整组音频根本不出字
- 最后表现成 `extension.real.spec.ts` 超时不产 graph

所以这组基线资产必须满足的不是“听起来像样”，而是：

- 对本地 bridge 友好
- 对 endpoint/final 友好
- 对 graph 产出友好

## 当前基线选择原则

当前这组音频来自：

- `sherpa-onnx-streaming-paraformer-bilingual-zh-en/test_wavs`

之所以选它们，不是因为它们内容最好，而是因为它们在当前 reference bridge 下有几个稳定特征：

- 能稳定产出多个 `transcript.final`
- 短句和断句边界比较明确
- 混合中英内容，能覆盖更接近真实本地 ASR 的输出风格

## 不要把 real fixture 当什么

不要把它当成：

- 精确 transcript 金标准
- 通用语义评测集
- 结构化质量基准集

它真正负责的是：

- local bridge 是否能吐出 final
- extension 是否能吃到 transcript
- structurer 是否能起 bootstrap
- graph 是否最终出现

## 修改这组 fixture 的最低要求

如果你要替换任意一个 `chunk-*.wav`，至少要同时做这几件事：

1. 更新 [fixture-manifest.json](C:/Users/finni/Desktop/ListenGraph/apps/extension/e2e/fixtures/fixture-manifest.json) 的 `provenance` 和 `baselineNotes`
2. 重新检查 keyword groups 是否仍然合理
3. 运行静态检查：

```powershell
pnpm --filter extension test:real-fixture:check
```

4. 运行真实 local bridge 闭环：

```powershell
pnpm run test:ext:e2e:real:local-bridge
```

5. 如果你改的是 sherpa 参考基线，还要再跑：

```powershell
pnpm run test:ext:e2e:real:sherpa
```

## 什么情况下应该换 fixture

只有在下面这些场景下才值得换：

- 当前 fixture 对主推本地 bridge 持续不友好
- 当前 fixture 长期只出 partial 不出 final
- 当前 fixture 的关键词锚点已经和真实识别结果明显脱节
- 要建立第二套独立 baseline，而不是覆盖现有基线

如果只是想提升 transcript 语义质量，不应该先改这组 fixture。

## 更稳妥的演进方式

未来如果要支持更多本地模型，优先做：

- 保留这组 `local-bridge-baseline-v1`
- 再新增另一组 `*-baseline-v2`

不要直接覆盖唯一基线，否则历史回归会失真。
