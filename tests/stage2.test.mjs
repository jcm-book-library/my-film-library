// Stage 2 (write paths) headless tests for app.html against a FAKE in-memory Google Sheet. Run: node tests/stage2.test.mjs
// Nothing here talks to Google: every request outside the page is answered locally or aborted (and any abort fails the scenario).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeSheet, buildSyntheticFixture, diffCells, show, colLetter, colOf, D, HEADERS, SHEET_ID, WIDTH } from './fakesheet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = process.env.SHOTS_DIR || SCRATCH + '/shots';
const CHART = SCRATCH + '/real/chart.umd.js';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl2-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>');
const CHART_JS = fs.existsSync(CHART) ? fs.readFileSync(CHART) : '';

const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const BOTH = ['laptop', 'phone'], LAPTOP = ['laptop'];
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want, extra) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}${extra ? ' | ' + extra : ''}`);

const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysIso = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const TODAY = () => addDaysIso(0);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ---------------------------------- harness ---------------------------------- */
// mode: 'ok' | 'none' (no window.claude)
async function open(size, { mode = 'ok', setup, S = '' } = {}) {
  const fake = new FakeSheet(buildSyntheticFixture());
  if (setup) setup(fake);
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1 });
  const badReq = [];
  await ctx.route(/^https?:\/\//, r => { badReq.push(r.request().url()); r.abort(); });
  await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/accounts\.google\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.route(/cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CHART_JS }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    window.__notices = [];
    document.addEventListener('DOMContentLoaded', () => {
      const n = document.getElementById('notice');
      if (n) new MutationObserver(() => window.__notices.push({ t: n.textContent, h: n.hidden })).observe(n, { attributes: true, childList: true, characterData: true, subtree: true });
    });
  });
  if (mode !== 'none') {
    await page.exposeFunction('__call', async (server, tool, input, opts) => {
      try { return fake.handle(server, tool, input, opts); }
      catch (e) { return { __error: (e && typeof e === 'object' && e.code) ? { code: e.code, message: e.message } : { code: 'tool_error', message: String((e && e.message) || e) } }; }
    });
    await page.addInitScript(() => {
      window.claude = { use: async n => n === 'mcp' ? { callTool: async (s, t, i, o) => { const r = await window.__call(s, t, i, o); if (r && r.__error) throw r.__error; return r; } } : null };
    });
  }
  await page.goto('file://' + PAGE);
  if (mode === 'ok') await page.waitForFunction(() => /^Live from your sheet/.test(document.getElementById('statusText').textContent) || document.getElementById('status').dataset.state === 'error', null, { timeout: 8000 }).catch(() => {});
  else await page.waitForTimeout(600);
  await page.waitForTimeout(80);
  return { page, ctx, fake, errors, badReq, S, size, n0: fake.calls.length, allowShrink: false };
}

async function scenario(name, sizes, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  for (const size of sizes) {
    const S = `[${size}] ${name} `;
    let E;
    try {
      E = await open(size, { ...opts, S });
      E.S = S;
      await fn(E);
      globalSafety(E);
    } catch (e) {
      check(S + 'scenario ran without exception', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
    } finally {
      if (E) await E.ctx.close();
    }
  }
}

/* ---- N: global safety assertions, run after EVERY scenario ---- */
const READ_OK = [/^'🎥'!A1:R6000$/, /^'🎥'!A2:Z2$/, /^'🎥'!N1:N6000$/, /^'🎥'!A1:A6000$/, /^'🎥'!A\d+:Z\d+$/, /^'🎥 Settings'!A1:C50$/];
function globalSafety(E) {
  const { fake, S } = E, bad = [];
  for (const c of fake.calls) {
    const tag = `#${c.n} ${c.tool} ${c.range}`;
    if (c.server !== 'Google Sheets') bad.push(tag + ' wrong server ' + c.server);
    if (c.spreadsheetId !== SHEET_ID) bad.push(tag + ' wrong spreadsheetId ' + c.spreadsheetId);
    if (!['get_values', 'update_values', 'append_values'].includes(c.tool)) bad.push(tag + ' unexpected tool');
    if (c.tool === 'get_values') { if (!READ_OK.some(r => r.test(c.range))) bad.push(tag + ' read of an unexpected range'); }
    else if (c.tool === 'update_values') {
      const m = String(c.range).match(/^'🎥'!([A-Z]+)(\d+)$/);
      if (!m) bad.push(tag + ' update is not a single cell on the 🎥 tab');
      else {
        if (m[1].length !== 1 || m[1] > 'R') bad.push(tag + ' column outside A..R');
        if (+m[2] < 3) bad.push(tag + ' touches a header row');
      }
      if (!(Array.isArray(c.values) && c.values.length === 1 && c.values[0].length === 1)) bad.push(tag + ' values are not exactly [[x]]');
      else if (!['string', 'number'].includes(typeof c.values[0][0])) bad.push(tag + ' value type ' + typeof c.values[0][0]);
    } else if (c.tool === 'append_values') {
      if (!/^'🎥'!A2:Z\d+$/.test(c.range)) bad.push(tag + ' append not anchored to the data block (A2:Z<last row>)');
      if (!(Array.isArray(c.values) && c.values.length === 1)) bad.push(tag + ' append is not exactly one row');
      else if (c.values[0].length > WIDTH) bad.push(tag + ' append wider than A..R');
    }
  }
  const snapSettings = JSON.stringify(fake.settings);
  if (snapSettings !== JSON.stringify(buildSyntheticFixture().settings)) bad.push('settings tab changed');
  if (!E.allowShrink && fake.grid.length < fake.initialRows) bad.push(`row count shrank ${fake.initialRows} -> ${fake.grid.length}`);
  if (fake.grid.some(r => r.length > WIDTH)) bad.push('a row grew beyond column R');
  check(S + 'N global safety (spreadsheetId, tabs, single-cell updates in A..R, appends, no settings/header writes, no row loss)', bad.length === 0, bad.slice(0, 6));
  check(S + 'N no page errors / console errors', E.errors.length === 0, E.errors.slice(0, 3));
  check(S + 'N no network requests outside the local stubs', E.badReq.length === 0, E.badReq.slice(0, 3));
}

/* ---- helpers ---- */
const UPD = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'update_values');
const APP_ = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'append_values');
const rowOf = (fake, title, year) => { const r = fake.rowOfTitle(title, year); if (!r) throw new Error('fixture row not found: ' + title); return r; };

