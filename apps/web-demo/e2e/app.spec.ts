import { test, expect } from '@playwright/test';

test.describe('ListenGraphic Web Demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('应该显示 ListenGraphic 标题', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Listen Graphic' }),
    ).toBeVisible();
  });

  test('初始状态应该显示"空闲"', async ({ page }) => {
    await expect(page.getByText('空闲')).toBeVisible();
  });

  test('初始状态应该显示"开始"按钮', async ({ page }) => {
    await expect(page.getByRole('button', { name: /开始/i })).toBeVisible();
  });

  test('初始状态节点数量应该为 0', async ({ page }) => {
    await expect(page.getByText(/节点: 0/)).toBeVisible();
  });

  test('初始状态会话应该显示"无"', async ({ page }) => {
    await expect(page.getByText(/会话: 无/)).toBeVisible();
  });

  test('点击"开始"后状态变为"运行中"', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await expect(page.getByText('运行中')).toBeVisible();
  });

  test('点击"开始"后按钮变为"停止"', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await expect(page.getByRole('button', { name: /停止/i })).toBeVisible();
  });

  test('点击"开始"后会话 ID 被生成', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    // 会话 ID 格式为 session_xxxxxxxxxxxxx
    await expect(page.getByText(/会话: session_\d+/)).toBeVisible();
  });

  test('点击"开始"后节点数量变为 1', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await expect(page.getByText(/节点: 1/)).toBeVisible();
  });

  test('点击"开始"后日志面板显示日志', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    // 日志数量应该大于 0
    await expect(page.getByText(/日志 \(\d+\)/)).toBeTruthy();
    const logText = await page.locator('text=/日志 \\(\\d+\\)/').textContent();
    const match = logText?.match(/日志 \((\d+)\)/);
    const count = match ? parseInt(match[1]) : 0;
    expect(count).toBeGreaterThan(0);
  });

  test('点击"停止"后状态恢复"空闲"', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await page.getByRole('button', { name: /停止/i }).click();
    await expect(page.getByText('空闲')).toBeVisible();
  });

  test('点击"停止"后按钮变回"开始"', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await page.getByRole('button', { name: /停止/i }).click();
    await expect(page.getByRole('button', { name: /开始/i })).toBeVisible();
  });

  test('应该显示四种视图切换按钮', async ({ page }) => {
    await expect(page.getByText('因果图')).toBeVisible();
    await expect(page.getByText('时间线')).toBeVisible();
    await expect(page.getByText('对比图')).toBeVisible();
    await expect(page.getByText('层级图')).toBeVisible();
  });

  test('点击视图切换按钮应该高亮当前视图', async ({ page }) => {
    // 默认是因果图（蓝色边框）
    const causalBtn = page.getByText('因果图');
    await expect(causalBtn).toHaveCSS(
      'border',
      /2px.*solid.*rgb\(59, 130, 246\)/,
    );
  });

  test('应该显示 ReactFlow 画布', async ({ page }) => {
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('应该显示日志面板', async ({ page }) => {
    await expect(page.getByText(/日志 \(\d+\)/)).toBeVisible();
  });

  test('应该显示底部状态栏', async ({ page }) => {
    await expect(page.getByText(/边: 0/)).toBeVisible();
  });

  test('应该显示当前时间显示', async ({ page }) => {
    await expect(page.getByText(/当前时间: 0:00/)).toBeVisible();
  });

  test('点击"开始"后日志面板应该显示会话开始消息', async ({ page }) => {
    await page.getByRole('button', { name: /开始/i }).click();
    await expect(page.getByText(/会话开始/)).toBeVisible();
  });

  test('停止后再点击"开始"应该开始新的会话', async ({ page }) => {
    // 第一次会话
    await page.getByRole('button', { name: /开始/i }).click();
    const firstSession = await page
      .getByText(/会话: session_(\d+)/)
      .textContent();
    await page.getByRole('button', { name: /停止/i }).click();

    // 第二次会话
    await page.getByRole('button', { name: /开始/i }).click();
    const secondSession = await page
      .getByText(/会话: session_(\d+)/)
      .textContent();

    // 两个会话 ID 应该不同
    expect(secondSession).not.toBe(firstSession);
  });
});
