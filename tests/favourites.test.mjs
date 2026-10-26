// Favourites (ticket-stub sticker) and the three "picks" boxes on Log, headless against a FAKE in-memory Google Sheet.
// Run: node tests/favourites.test.mjs
// Synthetic data only (planfixture.mjs). Nothing here talks to Google: every request outside the page is answered locally or aborted.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeSheet, diffCells, show, colLetter, colOf, D, SHEET_ID, WIDTH } from './fakesheet.mjs';
import { buildPlanFixture, isoDaysAgo } from './planfixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = (process.env.SHOTS_DIR || SCRATCH + '/shots') + '/favs';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlf-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', SHEET_ID) + '</body></html>');

const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const BOTH = ['laptop', 'phone'], LAPTOP = ['laptop'], PHONE = ['phone'];
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want, extra) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}${extra ? ' | ' + extra : ''}`);
const TODAY = () => isoDaysAgo(0);
const FAVC = colOf('Favourite');
const MISSING = 'Add a Favourite column to the 🎥 tab to pick favourites';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ---------------------------------- harness ---------------------------------- */
async function open(size, { fixture, setup, absent = false, theme, delay = 0, S = '' } = {}) {
  const fake = new FakeSheet(fixture ? fixture() : buildPlanFixture(), { favourite: !absent });
  if (setup) setup(fake);
  const settings0 = JSON.stringify(fake.settings);
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1 });
  const badReq = [];
  await ctx.route(/^https?:\/\//, r => { badReq.push(r.request().url()); r.abort(); });
  await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/accounts\.google\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await ctx.route(/cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.exposeFunction('__call', async (server, tool, input, opts) => {
    if (delay) await new Promise(r => setTimeout(r, delay));   // slow sheet: lets the test look at the screen while a write is in flight
    try { return fake.handle(server, tool, input, opts); }
    catch (e) { return { __error: (e && typeof e === 'object' && e.code) ? { code: e.code, message: e.message } : { code: 'tool_error', message: String((e && e.message) || e) } }; }
  });
  await page.addInitScript(t => {
    if (t && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('mvl-theme', t); }
    window.claude = { use: async n => n === 'mcp' ? { callTool: async (s, tl, i, o) => { const r = await window.__call(s, tl, i, o); if (r && r.__error) throw r.__error; return r; } } : null };
  }, theme || null);
  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => /^Live from your sheet/.test(document.getElementById('statusText').textContent) || document.getElementById('status').dataset.state === 'error', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(100);
  return { page, ctx, fake, errors, badReq, S, size, n0: fake.calls.length, settings0 };
}

async function scenario(name, sizes, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  for (const size of sizes) {
    const S = `[${size}] ${name} `;
    let E;
    try { E = await open(size, { ...opts, S }); E.S = S; await fn(E); globalSafety(E); }
    catch (e) { check(S + 'scenario ran without exception', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    finally { if (E) await E.ctx.close(); }
  }
}

const READ_OK = [/^'🎥'!A1:S6000$/, /^'🎥'!A2:Z2$/, /^'🎥'!N1:N6000$/, /^'🎥'!A\d+:Z\d+$/, /^'🎥 Settings'!A1:C50$/];
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
      else { if (m[1].length !== 1 || m[1] > 'S') bad.push(tag + ' column outside A..S'); if (+m[2] < 3) bad.push(tag + ' touches a header row'); }
      if (!(Array.isArray(c.values) && c.values.length === 1 && c.values[0].length === 1)) bad.push(tag + ' values are not exactly [[x]]');
    } else if (c.tool === 'append_values') {
      if (!/^'🎥'!A2:Z\d+$/.test(c.range)) bad.push(tag + ' append not anchored to the data block');
      if (c.values[0].length > WIDTH) bad.push(tag + ' append wider than A..S');
    }
  }
  if (JSON.stringify(fake.settings) !== E.settings0) bad.push('settings tab changed');
  if (fake.grid.length < fake.initialRows) bad.push('row count shrank');
  check(S + 'N global safety (spreadsheetId, tabs, single-cell updates in A..S, no header/settings writes, no row loss)', bad.length === 0, bad.slice(0, 6));
  check(S + 'N no page errors / console errors', E.errors.length === 0, E.errors.slice(0, 3));
  check(S + 'N no network requests outside the local stubs', E.badReq.length === 0, E.badReq.slice(0, 3));
}

/* ---------------------------------- helpers ---------------------------------- */
const UPD = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'update_values');
const rowOf = (fake, title, year) => { const r = fake.rowOfTitle(title, year); if (!r) throw new Error('fixture row not found: ' + title); return r; };
const settle = async page => { await page.waitForFunction(() => planQ.pending === 0); await page.waitForTimeout(250); };
const stub = (page, title, scope = '') => page.locator(`${scope} button[data-fav][aria-label="Favourite: ${title}"]`.trim());
const pressed = async (page, title, scope) => (await stub(page, title, scope).first().getAttribute('aria-pressed')) === 'true';
const titles = (page, sel) => page.$$eval(sel + ' li .t', els => els.map(e => e.textContent.trim()));
const noticeState = page => page.evaluate(() => { const n = document.getElementById('notice'); return { hidden: n.hidden, text: n.textContent }; });
const R = (page, sel) => page.$$eval(sel, es => es.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const tab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(80); };
const iso = c => (c && typeof c === 'object' && c.date) || '';
const norm = t => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const SEEN = ['Watched', '2026 Watched'];
const dataRows = fake => fake.grid.map((r, i) => ({ r, row: i + 1 })).filter(x => x.row >= 3 && x.r[0] !== '');
const keyOfRow = r => norm(r[colOf('Title')]) + '|' + r[colOf('Year')];
const setFav = (fake, title, year, date) => fake.setCell(rowOf(fake, title, year), 'Favourite', date);
// the cells that hold a Favourite value, as 'row:date'
const favCells = fake => dataRows(fake).filter(x => x.r[FAVC] !== '').map(x => `${x.row}:${iso(x.r[FAVC])}`);
// add a watched row (a rewatch) for a film that is already in the fixture
function addRewatch(fake, title, year, date, rating = 8) {
  const src = fake.grid[rowOf(fake, title, year) - 1];
  const row = src.slice(); row[colOf('Date')] = D(date); row[colOf('Rating')] = rating; row[colOf('Status')] = 'Watched'; row[colOf('Favourite')] = '';
  row[colOf('id')] = fake.maxId() + 1; row[colOf('Plan')] = ''; row[colOf('Order')] = '';
  fake.grid.push(row);
  return fake.grid.length;
}
// what the Last 5 box should show: dated watches, newest first, ties to the later sheet row
const expectLast5 = fake => dataRows(fake).filter(x => SEEN.includes(x.r[colOf('Status')]) && iso(x.r[colOf('Date')]))
  .sort((a, b) => iso(b.r[colOf('Date')]).localeCompare(iso(a.r[colOf('Date')])) || b.row - a.row).slice(0, 5).map(x => String(x.r[0]));
// what the Favourites box should show: films by newest Favourite date, then title; one entry per film
function expectFavs(fake) {
  const by = new Map();
  for (const x of dataRows(fake)) { const k = keyOfRow(x.r); const d = iso(x.r[FAVC]) || (x.r[FAVC] !== '' ? ' ' : ''); const e = by.get(k) || { title: String(x.r[0]), d: '' }; if (d && d > e.d) e.d = d; by.set(k, e); }
  return [...by.values()].filter(e => e.d).sort((a, b) => b.d.localeCompare(a.d) || a.title.localeCompare(b.title));
}

/* ---- independent model of the recommendation (same rules as the Plan deck, over watchlist + Soon films) ---- */
const people = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
function modelRanking(fake) {
  const g = fake.snapshot().films, get = (r, n) => g[r - 1][colOf(n)];
  const rows = g.map((_, i) => i + 1).filter(r => r >= 3 && g[r - 1][0] !== '');
  const seen = r => SEEN.includes(get(r, 'Status'));
  const key = r => norm(get(r, 'Title')) + '|' + get(r, 'Year');
  const isUp = r => !seen(r) && (get(r, 'Plan') === 'Up next' || (get(r, 'Status') === 'Next Up' && !get(r, 'Plan')));
  const backlog = r => !seen(r) && !isUp(r) && get(r, 'Plan') !== 'Soon' && (['Watchlist', 'Rewatch'].includes(get(r, 'Status')) || get(r, 'Plan') === 'Someday');
  const by = new Map();
  for (const r of rows) { const k = key(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const reps = [];
  for (const [, rs] of by) {
    const s = rs.filter(seen); if (!s.length) continue;
    const dated = s.filter(r => get(r, 'Date')).sort((a, b) => (get(a, 'Date').date < get(b, 'Date').date ? 1 : -1));
    const rep = dated[0] || s[0];
    const rt = typeof get(rep, 'Rating') === 'number' ? get(rep, 'Rating') : (s.map(r => get(r, 'Rating')).find(v => typeof v === 'number') ?? null);
    if (rt != null) reps.push({ rep, rt });
  }
  const mean = reps.length ? reps.reduce((a, x) => a + x.rt, 0) / reps.length : 6.5;
  const grp = fn => { const m = new Map(); for (const x of reps) for (const k of fn(x.rep)) { if (!m.has(k)) m.set(k, []); m.get(k).push(x.rt); } return m; };
  const P = { dir: grp(r => people(get(r, 'Director'))), cast: grp(r => people(get(r, 'Starring'))), genre: grp(r => (get(r, 'Genre') ? [get(r, 'Genre')] : [])) };
  const aff = a => (a.reduce((x, y) => x + y, 0) + 3 * mean) / (a.length + 3);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const score = r => {
    const parts = [], why = [];
    const best = (names, map, w, lab) => {
      let top = null;
      for (const n of names) { const a = map.get(n); if (a && a.length) { const v = aff(a); if (!top || v > top.v) top = { v, n, a }; } }
      if (!top) return;
      parts.push([w, top.v]);
      const n = top.a.length, m = f1(top.a.reduce((x, y) => x + y, 0) / n);
      if (top.v >= mean + 0.3 || top.v <= mean - 0.8) why.push(lab === 'genre' ? `${top.n}: you average ${m} over ${n}` : `${top.n}: ${n} film${n === 1 ? '' : 's'}, you average ${m}`);
    };
    best(people(get(r, 'Director')), P.dir, 0.5, 'dir'); best(people(get(r, 'Starring')), P.cast, 0.25, 'cast'); best(get(r, 'Genre') ? [get(r, 'Genre')] : [], P.genre, 0.25, 'genre');
    const ws = parts.reduce((a, [w]) => a + w, 0);
    let s = ws ? parts.reduce((a, [w, x]) => a + w * x, 0) / ws : mean - 0.5;
    if (get(r, 'Purchase') === 'Owned') { s += 0.3; why.push('You own it'); }
    const pl = get(r, 'Platform'); if (pl === 'Plex' || pl === 'Physical') { s += 0.15; why.push(pl === 'Plex' ? 'On Plex' : 'On disc'); }
    const prev = (by.get(key(r)) || []).filter(seen);
    if (prev.length) { const pr = prev.find(x => typeof get(x, 'Rating') === 'number'); why.unshift('Seen before' + (pr ? `, rated ${get(pr, 'Rating')}` : '')); }
    return { r, s, why: why.slice(0, 4) };
  };
  const cands = rows.filter(r => !seen(r) && (backlog(r) || get(r, 'Plan') === 'Soon')).map(score).sort((a, b) => b.s - a.s || a.r - b.r);
  const seenKeys = new Set(), out = [];
  for (const c of cands) { const k = key(c.r); if (seenKeys.has(k)) continue; seenKeys.add(k); out.push({ ...c, title: String(get(c.r, 'Title')), year: get(c.r, 'Year'), whyText: c.why.join(' · ') || 'On your watchlist' }); }
  return out;
}

/* ================================== scenarios ================================== */

// 1. column absent
await scenario('1 no Favourite column', BOTH, { absent: true }, async E => {
  const { page, fake, S } = E;
  const all = await page.$$eval('button[data-fav]', bs => bs.map(b => ({ dis: b.disabled, title: b.title, pressed: b.getAttribute('aria-pressed') })));
  check(S + '1a stickers are on the page', all.length >= 5, all.length);
  check(S + '1b every sticker is disabled with the tooltip', all.every(b => b.dis && b.title === MISSING && b.pressed === 'false'), all.slice(0, 2));
  check(S + '1c Favourites box says to add the column', (await page.textContent('#favList')).includes(MISSING), await page.textContent('#favList'));
  check(S + '1d "See all" is hidden', await page.locator('#favAll').isHidden());
  await stub(page, 'Rim C').first().click({ force: true });
  await page.evaluate(() => toggleFav(state.films.find(f => f.title === 'Rim C')));
  await settle(page);
  check(S + '1e tapping (even by code) attempts no write', UPD(fake, E.n0).length === 0, UPD(fake, E.n0).map(c => c.range));
  check(S + '1f the notice explains', (await noticeState(page)).text.includes(MISSING), await noticeState(page));
  await tab(page, 'library');
  const chip = page.locator('#libChips .chip[data-st="__fav"]');
  check(S + '1g Library Favourites chip is disabled', await chip.isDisabled() && (await chip.getAttribute('title')) === MISSING);
  check(S + '1h Library stickers are disabled', await page.$$eval('#libBody button[data-fav]', bs => bs.length > 0 && bs.every(b => b.disabled)));
  await page.click('#libBody tr.row'); await page.click('#libBody [data-edit]');
  check(S + '1i the edit dialog button is disabled', await page.locator('#filmDlg button[data-fav]').isDisabled());
  check(S + '1j still no writes', UPD(fake, E.n0).length === 0);
  check(S + '1k the app reads A1:S6000 and everything else works (Up next still lists)', fake.calls.some(c => c.range === "'🎥'!A1:S6000") && (await page.$$('#upList li')).length > 0);
});

// 2. toggle on writes exactly one cell on the most recent row
await scenario('2 toggle on', BOTH, { delay: 80 }, async E => {
  const { page, fake, S } = E;
  const before = fake.snapshot();
  const last5 = expectLast5(fake);
  eq(S + '2a Last 5 in the right order', await titles(page, '#last5List'), last5);
  check(S + '2b Favourites box starts empty with the hint', (await page.textContent('#favList')).includes('No favourites yet. Tap the ticket on a film to add it.'));
  check(S + '2c the chip-less state: sticker is off', !(await pressed(page, 'Rim C', '#last5List')));
  await stub(page, 'Rim C', '#last5List').click();
  check(S + '2d screen updates before the write is confirmed or right after', await pressed(page, 'Rim C', '#last5List'));
  await settle(page);
  const row = rowOf(fake, 'Rim C');
  const ups = UPD(fake, E.n0);
  eq(S + '2e exactly one update', ups.map(c => c.range), [`'🎥'!S${row}`]);
  eq(S + '2f it writes today as a date', ups[0].values, [[TODAY()]]);
  eq(S + '2g the sheet holds a real date today', iso(fake.cell(row, 'Favourite')), TODAY());
  const d = diffCells(before, fake.snapshot());
  eq(S + '2h only that cell changed', d.map(x => x.ref), [`S${row}`], d.map(show).join(';'));
  eq(S + '2i the update hit the right id', ups[0].targets[0].id, fake.cell(row, 'id'));
  check(S + '2j the sticker stays on', await pressed(page, 'Rim C', '#last5List'));
  eq(S + '2k Favourites box lists it', await titles(page, '#favList'), ['Rim C (1982)']);
  eq(S + '2l count note', await page.textContent('#favNote'), '1 film');
  check(S + '2m focus stays on the sticker', await page.evaluate(() => document.activeElement && document.activeElement.dataset.fav !== undefined));
  // Library: the same film is favourite there too
  await tab(page, 'library');
  const chip = page.locator('#libChips .chip[data-st="__fav"]');
  eq(S + '2n Library chip shows 1', (await chip.textContent()).replace(/\s+/g, ''), 'Favourites1');
  check(S + '2o the Library row sticker is on', await pressed(page, 'Rim C', '#libBody'));
  // a reload shows the same thing (reads the new column)
  await page.click('#refreshBtn'); await page.waitForTimeout(300);
  check(S + '2p after a re-read the film is still a favourite', await pressed(page, 'Rim C', '#libBody'));
});

// 3. toggle off clears every row of the film and nothing else
await scenario('3 toggle off', LAPTOP, {
  setup: f => { addRewatch(f, 'Solo Seen', 2000, isoDaysAgo(2), 9); setFav(f, 'Solo Seen', 2000, isoDaysAgo(40)); const r2 = f.grid.length; f.setCell(r2, 'Favourite', isoDaysAgo(10)); setFav(f, 'Rim A', 1980, isoDaysAgo(5)); }
}, async E => {
  const { page, fake, S } = E;
  const before = fake.snapshot();
  eq(S + '3a two rows hold a Favourite, one per row', favCells(fake).length, 3);
  eq(S + '3b the film counts once in the box (newest date first)', await titles(page, '#favList'), ['Rim A (1980)', 'Solo Seen (2000)']);
  check(S + '3c both Solo Seen rows in Last 5 show it pressed', (await page.$$eval('#last5List button[aria-label="Favourite: Solo Seen"]', bs => bs.map(b => b.getAttribute('aria-pressed')))).every(v => v === 'true'));
  await stub(page, 'Solo Seen', '#favList').click();
  await settle(page);
  const ups = UPD(fake, E.n0);
  eq(S + '3d two updates, both on the Favourite column, both clearing', ups.map(c => c.range.replace(/\d+$/, '') + ' ' + JSON.stringify(c.values)).sort(), ["'🎥'!S [[\"\"]]", "'🎥'!S [[\"\"]]"]);
  const d = diffCells(before, fake.snapshot());
  const rows = [rowOf(fake, 'Solo Seen', 2000), fake.grid.length].sort((a, b) => a - b);
  eq(S + '3e exactly the two Solo Seen cells changed to blank', d.map(x => `${x.ref}->${x.to}`).sort(), rows.map(r => `S${r}->""`).sort());
  eq(S + '3f the other favourite is untouched', favCells(fake), [`${rowOf(fake, 'Rim A', 1980)}:${isoDaysAgo(5)}`]);
  eq(S + '3g box now lists only the other film', await titles(page, '#favList'), ['Rim A (1980)']);
  eq(S + '3h empty state not shown, note counts 1', await page.textContent('#favNote'), '1 film');
});

// 4. a film with a rewatch counts once, and ON goes to the most recent row
await scenario('4 rewatch', LAPTOP, { setup: f => { addRewatch(f, 'Solo Seen', 2000, isoDaysAgo(2), 9); } }, async E => {
  const { page, fake, S } = E;
  const older = rowOf(fake, 'Solo Seen', 2000), newer = fake.grid.length;
  const n = await page.$$eval('#last5List button[aria-label="Favourite: Solo Seen"]', bs => bs.length);
  check(S + '4a the rewatch gives two watches in the diary (precondition)', n >= 1);
  await stub(page, 'Solo Seen', '#last5List').first().click(); await settle(page);
  eq(S + '4b ON writes the newest watch only', UPD(fake, E.n0).map(c => c.range), [`'🎥'!S${newer}`]);
  eq(S + '4c the older row stays blank', fake.cell(older, 'Favourite'), '');
  await tab(page, 'library');
  eq(S + '4d chip counts the film once', (await page.locator('#libChips .chip[data-st="__fav"]').textContent()).replace(/\s+/g, ''), 'Favourites1');
  await page.click('#libChips .chip[data-st="__fav"]');
  eq(S + '4e the filtered Library shows one row for the film', await page.$$eval('#libBody tr.row .t', e => e.map(x => x.textContent.trim())), ['Solo Seen']);
  // pressed on every row of the film, even where the date is on the other row
  await page.click('#libChips .chip[data-st="All"]');
  await page.fill('#libSearch', 'Solo Seen'); await page.waitForTimeout(300);
  const ps = await page.$$eval('#libBody button[aria-label="Favourite: Solo Seen"]', bs => bs.map(b => b.getAttribute('aria-pressed')));
  check(S + '4f both Library rows of the film show it on', ps.length === 2 && ps.every(v => v === 'true'), ps);
  // OFF from the older row's sticker clears the newer row
  const before = fake.snapshot(); const n1 = fake.calls.length;
  await page.locator('#libBody button[aria-label="Favourite: Solo Seen"]').first().click(); await settle(page);
  eq(S + '4g OFF clears the cell that held the date', UPD(fake, n1).map(c => c.range), [`'🎥'!S${newer}`]);
  eq(S + '4h and nothing else changed', diffCells(before, fake.snapshot()).map(x => x.ref), [`S${newer}`]);
  check(S + '4i tapping a Library sticker does not open the detail row', (await page.$$('#libBody tr.detail')).length === 0);
});

// 5. rapid taps
await scenario('5 rapid taps', BOTH, { delay: 40 }, async E => {
  const { page, fake, S } = E;
  const row = rowOf(fake, 'Rim C');
  const sel = '#last5List button[aria-label="Favourite: Rim C"]';
  await page.click(sel); await page.click(sel);
  await settle(page);
  check(S + '5a two quick taps end off on screen', !(await pressed(page, 'Rim C', '#last5List')));
  eq(S + '5b and off in the sheet', favCells(fake), []);
  const ups = UPD(fake, E.n0);
  check(S + '5c every write was one cell on the same row, in order on then off', ups.length === 2 && ups.every(c => c.range === `'🎥'!S${row}`) && ups[0].values[0][0] === TODAY() && ups[1].values[0][0] === '', ups.map(c => c.range + JSON.stringify(c.values)));
  const n1 = fake.calls.length;
  await page.click(sel); await page.click(sel); await page.click(sel);
  await settle(page);
  check(S + '5d three quick taps end on, screen and sheet agree', (await pressed(page, 'Rim C', '#last5List')) && favCells(fake).length === 1 && favCells(fake)[0] === `${row}:${TODAY()}`, favCells(fake));
  eq(S + '5e the Favourites box agrees', await titles(page, '#favList'), ['Rim C (1982)']);
  // two different films tapped quickly
  await page.click('#last5List button[aria-label="Favourite: Rim B"]'); await page.click('#last5List button[aria-label="Favourite: Rim A"]');
  await settle(page);
  eq(S + '5f two films, two cells, nothing interleaved', favCells(fake).map(x => x.split(':')[0]).sort(), [rowOf(fake, 'Rim A'), rowOf(fake, 'Rim B'), row].map(String).sort());
  check(S + '5g no stale or unexpected-change message', !(await noticeState(page)).text || (await noticeState(page)).hidden, await noticeState(page));
  void n1;
});

// 6. failed write
await scenario('6 failed write', BOTH, { delay: 80 }, async E => {
  const { page, fake, S } = E;
  fake.failNext('update_values', { code: 'tool_error', message: 'Quota exceeded' });
  await stub(page, 'Rim C', '#last5List').click();
  check(S + '6a the screen shows the wanted state first', await pressed(page, 'Rim C', '#last5List'));
  await settle(page);
  check(S + '6b then reverts', !(await pressed(page, 'Rim C', '#last5List')));
  const ns = await noticeState(page);
  check(S + '6c a message says it was not saved', !ns.hidden && /Not saved/.test(ns.text) && /Quota exceeded/.test(ns.text), ns);
  eq(S + '6d nothing was written', favCells(fake), []);
  eq(S + '6e box still empty', await titles(page, '#favList'), []);
  // failed OFF keeps it on
  setFav(fake, 'Rim B', 1981, isoDaysAgo(3)); await page.click('#refreshBtn'); await page.waitForTimeout(300);
  fake.failNext('update_values', { code: 'tool_error', message: 'Boom' });
  await stub(page, 'Rim B', '#last5List').click(); await settle(page);
  check(S + '6f a failed OFF goes back to on', await pressed(page, 'Rim B', '#last5List'));
  eq(S + '6g the date is still there', favCells(fake), [`${rowOf(fake, 'Rim B')}:${isoDaysAgo(3)}`]);
  // changed in the sheet since load: stale check refuses
  fake.setCell(rowOf(fake, 'Rim A'), 'Title', 'Rim A renamed');
  await stub(page, 'Rim A', '#last5List').click(); await settle(page);
  check(S + '6h a row changed in the sheet is refused, not overwritten', !(await pressed(page, 'Rim A', '#last5List')) && fake.cell(rowOf(fake, 'Rim A renamed'), 'Favourite') === '', await noticeState(page));
});

// 7. Favourites box: order and limit
await scenario('7 Favourites box', BOTH, {
  setup: f => {
    const d = [['Ash Meridian', 2001, 9], ['Bright Harbour', 2005, 2], ['Cold Orchard', 2009, 2], ['Dune Lantern', 2013, 20], ['Ember Voyage', 2015, 15], ['Flint Carnival', 2002, 30], ['Gale Station', 2006, 4]];
    d.forEach(([t, y, ago]) => setFav(f, t, y, isoDaysAgo(ago)));
  }
}, async E => {
  const { page, fake, S } = E;
  const exp = expectFavs(fake);
  eq(S + '7a precondition: seven favourite films', exp.length, 7);
  eq(S + '7b five shown, newest favourite first, ties by title', await titles(page, '#favList'), exp.slice(0, 5).map(e => e.title + ' (' + fake.cell(rowOf(fake, e.title), 'Year') + ')'));
  eq(S + '7b2 the order is as expected', exp.slice(0, 5).map(e => e.title), ['Bright Harbour', 'Cold Orchard', 'Gale Station', 'Ash Meridian', 'Ember Voyage']);
  eq(S + '7c the note counts all seven', await page.textContent('#favNote'), '7 films');
  const ratings = await page.$$eval('#favList li .rtg', e => e.map(x => x.textContent.trim()));
  eq(S + '7d ratings shown', ratings, ['9/10', '9/10', '4/10', '10/10', '10/10']);
  check(S + '7e every row has a pressed sticker', await page.$$eval('#favList button[data-fav]', bs => bs.length === 5 && bs.every(b => b.getAttribute('aria-pressed') === 'true')));
  // un-favourite the first: the sixth comes in
  await stub(page, 'Bright Harbour', '#favList').click(); await settle(page);
  eq(S + '7f un-favouriting from the box pulls in the next film', await titles(page, '#favList'), ['Cold Orchard (2009)', 'Gale Station (2006)', 'Ash Meridian (2001)', 'Ember Voyage (2015)', 'Dune Lantern (2013)']);
  eq(S + '7g its date is cleared in the sheet', fake.cell(rowOf(fake, 'Bright Harbour'), 'Favourite'), '');
  // See all
  await page.click('#favAll'); await page.waitForTimeout(150);
  check(S + '7h See all opens the Library', await page.locator('#view-library').isVisible());
  check(S + '7i with the Favourites chip active', (await page.locator('#libChips .chip[data-st="__fav"]').getAttribute('aria-pressed')) === 'true');
  eq(S + '7j and lists exactly the six favourite films', (await page.$$eval('#libBody tr.row .t', e => e.map(x => x.textContent.trim()))).sort(), ['Ash Meridian', 'Cold Orchard', 'Dune Lantern', 'Ember Voyage', 'Flint Carnival', 'Gale Station']);
  check(S + '7k Library count text says six films', (await page.textContent('#libCount')).includes('of 6 films'), await page.textContent('#libCount'));
  await page.screenshot({ path: `${SHOTS}/library-favourites-${E.size}.png`, fullPage: true });
  await page.click('#libChips .chip[data-st="All"]');
  check(S + '7l choosing All again shows the whole library', (await page.$$('#libBody tr.row')).length > 6);
});

// 8. Last 5, and the old Recent diary is gone
await scenario('8 Last 5', BOTH, async E => {
  const { page, fake, S } = E;
  eq(S + '8a five titles, newest first', await titles(page, '#last5List'), expectLast5(fake));
  check(S + '8b there is no Recent diary panel any more', (await page.$$('#recList, #recH, #recNote')).length === 0);
  const subs = await page.$$eval('#last5List li .sub', e => e.map(x => x.textContent.trim().split(' · ')[0]));
  const exp = dataRows(fake).filter(x => SEEN.includes(x.r[colOf('Status')]) && iso(x.r[colOf('Date')])).sort((a, b) => iso(b.r[colOf('Date')]).localeCompare(iso(a.r[colOf('Date')])) || b.row - a.row).slice(0, 5)
    .map(x => { const [y, m, d] = iso(x.r[colOf('Date')]).split('-').map(Number); return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`; });
  eq(S + '8c short dates', subs, exp);
  eq(S + '8d ratings', await page.$$eval('#last5List li .rtg', e => e.map(x => x.textContent.trim())), ['5/10', '6/10', '6/10', '9/10', '7/10']);
  check(S + '8e each row has Edit and a sticker', await page.$$eval('#last5List li', ls => ls.length === 5 && ls.every(l => l.querySelector('[data-edit]') && l.querySelector('button[data-fav]'))));
  // Edit opens the dialog with the stub button
  await page.locator('#last5List [data-edit]').first().click(); await page.waitForTimeout(100);
  check(S + '8f Edit opens the dialog', await page.locator('#filmDlg').evaluate(d => d.open));
  const fb = page.locator('#filmDlg button[data-fav]');
  eq(S + '8g the dialog has a Favourite button with the stub', [(await fb.textContent()).trim(), await fb.locator('svg use').count()], ['Favourite', 1]);
  check(S + '8h it is off, then on after a tap, and writes one cell', await (async () => {
    const off = (await fb.getAttribute('aria-pressed')) === 'false';
    await fb.click(); await settle(page);
    return off && (await fb.getAttribute('aria-pressed')) === 'true' && UPD(fake, E.n0).length === 1 && UPD(fake, E.n0)[0].range.startsWith("'🎥'!S");
  })());
  check(S + '8i the dialog is still open and the Favourites box now has the film', await page.locator('#filmDlg').evaluate(d => d.open) && (await titles(page, '#favList')).length === 1);
  // Save with no other change then writes nothing more (Favourite is not a form field)
  const n1 = UPD(fake, E.n0).length;
  await page.click('#fdSave'); await page.waitForTimeout(300);
  eq(S + '8j saving the dialog without edits writes nothing extra', UPD(fake, E.n0).length, n1);
});

