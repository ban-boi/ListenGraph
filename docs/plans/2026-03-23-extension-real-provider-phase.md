# Extension Real Provider Phase

## Purpose
This note records the execution baseline for the real-provider phase after providerization landed.
Its goal is to keep implementation, testing, and the current direct-mode scope aligned with the current extension mainline.

## Source Of Truth
- Extension mainline: `docs/plans/2026-03-21-extension-execution-baseline.md`
- Engineering design: `doc/更工程化的技术设计文档.md`
- Product/stage reference: `doc/重构版 design 文档 v2.md`

## What Landed
- `packages/schema/src/provider.ts`
  - Added `ProviderConfig`, retry policy, runtime summary, and serializable provider errors.
- `packages/providers/src/*`
  - Added config normalization, provider registry, retry helper, and the first real adapters:
    - `OpenAIAsrProvider`
    - `OpenAIStructurerProvider`
- `packages/storage/src/*`
  - Added a `settings` store and `createSettingsRepository()` for provider config persistence and secret clearing.
- `apps/extension/src/service-worker/index.ts`
  - Replaced hard-coded top-level mock construction with config-driven provider runtime loading.
  - Added provider settings messages:
    - `GET_PROVIDER_SETTINGS`
    - `SAVE_PROVIDER_SETTINGS`
    - `CLEAR_PROVIDER_SECRETS`
  - Added runtime/debug exposure of provider summary and last provider error.
  - Added bounded retry / graceful degradation for transient IndexedDB backing-store failures on the live path.
- `apps/extension/src/sidepanel/App.tsx`
  - Added provider settings UI in the sidepanel.
  - Added save/clear flows for local-only secrets.

## Current Provider Strategy
- Default local config remains `mock + mock`.
- Real-provider path is `openai + openai`.
- Access mode for the current product surface is `direct` only:
  - user-provided API key or Tencent direct credentials in local-only storage
  - `relay` stays in schema/provider contracts as a reserved future path, but is out of scope for now and not exposed in the settings UI
- Business code still depends on provider contracts rather than provider-specific SDKs.

## Mainline Rule
The active extension path remains:

`sidepanel -> service-worker -> content-script -> getDisplayMedia -> AudioWorklet -> service-worker -> sidepanel`

This phase does not revive `tabCapture` or `offscreen` as the production execution host.

## Settings And Secrets Rule
- Provider settings are stored in extension-local IndexedDB via `packages/storage`.
- Secrets are never written to sync storage.
- Sidepanel offers:
  - provider type
  - endpoint
  - model
  - API key
  - Tencent `secretId` / `secretKey`
  - language
- A dedicated clear-secrets action removes `apiKey`, `sessionToken`, `secretId`, and `secretKey` while preserving the rest of the config.
- If legacy stored settings still contain `relay`, the current UI/runtime normalizes them back to `direct` on load/save.

## Testing Baseline
Testing is now split into three layers:

1. Unit and integration
- Provider config normalization and registry contract
- Real adapter request/response mapping
- Retry policy and provider error propagation
- Service-worker provider loading, runtime re-hydration, and storage degradation handling
- Sidepanel settings interactions

2. Deterministic browser E2E
- Build artifact sidepanel with a stateful runtime mock now covers:
  - provider settings save
  - `AUDIO_CHUNK_READY` flow
  - graph render
  - refresh recovery
  - debug surface with provider summary

3. Real extension persistence E2E
- Existing Playwright extension test still verifies:
  - runtime/storage asset reading
  - extension restart
  - IndexedDB fallback recovery

## Real Provider Smoke Guidance
The recommended manual smoke path for user-provided real keys is:

1. Build the extension with `pnpm --filter extension build`
2. Load `apps/extension/dist` as an unpacked extension
3. Open the sidepanel and save real ASR / structurer settings
4. Start a capture session on a real tab
5. Confirm:
   - transcript logs appear
   - graph nodes appear
   - debug panel shows provider summary
   - export still works after the session

## Known Constraint
Chromium Playwright runs can still hit intermittent extension IndexedDB backing-store failures.
The current code treats those failures as transient on the live path:
- retry persistence first
- if backing-store access is still unavailable, keep the in-memory graph/runtime alive
- still fail hard for ordinary storage errors that are not backing-store flukes

## Next Step
The next natural increment is direct-mode hardening rather than hosted relay:
- keep `ProviderConfig` compatible with future relay work, but do not expose relay in the current UI
- finish direct-mode smoke validation for `mock`, `openai`, and `tencent` provider combinations
- keep documentation and acceptance checks aligned with the active direct-only product surface