// compare the exact set of update calls: expected = { ColName: rawValue }
function expectUpdates(E, label, row, want) {
  const { fake, S, n0 } = E;
  const got = UPD(fake, n0).map(c => `${c.range}=${JSON.stringify(c.values)}`).sort();
  const exp = Object.entries(want).map(([k, v]) => `'🎥'!${colLetter(colOf(k))}${row}=${JSON.stringify([[v]])}`).sort();
  eq(S + label + ' exact update_values calls (one cell each)', got, exp);
  check(S + label + ' number of update calls = ' + exp.length, UPD(fake, n0).length === exp.length, UPD(fake, n0).length);
}
// compare the exact cell-level diff: expected = [[row, ColName, typedValue], ...]
function expectDiff(E, label, before, want) {
  const { fake, S } = E;
  const diffs = diffCells(before, fake.snapshot());
  const got = diffs.map(d => `${d.ref}=${d.to}`).sort();
  const exp = want.map(([row, name, to]) => `${colLetter(colOf(name))}${row}=${JSON.stringify(to)}`).sort();
  eq(S + label + ' exact cells changed', got, exp, diffs.map(show).join(' ; '));
}
const sheetUnchanged = (E, label, before) => {
  const diffs = diffCells(before, E.fake.snapshot());
  check(E.S + label + ' sheet cell-for-cell unchanged', diffs.length === 0, diffs.slice(0, 6).map(show));
};
const noWrites = (E, label) => check(E.S + label + ' zero update/append calls', E.fake.calls.slice(E.n0).every(c => c.tool === 'get_values'), E.fake.calls.slice(E.n0).map(c => c.tool + ' ' + c.range));
const noCalls = (E, label) => check(E.S + label + ' zero sheet calls at all', E.fake.calls.length === E.n0, E.fake.calls.slice(E.n0).map(c => c.tool + ' ' + c.range));
// the row is located by header + id column + the row itself right before the first write, and read back after the last
function expectSequence(E, label, row, nWrites) {
  const seq = E.fake.calls.slice(E.n0).map(c => c.tool === 'get_values' ? c.range : c.tool.replace('_values', '') + ' ' + c.range.replace("'🎥'!", ''));
  const head = ["'🎥'!A2:Z2", "'🎥'!N1:N6000", `'🎥'!A${row}:Z${row}`];
  const exp = [...head, ...Array(nWrites).fill('upd'), `'🎥'!A${row}:Z${row}`];
  eq(E.S + label + ' call order: header, id column, row, writes, read-back', seq.map(s => /^update /.test(s) ? 'upd' : s), exp);
}
const settle = async page => { await page.waitForFunction(() => !document.getElementById('lfSave').disabled && !document.getElementById('fdSave').disabled); await page.waitForTimeout(250); };
const noticeState = page => page.evaluate(() => { const n = document.getElementById('notice'); return { hidden: n.hidden, text: n.textContent, kind: n.dataset.kind }; });
const noticeHistory = page => page.evaluate(() => window.__notices.filter(x => !x.h && x.t).map(x => x.t));
const statusText = page => page.textContent('#statusText');
const upTitles = page => page.$$eval('#upList li .t', els => els.map(e => e.textContent.trim()));
const recTitles = page => page.$$eval('#recList li .t', els => els.map(e => e.textContent.trim()));

async function pick(page, title, year) {
  await page.fill('#lfTitle', title);
  const idx = await page.evaluate(({ title, year }) => [...document.querySelectorAll('#lfSugg li')].findIndex(li => li.querySelector('.t').textContent === title && (year == null || li.querySelector('.y').textContent === String(year))), { title, year });
  if (idx < 0) throw new Error('no suggestion for ' + title + ' ' + (year ?? ''));
  await page.locator('#lfSugg li button').nth(idx).click();
}
async function libOpen(page, title, year) {
  await page.click('#tab-library');
  await page.fill('#libSearch', title);
  await page.waitForTimeout(350);
  const idx = await page.evaluate(({ title, year }) => [...document.querySelectorAll('#libBody tr.row')].findIndex(tr => tr.querySelector('.t').textContent.trim() === title && (year == null || tr.querySelector('.y').textContent.trim() === String(year))), { title, year });
  if (idx < 0) throw new Error('library row not found: ' + title + ' ' + (year ?? ''));
  await page.locator('#libBody tr.row').nth(idx).locator('.t').click();
  await page.click('#libBody .detail [data-edit]');
  await page.waitForSelector('#filmDlg[open]');
}
async function openAdd(page) { await page.click('#tab-library'); await page.click('#addFilmBtn'); await page.waitForSelector('#filmDlg[open]'); }
const dlgOpen = page => page.evaluate(() => document.getElementById('filmDlg').open);
const fdSave = async page => { await page.click('#fdSave'); await page.waitForFunction(() => !document.getElementById('fdSave').disabled); await page.waitForTimeout(250); };
const fdMsg = page => page.textContent('#fdMsg');

/* =============================== A. Log in place =============================== */
await scenario('A log Next Up film via typing + suggestion', BOTH, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Harbour', 2012), id = fake.cell(row, 'id');
  check(S + 'A fixture: film is Next Up / Up next / Order 1', fake.cell(row, 'Status') === 'Next Up' && fake.cell(row, 'Plan') === 'Up next' && fake.cell(row, 'Order') === 1);
  check(S + 'A film is in the Up next list before', (await upTitles(page)).includes('Quiet Harbour'));
  await pick(page, 'Quiet Harbour', 2012);
  check(S + 'A plan text says it marks the film as watched', /Marks .Quiet Harbour. \(2012\) as watched today/.test(await page.textContent('#lfPlan')), await page.textContent('#lfPlan'));
  await page.fill('#lfRating', '8');
  await page.selectOption('#lfPlatform', 'Plex');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const T = TODAY();
  expectUpdates(E, 'A', row, { Status: 'Watched', Date: T, Rating: 8, Platform: 'Plex', Plan: '', Order: '' });
  check(S + 'A no append', APP_(fake, E.n0).length === 0);
  expectDiff(E, 'A', before, [[row, 'Status', 'Watched'], [row, 'Date', D(T)], [row, 'Rating', 8], [row, 'Platform', 'Plex'], [row, 'Plan', ''], [row, 'Order', '']]);
  check(S + 'A every write landed on the row holding this film\'s id', UPD(fake, E.n0).every(c => c.targets[0].id === id && c.targets[0].title === 'Quiet Harbour'));
  expectSequence(E, 'A', row, 6);
  check(S + 'A film left the Up next list', !(await upTitles(page)).includes('Quiet Harbour'), await upTitles(page));
  eq(S + 'A film is first in Recent diary', (await recTitles(page))[0], 'Quiet Harbour');
  check(S + 'A status text says Logged', /^Logged .Quiet Harbour. on /.test(await statusText(page)), await statusText(page));
  check(S + 'A no error notice', (await noticeState(page)).hidden);
  check(S + 'A form was reset', (await page.inputValue('#lfTitle')) === '' && (await page.inputValue('#lfRating')) === '');
});

await scenario('A2 log via the Up next [data-log] button, rating blank', BOTH, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Last Orchard', 2020);
  const before = fake.snapshot();
  const idx = await page.evaluate(() => [...document.querySelectorAll('#upList li')].findIndex(li => li.querySelector('.t').textContent.trim() === 'Last Orchard'));
  await page.locator('#upList li').nth(idx).locator('[data-log]').click();
  check(S + 'A2 title prefilled by the button', (await page.inputValue('#lfTitle')) === 'Last Orchard');
  check(S + 'A2 platform prefilled from the film (Netflix)', (await page.inputValue('#lfPlatform')) === 'Netflix');
  await page.click('#lfSave'); await settle(page);
  // Rating untouched (blank), Platform unchanged (prefill equals the stored value), so only these cells:
  expectUpdates(E, 'A2', row, { Status: 'Watched', Date: TODAY(), Plan: '', Order: '' });
  expectDiff(E, 'A2', before, [[row, 'Status', 'Watched'], [row, 'Date', D(TODAY())], [row, 'Plan', ''], [row, 'Order', '']]);
  check(S + 'A2 Rating cell untouched and still empty', !UPD(fake, E.n0).some(c => /!B\d+$/.test(c.range)) && fake.cell(row, 'Rating') === '');
  check(S + 'A2 no append', APP_(fake, E.n0).length === 0);
  check(S + 'A2 left Up next, first in Recent diary', !(await upTitles(page)).includes('Last Orchard') && (await recTitles(page))[0] === 'Last Orchard');
});

