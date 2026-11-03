import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>${css}</style><div class="markdown" style="max-width:1000px"><table><tbody><tr><td>标注工作台</td><td>当前用户可参与</td><td>开始 / 继续标注</td><td>${'复用现有 VAD、ASR 工作台；进入任务后定位上次处理位置，没有记录则进入待处理样本。'.repeat(5)}</td></tr></tbody></table></div>`);
    for (const cell of await page.locator('td').evaluateAll(ns => ns.map(n => ({width:n.getBoundingClientRect().width,min:parseFloat(getComputedStyle(n).fontSize)*8,wrap:getComputedStyle(n).whiteSpace})))) {
      expect(cell.width).toBeGreaterThanOrEqual(cell.min);
      expect(cell.wrap).toBe('normal');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if(width === 390) expect(await page.locator('table').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
  }
  console.log('Markdown table desktop/mobile layout passed');
} finally { await browser.close(); }