// 9. Recommended for you
await scenario('9 Recommended', LAPTOP, async E => {
  const { page, fake, S } = E;
  const rank = modelRanking(fake);
  check(S + '9a precondition: several films to pick from', rank.length >= 5, rank.length);
  const read = async () => ({ h: (await page.textContent('#pickBody h3')).trim(), m: (await page.textContent('#pickBody .m')).trim(), why: (await page.textContent('#pickBody .pwhy')).trim() });
  const first = await read();
  eq(S + '9b shows the best-scored watchlist film as "Title (year)"', first.h, `${rank[0].title} (${rank[0].year})`);
  eq(S + '9c with its why line', first.why, rank[0].whyText);
  check(S + '9d and a director / genre line', first.m.length > 0 && !first.m.startsWith('undefined'), first.m);
  check(S + '9e it really is a watchlist film', ['Watchlist', 'Rewatch', 'Watchlist'].includes(String(fake.cell(rank[0].r, 'Status'))), fake.cell(rank[0].r, 'Status'));
  const seq = [first.h];
  for (let i = 1; i < 4; i++) { await page.click('#pickAnother'); seq.push((await read()).h); }
  eq(S + '9f Another walks down the ranking in order', seq, rank.slice(0, 4).map(x => `${x.title} (${x.year})`));
  // cycling wraps back to the start
  for (let i = 4; i < rank.length; i++) await page.click('#pickAnother');
  await page.click('#pickAnother');
  eq(S + '9g after the last film it wraps to the first', (await read()).h, seq[0]);
  check(S + '9h choosing Another writes nothing', UPD(fake, E.n0).length === 0);
  // the note counts the candidates
  eq(S + '9i note counts candidates', await page.textContent('#pickNote'), `${rank.length} to pick from`);
  // stays put when something else re-renders
  await stub(page, 'Rim C', '#last5List').click(); await settle(page);
  eq(S + '9j the pick does not jump when another box re-renders', (await read()).h, seq[0]);
});