/* =============================== B. Backdating =============================== */
await scenario('B1 Yesterday button', BOTH, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Distant Kingdom', 2001), Y = addDaysIso(-1);
  const pressed = () => page.$$eval('.logday button[data-day]', bs => Object.fromEntries(bs.map(b => [b.dataset.day, b.getAttribute('aria-pressed')])));
  eq(S + 'B1 initially Today pressed', await pressed(), { 0: 'true', '-1': 'false' });
  check(S + 'B1 banner hidden on Today', await page.$eval('#logDayBanner', e => e.hidden));
  await page.click('.logday button[data-day="-1"]');
  eq(S + 'B1 Yesterday pressed, Today not', await pressed(), { 0: 'false', '-1': 'true' });
  const banner = await page.$eval('#logDayBanner', e => ({ h: e.hidden, t: e.textContent }));
  check(S + 'B1 banner visible and says not today', !banner.h && /not today/.test(banner.t), banner);
  await pick(page, 'Distant Kingdom', 2001);
  check(S + 'B1 plan text mentions the date, not "today"', !/today/.test((await page.textContent('#lfPlan')).replace(/Logging.*not today/, '')), await page.textContent('#lfPlan'));
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  expectDiff(E, 'B1', before, [[row, 'Status', 'Watched'], [row, 'Date', D(Y)], [row, 'Plan', ''], [row, 'Order', '']]);
  expectUpdates(E, 'B1', row, { Status: 'Watched', Date: Y, Plan: '', Order: '' });
  await page.click('.logday button[data-day="0"]');
  eq(S + 'B1 Today button restores pressed state', await pressed(), { 0: 'true', '-1': 'false' });
  check(S + 'B1 banner hidden again', await page.$eval('#logDayBanner', e => e.hidden));
});
await scenario('B2 older date from the picker', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Winter Archive', 2017);
  await page.fill('#logDate', '2026-08-15');
  const st = await page.$$eval('.logday button[data-day]', bs => bs.map(b => b.getAttribute('aria-pressed')));
  eq(S + 'B2 neither Today nor Yesterday pressed', st, ['false', 'false']);
  check(S + 'B2 banner mentions 15 August', /15 August/.test(await page.textContent('#logDayBanner')), await page.textContent('#logDayBanner'));
  await pick(page, 'Winter Archive', 2017);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  expectDiff(E, 'B2', before, [[row, 'Status', 'Watched'], [row, 'Date', D('2026-08-15')], [row, 'Plan', ''], [row, 'Order', '']]);
  check(S + 'B2 status text names the date', /15 Aug 2026/.test(await statusText(page)), await statusText(page));
});
await scenario('B3 future date rejected', LAPTOP, async E => {
  const { page, fake, S } = E;
  await page.fill('#logDate', addDaysIso(1));
  await pick(page, 'Copper Carnival', 2024);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'B3 notice says the date is in the future', !n.hidden && /future/.test(n.text), n);
  noCalls(E, 'B3');
  sheetUnchanged(E, 'B3', before);
});

