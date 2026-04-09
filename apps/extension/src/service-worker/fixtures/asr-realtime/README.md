# ASR Realtime Fixtures

Place 16kHz mono PCM WAV files and matching JSON fixtures here for Tencent realtime ASR real tests.

If your raw assets live under repo-root `raw_audio&text/` as `mp3 + txt`, use the preparation script first:

```bash
pnpm --filter extension prepare:asr:real
```

The script will:

- scan `raw_audio&text/` for `.mp3` / `.wav`
- pair same-name `.txt` files when present
- convert audio to `16kHz mono wav` with `ffmpeg`
- generate `generated-*.json` fixtures here
- by default, limit each generated fixture to the first `120s` of audio so realtime runs stay practical

If `ffmpeg` is not in `PATH`, rerun with:

```bash
pnpm --filter extension prepare:asr:real -- --ffmpeg "C:/path/to/ffmpeg.exe"
```

You can preview what would be generated without writing files:

```bash
pnpm --filter extension prepare:asr:real -- --dry-run
```

Required env vars:

- `LISTEN_GRAPHIC_E2E_ASR_TENCENT_APP_ID`
- `LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_ID`
- `LISTEN_GRAPHIC_E2E_ASR_TENCENT_SECRET_KEY`

Optional env vars:

- `LISTEN_GRAPHIC_E2E_ASR_ENGINE_MODEL`
- `LISTEN_GRAPHIC_E2E_ASR_FIXTURE`
- `LISTEN_GRAPHIC_E2E_ASR_ALLOW_EXTERNAL_SKIP=1`
- `LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS`

Fixture shape:

```json
{
  "name": "sample-fixture",
  "audioFile": "./audio/sample.wav",
  "acceptance": {
    "minStableUtterances": 1,
    "mustContainTexts": ["腾讯云"],
    "mustContainOneOfTexts": [["语音识别", "实时识别"]]
  }
}
```

Generated fixtures include heuristic `mustContainTexts` anchors extracted from the matching `.txt`.
They are meant to get the first real run going quickly, not to be perfect forever. After the first run,
review and tighten them if Tencent realtime ASR consistently returns slightly different wording.
In practice the workflow is:

1. Run `prepare:asr:real` to scaffold the first fixture JSONs.
2. Run the real test once against Tencent realtime ASR.
3. Replace weak auto-generated anchors with short, stable phrases observed in real output.

If you want to feed the recorded Tencent realtime utterances into the structure-focused replay pipeline:

1. Write utterance artifacts while running the realtime ASR test:

```bash
LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS=1 pnpm --filter extension test:asr:real
```

2. Build replay fixtures under `fixtures/structure`:

```bash
pnpm --filter extension prepare:structure:replay -- --force
```

3. Run the real structurer only on replay fixtures:

```bash
pnpm --filter extension test:structure:real:replay
```

`test:structure:real:replay` defaults to `LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP=1`
to avoid hard-failing on transient upstream `429/timeout` from the external structurer.
For strict mode, override explicitly:

```bash
LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP=0 pnpm --filter extension test:structure:real:replay
```

If you want the stricter and more isolated replay run, use:

```bash
pnpm --filter extension test:structure:real:replay:strict
```

If you want the current recommended structure regression gate, use:

```bash
pnpm --filter extension test:structure
```

This keeps `mock + smoke` as the daily structure gate.

If you want the current full real structurer validation on active fixtures, use:

```bash
pnpm --filter extension test:structure:real:full:part1
pnpm --filter extension test:structure:real:full:part2
```

`replay:strict` is still useful when you specifically want to verify
real Tencent utterance artifacts, but it is no longer the default structure gate.

This runs one replay fixture per process with longer default cooldowns:

- `LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS=180000`
- `LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS=60000`
- `LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS=240000`
- `LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS=120000`
- `LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT=1`
- `LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP=0`

Per-fixture failure reports and an overall summary are written under:

- `apps/extension/src/service-worker/fixtures/structure/artifacts/provider-instability/`

Current recommendation:

- default structurer provider for extension settings: `aliyun`
- old providers such as `zhipu/openai/baidu` remain available for manual fallback and comparison

If you want to compare Tencent batch ASR with Tencent realtime WS on the same clipped audio:

```bash
pnpm --filter extension test:asr:compare
```

This writes JSON reports under `fixtures/asr-realtime/compare-artifacts/` with:

- realtime stable utterance count
- batch 10s chunk count and non-empty chunk count
- per-transport total text length
- raw transport outputs for manual inspection
```
