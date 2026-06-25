// Browser smoke test (dev-only, uses Playwright). Serves the project with a
// tiny static server and drives a headless Chromium to verify the app boots,
// renders, and reacts to user actions without runtime errors.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(data);
  });
});

function assert(cond, msg) { if (!cond) { throw new Error('FAIL: ' + msg); } console.log('  ok  ' + msg); }

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(base + '/index.html');
  await page.waitForSelector('.column', { timeout: 5000 });

  const columns = await page.locator('.column').count();
  assert(columns === 3, `renders 3 default columns (got ${columns})`);

  // Add a card to the first column.
  await page.locator('.column').first().locator('.add-card-btn').click();
  await page.waitForTimeout(100);
  const cards = await page.locator('.column').first().locator('.card').count();
  assert(cards === 1, `add-card adds a card (got ${cards})`);

  // Add a column.
  await page.locator('[data-add-column]').click();
  await page.waitForTimeout(100);
  const cols2 = await page.locator('.column').count();
  assert(cols2 === 4, `add-column adds a list (got ${cols2})`);

  // Language switch to English updates labels.
  await page.selectOption('#langSelect', 'en');
  await page.waitForTimeout(100);
  const addColText = await page.locator('[data-add-column]').textContent();
  assert(addColText.includes('Add list'), `language switch updates labels (got "${addColText}")`);

  // Zoom button changes the scale transform.
  await page.locator('#zoomInBtn').click();
  const transform = await page.locator('#boardScale').evaluate((el) => el.style.transform);
  assert(/scale\(/.test(transform), `zoom applies a transform (got "${transform}")`);

  // Reload to verify persistence (IndexedDB) restores the added card/column.
  await page.reload();
  await page.waitForSelector('.column', { timeout: 5000 });
  await page.waitForTimeout(200);
  const colsAfter = await page.locator('.column').count();
  assert(colsAfter === 4, `state persists across reload (got ${colsAfter})`);

  // Drag the card from the first column into the second (empty) column.
  const card = page.locator('.column').nth(0).locator('.card').first();
  const target = page.locator('.column').nth(1);
  const cb = await card.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2 - 20, { steps: 5 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 10 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 70, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const c0 = await page.locator('.column').nth(0).locator('.card').count();
  const c1 = await page.locator('.column').nth(1).locator('.card').count();
  assert(c0 === 0 && c1 === 1, `drag-and-drop moves card across columns (got ${c0}/${c1})`);

  assert(errors.length === 0, `no runtime errors (${JSON.stringify(errors)})`);
  console.log('\nsmoke: all checks passed');
} finally {
  await browser.close();
  server.close();
}