/* =============================== C. Rewatch =============================== */
await scenario('C rewatch of a Watched-only film', BOTH, async E => {
  const { page, fake, S } = E;
  const old = rowOf(fake, 'Midnight Orchard', 1985), newId = fake.maxId() + 1, newRow = fake.lastDataRow() + 1;
  await pick(page, 'Midnight Orchard', 1985);
  check(S + 'C plan text says rewatch', /rewatch/i.test(await page.textContent('#lfPlan')) && /new row/.test(await page.textContent('#lfPlan')), await page.textContent('#lfPlan'));
  await page.fill('#lfRating', '9');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const T = TODAY();
  eq(S + 'C exactly one append_values, zero update_values', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  const call = APP_(fake, E.n0)[0];
  eq(S + 'C appended raw row (A..N, text prefixed with \', selects plain, numbers numeric)', call.values[0],
    ["'Midnight Orchard", 9, 'Watched', T, "'Carmen Ruiz, Ivo Petrenko", "'Inés Cuarón", "'Gustav Holm", 'Owned', 'Drama', 'Plex', '', 1985, '', newId]);
  const o = fake.rowObj(newRow);
  check(S + 'C stored cell types: id/Year/Rating numbers, Title text, Date a date', typeof o.id === 'number' && o.id === newId && o.Year === 1985 && o.Rating === 9 && o.Title === 'Midnight Orchard' && JSON.stringify(o.Date) === JSON.stringify(D(T)), o);
  expectDiff(E, 'C', before, ['Title', 'Rating', 'Status', 'Date', 'Starring', 'Director', 'Cinematography', 'Purchase', 'Genre', 'Platform', 'Year', 'id'].map(k => [newRow, k, o[k]]));
  check(S + 'C old row untouched', JSON.stringify(fake.grid[old - 1]) === JSON.stringify(before.films[old - 1]));
  eq(S + 'C new row is first in Recent diary', (await recTitles(page))[0], 'Midnight Orchard');
  await page.click('#tab-library'); await page.fill('#libSearch', 'Midnight Orchard'); await page.waitForTimeout(350);
  await page.locator('#libBody tr.row').first().locator('.t').click();
  const others = await page.$$eval('#libBody .detail .others li', l => l.map(x => x.textContent));
  check(S + 'C Library detail lists the other entry', others.length === 1 && /Watched/.test(others[0]) && /row \d+/.test(others[0]), others);
});
await scenario('C2 film with a Rewatch row AND a Watched row updates the Rewatch row in place', LAPTOP, async E => {
  const { page, fake, S } = E;
  const rw = fake.grid.findIndex((r, i) => i >= 2 && r[0] === 'Velvet Archive' && r[colOf('Status')] === 'Rewatch') + 1;
  const watched = fake.grid.findIndex((r, i) => i >= 2 && r[0] === 'Velvet Archive' && r[colOf('Status')] === 'Watched') + 1;
  await pick(page, 'Velvet Archive', 2004);
  check(S + 'C2 plan text is the mark-as-watched one (not rewatch)', /Marks .Velvet Archive./.test(await page.textContent('#lfPlan')), await page.textContent('#lfPlan'));
  await page.fill('#lfRating', '10');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  check(S + 'C2 no append', APP_(fake, E.n0).length === 0);
  expectDiff(E, 'C2', before, [[rw, 'Status', 'Watched'], [rw, 'Date', D(TODAY())], [rw, 'Rating', 10], [rw, 'Plan', '']]);
  check(S + 'C2 the earlier Watched row was not touched', JSON.stringify(fake.grid[watched - 1]) === JSON.stringify(before.films[watched - 1]));
});

/* =============================== D. New films =============================== */
await scenario('D new films typed with a year', BOTH, async E => {
  const { page, fake, S } = E;
  check(S + 'D fixture sanity: existing 1917 and 2012 titles are stored as text', typeof fake.cell(rowOf(fake, '1917'), 'Title') === 'string' && typeof fake.cell(rowOf(fake, '2012'), 'Title') === 'string');
  const cases = [
    { t: '1984', y: 1949 }, { t: '300', y: 2006, r: 7, p: 'Netflix' }, { t: 'Se7en', y: 1995 },
    { t: "'Tis the Season", y: 2001 }, { t: 'Don\'t "Quote" Me', y: 2012 }, { t: 'Zoë & the Café <b>', y: 2020 }
  ];
  for (const c of cases) {
    const id = fake.maxId() + 1, n1 = fake.calls.length, before = fake.snapshot(), row = fake.lastDataRow() + 1;
    await page.fill('#lfTitle', c.t);
    check(S + `D "${c.t}" Year box is shown and no film selected`, await page.isVisible('#lfYearWrap'));
    check(S + `D "${c.t}" plan says new film`, /^New film/.test(await page.textContent('#lfPlan')), await page.textContent('#lfPlan'));
    await page.fill('#lfYear', String(c.y));
    if (c.r) await page.fill('#lfRating', String(c.r));
    if (c.p) await page.selectOption('#lfPlatform', c.p);
    await page.click('#lfSave'); await settle(page);
    const ups = fake.calls.slice(n1).filter(x => x.tool === 'update_values'), aps = fake.calls.slice(n1).filter(x => x.tool === 'append_values');
    eq(S + `D "${c.t}" one append, no update`, [aps.length, ups.length], [1, 0]);
    const o = fake.rowObj(row);
    eq(S + `D "${c.t}" raw title sent with leading apostrophe`, aps[0].values[0][0], "'" + c.t);
    check(S + `D "${c.t}" stored Title is TEXT and round-trips exactly`, typeof o.Title === 'string' && o.Title === c.t, o.Title);
    check(S + `D "${c.t}" id = old max + 1 (${id}), Year numeric, Status Watched, Date ISO`, o.id === id && o.Year === c.y && o.Status === 'Watched' && JSON.stringify(o.Date) === JSON.stringify(D(TODAY())), o);
    const want = [['Title', c.t], ['Status', 'Watched'], ['Date', D(TODAY())], ['Year', c.y], ['id', id]];
    if (c.r) want.push(['Rating', c.r]); if (c.p) want.push(['Platform', c.p]);
    const diffs = diffCells(before, fake.snapshot());
    eq(S + `D "${c.t}" exactly the expected cells in the new row only`, diffs.map(d => `${d.ref}=${d.to}`).sort(), want.map(([k, v]) => `${colLetter(colOf(k))}${row}=${JSON.stringify(v)}`).sort());
    check(S + `D "${c.t}" status says Logged`, /^Logged/.test(await statusText(page)), await statusText(page));
  }
});
await scenario('D2 rewatch of a text-numeric title keeps it text', LAPTOP, async E => {
  const { page, fake, S } = E;
  const newRow = fake.lastDataRow() + 1;
  await pick(page, '1917', 2019);
  await page.click('#lfSave'); await settle(page);
  const c = APP_(fake, E.n0)[0];
  check(S + 'D2 raw title "\'1917", stored cell is a string', c && c.values[0][0] === "'1917" && fake.cell(newRow, 'Title') === '1917', c && c.values[0]);
});

/* =============================== E. Same title, different year =============================== */
// Type a title (suggestions open), press Log, and report whether the suggestion dropdown is still covering the ask box
async function askFor(E, title) {
  const { page, S } = E;
  await page.fill('#lfTitle', title);
  await page.click('#lfSave');
  const covered = await page.evaluate(() => { const u = document.getElementById('lfSugg'); const p = document.getElementById('lfPlan'); if (u.hidden) return false; const a = u.getBoundingClientRect(), b = p.getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom; });
  check(S + 'ask box is not covered by the still-open suggestion list', !covered, 'suggestion dropdown overlaps #lfPlan after pressing Log');
  await page.evaluate(() => { document.getElementById('lfSugg').hidden = true; });   // workaround so the rest of the scenario can click the ask buttons
}
const askInfo = page => page.evaluate(() => { const b = document.getElementById('lfPlan'); return { kind: b.dataset.kind, hidden: b.hidden, use: [...b.querySelectorAll('[data-use]')].map(x => x.textContent), nf: [...b.querySelectorAll('[data-newfilm]')].map(x => x.textContent) }; });
await scenario('E1 ask -> "different film" appends a new row', LAPTOP, async E => {
  const { page, fake, S } = E;
  const newRow = fake.lastDataRow() + 1, id = fake.maxId() + 1;
  await askFor(E, 'The Glass Citadel');
  const a = await askInfo(page);
  check(S + 'E1 ask box shown with both entries and the different-film button', a.kind === 'ask' && a.use.length === 2 && a.use.includes('Yes, the 1994 entry') && a.use.includes('Yes, the 1958 entry') && a.nf.length === 1, a);
  noCalls(E, 'E1 before answering');
  const before = fake.snapshot();
  await page.click("#lfPlan [data-newfilm]"); await settle(page);
  eq(S + 'E1 one append, no update', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  expectDiff(E, 'E1', before, [[newRow, 'Title', 'The Glass Citadel'], [newRow, 'Status', 'Watched'], [newRow, 'Date', D(TODAY())], [newRow, 'id', id]]);
});
await scenario('E2 ask -> "Yes, the 2008 entry" updates the Watchlist row in place', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Winter Signal', 2008);
  await askFor(E, 'Winter Signal');
  const before = fake.snapshot();
  await page.locator('#lfPlan [data-use]', { hasText: '2008' }).click(); await settle(page);
  eq(S + 'E2 no append', APP_(fake, E.n0).length, 0);
  expectDiff(E, 'E2', before, [[row, 'Status', 'Watched'], [row, 'Date', D(TODAY())]]);
  check(S + 'E2 row count unchanged (no spurious row)', fake.grid.length === before.films.length);
});
await scenario('E3 ask -> "Yes, the 1958 entry" (already seen) appends a rewatch of that entry', LAPTOP, async E => {
  const { page, fake, S } = E;
  const newRow = fake.lastDataRow() + 1;
  await askFor(E, 'The Glass Citadel');
  await page.locator('#lfPlan [data-use]', { hasText: '1958' }).click(); await settle(page);
  eq(S + 'E3 one append, no update', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  const o = fake.rowObj(newRow);
  check(S + 'E3 appended row is the 1958 film (Year 1958, director Bruno Kallas)', o.Year === 1958 && o.Director === 'Bruno Kallas' && o.Title === 'The Glass Citadel', o);
});
await scenario('E4 typed year matching an entry exactly skips the ask', LAPTOP, async E => {
  const { page, fake, S } = E;
  const newRow = fake.lastDataRow() + 1;
  await page.fill('#lfTitle', 'The Glass Citadel');
  await page.fill('#lfYear', '1994');
  await page.click('#lfSave'); await settle(page);
  const a = await askInfo(page);
  check(S + 'E4 no ask box', a.kind !== 'ask', a);
  eq(S + 'E4 one append with Year 1994 (rewatch of the 1994 entry)', [APP_(fake, E.n0).length, UPD(fake, E.n0).length, fake.cell(newRow, 'Year')], [1, 0, 1994]);
  check(S + 'E4 director copied from the 1994 entry', fake.cell(newRow, 'Director') === 'Hana Seo', fake.cell(newRow, 'Director'));
});
await scenario('E5 typed year that matches nothing still asks', LAPTOP, async E => {
  const { page, fake, S } = E;
  await page.fill('#lfTitle', 'Winter Signal');
  await page.fill('#lfYear', '2012');
  await page.click('#lfSave');
  const a = await askInfo(page);
  check(S + 'E5 ask box shown (title exists, year differs)', a.kind === 'ask', a);
  noCalls(E, 'E5');
});

/* =============================== F. Stale protection =============================== */
await scenario('F1 Rating changed in the sheet after load', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Quiet Harbour', 2012), 'Rating', 5)) }, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Harbour', 2012);
  check(S + 'F1 hook ran (sheet Rating now 5)', fake.cell(row, 'Rating') === 5);
  await pick(page, 'Quiet Harbour', 2012);
  await page.fill('#lfRating', '8');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'F1 notice says it was changed and to Refresh', !n.hidden && /changed/.test(n.text) && /Refresh/.test(n.text), n);
  eq(S + 'F1 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  eq(S + 'F1 zero appends', APP_(fake, E.n0).length, 0);
  sheetUnchanged(E, 'F1', before);
  check(S + 'F1 status does not claim success', !/^Logged/.test(await statusText(page)), await statusText(page));
});
await scenario('F2 Status changed in the sheet after load (already logged elsewhere)', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Last Orchard', 2020), 'Status', 'Watched')) }, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Last Orchard', 2020);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'F2 notice mentions Status changed + Refresh', !n.hidden && /Status/.test(n.text) && /changed/.test(n.text) && /Refresh/.test(n.text), n);
  eq(S + 'F2 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  sheetUnchanged(E, 'F2', before);
});
await scenario('F3 the row\'s TITLE changed under the same id', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Distant Kingdom', 2001), 'Title', 'Something Else')) }, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Distant Kingdom', 2001);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'F3 refused with a notice', !n.hidden && /Refresh/.test(n.text), n);
  eq(S + 'F3 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  sheetUnchanged(E, 'F3', before);
});
await scenario('F4 edit dialog stale: another cell edited the same field', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Harbour of Glass', 2019), 'Rating', 3)) }, async E => {
  const { page, fake, S } = E;
  await libOpen(page, 'Harbour of Glass', 2019);
  await page.fill('#fd-rating', '9');
  const before = fake.snapshot();
  await fdSave(page);
  check(S + 'F4 dialog stays open with a Refresh message', (await dlgOpen(page)) && /Refresh/.test(await fdMsg(page)) && /changed/.test(await fdMsg(page)), await fdMsg(page));
  eq(S + 'F4 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  sheetUnchanged(E, 'F4', before);
});