// 9b. Add to Up next does what the Plan buttons do
const addRun = {};
await scenario('9b Add to Up next', LAPTOP, async E => {
  const { page, fake, S } = E;
  const rank = modelRanking(fake);
  await page.click('#pickAnother');                                  // not the first, to prove it follows what is shown
  const shown = (await page.textContent('#pickBody h3')).trim();
  const f = rank[1]; eq(S + '9b1 the shown film is the second in the ranking', shown, `${f.title} (${f.year})`);
  const before = fake.snapshot();
  await page.click('#pickAdd'); await settle(page);
  addRun.title = f.title; addRun.row = f.r; addRun.cells = diffCells(before, fake.snapshot()).map(x => `${x.ref}:${x.to}`).sort(); addRun.calls = UPD(fake, E.n0).map(c => c.range + JSON.stringify(c.values));
  check(S + '9b2 the film went to Up next (Plan, Order, Status, Sorted)', fake.cell(f.r, 'Plan') === 'Up next' && fake.cell(f.r, 'Status') === 'Next Up' && typeof fake.cell(f.r, 'Order') === 'number' && iso(fake.cell(f.r, 'Sorted')) === TODAY());
  check(S + '9b3 it is now on the Up next list', (await titles(page, '#upList')).includes(f.title));
  const now = (await page.textContent('#pickBody h3')).trim();
  check(S + '9b4 the pick moved on to another film and the button is live', now !== shown && await page.locator('#pickAdd').isEnabled(), now);
});
await scenario('9c Plan action for the same film', LAPTOP, async E => {
  const { page, fake, S } = E;
  const f = modelRanking(fake)[1];
  eq(S + '9c0 same film as before', f.title, addRun.title);
  await page.click('#tab-library'); await page.click('.lib-mode button[data-mode="plan"]'); await page.waitForTimeout(100);
  const before = fake.snapshot();
  const b = page.locator(`#planView button[aria-label="Add to Up next: ${f.title}"], #planView button[aria-label="Move to Up next: ${f.title}"]`).first();
  await b.scrollIntoViewIfNeeded(); await b.click(); await settle(page);
  eq(S + '9c1 the Plan button wrote the same cells', diffCells(before, fake.snapshot()).map(x => `${x.ref}:${x.to}`).sort(), addRun.cells);
  eq(S + '9c2 in the same calls', UPD(fake, E.n0).map(c => c.range + JSON.stringify(c.values)), addRun.calls);
});
await scenario('9d nothing to recommend', LAPTOP, {
  setup: f => { for (const x of dataRows(f)) { const st = x.r[colOf('Status')]; if (['Watchlist', 'Rewatch'].includes(st)) x.r[colOf('Status')] = 'Unavailable'; if (['Soon', 'Someday'].includes(x.r[colOf('Plan')])) x.r[colOf('Plan')] = ''; } }
}, async E => {
  const { page, S } = E;
  check(S + '9d1 empty state', (await page.textContent('#pickBody')).includes('Nothing to recommend yet'), await page.textContent('#pickBody'));
  check(S + '9d2 no buttons that do nothing', (await page.$$('#pickAnother, #pickAdd')).length === 0);
});

