import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import * as path from 'node:path';

// 复用扩展 e2e 的启动逻辑（参考 apps/extension/e2e/helpers.ts:21-42）
// 这里重实现而非 import，因为 lab 在 monorepo 外、且 helpers.ts 依赖 e2e fixtures 路径
const EXTENSION_PATH = path.resolve(
  import.meta.dirname,
  '../../../apps/extension/dist',
);

export async function launchExtensionContext(userDataDir: string): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = serviceWorker.url().split('/')[2];
  return { context, extensionId };
}

export async function openSidepanelPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

// 等待 fixture 控制器就绪：__listenGraphicFixture 由 App.tsx 的 useEffect 通过
// 动态 import('./fixture-sequence-dev') 异步安装。domcontentloaded 之后该 chunk
// 可能尚未加载完成，此时 globalThis.__listenGraphicFixture 仍为 undefined，
// 直接调用 loadGraph 会被可选链 ?. 静默吞掉（status().nodeCount 永远为 0）。
// 必须先确认控制器挂载完成，才能安全 loadGraph。
export async function waitForFixtureReady(page: Page, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => typeof globalThis.__listenGraphicFixture);
      },
      { timeout },
    )
    .toBe('object');
}

// 关键：不复用 waitForGraph（它查 service worker snapshot）。
// fixture loadGraph 直接灌 sidepanel React state，service worker 不知情。
// 这里读 __listenGraphicFixture.status().nodeCount（依赖 Task 5 的 loadedGraph 修复）。
export async function waitForFixtureGraph(
  page: Page,
  expectedNodeCount: number,
  timeout = 10_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          return globalThis.__listenGraphicFixture?.status()?.nodeCount ?? 0;
        });
      },
      { timeout },
    )
    .toBeGreaterThanOrEqual(expectedNodeCount);
}

// 截图前稳定视图状态：关 auto-tour、等 fitView
//
// auto-tour 调查结论（已核实代码，非猜测）：
// 1. fixture-sequence-controller.ts 的 loadGraph（226-244 行）**不**调用
//    deps.setAutoTourSeed(...) —— 它只 dispatch FIXTURE_SEQUENCE_ARM 并调用
//    onFixtureLabReset（后者反而 resetAutoTourState() 把导览强制回到 'idle'）。
//    相比之下 next()/prev() 走的 deliverStep（82-113 行）才会 setAutoTourSeed。
//    => 通过 loadGraph 灌图时，导览永远不会启动，无需关闭。
// 2. 即便导览启动，App.tsx 中也**没有**用户可见的「关闭导览」按钮——auto-tour
//    纯粹是 fitBounds 视口动画，仅靠用户视口交互 pauseAutoTour() 或跑完阶段自动
//    回到 idle。DOM 上只有 auto-tour-indicator（圆点）和 auto-tour-status（文字）
//    两个 testid，都不是可点击的关闭入口。
//    => 没有可点击的真实 selector。
//
// 因此本函数的 tour 抑制是 no-op 防护：loadGraph 路径下导览本就不启动。
//
// **关键：必须手动点击「适配视图」按钮触发 fitView。**
// React Flow 实例在 App 首次 onInit 时创建并 fitView 一次，但之后每次 loadGraph
// 仅替换 nodes/edges，视口停留在上一张图的缩放/平移位置（App.tsx 的 fitView 触发点
// 只有 onInit / ResizeObserver / 手动按钮，没有 fit-on-graph-change）。
// 后续 graph 的节点会渲染在视口之外，fullPage 截图只能拍到空白网格。
// ViewSwitcher 渲染的「适配视图」按钮 onClick => requestAutoFit({ force: true })，
// 点击它即可对当前节点重新 fitView（动画 AUTO_FIT_DURATION_MS = 240ms，留足余量）。
export async function stabilizeForScreenshot(page: Page): Promise<void> {
  // 点击「适配视图」按钮强制重新 fitView（force:true 绕过降级逻辑）。
  // 按钮在节点数为 0 时 disabled，截图前节点已 >0，故存在且可点。
  const fitButton = page.getByRole('button', { name: '适配视图' });
  await fitButton.click({ timeout: 5_000 });
  // 等 fitView 动画落定（AUTO_FIT_DURATION_MS = 240ms，留余量）。
  await page.waitForTimeout(600);
}