/* =============================== G. Row moved =============================== */
await scenario('G1 blank row inserted above the target after load', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.insertRowAbove(s.rowOfTitle('Quiet Harbour', 2012))) }, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Harbour', 2012);   // already shifted
  const id = fake.cell(row, 'id');
  await pick(page, 'Quiet Harbour', 2012);
  await page.fill('#lfRating', '8');
  await page.selectOption('#lfPlatform', 'Plex');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  expectUpdates(E, 'G1', row, { Status: 'Watched', Date: TODAY(), Rating: 8, Platform: 'Plex', Plan: '', Order: '' });
  expectDiff(E, 'G1', before, [[row, 'Status', 'Watched'], [row, 'Date', D(TODAY())], [row, 'Rating', 8], [row, 'Platform', 'Plex'], [row, 'Plan', ''], [row, 'Order', '']]);
  check(S + 'G1 every write hit the row with this id (shifted row ' + row + ')', UPD(fake, E.n0).every(c => c.targets[0].id === id));
  check(S + 'G1 status says Logged', /^Logged/.test(await statusText(page)), await statusText(page));
});
await scenario('G2 target row deleted from the sheet after load', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.grid.splice(s.rowOfTitle('Quiet Harbour', 2012) - 1, 1)) }, async E => {
  const { page, fake, S } = E;
  E.allowShrink = true;
  await pick(page, 'Quiet Harbour', 2012);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'G2 notice says the id is not in the sheet any more', !n.hidden && /isn't in the sheet/.test(n.text), n);
  eq(S + 'G2 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  sheetUnchanged(E, 'G2', before);
});
await scenario('G3 two rows now share the id (someone pasted a copy)', LAPTOP, { setup: f => f.mutateAfterLoad(s => { const r = s.rowOfTitle('Quiet Harbour', 2012); const at = s.lastDataRow() + 1; s.setCell(at, 'Title', 'Pasted copy'); s.setCell(at, 'id', s.cell(r, 'id')); }) }, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Quiet Harbour', 2012);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'G3 notice says the id appears 2 times', !n.hidden && /appears 2 times/.test(n.text), n);
  eq(S + 'G3 ZERO update_values calls', UPD(fake, E.n0).length, 0);
  sheetUnchanged(E, 'G3', before);
});

/* =============================== H. Read-back verification =============================== */
await scenario('H1 a dropped Rating write is caught by the read-back', LAPTOP, { setup: f => f.dropWrites(i => i.colName === 'Rating') }, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Harbour', 2012);
  await pick(page, 'Quiet Harbour', 2012);
  await page.fill('#lfRating', '8');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'H1 notice says it didn\'t save as expected + Refresh', !n.hidden && /didn't save as expected/.test(n.text) && /Rating/.test(n.text) && /Check this row/.test(n.text), n);
  check(S + 'H1 status does NOT claim success', !/^Logged/.test(await statusText(page)), await statusText(page));
  check(S + 'H1 writes were attempted for all 5 cells (rating one silently dropped)', UPD(fake, E.n0).length === 5 && fake.calls.slice(E.n0).filter(c => c.dropped).length === 1, UPD(fake, E.n0).length);
  // INFO about partial state: the other five cells did land in the sheet
  const diffs = diffCells(before, fake.snapshot());
  check(S + 'H1 the sheet shows only the 4 cells that did save (Rating untouched)', diffs.length === 4 && !diffs.some(d => d.colName === 'Rating'), diffs.map(show));
  check(S + 'H1 UI after a half-saved row: film is no longer listed as Up next (page re-read the sheet) OR user is told to Refresh',
    !(await upTitles(page)).includes('Quiet Harbour') || /Refresh/.test(n.text), { up: await upTitles(page) });
  void row;
});
await scenario('H1b a dropped Status write is caught too', LAPTOP, { setup: f => f.dropWrites(i => i.colName === 'Status') }, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Last Orchard', 2020);
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'H1b notice says Status didn\'t save as expected', !n.hidden && /Status didn't save as expected/.test(n.text), n);
});
await scenario('H2 duplicate id produced between id lookup and append', LAPTOP, { setup: f => f.beforeAppend(s => { const at = s.lastDataRow() + 1; s.setCell(at, 'Title', 'Racing append'); s.setCell(at, 'id', s.maxId() + 1); }) }, async E => {
  const { page, fake, S } = E;
  await page.fill('#lfTitle', 'Brand New One'); await page.fill('#lfYear', '2024');
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'H2 notice says the row landed somewhere unexpected (caught before trusting it)', !n.hidden && /landed at/.test(n.text) && /instead of row/.test(n.text), n);
  check(S + 'H2 status does not claim success', !/^Logged/.test(await statusText(page)), await statusText(page));
  eq(S + 'H2 one append call only (no retry)', APP_(fake, E.n0).length, 1);
});
await scenario('H3 append lands on a later row than the end (refused)', LAPTOP, { setup: f => f.appendLandsAt(f.grid.length + 4) }, async E => {
  const { page, fake, S } = E;
  const landed = fake.grid.length + 4;
  await page.fill('#lfTitle', 'Lands Later'); await page.fill('#lfYear', '2024');
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'H3 an append that lands away from the next row is reported, not claimed as success', !/^Logged/.test(await statusText(page)) && !n.hidden && /landed at/.test(n.text) && /instead of row/.test(n.text), { status: await statusText(page), n });
  eq(S + 'H3 one append call only (no retry)', APP_(fake, E.n0).length, 1);
});
await scenario('H4 appended row reads back with a different title (wrong place)', LAPTOP, { setup: f => f.dropWrites(() => false) }, async E => {
  // simulate the sheet silently altering the title: mutate right after append by hooking beforeAppend on a second append is not possible;
  // instead make the fake land the row, then change the title before the app reads it back
  const { page, fake, S } = E;
  const orig = fake.handle.bind(fake);
  fake.handle = (s, t, i, o) => { const r = orig(s, t, i, o); if (t === 'append_values') { const m = r.payload.updates.updatedRange.match(/A(\d+):/); fake.setCell(+m[1], 'Title', 'Tampered'); } return r; };
  await page.fill('#lfTitle', 'Readback Check'); await page.fill('#lfYear', '2024');
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'H4 notice says the new row doesn\'t read back as expected', !n.hidden && /doesn't read back as expected/.test(n.text), n);
  check(S + 'H4 status does not claim success', !/^Logged/.test(await statusText(page)));
});

