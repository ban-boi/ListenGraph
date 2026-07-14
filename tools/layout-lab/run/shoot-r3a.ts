import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const HTML_DIR = '../outputs/r3a-vs-r3b';
const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const f of files) {
    const htmlPath = path.resolve(HTML_DIR, f);
    const page = await browser.newPage();
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);
    const pngName = f.replace('.html', '.png');
    try {
      await page.screenshot({ path: path.join(HTML_DIR, pngName), fullPage: true });
      console.log('OK:', f);
    } catch (e) {
      console.warn('FAIL:', f, (e as Error).message.split('\n')[0]);
    }
    await page.close();
  }
  await browser.close();
  console.log('done');
}
main();
