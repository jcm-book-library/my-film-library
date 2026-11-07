// Interaction polish tests for app.html: drag to reorder Up next, back to top, the left edit panel, the Library filter area.
// Run: node tests/interact.test.mjs. Uses the in-memory fake sheet and invented films; nothing touches Google or the network.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeSheet, diffCells, show, SHEET_ID, WIDTH } from './fakesheet.mjs';
import { buildPlanFixture } from './planfixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = (process.env.SHOTS_DIR || SCRATCH + '/shots') + '/interact';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvi-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', SHEET_ID) + '</body></html>');

// Phone drags use a tall window so a whole Up next list is on screen; the autoscroll scenario uses the real 390x844.
const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 1500 }, phoneReal: { width: 390, height: 844 }, mid: { width: 960, height: 800 } };
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function open(size, { setup, S = '', touch = false, reduced = false, theme = null } = {}) {
  const fake = new FakeSheet(buildPlanFixture());
  if (setup) setup(fake);
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const badReq = [];
  await ctx.route(/^https?:\/\//, r => { badReq.push(r.request().url()); r.abort(); });
  await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/accounts\.google\.com|cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.exposeFunction('__call', async (server, tool, input, opts) => {
    try { return fake.handle(server, tool, input, opts); }
    catch (e) { return { __error: (e && typeof e === 'object' && e.code) ? { code: e.code, message: e.message } : { code: 'tool_error', message: String((e && e.message) || e) } }; }
  });
  if (theme) await page.addInitScript(t => { try { localStorage.setItem('mvl-theme', t); } catch (_) { /* storage blocked */ } }, theme);
  await page.addInitScript(() => {
    window.claude = { use: async n => n === 'mcp' ? { callTool: async (s, t, i, o) => { const r = await window.__call(s, t, i, o); if (r && r.__error) throw r.__error; return r; } } : null };
  });
  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => /^Live from your sheet/.test(document.getElementById('statusText').textContent) || document.getElementById('status').dataset.state === 'error', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(100);
  return { page, ctx, fake, errors, badReq, S, size, n0: fake.calls.length };
}
async function scenario(name, sizes, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  for (const size of sizes) {
    const S = `[${size}] ${name}: `;
    let E;
    try { E = await open(size, { ...opts, S }); await fn(E); safety(E); }
    catch (e) { check(S + 'scenario ran without exception', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    finally { if (E) await E.ctx.close(); }
  }
}
// every write in these scenarios is one cell of Order or Plan (or Status/Sorted via the Plan queue) on the 🎥 tab
function safety(E) {
  const bad = [];
  for (const c of E.fake.calls) {
    if (c.spreadsheetId !== SHEET_ID) bad.push('spreadsheetId');
    if (!/^'🎥( Settings)?'!/.test(c.range)) bad.push('range ' + c.range);
    if (c.tool === 'append_values') bad.push('unexpected append');
    if (c.tool === 'update_values' && !/^'🎥'!([A-S])\d+$/.test(c.range)) bad.push('write not a single cell ' + c.range);
  }
  check(E.S + 'safety: only 🎥 ranges, single-cell writes, no appends', bad.length === 0, bad.slice(0, 4));
  check(E.S + 'no page errors', E.errors.length === 0, E.errors.slice(0, 3));
  check(E.S + 'no network outside the stubs', E.badReq.length === 0, E.badReq.slice(0, 3));
}

const UPD = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'update_values');
const goPlan = async page => { await page.click('#tab-library'); await page.click('.lib-mode button[data-mode="plan"]'); await page.waitForTimeout(80); };
const settle = async page => { await page.waitForFunction(() => planQ.pending === 0); await page.waitForTimeout(250); };
const titles = page => page.$$eval('#planUp li .t', els => els.map(e => e.textContent.trim()));
const gripOf = (page, t) => page.locator(`#planUp button.grip[aria-label="Reorder: ${t}"]`).first();
const UP = ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Billy Style'];
// What the sheet should change for a new Up next order: Order = place where it differs, Plan = Up next where it is not yet
function expectCells(fake, order) {
  const out = [];
  order.forEach((t, i) => {
    const r = fake.rowOfTitle(t);
    if (fake.cell(r, 'Order') !== i + 1) out.push(`P${r}=${i + 1}`);
    if (fake.cell(r, 'Plan') !== 'Up next') out.push(`O${r}="Up next"`);
  });
  return out.sort();
}
const changed = (before, fake) => diffCells(before, fake.snapshot()).map(d => `${d.ref}=${d.to}`).sort();
const box = async loc => { const b = await loc.boundingBox(); return b; };
// mouse drag from the middle of a handle to a y (page is scrolled so both are in view)
async function mouseDrag(page, title, toY, { hold = false } = {}) {
  const b = await box(gripOf(page, title));
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + (toY > y ? 6 : -6), { steps: 2 });
  await page.mouse.move(x, toY, { steps: 12 });
  if (!hold) await page.mouse.up();
  return { x, y };
}
const rowBox = async (page, title) => box(page.locator(`#planUp li:has(.t:text-is("${title}"))`));

/* =============================== 1. drag to reorder =============================== */
await scenario('arrow buttons are gone, handles are focusable buttons', ['laptop', 'phone'], async E => {
  const { page, S } = E;
  await goPlan(page);
  eq(S + 'no Move up / Move down buttons', await page.locator('#planView button[aria-label^="Move up"], #planView button[aria-label^="Move down"]').count(), 0);
  eq(S + 'one handle per Up next row', await page.locator('#planUp button.grip').count(), 7);
  const g = await page.$eval('#planUp button.grip', b => ({ tag: b.tagName, type: b.type, ta: getComputedStyle(b).touchAction, li: getComputedStyle(b.closest('li')).touchAction, tab: b.tabIndex, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
  check(S + 'handle is a <button>, touch-action none on the handle only', g.tag === 'BUTTON' && g.ta === 'none' && g.li === 'auto' && g.tab === 0, g);
  if (E.size === 'phone') check(S + 'handle tap target is 40px on a phone', g.w >= 40 && g.h >= 40, g);
  check(S + 'Log Up next list has no handles (it is a read-only glance)', (await page.locator('#upList .grip').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/plan-${E.size}.png` });
});

await scenario('drag first to last writes exactly the Order cells that changed', ['laptop', 'phone'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot(), order = [...UP.slice(1), UP[0]], want = expectCells(fake, order);
  E.n0 = fake.calls.length;
  const last = await rowBox(page, 'Billy Style');
  await mouseDrag(page, 'Alder Gate', last.y + last.height - 4, { hold: true });
  check(S + 'mid-drag: the row is lifted and a drop line shows', (await page.locator('#planUp li.dragging').count()) === 1 && (await page.locator('#planUp .drop-line:not([hidden])').count()) === 1);
  eq(S + 'mid-drag: nothing written yet', UPD(fake, E.n0).length, 0);
  await page.mouse.up(); await settle(page);
  eq(S + 'new order on screen', await titles(page), order);
  eq(S + 'sheet cells changed = exactly the Order cells that differ (and Plan on the owner-edited film)', changed(before, fake), want);
  const ups = UPD(fake, E.n0);
  eq(S + 'one update_values call per changed cell, nothing else', ups.length, want.length);
  check(S + 'Order is 1..7 on the sheet', UP.length === 7 && order.every((t, i) => fake.cell(fake.rowOfTitle(t), 'Order') === i + 1));
  check(S + 'no drag artefacts left behind', (await page.locator('#planUp li.dragging, #planUp .drop-line').count()) === 0 && !(await page.evaluate(() => document.body.classList.contains('dragging-up'))));
});

await scenario('drag last to first, and into the middle', ['laptop'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  let before = fake.snapshot(), order = ['Fir Lane', 'Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Billy Style'];
  let want = expectCells(fake, order);
  const first = await rowBox(page, 'Alder Gate');
  await mouseDrag(page, 'Fir Lane', first.y + 4); await settle(page);
  eq(S + 'Fir Lane to the top: order', await titles(page), order);
  eq(S + 'Fir Lane to the top: cells', changed(before, fake), want);
  before = fake.snapshot(); order = ['Fir Lane', 'Birch Pier', 'Alder Gate', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Billy Style']; want = expectCells(fake, order);
  const third = await rowBox(page, 'Cedar Row');
  await mouseDrag(page, 'Alder Gate', third.y + 6); await settle(page);
  eq(S + 'Alder Gate to third place: order', await titles(page), order);
  eq(S + 'Alder Gate to third place: cells', changed(before, fake), want);
});

await scenario('drag to the same place writes nothing', ['laptop', 'phone'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot();
  E.n0 = fake.calls.length;
  const r = await rowBox(page, 'Cedar Row');
  await mouseDrag(page, 'Cedar Row', r.y + r.height / 2 + 12); await settle(page);
  eq(S + 'a small wobble inside the row: no calls at all', fake.calls.length, E.n0);
  // out and back to where it started
  const top = await rowBox(page, 'Alder Gate'), mine = await rowBox(page, 'Dove Hall');
  const b = await box(gripOf(page, 'Dove Hall'));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 5, top.y + 4, { steps: 10 }); await page.mouse.move(b.x + 5, mine.y + mine.height / 2, { steps: 10 }); await page.mouse.up();
  await settle(page);
  eq(S + 'dragged up and back: no calls at all', fake.calls.length, E.n0);
  eq(S + 'order and sheet unchanged', [await titles(page), changed(before, fake)], [UP, []]);
  // a plain click on the handle does not write either
  await gripOf(page, 'Elm Court').click(); await settle(page);
  eq(S + 'click on a handle: no calls', fake.calls.length, E.n0);
});

await scenario('Escape cancels a drag', ['laptop', 'phone'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  E.n0 = fake.calls.length;
  const mid = await rowBox(page, 'Dove Hall');
  await mouseDrag(page, 'Alder Gate', mid.y + 20, { hold: true });
  check(S + 'row lifted, drop line between Cedar Row and Dove Hall', (await page.locator('#planUp li.dragging').count()) === 1 && (await page.locator('#planUp .drop-line:not([hidden])').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/plan-mid-drag-${E.size}.png` });
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page);
  eq(S + 'order unchanged, nothing written', [await titles(page), fake.calls.length], [UP, E.n0]);
});

await scenario('keyboard: ArrowUp / ArrowDown on the handle, with a live announcement', ['laptop', 'phone'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  let before = fake.snapshot();
  E.n0 = fake.calls.length;
  await gripOf(page, 'Alder Gate').focus();
  await page.keyboard.press('ArrowDown');
  eq(S + 'announced at once', (await page.textContent('#planLive')).replace(/ /g, ''), 'Alder Gate moved to position 2 of 7');
  eq(S + 'screen already shows it', (await titles(page)).slice(0, 2), ['Birch Pier', 'Alder Gate']);
  await settle(page);
  eq(S + 'cells', changed(before, fake), expectCells({ rowOfTitle: t => before.films.findIndex((r, i) => i >= 2 && String(r[0]) === t) + 1, cell: (r, n) => before.films[r - 1][n === 'Order' ? 15 : 14] }, ['Birch Pier', 'Alder Gate', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Billy Style']));
  check(S + 'focus stays on the same handle after the write', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Reorder: Alder Gate'));
  before = fake.snapshot();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await settle(page);
  eq(S + 'two more presses in a row (queued): order', await titles(page), ['Birch Pier', 'Cedar Row', 'Dove Hall', 'Alder Gate', 'Elm Court', 'Fir Lane', 'Billy Style']);
  eq(S + 'announcement for the last move', (await page.textContent('#planLive')).replace(/ /g, ''), 'Alder Gate moved to position 4 of 7');
  await page.keyboard.press('ArrowUp'); await settle(page);
  eq(S + 'ArrowUp moves back one place', (await titles(page)).slice(2, 4), ['Alder Gate', 'Dove Hall']);
  const orders = [...UP].map(t => fake.cell(fake.rowOfTitle(t), 'Order')).sort((a, b) => a - b);
  eq(S + 'Orders on the sheet are unique 1..7', orders, [1, 2, 3, 4, 5, 6, 7]);
  // edges do nothing
  const n1 = fake.calls.length;
  await gripOf(page, 'Birch Pier').focus(); await page.keyboard.press('ArrowUp');
  await gripOf(page, 'Billy Style').focus(); await page.keyboard.press('ArrowDown'); await settle(page);
  eq(S + 'ArrowUp on the first / ArrowDown on the last: no calls', fake.calls.length, n1);
});

await scenario('failed write reverts and says so', ['laptop', 'phone'], { setup: f => f.failNext('update_values', { code: 'tool_error', message: 'boom' }) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot();
  const last = await rowBox(page, 'Billy Style');
  await mouseDrag(page, 'Alder Gate', last.y + last.height - 4);
  eq(S + 'the screen moved first', (await titles(page))[6], 'Alder Gate');
  await settle(page); await page.waitForTimeout(300);
  eq(S + 'then went back to the sheet order', await titles(page), UP);
  const n = await page.evaluate(() => { const n = document.getElementById('notice'); return { hidden: n.hidden, text: n.textContent }; });
  check(S + 'same message as the other Plan writes', !n.hidden && /Not saved: boom/.test(n.text), n);
  eq(S + 'sheet unchanged', diffCells(before, fake.snapshot()).length, 0);
  // and it works again afterwards
  await settle(page);
  await gripOf(page, 'Alder Gate').focus(); await page.keyboard.press('ArrowDown'); await settle(page);
  eq(S + 'a later move is saved', (await titles(page)).slice(0, 2), ['Birch Pier', 'Alder Gate']);
});

await scenario('rapid drags go through the queue in order', ['laptop'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  let r = await rowBox(page, 'Billy Style');
  await mouseDrag(page, 'Alder Gate', r.y + r.height - 4);
  r = await rowBox(page, 'Alder Gate');
  await mouseDrag(page, 'Birch Pier', r.y + r.height - 4);   // second drag before the first is saved
  check(S + 'the second drag started while writes were pending', true);
  await settle(page);
  const want = ['Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Billy Style', 'Alder Gate', 'Birch Pier'];
  eq(S + 'screen order', await titles(page), want);
  eq(S + 'sheet Orders follow it', want.map(t => fake.cell(fake.rowOfTitle(t), 'Order')), [1, 2, 3, 4, 5, 6, 7]);
  check(S + 'every film is Up next and none was lost', want.every(t => fake.cell(fake.rowOfTitle(t), 'Plan') === 'Up next'));
  // calls are strictly sequential: the sheet was never written by two drags at once
  const w = UPD(fake, 0).map(c => c.range);
  eq(S + 'no cell written twice with a different value in a row', w.length, new Set(w.map((x, i) => x + '@' + i)).size);
});

await scenario('touch at 390px: drag by the handle, page still scrolls elsewhere', ['phone'], { touch: true }, async E => {
  const { page, fake, S, ctx } = E;
  await goPlan(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const before = fake.snapshot(), order = ['Fir Lane', ...UP.filter(t => t !== 'Fir Lane')];
  const g = await box(gripOf(page, 'Fir Lane')), top = await rowBox(page, 'Alder Gate');
  const x = g.x + g.width / 2, y = g.y + g.height / 2;
  await touch('touchStart', x, y);
  for (let i = 1; i <= 14; i++) await touch('touchMove', x, y + (top.y + 4 - y) * i / 14);
  check(S + 'touch drag lifts the row', (await page.locator('#planUp li.dragging').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/plan-touch-drag-390.png` });
  await touch('touchEnd');
  await settle(page);
  eq(S + 'touch drop: order', await titles(page), order);
  eq(S + 'touch drop: cells', changed(before, fake), expectCells({ rowOfTitle: t => before.films.findIndex((r, i) => i >= 2 && String(r[0]) === t) + 1, cell: (r, n) => before.films[r - 1][n === 'Order' ? 15 : 14] }, order));
  // a swipe that starts on the text (not the handle) scrolls the page and writes nothing
  await page.evaluate(() => window.scrollTo(0, 0));
  const t0 = await rowBox(page, 'Cedar Row'), sy0 = await page.evaluate(() => scrollY);
  const n0 = fake.calls.length;
  await touch('touchStart', 120, t0.y + 30);
  for (let i = 1; i <= 8; i++) await touch('touchMove', 120, t0.y + 30 - i * 30);
  await touch('touchEnd'); await page.waitForTimeout(300);
  check(S + 'swiping on a row scrolls the page', (await page.evaluate(() => scrollY)) > sy0 + 50, await page.evaluate(() => scrollY));
  eq(S + 'and writes nothing', fake.calls.length, n0);
});

await scenario('near the screen edge the page autoscrolls while dragging (390x844)', ['phoneReal'], async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const h = await page.evaluate(() => innerHeight);
  const lastBottom = await page.evaluate(() => { const r = document.querySelector('#planUp li:last-child').getBoundingClientRect(); return r.bottom + scrollY; });
  check(S + 'the Up next list is taller than the screen from the top of the page', lastBottom > h, [lastBottom, h]);
  const b = await box(gripOf(page, 'Alder Gate'));
  const n0 = fake.calls.length;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 5, h - 20, { steps: 8 });
  await page.waitForTimeout(900);
  const sy = await page.evaluate(() => scrollY);
  check(S + 'scrolled down while the pointer waited at the bottom edge', sy > 100, sy);
  await page.screenshot({ path: `${SHOTS}/plan-autoscroll-390.png` });
  await page.mouse.move(b.x + 5, 30, { steps: 8 }); await page.waitForTimeout(900);
  check(S + 'and back up at the top edge', (await page.evaluate(() => scrollY)) < sy - 50, await page.evaluate(() => scrollY));
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page);
  eq(S + 'cancelled: nothing written', fake.calls.length, n0);
});

/* =============================== 2. back to top =============================== */
async function toTopState(page) {
  return page.evaluate(() => {
    const b = document.getElementById('toTop'), r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    const hit = x => { const q = x.getBoundingClientRect(); return q.width > 0 && q.height > 0 && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; };
    const covered = [...document.querySelectorAll('button,input,select,textarea,a[href]')].filter(x => x !== b && hit(x) && getComputedStyle(x).visibility !== 'hidden' && !x.closest('[hidden]') && !x.closest('dialog:not([open])') && x.offsetParent !== null).map(x => x.id || x.className || x.tagName);
    return { shown: b.classList.contains('show') && cs.visibility === 'visible', opacity: +cs.opacity, y: scrollY, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }, W: innerWidth, H: innerHeight, covered };
  });
}
await scenario('back to top: appears after 600px, scrolls up, 44px round, 16px margin', ['laptop', 'phoneReal'], async E => {
  const { page, S } = E;
  await page.click('#tab-library'); await page.waitForTimeout(100);
  let st = await toTopState(page);
  check(S + 'hidden at the top of the page', !st.shown && st.y === 0, st);
  await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(250);
  check(S + 'still hidden at 500px', !(await toTopState(page)).shown);
  const aria = await page.getAttribute('#toTop', 'aria-label');
  eq(S + 'aria-label', aria, 'Back to top');
  // find a spot past 600px where it is visible (it steps aside while it would sit over a control)
  let seen = null;
  for (let y = 700; y < 2400 && !seen; y += 40) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(60); const s = await toTopState(page); if (s.shown) seen = s; }
  check(S + 'visible after scrolling past 600px', !!seen, seen);
  if (seen) {
    await page.waitForTimeout(300);
    check(S + 'fully opaque once the fade is done', (await toTopState(page)).opacity > 0.99);
    seen = await toTopState(page);
    check(S + 'is 44 x 44 and round', near(seen.rect.w, 44) && near(seen.rect.h, 44) && (await page.$eval('#toTop', b => getComputedStyle(b).borderRadius)).includes('50%'), seen.rect);
    check(S + 'at least 16px from the right and bottom edges', seen.W - seen.rect.r >= 15.5 && seen.H - seen.rect.b >= 15.5, [seen.W - seen.rect.r, seen.H - seen.rect.b]);
    eq(S + 'covers no button or field while shown', seen.covered, []);
    await page.screenshot({ path: `${SHOTS}/back-to-top-${E.size}.png` });
    await page.click('#toTop');
    await page.waitForFunction(() => scrollY === 0, null, { timeout: 4000 }).catch(() => {});
    check(S + 'click scrolls to the top', (await page.evaluate(() => scrollY)) === 0);
    await page.waitForTimeout(250);
    check(S + 'and it hides again', !(await toTopState(page)).shown);
    check(S + 'focus lands on the current tab', await page.evaluate(() => document.activeElement && document.activeElement.id === 'tab-library'));
  }
});
await scenario('back to top: instant with reduced motion', ['phoneReal'], { reduced: true }, async E => {
  const { page, S } = E;
  await page.click('#tab-library');
  let ok = false;
  for (let y = 700; y < 2400 && !ok; y += 40) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(60); ok = (await toTopState(page)).shown; }
  await page.evaluate(() => { window.__t0 = performance.now(); });
  await page.click('#toTop');
  await page.waitForTimeout(60);
  eq(S + 'at the top within a frame or two', await page.evaluate(() => scrollY), 0);
});
for (const size of ['laptop', 'phoneReal']) await scenario('back to top never sits over a control (Log form, Plan buttons, Library) and never shows below 600px', [size], async E => {
  const { page, S } = E;
  const bad = [], shownAt = [];
  for (const [tab, mode] of [['log', null], ['library', 'films'], ['library', 'plan'], ['dashboard', null]]) {
    await page.click('#tab-' + tab); if (mode) await page.click(`.lib-mode button[data-mode="${mode}"]`);
    await page.waitForTimeout(150);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= max; y += 90) {
      await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(40);
      let s = await toTopState(page);
      if (s.shown === !!(s.y > 700 && !s.covered.length) ? false : true) { await page.waitForTimeout(120); s = await toTopState(page); }   // let a late frame settle
      if (s.shown && s.covered.length) bad.push(`${tab}/${mode} y${y} ${s.covered.join(',')}`);
      if (s.shown && s.y <= 600) bad.push(`${tab}/${mode} shown at ${s.y}`);
      if (!s.shown && s.y > 700 && !s.covered.length && !(await page.evaluate(() => !!document.querySelector('dialog:modal')))) bad.push(`${tab}/${mode} y${y} hidden though nothing is under it`);
      if (s.shown) shownAt.push(`${tab}/${mode}`);
    }
  }
  eq(S + 'invariants hold at every scroll position on every view', bad.slice(0, 5), []);
  check(S + 'it does show on every kind of view', ['log/null', 'library/films', 'library/plan', 'dashboard/null'].every(k => shownAt.includes(k)) || E.size === 'phoneReal' && shownAt.length > 0, [...new Set(shownAt)]);
  // the Log a film form specifically: scroll it into view and compare rectangles
  await page.click('#tab-log'); await page.waitForTimeout(100);
  await page.$eval('#logForm', f => f.scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
  const form = await page.evaluate(() => {
    const t = document.getElementById('toTop').getBoundingClientRect(), shown = document.getElementById('toTop').classList.contains('show');
    const over = [...document.querySelectorAll('#logForm input,#logForm select,#logForm button,#logForm textarea')].filter(x => { const r = x.getBoundingClientRect(); return r.width && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top; }).map(x => x.id);
    return { shown, over };
  });
  check(S + 'Log a film controls: not covered (button steps aside if it would be)', !(form.shown && form.over.length), form);
  const status = await page.evaluate(() => { const s = document.getElementById('status').getBoundingClientRect(), t = document.getElementById('toTop').getBoundingClientRect(); return { fixed: getComputedStyle(document.getElementById('status')).position, hit: s.left < t.right && s.right > t.left && s.top < t.bottom && s.bottom > t.top }; });
  check(S + 'status line is not fixed and not under the button', status.fixed !== 'fixed' && !status.hit, status);
});

/* =============================== 3. edit panel =============================== */
async function libOpen(page, title) {
  await page.click('#tab-library'); await page.click('.lib-mode button[data-mode="films"]');
  await page.fill('#libSearch', title); await page.waitForTimeout(350);
  await page.locator('#libBody tr.row').first().locator('.t').click();
  const opener = page.locator('#libBody .detail [data-edit]').first();
  await opener.focus();
  await opener.click();
  await page.waitForSelector('#filmDlg[open]');
}
const R = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
const wrapEdges = page => page.evaluate(() => [...document.querySelectorAll('.wrap')].map(w => { const r = w.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
await scenario('edit panel docks on the left from 900px wide', ['laptop', 'mid'], async E => {
  const { page, fake, S } = E;
  const closedEdges = (await page.click('#tab-library'), await wrapEdges(page));
  await libOpen(page, 'Ash Meridian');
  const d = await page.evaluate(() => { const d = document.getElementById('filmDlg'); return { open: d.open, modal: d.matches(':modal'), dock: d.classList.contains('dock'), bodyDock: document.body.classList.contains('dock-open'), inside: d.contains(document.activeElement), pos: getComputedStyle(d).position }; });
  check(S + 'opened without modality, docked', d.open && !d.modal && d.dock && d.bodyDock && d.pos === 'fixed', d);
  check(S + 'focus moved into the panel', d.inside);
  const p = await R(page, '#filmDlg'), H = SIZES[E.size].height, W = SIZES[E.size].width;
  check(S + 'panel hugs the left edge with 16px, full height minus 16px top and bottom', near(p.l, 16) && near(p.t, 16) && near(p.b, H - 16) && p.w >= 340 && p.w <= 421, p);
  const tabs = await R(page, '.tabs'), tbl = await R(page, '.table-wrap'), hd = await R(page, '#wordmark');
  check(S + 'page content sits to the right of the panel (nothing hidden behind it)', tabs.l >= p.r && tbl.l >= p.r && hd.l >= p.r, { panelRight: p.r, tabs: tabs.l, table: tbl.l, header: hd.l });
  check(S + 'content keeps a 16px right gutter and no sideways scroll', near(W - tbl.r, 16) && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), [W - tbl.r]);
  await page.screenshot({ path: `${SHOTS}/panel-${E.size}.png` });
  // the list stays scrollable and the panel stays put
  await page.evaluate(() => { document.body.style.minHeight = '2600px'; scrollTo(0, 300); }); await page.waitForTimeout(100);
  const p2 = await R(page, '#filmDlg');
  check(S + 'page scrolls with the panel open, the panel stays where it is', (await page.evaluate(() => scrollY)) > 0 && near(p2.t, p.t) && near(p2.l, p.l));
  check(S + 'Close and Save are visible inside the panel', (await page.isVisible('#fdClose')) && (await page.isVisible('#fdSave')) && (await R(page, '#fdSave')).b <= H);
  // Escape closes it, focus goes back to the opener, layout returns
  await page.evaluate(() => scrollTo(0, 0));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(S + 'Escape closes the panel', !(await page.evaluate(() => document.getElementById('filmDlg').open)));
  check(S + 'focus returns to the control that opened it', await page.evaluate(() => { const a = document.activeElement; return !!a && a.hasAttribute('data-edit'); }), await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  eq(S + 'page layout is back to what it was', await wrapEdges(page), closedEdges);
  check(S + 'dock class no longer shifts the page', !(await page.evaluate(() => document.body.classList.contains('dock-open'))));
  // the Close button works too
  await page.locator('#libBody .detail [data-edit]').first().click(); await page.waitForSelector('#filmDlg[open]');
  await page.click('#fdClose');
  check(S + 'Close button closes it', !(await page.evaluate(() => document.getElementById('filmDlg').open)));
  void fake;
});
await scenario('picking another film swaps the panel, with a guard for unsaved changes', ['laptop'], async E => {
  const { page, fake, S } = E;
  await page.click('#tab-library');
  await libOpen(page, 'Ash Meridian');
  const firstTitle = await page.inputValue('#fd-title');
  eq(S + 'panel shows the film', firstTitle, 'Ash Meridian');
  // pick another film in the list on the right: the page is not inert
  await page.fill('#libSearch', ''); await page.waitForTimeout(350);
  await page.locator('#libBody tr.row').filter({ hasText: 'Bright Harbour' }).locator('.t').click();
  await page.locator('#libBody .detail [data-edit]').first().click(); await page.waitForTimeout(100);
  eq(S + 'clean panel: swapped without asking', await page.inputValue('#fd-title'), 'Bright Harbour');
  check(S + 'still one open panel, still not modal', await page.evaluate(() => { const d = document.getElementById('filmDlg'); return d.open && !d.matches(':modal'); }));
  // edit, then try another film
  await page.fill('#fd-notes', 'a note I have not saved');
  await page.locator('#libBody tr.row').filter({ hasText: 'Cold Orchard' }).locator('.t').click();
  await page.locator('#libBody .detail [data-edit]').first().click(); await page.waitForTimeout(100);
  eq(S + 'unsaved changes: the panel stays on the first film', await page.inputValue('#fd-title'), 'Bright Harbour');
  check(S + 'and says why', /unsaved changes/i.test(await page.textContent('#fdMsg')), await page.textContent('#fdMsg'));
  eq(S + 'the typed text is still there', await page.inputValue('#fd-notes'), 'a note I have not saved');
  await page.locator('#libBody .detail [data-edit]').first().click(); await page.waitForTimeout(100);
  eq(S + 'asking again discards and swaps', await page.inputValue('#fd-title'), 'Cold Orchard');
  eq(S + 'the discarded note was never written', fake.calls.filter(c => c.tool === 'update_values').length, 0);
  // saving from the docked panel writes one cell
  await page.fill('#fd-rating', '7');
  const before = fake.snapshot();
  await page.click('#fdSave'); await page.waitForFunction(() => !document.getElementById('fdSave').disabled); await page.waitForTimeout(300);
  const got = diffCells(before, fake.snapshot());
  check(S + 'Save through the docked panel writes the changed cell only', got.length <= 1, got.map(show));
  check(S + 'panel closed after saving', !(await page.evaluate(() => document.getElementById('filmDlg').open)));
});
await scenario('on a phone the edit panel is a full-width bottom sheet (modal)', ['phoneReal'], async E => {
  const { page, S } = E;
  await libOpen(page, 'Ash Meridian');
  const d = await page.evaluate(() => { const d = document.getElementById('filmDlg'), r = d.getBoundingClientRect(); return { modal: d.matches(':modal'), dock: d.classList.contains('dock'), bodyDock: document.body.classList.contains('dock-open'), l: r.left, r: r.right, b: r.bottom, t: r.top, W: innerWidth, H: innerHeight, inside: d.contains(document.activeElement) }; });
  check(S + 'modal, not docked', d.modal && !d.dock && !d.bodyDock, d);
  check(S + 'full width, sitting on the bottom edge', near(d.l, 0) && near(d.r, d.W) && near(d.b, d.H) && d.t >= 0, d);
  check(S + 'focus is inside', d.inside);
  const save = await R(page, '#fdSave'), close = await R(page, '#fdClose');
  check(S + 'Save and Close are on screen', save.b <= d.H && save.r <= d.W && close.t >= 0 && close.r <= d.W);
  check(S + 'no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${SHOTS}/sheet-390.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(S + 'Escape closes the sheet', !(await page.evaluate(() => document.getElementById('filmDlg').open)));
  check(S + 'focus returns to the opener', await page.evaluate(() => { const a = document.activeElement; return !!a && a.hasAttribute('data-edit'); }));
});
await scenario('resizing across 900px changes how an open panel is shown', ['laptop'], async E => {
  const { page, S } = E;
  await libOpen(page, 'Ash Meridian');
  await page.fill('#fd-notes', 'kept');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  check(S + 'narrow: now a modal sheet, text kept', await page.evaluate(() => { const d = document.getElementById('filmDlg'); return d.open && d.matches(':modal') && document.getElementById('fd-notes').value === 'kept' && !document.body.classList.contains('dock-open'); }));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(200);
  check(S + 'wide again: docked, text kept', await page.evaluate(() => { const d = document.getElementById('filmDlg'); return d.open && !d.matches(':modal') && document.getElementById('fd-notes').value === 'kept' && document.body.classList.contains('dock-open'); }));
});
await scenario('panel does not overlap the back-to-top button', ['laptop'], async E => {
  const { page, S } = E;
  await libOpen(page, 'Ash Meridian');
  await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(250);
  const s = await toTopState(page), p = await R(page, '#filmDlg');
  check(S + 'button is on the right of the panel', s.rect.l >= p.r + 8, [s.rect.l, p.r]);
  const sv = await R(page, '#fdSave');
  check(S + 'and does not touch Save', s.rect.l >= sv.r || s.rect.t >= sv.b || s.rect.b <= sv.t);
});

/* =============================== 4. Library filter area =============================== */
const FILTER_SETUP = f => { // spread the statuses so the chips need more than one row
  ['Abandoned', 'On Hold', 'Reference'].forEach((s, i) => f.setCell(f.rowOfTitle('Pending ' + 'ABC'[i]), 'Status', s));
};
await scenario('Library filter area is aligned', ['laptop', 'phoneReal'], { setup: FILTER_SETUP }, async E => {
  const { page, S } = E;
  await page.click('#tab-library'); await page.waitForTimeout(150);
  const bar = await R(page, '.lib-bar'), search = await R(page, '#libSearch');
  const cells = [];
  for (const id of ['libGenre', 'libPlatform', 'libOwned', 'addFilmBtn']) cells.push(await R(page, '#' + id));
  check(S + 'search comes first and spans the full width', near(search.l, bar.l) && near(search.r, bar.r) && search.b <= Math.min(...cells.map(c => c.t)), { search, bar });
  check(S + 'search, selects and Add film are all 40px high', [search, ...cells].every(c => near(c.h, 40)), [search, ...cells].map(c => c.h));
  check(S + 'three selects and the button have equal widths', cells.every(c => near(c.w, cells[0].w)), cells.map(c => c.w));
  const cols = E.size === 'laptop' ? 4 : 2;
  const tops = [...new Set(cells.map(c => Math.round(c.t)))];
  eq(S + `laid out in ${cols} columns`, tops.length, 4 / cols);
  const rows = tops.map(t => cells.filter(c => Math.round(c.t) === t));
  check(S + 'rows start at the left edge and end at the right edge', rows.every(r => near(r[0].l, bar.l) && near(r[r.length - 1].r, bar.r)), rows.map(r => r.map(c => [c.l, c.r])));
  check(S + 'columns line up between rows', rows.every(r => r.every((c, i) => near(c.l, rows[0][i].l) && near(c.w, rows[0][i].w))));
  check(S + '12px between controls, sideways and downwards', rows.every(r => r.slice(1).every((c, i) => near(c.l - r[i].r, 12))) && rows.slice(1).every((r, i) => near(r[0].t - rows[i][0].b, 12)) && near(cells[0].t - search.b, 12), { search: cells[0].t - search.b });
  const chips = await page.$$eval('#libChips .chip', cs => cs.map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, label: c.textContent.trim().slice(0, 14), sw: c.scrollWidth, cw: c.clientWidth }; }));
  const grid = await R(page, '#libChips');
  check(S + `there are enough chips to need several rows (${chips.length})`, chips.length >= 9, chips.length);
  check(S + 'all chips have the same height and width', chips.every(c => near(c.h, chips[0].h) && near(c.w, chips[0].w)), chips.map(c => [c.w, c.h]));
  const crow = [...new Set(chips.map(c => Math.round(c.t)))].map(t => chips.filter(c => Math.round(c.t) === t));
  check(S + 'chips: more than one row', crow.length > 1, crow.length);
  check(S + 'chips: first row spans left edge to right edge', near(crow[0][0].l, grid.l) && near(crow[0][crow[0].length - 1].r, grid.r), [crow[0][0].l, grid.l, crow[0][crow[0].length - 1].r, grid.r]);
  check(S + 'chips: every row uses the same column positions (last row may be shorter)', crow.every((r, ri) => r.length <= crow[0].length && (ri === crow.length - 1 || r.length === crow[0].length) && r.every((c, i) => near(c.l, crow[0][i].l))), crow.map(r => r.length));
  check(S + 'chips: 12px between chips in a row and between rows', crow.every(r => r.slice(1).every((c, i) => near(c.l - r[i].r, 12))) && crow.slice(1).every((r, i) => near(r[0].t - crow[i][0].b, 12)));
  check(S + 'chip labels are not cut off', chips.every(c => c.sw <= c.cw + 1), chips.filter(c => c.sw > c.cw + 1).map(c => c.label));
  check(S + 'chips keep their pressed state and still filter', await page.evaluate(() => { const c = document.querySelector('#libChips .chip[data-st="Watched"]'); c.click(); return document.querySelector('#libChips .chip[data-st="Watched"]').getAttribute('aria-pressed') === 'true'; }));
  check(S + 'chips sit under the search/selects with 12px or more', grid.t - Math.max(...cells.map(c => c.b)) >= 12);
  check(S + 'no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${SHOTS}/library-filter-${E.size === 'laptop' ? 1280 : 390}.png` });
});

/* =============================== screenshots in three themes =============================== */
for (const theme of ['totoro', 'default', 'matrix']) {
  await scenario('screenshots ' + theme, ['laptop'], { theme }, async E => {
    const { page, S } = E;
    await libOpen(page, 'Ash Meridian');
    await page.fill('#libSearch', ''); await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/library-panel-${theme}-1280.png` });
    check(S + 'panel open next to the list', await page.evaluate(() => document.getElementById('filmDlg').open && document.body.classList.contains('dock-open')));
    await page.keyboard.press('Escape');
    await goPlan(page);
    const mid = await rowBox(page, 'Dove Hall');
    await mouseDrag(page, 'Alder Gate', mid.y + 20, { hold: true });
    await page.screenshot({ path: `${SHOTS}/plan-drag-${theme}-1280.png` });
    await page.keyboard.press('Escape'); await page.mouse.up();
  });
}
await scenario('screenshots phone Library with the sheet and with the button', ['phoneReal'], { theme: 'totoro' }, async E => {
  const { page, S } = E;
  await page.click('#tab-library'); await page.waitForTimeout(150);
  await page.evaluate(() => scrollTo(0, 1000)); await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/library-phone-totoro-with-button.png` });
  check(S + 'button visible in the shot', (await toTopState(page)).shown);
  await page.evaluate(() => scrollTo(0, 0));
  await libOpen(page, 'Ash Meridian');
  await page.screenshot({ path: `${SHOTS}/library-phone-totoro-sheet.png` });
});

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