/* =============================== I. No-id row =============================== */
await scenario('I1 Edit on a row with no id', LAPTOP, async E => {
  const { page, fake, S } = E;
  await libOpen(page, 'Hand Added Thing', 2020);
  check(S + 'I1 dialog header says "id none yet"', /id none yet/.test(await fdMsg(page)), await fdMsg(page));
  await page.fill('#fd-rating', '6');
  const before = fake.snapshot();
  await fdSave(page);
  check(S + 'I1 helpful message about the missing id', /no id/.test(await fdMsg(page)), await fdMsg(page));
  noWrites(E, 'I1'); sheetUnchanged(E, 'I1', before);
});
await scenario('I2 Log on a row with no id', LAPTOP, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Hand Added Thing', 2020);
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  check(S + 'I2 notice explains the row has no id', !n.hidden && /no id/.test(n.text), n);
  noWrites(E, 'I2'); sheetUnchanged(E, 'I2', before);
});

/* =============================== J. Unsure outcome =============================== */
await scenario('J1 server_unavailable on the first update', LAPTOP, { setup: f => f.failNext('update_values', { code: 'server_unavailable', message: 'x' }) }, async E => {
  const { page, fake, S } = E;
  await pick(page, 'Quiet Harbour', 2012);
  await page.fill('#lfRating', '8');
  const before = fake.snapshot();
  await page.click('#lfSave'); await settle(page); await page.waitForTimeout(500);
  const hist = await noticeHistory(page), now = await noticeState(page);
  check(S + 'J1 a notice said the save may or may not have gone through', hist.some(t => /may or may not/.test(t)), hist);
  check(S + 'J1 that notice is STILL visible after the page re-read the sheet', !now.hidden && /may or may not/.test(now.text), now);
  const after = fake.calls.slice(E.n0);
  eq(S + 'J1 exactly one update_values attempt (no retry)', after.filter(c => c.tool === 'update_values').length, 1);
  const lastUpd = after.map(c => c.tool).lastIndexOf('update_values');
  check(S + 'J1 a fresh get_values of A1:R6000 follows the failure', after.slice(lastUpd + 1).some(c => c.tool === 'get_values' && c.range === "'🎥'!A1:R6000"), after.map(c => c.range));
  sheetUnchanged(E, 'J1', before);
});
await scenario('J2 server_unavailable AFTER the update landed', LAPTOP, { setup: f => f.failNext('update_values', { code: 'server_unavailable', message: 'x' }, { apply: true }) }, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Harbour', 2012);
  await pick(page, 'Quiet Harbour', 2012);
  await page.click('#lfSave'); await settle(page); await page.waitForTimeout(500);
  eq(S + 'J2 only the first cell written, no retry, no further cells', UPD(fake, E.n0).length, 1);
  check(S + 'J2 sheet has Status=Watched only (partial) and the page now shows what the sheet holds', fake.cell(row, 'Status') === 'Watched' && fake.cell(row, 'Plan') === 'Up next');
  const hist = await noticeHistory(page);
  check(S + 'J2 user was told it may or may not have saved', hist.some(t => /may or may not/.test(t)), hist);
});
await scenario('J3 server_unavailable on append (landed): not saved twice', LAPTOP, { setup: f => f.failNext('append_values', { code: 'server_unavailable', message: 'x' }, { apply: true }) }, async E => {
  const { page, fake, S } = E;
  const rows0 = fake.lastDataRow();
  await page.fill('#lfTitle', 'Maybe Twice'); await page.fill('#lfYear', '2024');
  await page.click('#lfSave'); await settle(page); await page.waitForTimeout(500);
  eq(S + 'J3 exactly one append attempt', APP_(fake, E.n0).length, 1);
  eq(S + 'J3 sheet has the film exactly once', fake.grid.filter(r => r[0] === 'Maybe Twice').length, 1);
  check(S + 'J3 the page re-read the sheet and now lists the row', (await recTitles(page))[0] === 'Maybe Twice', await recTitles(page));
  void rows0;
});
await scenario('J4 non-"unsure" error in the middle of several cells (partial write, tool_error)', LAPTOP, {}, async E => {
  const { page, fake, S } = E;
  // 3rd update fails with a definite error; the first two cells have already been written
  let seen = 0; const orig = fake.handle.bind(fake);
  fake.handle = (s, t, i, o) => { if (t === 'update_values' && ++seen === 3) { fake.calls.push({ n: fake.calls.length, server: s, tool: t, spreadsheetId: i.spreadsheetId, range: i.range, values: i.values, raw: i, error: 'injected' }); throw { code: 'tool_error', message: 'quota exceeded' }; } return orig(s, t, i, o); };
  const row = rowOf(fake, 'Quiet Harbour', 2012);
  await pick(page, 'Quiet Harbour', 2012);
  await page.fill('#lfRating', '8');
  await page.click('#lfSave'); await settle(page);
  const n = await noticeState(page);
  const written = ['Status', 'Date'].every(k => fake.cell(row, k) !== (k === 'Status' ? 'Next Up' : ''));
  check(S + 'J4 two cells already landed before the failure (Status, Date)', written);
  check(S + 'J4 notice is still visible after the re-read and says "Only partly saved: 2 of 5"', !n.hidden && /Only partly saved: 2 of 5/.test(n.text), n);
  eq(S + 'J4 no 4th write attempted, no retry', UPD(fake, E.n0).length, 3);
  check(S + 'J4 page re-read the sheet (fresh A1:R6000)', fake.calls.slice(E.n0).some((c, i, a) => c.tool === 'get_values' && c.range === "'🎥'!A1:R6000"));
});

