/**
 * Sidepanel DOM 增量稳定性门禁：view / tick / select 不得移动旧节点中心（期望 maxDrift === 0）。
 *
 * Usage:
 *   pnpm --filter extension build:r3b:fixture-lab
 *   pnpm --filter listen-graph-layout-lab stability
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  launchExtensionContext,
  openSidepanelPage,
  waitForFixtureReady,
  stabilizeForScreenshot,
} from './e2e-helpers';

const OUT_DIR = path.resolve(import.meta.dirname, '../outputs/round5');
const OUT_FILE = path.join(OUT_DIR, 'stability.json');
const USER_DATA = path.resolve(import.meta.dirname, '../.tmp/stability-user-data');

const SEQUENCES = [
  'seq-incremental-growth',
  'seq-late-burst',
  'seq-view-switch-mid',
] as const;

const DRIFT_TOLERANCE = 0.01;
const VIEW_LABELS = ['因果', '时间线', '对比', '层级'] as const;

type Center = { cx: number; cy: number };
type Centers = Record<string, Center>;

type ActionResult =
  | { skipped: true; reason: string }
  | { skipped?: false; maxDrift: number; ok: boolean };

type SequenceResult = {
  id: string;
  oldNodeIds: string[];
  oldNodeCount: number;
  actions: {
    view: ActionResult;
    tick: ActionResult;
    select: ActionResult;
  };
  ok: boolean;
};

export function readNodeCentersFromDom(): Centers {
  const skip = new Set(['header', 'body', 'speaker']);
  const cards = Array.from(
    document.querySelectorAll('[data-testid^="graph-node-card-"]'),
  );
  const out: Centers = {};
  for (const el of cards) {
    const testId = el.getAttribute('data-testid') ?? '';
    const id = testId.replace(/^graph-node-card-/, '');
    // 子元素也用 graph-node-card-* testid（header/body/speaker），必须排除
    if (!id || skip.has(id)) continue;

    // Prefer React Flow node transform（布局坐标，不受 viewport pan/zoom 影响）
    const rfNode = el.closest('.react-flow__node') as HTMLElement | null;
    if (rfNode?.style?.transform) {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(rfNode.style.transform);
      if (m) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const w = rfNode.offsetWidth || (el as HTMLElement).offsetWidth;
        const h = rfNode.offsetHeight || (el as HTMLElement).offsetHeight;
        out[id] = { cx: x + w / 2, cy: y + h / 2 };
        continue;
      }
    }

    const r = el.getBoundingClientRect();
    out[id] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }
  return out;
}

export function maxDrift(before: Centers, after: Centers, ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    if (!a || !b) continue;
    max = Math.max(max, Math.hypot(a.cx - b.cx, a.cy - b.cy));
  }
  return max;
}

async function readNodeCenters(page: Page): Promise<Centers> {
  return page.evaluate(readNodeCentersFromDom);
}

async function waitBrief(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms);
}

async function advanceSequence(page: Page, sequenceId: string): Promise<{
  oldNodeIds: string[];
  nodeCount: number;
}> {
  await page.evaluate((id) => {
    globalThis.__listenGraphicFixture?.arm(id);
  }, sequenceId);

  // arm 已交付 step 0；再 next 至少两次，形成可观察的增量图
  for (let i = 0; i < 2; i++) {
    const advanced = await page.evaluate(() => globalThis.__listenGraphicFixture?.next() ?? false);
    if (!advanced) break;
    await waitBrief(page, 350);
  }

  const status = await page.evaluate(() => globalThis.__listenGraphicFixture?.status());
  const nodeCount = status?.nodeCount ?? 0;
  if (nodeCount <= 0) {
    throw new Error(`[stability] ${sequenceId}: expected nodes after next×2, got ${nodeCount}`);
  }

  // 等节点卡片进 DOM（排除 header/body/speaker 子 testid）
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-testid^="graph-node-card-"]')).filter((el) => {
        const id = (el.getAttribute('data-testid') ?? '').replace(/^graph-node-card-/, '');
        return id && !['header', 'body', 'speaker'].includes(id);
      }).length >= 1,
    undefined,
    { timeout: 10_000 },
  );

  // 有节点时 fit 一次并落定；之后动作不再 fit，避免 viewport 干扰
  const fit = page.getByRole('button', { name: '适配视图' });
  if (await fit.isEnabled().catch(() => false)) {
    await stabilizeForScreenshot(page);
  } else {
    await waitBrief(page, 500);
  }

  const centers = await readNodeCenters(page);
  const oldNodeIds = Object.keys(centers).sort();
  if (oldNodeIds.length === 0) {
    throw new Error(`[stability] ${sequenceId}: no node centers readable in DOM`);
  }
  return { oldNodeIds, nodeCount: oldNodeIds.length };
}

async function runViewSwitch(
  page: Page,
  oldNodeIds: string[],
): Promise<ActionResult> {
  const before = await readNodeCenters(page);

  const active = page.locator('button.lg-btn-primary').filter({
    hasText: /^(因果|时间线|对比|层级)$/,
  });
  const currentLabel =
    (await active.first().textContent().catch(() => null))?.trim() || '因果';
  const otherLabel =
    VIEW_LABELS.find((label) => label !== currentLabel) ?? '时间线';

  await page.getByRole('button', { name: otherLabel, exact: true }).click();
  await waitBrief(page, 350);
  await page.getByRole('button', { name: currentLabel, exact: true }).click();
  await waitBrief(page, 350);

  const after = await readNodeCenters(page);
  const drift = maxDrift(before, after, oldNodeIds);
  return { maxDrift: drift, ok: drift <= DRIFT_TOLERANCE };
}

async function runTimeTick(
  page: Page,
  oldNodeIds: string[],
): Promise<ActionResult> {
  // 节点卡片 header 上的时间 button 即 time tick 入口（onClickTime）
  const timeButtons = page.locator(
    '[data-testid^="graph-node-card-"] button',
  );
  const count = await timeButtons.count();
  if (count === 0) {
    return { skipped: true, reason: 'no time control' };
  }

  const before = await readNodeCenters(page);
  // 点第二个（或唯一）时间按钮，推动 currentTimeMs
  const index = count > 1 ? 1 : 0;
  await timeButtons.nth(index).click();
  await waitBrief(page, 350);

  const after = await readNodeCenters(page);
  const drift = maxDrift(before, after, oldNodeIds);
  return { maxDrift: drift, ok: drift <= DRIFT_TOLERANCE };
}

async function runSelect(
  page: Page,
  oldNodeIds: string[],
): Promise<ActionResult> {
  if (oldNodeIds.length === 0) {
    return { skipped: true, reason: 'no nodes to select' };
  }

  const before = await readNodeCenters(page);
  // 优先点第二个旧节点，避免与 tick 点到的同一个完全重合
  const targetId = oldNodeIds[Math.min(1, oldNodeIds.length - 1)]!;
  await page.getByTestId(`graph-node-card-${targetId}`).click({
    position: { x: 24, y: 40 },
  });
  await waitBrief(page, 350);

  const after = await readNodeCenters(page);
  const drift = maxDrift(before, after, oldNodeIds);
  return { maxDrift: drift, ok: drift <= DRIFT_TOLERANCE };
}

function actionOk(result: ActionResult): boolean {
  if (result.skipped) return true;
  return result.ok;
}

async function runSequence(page: Page, sequenceId: string): Promise<SequenceResult> {
  console.log(`[stability] === ${sequenceId} ===`);
  const { oldNodeIds, nodeCount } = await advanceSequence(page, sequenceId);
  console.log(`[stability] ${sequenceId}: oldNodes=${nodeCount} ids=${oldNodeIds.slice(0, 5).join(',')}${oldNodeIds.length > 5 ? '…' : ''}`);

  const view = await runViewSwitch(page, oldNodeIds);
  console.log(
    `[stability] ${sequenceId} view: ${
      'skipped' in view && view.skipped
        ? `skipped (${view.reason})`
        : `maxDrift=${(view as { maxDrift: number }).maxDrift.toFixed(4)} ok=${(view as { ok: boolean }).ok}`
    }`,
  );

  const tick = await runTimeTick(page, oldNodeIds);
  console.log(
    `[stability] ${sequenceId} tick: ${
      tick.skipped
        ? `skipped (${tick.reason})`
        : `maxDrift=${tick.maxDrift.toFixed(4)} ok=${tick.ok}`
    }`,
  );

  const select = await runSelect(page, oldNodeIds);
  console.log(
    `[stability] ${sequenceId} select: ${
      select.skipped
        ? `skipped (${select.reason})`
        : `maxDrift=${select.maxDrift.toFixed(4)} ok=${select.ok}`
    }`,
  );

  const ok = actionOk(view) && actionOk(tick) && actionOk(select);
  return {
    id: sequenceId,
    oldNodeIds,
    oldNodeCount: oldNodeIds.length,
    actions: { view, tick, select },
    ok,
  };
}

async function main(): Promise<void> {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { context, extensionId } = await launchExtensionContext(USER_DATA);
  const page = await openSidepanelPage(context, extensionId);
  await page.waitForLoadState('domcontentloaded');
  await waitForFixtureReady(page);

  const sequences: SequenceResult[] = [];
  try {
    for (const id of SEQUENCES) {
      // 每条序列前 disarm，避免状态串扰
      await page.evaluate(() => {
        globalThis.__listenGraphicFixture?.disarm();
      });
      await waitBrief(page, 200);
      sequences.push(await runSequence(page, id));
    }
  } finally {
    await context.close();
  }

  const ok = sequences.every((s) => s.ok);
  const report = {
    ok,
    tolerance: DRIFT_TOLERANCE,
    requirement: 'view/tick/select must keep old node centers at 0px drift (decoration only)',
    sequences,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(`[stability] wrote ${OUT_FILE}`);

  if (!ok) {
    const failures = sequences
      .filter((s) => !s.ok)
      .map((s) => {
        const parts: string[] = [];
        for (const [name, action] of Object.entries(s.actions)) {
          if (!action.skipped && 'ok' in action && !action.ok) {
            parts.push(`${name}=${action.maxDrift.toFixed(4)}px`);
          }
        }
        return `${s.id}: ${parts.join(', ')}`;
      });
    console.error('[stability] FAIL:\n - ' + failures.join('\n - '));
    process.exit(1);
  }

  console.log('[stability] PASS');
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
