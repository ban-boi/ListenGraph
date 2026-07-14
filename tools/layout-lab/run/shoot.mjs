import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const dir = '../outputs/r3a-vs-r3b';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const browser = await chromium.launch({ headless: true });
for (const f of files) {
  const p = path.resolve(dir, f);
  const page = await browser.newPage();
  const url = 'file:///' + p.replace(/\\/g, '/');
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  const png = f.replace('.html', '.png');
  try {
    await page.screenshot({ path: path.join(dir, png), fullPage: true });
    console.log('OK:', f);
  } catch (e) {
    console.warn('FAIL:', f);
  }
  await page.close();
}
await browser.close();
console.log('done');