/* =============================== K. Edit dialog =============================== */
await scenario('K1 change only Rating', BOTH, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Harbour of Glass', 2019);
  await libOpen(page, 'Harbour of Glass', 2019);
  check(S + 'K1 header shows row and id', new RegExp(`Row ${row} · id ${fake.cell(row, 'id')}`).test(await fdMsg(page)), await fdMsg(page));
  await page.fill('#fd-rating', '9');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K1', row, { Rating: 9 });
  expectDiff(E, 'K1', before, [[row, 'Rating', 9]]);
  expectSequence(E, 'K1', row, 1);
  check(S + 'K1 dialog closed, status says Saved 1 change', !(await dlgOpen(page)) && /^Saved 1 change to .Harbour of Glass./.test(await statusText(page)), await statusText(page));
});
await scenario('K2 change nothing', LAPTOP, async E => {
  const { page, fake, S } = E;
  await libOpen(page, 'Silver Voyage', 1987);   // accents, commas, many fields
  const before = fake.snapshot();
  await fdSave(page);
  check(S + 'K2 says No changes to save', /No changes to save/.test(await statusText(page)), await statusText(page));
  noCalls(E, 'K2'); sheetUnchanged(E, 'K2', before);
});
await scenario('K3 rename Title', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Harbour of Glass', 2019);
  await libOpen(page, 'Harbour of Glass', 2019);
  await page.fill('#fd-title', 'Harbour of Glass (Extended)');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K3', row, { Title: "'Harbour of Glass (Extended)" });
  expectDiff(E, 'K3', before, [[row, 'Title', 'Harbour of Glass (Extended)']]);
});
await scenario('K3b rename Title to something numeric stays text', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Golden Voyage', 1969);
  await libOpen(page, 'Golden Voyage', 1969);
  await page.fill('#fd-title', '1408');
  await fdSave(page);
  check(S + 'K3b raw "\'1408" sent, stored as text', UPD(fake, E.n0).length === 1 && UPD(fake, E.n0)[0].values[0][0] === "'1408" && fake.cell(row, 'Title') === '1408', UPD(fake, E.n0).map(c => c.values));
});
await scenario('K4 Plan -> Up next on a Watchlist film', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Salt Carnival', 2013), order = fake.maxOrder() + 1;
  await libOpen(page, 'Salt Carnival', 2013);
  await page.selectOption('#fd-plan', 'Up next');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K4', row, { Plan: 'Up next', Sorted: TODAY(), Order: order, Status: 'Next Up' });
  expectDiff(E, 'K4', before, [[row, 'Plan', 'Up next'], [row, 'Sorted', D(TODAY())], [row, 'Order', order], [row, 'Status', 'Next Up']]);
  check(S + 'K4 appears in Up next on the Log tab', (await (async () => { await page.click('#tab-log'); return upTitles(page); })()).includes('Salt Carnival'));
});
await scenario('K5 clear Plan on an Up next film', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Last Orchard', 2020);
  await libOpen(page, 'Last Orchard', 2020);
  await page.selectOption('#fd-plan', '');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K5', row, { Plan: '', Order: '', Sorted: TODAY(), Status: 'Watchlist' });
  expectDiff(E, 'K5', before, [[row, 'Plan', ''], [row, 'Order', ''], [row, 'Sorted', D(TODAY())], [row, 'Status', 'Watchlist']]);
});
await scenario('K6 edit a past diary date from Recent diary', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Hollow Citadel', 2022);
  const idx = await page.evaluate(() => [...document.querySelectorAll('#recList li')].findIndex(li => li.querySelector('.t').textContent.trim() === 'Hollow Citadel'));
  await page.locator('#recList li').nth(idx).locator('[data-edit]').click();
  await page.waitForSelector('#filmDlg[open]');
  check(S + 'K6 date field holds the ISO date', (await page.inputValue('#fd-date')) === '2026-10-21', await page.inputValue('#fd-date'));
  await page.fill('#fd-date', '2026-10-19');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K6', row, { Date: '2026-10-19' });
  expectDiff(E, 'K6', before, [[row, 'Date', D('2026-10-19')]]);
});
await scenario('K7 TBA year is not rewritten', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Quiet Station', 'TBA');
  await libOpen(page, 'Quiet Station');
  check(S + 'K7 Year field is blank for TBA', (await page.inputValue('#fd-year')) === '');
  await page.fill('#fd-rating', '6');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K7', row, { Rating: 6 });
  check(S + 'K7 Year cell still "TBA"', fake.cell(row, 'Year') === 'TBA', fake.cell(row, 'Year'));
  expectDiff(E, 'K7', before, [[row, 'Rating', 6]]);
});
await scenario('K7b all other fields round-trip untouched when only Notes changes', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Silver Voyage', 1987);
  await libOpen(page, 'Silver Voyage', 1987);
  await page.fill('#fd-notes', '= SUM(1,2) "quoted" 007');
  const before = fake.snapshot();
  await fdSave(page);
  expectUpdates(E, 'K7b', row, { Notes: "'= SUM(1,2) \"quoted\" 007" });
  check(S + 'K7b note stored as literal text (no formula / number conversion)', fake.cell(row, 'Notes') === '= SUM(1,2) "quoted" 007', fake.cell(row, 'Notes'));
  expectDiff(E, 'K7b', before, [[row, 'Notes', '= SUM(1,2) "quoted" 007']]);
});
await scenario('K8 validation (nothing is written)', LAPTOP, async E => {
  const { page, fake, S } = E;
  await libOpen(page, 'Harbour of Glass', 2019);
  const before = fake.snapshot();
  const cases = [
    ['rating 11', '#fd-rating', '11', /whole number from 1 to 10/], ['rating 0', '#fd-rating', '0', /whole number from 1 to 10/],
    ['rating 2.5', '#fd-rating', '2.5', /whole number from 1 to 10/], ['year 3000', '#fd-year', '3000', /Year should look like/],
    ['future date', '#fd-date', addDaysIso(1), /isn't valid \(or it's in the future\)/], ['empty title', '#fd-title', '', /title is needed/]
  ];
  for (const noValidate of [false, true]) {
    await page.evaluate(v => { document.getElementById('filmForm').noValidate = v; }, noValidate);
    for (const [label, sel, val, re] of cases) {
      const orig = await page.inputValue(sel);
      await page.fill(sel, val);
      await page.evaluate(() => { document.getElementById('fdMsg').textContent = 'Row'; });
      await page.click('#fdSave'); await page.waitForTimeout(150);
      const msg = await fdMsg(page), valid = await page.evaluate(() => document.getElementById('filmForm').checkValidity());
      const handled = noValidate ? re.test(msg) : (re.test(msg) || !valid);
      check(S + `K8 ${noValidate ? '(JS check)' : '(native + JS)'} ${label}: rejected inline`, handled && (await dlgOpen(page)), { msg, nativeValid: valid });
      await page.fill(sel, orig);
    }
  }
  noWrites(E, 'K8'); sheetUnchanged(E, 'K8', before);
});

await scenario('K9 partial failure inside the edit dialog', LAPTOP, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Salt Carnival', 2013);
  let seen = 0; const orig = fake.handle.bind(fake);
  fake.handle = (s, t, i, o) => { if (t === 'update_values' && ++seen === 3) { fake.calls.push({ n: fake.calls.length, server: s, tool: t, spreadsheetId: i.spreadsheetId, range: i.range, values: i.values, raw: i, error: 'injected' }); throw { code: 'tool_error', message: 'quota exceeded' }; } return orig(s, t, i, o); };
  await libOpen(page, 'Salt Carnival', 2013);
  await page.selectOption('#fd-plan', 'Up next');
  await fdSave(page); await page.waitForTimeout(400);
  const msg = await fdMsg(page);
  check(S + 'K9 dialog stays open and the message says some changes WERE saved (not just "Not saved")', (await dlgOpen(page)) && /were saved|partly/i.test(msg) , msg);
  check(S + 'K9 two cells landed, third did not, no retry', UPD(fake, E.n0).length === 3 && fake.cell(row, 'Plan') === 'Up next' && fake.cell(row, 'Status') === 'Watchlist', { plan: fake.cell(row, 'Plan'), status: fake.cell(row, 'Status') });
});