// 10. drill-down shows the stub
await scenario('10 dashboard drill', LAPTOP, { setup: f => setFav(f, 'Ash Meridian', 2001, isoDaysAgo(4)) }, async E => {
  const { page, S } = E;
  await tab(page, 'dashboard');
  await page.evaluate(() => openDrill({ title: 'Test', parts: ['x'], items: ['Ash Meridian', 'Bright Harbour'].map(t => ({ f: state.films.find(f => f.title === t), r: 9 })) }));
  const marks = await page.$$eval('#drillList li', ls => Object.fromEntries(ls.map(l => [l.querySelector('.t').textContent.trim(), !!l.querySelector('svg.stub[aria-label="Favourite"]')])));
  eq(S + '10a only the favourite film carries the stub', Object.entries(marks).sort(), [['Ash Meridian (2001)', true], ['Bright Harbour (2005)', false]]);
  await page.keyboard.press('Escape');
});

// 11. symmetry and sizes
await scenario('11 symmetry laptop', LAPTOP, { setup: f => { ['Ash Meridian', 'Bright Harbour', 'Cold Orchard', 'Dune Lantern', 'Ember Voyage'].forEach((t, i) => fake_set(f, t, i)); } }, async E => {
  const { page, S } = E;
  const bx = await R(page, '#view-log .picks > .panel');
  eq(S + '11a three boxes', bx.length, 3);
  check(S + '11b share a top edge', bx.every(r => near(r.t, bx[0].t)), bx.map(r => r.t));
  check(S + '11c share a height', bx.every(r => near(r.h, bx[0].h)), bx.map(r => r.h));
  check(S + '11d share a width', bx.every(r => near(r.w, bx[0].w)), bx.map(r => r.w));
  check(S + '11e 20px gaps', [bx[1].l - bx[0].r, bx[2].l - bx[1].r].every(g => near(g, 20)), [bx[1].l - bx[0].r, bx[2].l - bx[1].r]);
  const hd = await R(page, '#view-log .picks .panel-head'); check(S + '11f panel heads line up', hd.every(r => near(r.t, hd[0].t) && near(r.b, hd[0].b)), hd);
  const h2 = await R(page, '#view-log .picks h2'); check(S + '11g titles line up', h2.every(r => near(r.t, h2[0].t)), h2);
  const st = await R(page, '#view-log .stats'); const lg = await R(page, '#view-log > .panel');
  check(S + '11h the boxes sit directly under the summary tiles, 20px below', near(bx[0].t - st[0].b, 20), [st[0].b, bx[0].t]);
  check(S + '11i and 20px above Log a film', near(lg[0].t - bx[0].b, 20), [bx[0].b, lg[0].t]);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(S + '11j no horizontal scroll at 1280', sw <= 0, sw);
  const small = await page.$$eval('#view-log button[data-fav]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check(S + '11k stub buttons are at least 28px on a laptop', small.length >= 10 && small.every(([w, h]) => w >= 28 && h >= 28), small.slice(0, 4));
  const ic = await R(page, '#view-log #last5List .stub');
  check(S + '11l the stub itself is drawn at 22x15 (reads clearly)', ic.length === 5 && ic.every(r => near(r.w, 22, 1) && near(r.h, 15, 1)), ic.slice(0, 2));
  await tab(page, 'dashboard'); await tab(page, 'log');
});
function fake_set(f, t, i) { const r = f.rowOfTitle(t); if (r) f.setCell(r, 'Favourite', isoDaysAgo(i + 1)); }
await scenario('11 symmetry phone', PHONE, { setup: f => { ['Ash Meridian', 'Bright Harbour', 'Cold Orchard'].forEach((t, i) => fake_set(f, t, i)); } }, async E => {
  const { page, S } = E;
  const bx = await R(page, '#view-log .picks > .panel');
  eq(S + '11m three boxes', bx.length, 3);
  check(S + '11n stacked: same left edge and width', bx.every(r => near(r.l, bx[0].l) && near(r.w, bx[0].w)), bx.map(r => [r.l, r.w]));
  check(S + '11o full width like the other Log panels', near(bx[0].w, (await R(page, '#view-log > .panel'))[0].w), [bx[0].w]);
  check(S + '11p in order, 20px apart', bx.slice(1).every((r, i) => near(r.t - bx[i].b, 20)), bx.map(r => [r.t, r.b]));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(S + '11q no horizontal scroll at 390', sw <= 0, sw);
  const tap = await page.$$eval('#view-log button[data-fav]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
  check(S + '11r every Log stub button is at least 40x40', tap.length >= 8 && tap.every(([w, h]) => w >= 39.5 && h >= 39.5), tap.filter(([w, h]) => w < 39.5 || h < 39.5));
  await tab(page, 'library');
  const lt = await page.$$eval('#libBody button[data-fav]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
  check(S + '11s Library stub buttons are at least 40x40', lt.length > 5 && lt.every(([w, h]) => w >= 39.5 && h >= 39.5), lt.slice(0, 3));
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const vis = await page.evaluate(() => { const w = document.querySelector('#view-library .table-wrap').getBoundingClientRect(), b = document.querySelector('#libBody button[data-fav]').getBoundingClientRect(); return b.left >= w.left - 0.5 && b.right <= w.right + 0.5; });
  check(S + '11t Library at 390: no page scroll, and the first sticker is visible without scrolling the table', sw2 <= 0 && vis, [sw2, vis]);
  await page.locator('#libBody tr.row').first().click(); await page.locator('#libBody [data-edit]').click(); await page.waitForTimeout(100);
  const db = await page.locator('#filmDlg button[data-fav]').boundingBox();
  check(S + '11u the dialog button is at least 40px tall', db.height >= 39.5, db);
});

// 12. screenshots: Log at both widths in three themes
for (const theme of ['totoro', 'matrix', 'default']) for (const size of ['laptop', 'phone']) {
  await scenario('12 screenshots ' + theme, [size], {
    theme, setup: f => { ['Ash Meridian', 'Bright Harbour', 'Cold Orchard', 'Dune Lantern', 'Ember Voyage', 'Flint Carnival'].forEach((t, i) => fake_set(f, t, i * 3 + 1)); }
  }, async E => {
    const { page, S } = E;
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/log-${theme}-${size}.png`, fullPage: true });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(S + 'screenshot taken, no horizontal scroll', sw <= 0, sw);
  });
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