/* =============================== L. Add dialog =============================== */
await scenario('L1 add a film with some fields', BOTH, async E => {
  const { page, fake, S } = E;
  const id = fake.maxId() + 1, newRow = fake.lastDataRow() + 1;
  await openAdd(page);
  check(S + 'L1 header says a new id is given on save', /new id/i.test(await fdMsg(page)), await fdMsg(page));
  await page.fill('#fd-title', 'Brand New Picture'); await page.fill('#fd-year', '2025'); await page.fill('#fd-rating', '7');
  await page.selectOption('#fd-status', 'Watched'); await page.fill('#fd-date', '2026-10-22');
  await page.selectOption('#fd-platform', 'Netflix'); await page.selectOption('#fd-purchase', 'Owned'); await page.selectOption('#fd-genre', 'Drama');
  await page.fill('#fd-director', 'Bruno Kallas');
  const before = fake.snapshot();
  await fdSave(page);
  eq(S + 'L1 exactly one append, zero updates', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  const hdr = HEADERS, row = APP_(fake, E.n0)[0].values[0];
  const byName = Object.fromEntries(hdr.map((h, i) => [h, row[i]]).filter(([, v]) => v !== undefined && v !== ''));
  eq(S + 'L1 raw values: text prefixed, selects plain, numbers numeric, blanks not sent', byName,
    { Title: "'Brand New Picture", Rating: 7, Status: 'Watched', Date: '2026-10-22', Director: "'Bruno Kallas", Purchase: 'Owned', Genre: 'Drama', Platform: 'Netflix', Year: 2025, id });
  expectDiff(E, 'L1', before, [[newRow, 'Title', 'Brand New Picture'], [newRow, 'Rating', 7], [newRow, 'Status', 'Watched'], [newRow, 'Date', D('2026-10-22')], [newRow, 'Director', 'Bruno Kallas'], [newRow, 'Purchase', 'Owned'], [newRow, 'Genre', 'Drama'], [newRow, 'Platform', 'Netflix'], [newRow, 'Year', 2025], [newRow, 'id', id]]);
  check(S + 'L1 dialog closed, status says Added ... with id', !(await dlgOpen(page)) && new RegExp(`^Added .Brand New Picture. with id ${id}`).test(await statusText(page)), await statusText(page));
});
await scenario('L2 duplicate title+year warns first, writes only on the second Add', LAPTOP, async E => {
  const { page, fake, S } = E;
  await openAdd(page);
  await page.fill('#fd-title', 'Harbour of Glass'); await page.fill('#fd-year', '2019');
  await fdSave(page);
  check(S + 'L2 first press shows a warning naming the existing row', /already in the sheet/.test(await fdMsg(page)) && /Press Add again/.test(await fdMsg(page)), await fdMsg(page));
  noCalls(E, 'L2 after first press');
  const newRow = fake.lastDataRow() + 1;
  await fdSave(page);
  eq(S + 'L2 second press: one append', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  check(S + 'L2 new row is a separate row with a new id', fake.cell(newRow, 'Title') === 'Harbour of Glass' && fake.cell(newRow, 'id') === fake.maxId());
});
await scenario('L3 add with Plan = Up next', LAPTOP, async E => {
  const { page, fake, S } = E;
  const id = fake.maxId() + 1, order = fake.maxOrder() + 1, newRow = fake.lastDataRow() + 1, before = fake.snapshot();
  await openAdd(page);
  await page.fill('#fd-title', 'Planned Picture'); await page.fill('#fd-year', '2027'); await page.selectOption('#fd-plan', 'Up next'); await page.fill('#fd-why', 'A friend said so');
  await fdSave(page);
  expectDiff(E, 'L3', before, [[newRow, 'Title', 'Planned Picture'], [newRow, 'Status', 'Next Up'], [newRow, 'Year', 2027], [newRow, 'Plan', 'Up next'], [newRow, 'Why', 'A friend said so'], [newRow, 'Order', order], [newRow, 'Sorted', D(TODAY())], [newRow, 'id', id]]);
});

/* =============================== M. Not connected =============================== */
await scenario('M1 no window.claude (no Google sign-in either)', LAPTOP, { mode: 'none' }, async E => {
  const { page, fake, S } = E;
  await page.fill('#lfTitle', 'Something'); await page.click('#lfSave'); await page.waitForTimeout(200);
  let n = await noticeState(page);
  check(S + 'M1 Log shows a "live connection" notice', !n.hidden && /live connection/.test(n.text), n);
  await page.click('#tab-library'); await page.click('#addFilmBtn'); await page.waitForTimeout(200);
  n = await noticeState(page);
  check(S + 'M1 Add film shows a "live connection" notice', !n.hidden && /live connection/.test(n.text), n);
  check(S + 'M1 no dialog opened', !(await dlgOpen(page)));
  eq(S + 'M1 no sheet calls', fake.calls.length, 0);
});
await scenario('M2 callTool rejects server_not_connected', LAPTOP, { setup: f => f.failAll({ code: 'server_not_connected' }) }, async E => {
  const { page, fake, S } = E;
  await page.fill('#lfTitle', 'Something'); await page.fill('#lfYear', '2024');
  const n0 = fake.calls.length;
  await page.click('#lfSave'); await settle(page);
  let n = await noticeState(page);
  check(S + 'M2 Log shows a connection notice', !n.hidden && /(isn't connected|live connection|Couldn't reach|Connectors)/.test(n.text), n);
  check(S + 'M2 no update/append attempted', fake.calls.every(c => c.tool === 'get_values'), fake.calls.map(c => c.tool));
  const malformed = fake.calls.slice(n0).filter(c => /undefined|NaN/.test(c.range || ''));
  check(S + 'M2 no sheet request with a malformed range (header row unknown before first load)', malformed.length === 0, malformed.map(c => c.range));
  await page.click('#tab-library'); await page.click('#addFilmBtn'); await page.waitForTimeout(200);
  n = await noticeState(page);
  check(S + 'M2 Add film shows a "live connection" notice, no dialog', !n.hidden && /live connection/.test(n.text) && !(await dlgOpen(page)), n);
});

/* =============================== O. Layout =============================== */
async function noSideScroll(E, label) {
  const r = await E.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, W: window.innerWidth, bw: document.body.scrollWidth }));
  check(E.S + `O ${label}: no horizontal page scroll`, r.sw <= r.W && r.bw <= r.W, r);
}
const inView = async (E, label, sel) => {
  const r = await E.page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, W: window.innerWidth, H: window.innerHeight }; }, sel);
  check(E.S + `O ${label} inside the viewport horizontally`, r && r.l >= -0.5 && r.r <= r.W + 0.5, r);
  return r;
};
await scenario('O layout', BOTH, async E => {
  const { page, size, S } = E;
  await page.focus('#lfTitle'); await page.fill('#lfTitle', 'the');
  check(S + 'O suggestions are open', await page.isVisible('#lfSugg'));
  await noSideScroll(E, 'suggestions open'); await inView(E, 'suggestion list', '#lfSugg');
  await page.screenshot({ path: `${SHOTS}/s2-${size}-suggestions.png` });
  await page.fill('#lfTitle', 'The Glass Citadel'); await page.click('#lfSave');
  check(S + 'O ask box visible', (await askInfo(page)).kind === 'ask');
  await noSideScroll(E, 'ask box'); await inView(E, 'ask box', '#lfPlan');
  const btns = await page.$$eval('#lfPlan button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.left, r.right, window.innerWidth]; }));
  check(S + 'O ask buttons inside viewport', btns.every(([l, r, W]) => l >= 0 && r <= W), btns);
  await page.screenshot({ path: `${SHOTS}/s2-${size}-ask.png` });
  await page.fill('#lfTitle', ''); await page.fill('#lfTitle', 'Harbour of Glass');
  await libOpen(page, 'Silver Voyage', 1987);
  await noSideScroll(E, 'edit dialog open'); await inView(E, 'dialog', '#filmDlg');
  const d = await page.evaluate(() => { const r = document.getElementById('filmDlg').getBoundingClientRect(); return { t: r.top, b: r.bottom, H: window.innerHeight }; });
  check(S + 'O dialog fits vertically (scrolls inside if needed)', d.t >= -0.5 && d.b <= d.H + 0.5, d);
  await page.screenshot({ path: `${SHOTS}/s2-${size}-dialog-edit.png` });
  const saveVis = await page.evaluate(() => { const r = document.getElementById('fdSave').getBoundingClientRect(); return r.bottom <= window.innerHeight && r.right <= window.innerWidth; });
  check(S + 'O Save button reachable on screen without scrolling the page', saveVis);
  await page.click('#fdClose');
  await openAdd(page);
  await noSideScroll(E, 'add dialog open'); await inView(E, 'add dialog', '#filmDlg');
  await page.screenshot({ path: `${SHOTS}/s2-${size}-dialog-add.png` });
  await page.click('#fdClose');
  await page.click('#tab-log');
  await page.click('.logday button[data-day="-1"]');
  await noSideScroll(E, 'backdating banner');
  await page.screenshot({ path: `${SHOTS}/s2-${size}-backdate.png` });
});

console.log(`\n${passes} passed, ${failures} failed`);
await browser.close();
process.exit(failures ? 1 : 0);
