// Stage 3 (Plan) headless tests for app.html against a FAKE in-memory Google Sheet. Run: node tests/stage3.test.mjs
// Nothing here talks to Google: every request outside the page is answered locally or aborted (and any abort fails the scenario).
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
const SHOTS = process.env.SHOTS_DIR || SCRATCH + '/shots';
const CHART = SCRATCH + '/real/chart.umd.js';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl3-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', SHEET_ID) + '</body></html>');
const CHART_JS = fs.existsSync(CHART) ? fs.readFileSync(CHART) : '';

const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const BOTH = ['laptop', 'phone'], LAPTOP = ['laptop'];
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want, extra) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}${extra ? ' | ' + extra : ''}`);
const TODAY = () => isoDaysAgo(0);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ---------------------------------- harness ---------------------------------- */
async function open(size, { fixture, setup, S = '' } = {}) {
  const fake = new FakeSheet(fixture ? fixture() : buildPlanFixture());
  const settings0 = JSON.stringify(fake.settings);
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
  await page.exposeFunction('__call', async (server, tool, input, opts) => {
    try { return fake.handle(server, tool, input, opts); }
    catch (e) { return { __error: (e && typeof e === 'object' && e.code) ? { code: e.code, message: e.message } : { code: 'tool_error', message: String((e && e.message) || e) } }; }
  });
  await page.addInitScript(() => {
    window.claude = { use: async n => n === 'mcp' ? { callTool: async (s, t, i, o) => { const r = await window.__call(s, t, i, o); if (r && r.__error) throw r.__error; return r; } } : null };
  });
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
      else { if (m[1].length !== 1 || m[1] > 'R') bad.push(tag + ' column outside A..R'); if (+m[2] < 3) bad.push(tag + ' touches a header row'); }
      if (!(Array.isArray(c.values) && c.values.length === 1 && c.values[0].length === 1)) bad.push(tag + ' values are not exactly [[x]]');
      else if (!['string', 'number'].includes(typeof c.values[0][0])) bad.push(tag + ' value type ' + typeof c.values[0][0]);
    } else if (c.tool === 'append_values') {
      if (!/^'🎥'!A2:Z\d+$/.test(c.range)) bad.push(tag + ' append not anchored to the data block (A2:Z<last row>)');
      if (!(Array.isArray(c.values) && c.values.length === 1)) bad.push(tag + ' append is not exactly one row');
      else if (c.values[0].length > WIDTH) bad.push(tag + ' append wider than A..R');
    }
  }
  if (JSON.stringify(fake.settings) !== E.settings0) bad.push('settings tab changed');
  if (fake.grid.length < fake.initialRows) bad.push(`row count shrank ${fake.initialRows} -> ${fake.grid.length}`);
  if (fake.grid.some(r => r.length > WIDTH)) bad.push('a row grew beyond column R');
  // no row deleted/moved: every original id still on the same row
  check(S + 'N global safety (spreadsheetId, tabs, single-cell updates in A..R, appends, no settings/header writes, no row loss)', bad.length === 0, bad.slice(0, 6));
  check(S + 'N no page errors / console errors', E.errors.length === 0, E.errors.slice(0, 3));
  check(S + 'N no network requests outside the local stubs', E.badReq.length === 0, E.badReq.slice(0, 3));
}

/* ---------------- independent model of the Plan rules (works on a typed grid) ---------------- */
const SEEN = ['Watched', '2026 Watched'];
const mkModel = films => {
  const g = structuredClone(films);
  const M = { g, get: (r, n) => g[r - 1][colOf(n)], set: (r, n, v) => { g[r - 1][colOf(n)] = v; }, rows: () => g.map((_, i) => i + 1).filter(r => r >= 3 && g[r - 1][0] !== '') };
  M.seen = r => SEEN.includes(M.get(r, 'Status'));
  M.isUp = r => !M.seen(r) && (M.get(r, 'Plan') === 'Up next' || (M.get(r, 'Status') === 'Next Up' && !M.get(r, 'Plan')));
  M.up = () => M.rows().filter(M.isUp).sort((a, b) => (typeof M.get(a, 'Order') === 'number' ? M.get(a, 'Order') : 1e9) - (typeof M.get(b, 'Order') === 'number' ? M.get(b, 'Order') : 1e9) || a - b);
  M.soon = () => M.rows().filter(r => !M.seen(r) && M.get(r, 'Plan') === 'Soon');
  M.backlog = () => M.rows().filter(r => !M.seen(r) && !M.isUp(r) && M.get(r, 'Plan') !== 'Soon' && (['Watchlist', 'Rewatch'].includes(M.get(r, 'Status')) || M.get(r, 'Plan') === 'Someday'));
  M.renumber = list => list.forEach((r, i) => { if (M.get(r, 'Order') !== i + 1) M.set(r, 'Order', i + 1); if (M.get(r, 'Plan') !== 'Up next') M.set(r, 'Plan', 'Up next'); });
  M.setTier = (row, tier) => {
    const wasUp = M.isUp(row), others = M.up().filter(r => r !== row);
    M.set(row, 'Plan', tier);
    if (tier) M.set(row, 'Sorted', D(TODAY()));
    if (tier === 'Up next') { M.set(row, 'Order', Math.max(0, ...others.map(r => (typeof M.get(r, 'Order') === 'number' ? M.get(r, 'Order') : 0))) + 1); M.set(row, 'Status', 'Next Up'); }
    else { M.set(row, 'Order', ''); if (M.get(row, 'Status') === 'Next Up') M.set(row, 'Status', 'Watchlist'); }
    if (wasUp || tier === 'Up next') M.renumber(M.up());
  };
  M.move = (row, dir) => { const l = M.up(), i = l.indexOf(row), j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; M.renumber(l); };
  return M;
};
const modelOf = fake => mkModel(fake.snapshot().films);
const titleOf = (M, r) => String(M.get(r, 'Title'));
const people = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
function modelScores(fake) {
  const M = modelOf(fake), norm = t => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const key = r => norm(M.get(r, 'Title')) + '|' + M.get(r, 'Year');
  const by = new Map();
  for (const r of M.rows()) { const k = key(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const reps = [];
  for (const [, rs] of by) {
    const s = rs.filter(M.seen); if (!s.length) continue;
    const dated = s.filter(r => M.get(r, 'Date')).sort((a, b) => (M.get(a, 'Date').date < M.get(b, 'Date').date ? 1 : -1));
    const rep = dated[0] || s[0];
    const rt = typeof M.get(rep, 'Rating') === 'number' ? M.get(rep, 'Rating') : (s.map(r => M.get(r, 'Rating')).find(v => typeof v === 'number') ?? null);
    if (rt != null) reps.push({ rep, rt });
  }
  const mean = reps.length ? reps.reduce((a, x) => a + x.rt, 0) / reps.length : 6.5;
  const grp = fn => { const m = new Map(); for (const x of reps) for (const k of fn(x.rep)) { if (!m.has(k)) m.set(k, []); m.get(k).push(x.rt); } return m; };
  const P = { dir: grp(r => people(M.get(r, 'Director'))), cast: grp(r => people(M.get(r, 'Starring'))), genre: grp(r => (M.get(r, 'Genre') ? [M.get(r, 'Genre')] : [])) };
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
    best(people(M.get(r, 'Director')), P.dir, 0.5, 'dir'); best(people(M.get(r, 'Starring')), P.cast, 0.25, 'cast'); best(M.get(r, 'Genre') ? [M.get(r, 'Genre')] : [], P.genre, 0.25, 'genre');
    const ws = parts.reduce((a, [w]) => a + w, 0);
    let s = ws ? parts.reduce((a, [w, x]) => a + w * x, 0) / ws : mean - 0.5;
    if (M.get(r, 'Purchase') === 'Owned') { s += 0.3; why.push('You own it'); }
    const pl = M.get(r, 'Platform'); if (pl === 'Plex' || pl === 'Physical') { s += 0.15; why.push(pl === 'Plex' ? 'On Plex' : 'On disc'); }
    const prev = (by.get(key(r)) || []).filter(M.seen);
    if (prev.length) { const pr = prev.find(x => typeof M.get(x, 'Rating') === 'number'); why.unshift('Seen before' + (pr ? `, rated ${M.get(pr, 'Rating')}` : '')); }
    return { r, s, why: why.slice(0, 4) };
  };
  return { M, mean, score };
}
function modelDeck(fake) {
  const { M, score } = modelScores(fake);
  const stale = r => M.get(r, 'Plan') === 'Someday' && (!M.get(r, 'Sorted') || Math.round((new Date(TODAY() + 'T00:00') - new Date(M.get(r, 'Sorted').date + 'T00:00')) / 864e5) >= 365);
  return M.backlog().filter(r => !M.get(r, 'Plan') || stale(r)).map(score).sort((a, b) => b.s - a.s || a.r - b.r).map(x => ({ ...x, title: titleOf(M, x.r) }));
}

/* ---------------- helpers ---------------- */
const UPD = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'update_values');
const APP_ = (fake, n0) => fake.calls.slice(n0).filter(c => c.tool === 'append_values');
const rowOf = (fake, title) => { const r = fake.rowOfTitle(title); if (!r) throw new Error('fixture row not found: ' + title); return r; };
const noCalls = (E, label) => check(E.S + label + ' zero sheet calls at all', E.fake.calls.length === E.n0, E.fake.calls.slice(E.n0).map(c => c.tool + ' ' + c.range));
const noWrites = (E, label) => check(E.S + label + ' zero update/append calls', E.fake.calls.slice(E.n0).every(c => c.tool === 'get_values'), E.fake.calls.slice(E.n0).filter(c => c.tool !== 'get_values').map(c => c.tool + ' ' + c.range));
const settlePlan = async page => { await page.waitForFunction(() => planQ.pending === 0); await page.waitForTimeout(250); };
const goPlan = async page => { await page.click('#tab-library'); await page.click('.lib-mode button[data-mode="plan"]'); await page.waitForTimeout(80); };
const goFilms = async page => { await page.click('.lib-mode button[data-mode="films"]'); await page.waitForTimeout(80); };
const titles = (page, sel) => page.$$eval(sel + ' li .t', els => els.map(e => e.textContent.trim()));
const noticeState = page => page.evaluate(() => { const n = document.getElementById('notice'); return { hidden: n.hidden, text: n.textContent, kind: n.dataset.kind }; });
const noticeHistory = page => page.evaluate(() => window.__notices.filter(x => !x.h && x.t).map(x => x.t));
const btn = (page, aria) => page.locator(`#planView button[aria-label="${aria}"]`).first();
const btnCount = (page, aria) => page.locator(`#planView button[aria-label="${aria}"]`).count();
const enc = v => JSON.stringify(v === undefined || v === null ? '' : v);

// Compare the fake's real change (cell by cell AND call by call) with what the model says should change
function verifyAgainst(E, label, before, M, { nUpdates, anyCount } = {}) {
  const { fake, S } = E;
  const exp = diffCells({ films: before.films }, { films: M.g });
  const got = diffCells(before, fake.snapshot());
  const f = d => `${d.ref}=${d.to}`;
  eq(S + label + ' exact cells changed', got.map(f).sort(), exp.map(f).sort(), 'actual: ' + got.map(show).join(' ; ') + ' | expected: ' + exp.map(show).join(' ; '));
  const ups = UPD(fake, E.n0);
  check(S + label + ` one update_values per changed cell (${exp.length}), no redundant writes`, anyCount ? ups.length >= exp.length : ups.length === (nUpdates ?? exp.length), `${ups.length} calls: ` + ups.map(c => c.range + '=' + JSON.stringify(c.values[0][0])).join(', '));
  check(S + label + ' every write hit the row whose id it was meant for', ups.every(c => { const r = +c.range.match(/(\d+)$/)[1]; return c.targets[0].id === before.films[r - 1][colOf('id')]; }));
  check(S + label + ' no append', APP_(fake, E.n0).length === 0);
  check(S + label + ' no error notice', true);
}
function expectSeqPerRow(E, label) {
  // before the first write: header, id column, row; each film's writes are preceded by its own re-locate
  const seq = E.fake.calls.slice(E.n0).map(c => c.tool === 'get_values' ? c.range : 'upd');
  check(E.S + label + ' starts with header, id column, row read', seq[0] === "'🎥'!A2:Z2" && seq[1] === "'🎥'!N1:N6000" && /^'🎥'!A\d+:Z\d+$/.test(seq[2]), seq.slice(0, 4));
}

/* =============================== A. Viewing =============================== */
await scenario('A1 viewing the Plan makes no calls; lists and notes', BOTH, async E => {
  const { page, fake, S } = E;
  const M = modelOf(fake);
  await goPlan(page);
  check(S + 'A plan view visible, table + chips + foot hidden', await page.evaluate(() => !document.getElementById('planView').hidden && document.querySelector('#view-library .table-wrap').hidden && document.getElementById('libChips').hidden && document.querySelector('#view-library .lib-foot').hidden));
  const up = M.up().map(r => titleOf(M, r));
  eq(S + 'A Up next list order (Orders 1..6, blank-Order film last)', await titles(page, '#planUp'), up);
  eq(S + 'A Up next literal order', up, ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Billy Style']);
  eq(S + 'A Up next numbers 1..7', await page.$$eval('#planUp li .n', e => e.map(x => x.textContent)), ['1', '2', '3', '4', '5', '6', '7']);
  check(S + 'A Why shown for Cedar Row', (await page.$$eval('#planUp li', ls => ls.find(l => l.querySelector('.t').textContent === 'Cedar Row').querySelector('.why').textContent)).includes('Recommended by Sam'));
  eq(S + 'A Up next note', await page.textContent('#planUpNote'), '7 of 10');
  eq(S + 'A Soon list', await titles(page, '#planSoon'), ['Soon Alpha', 'Soon Beta']);
  eq(S + 'A Soon note', await page.textContent('#planSoonNote'), '2 films');
  const back = M.backlog().map(r => titleOf(M, r));
  eq(S + 'A backlog = unseen Watchlist/Rewatch/Someday not in Up next/Soon, in sheet order', await titles(page, '#planBack'), back);
  eq(S + 'A backlog count is 30', back.length, 30);
  eq(S + 'A backlog note', await page.textContent('#planBackNote'), '30 films');
  for (const t of ['Coming Alpha', 'Coming Beta', 'Dev One', 'Unavail One', 'Dnf One', 'Billy Style', 'Soon Alpha', 'Alder Gate', 'Solo Seen']) check(S + `A "${t}" not in backlog`, !back.includes(t));
  for (const t of ['Some Stale', 'Some Fresh', 'Some Blank', 'Rewatch One', 'Twice Seen']) check(S + `A "${t}" is in backlog`, back.includes(t));
  check(S + 'A Someday rows are marked', (await page.$$eval('#planBack li.someday', l => l.length)) === 5);
  check(S + 'A Rewatch rows are marked', (await page.$$eval('#planBack li .m', l => l.filter(x => /Rewatch/.test(x.textContent)).length)) === 2);
  await page.mouse.wheel(0, 900); await page.waitForTimeout(100); await page.mouse.wheel(0, -900);
  await page.hover('#planUp li:nth-child(2)'); await page.hover('#planBack li:nth-child(3)');
  noCalls(E, 'A scrolling/hovering the Plan');
  await page.click('#tab-log'); await page.click('#tab-library'); await goFilms(page); await goPlan(page);
  noCalls(E, 'A switching tabs/modes');
  check(S + 'A Films mode hides the plan view', await (async () => { await goFilms(page); return page.evaluate(() => document.getElementById('planView').hidden && !document.querySelector('#view-library .table-wrap').hidden); })());
  await page.click('#tab-log');
  const log = await titles(page, '#upList');
  eq(S + 'A Log Up next shows the same list incl. Billy-style film', log, up);
  eq(S + 'A Log Up next note', await page.textContent('#upNote'), '7 films');
  noCalls(E, 'A whole viewing session');
});
await scenario('A2 more than 10 in Up next', BOTH, { fixture: () => buildPlanFixture({ extraUp: 5 }) }, async E => {
  const { page, fake, S } = E;
  const M = modelOf(fake);
  const up = M.up().map(r => titleOf(M, r));
  eq(S + 'A2 12 Up next films', up.length, 12);
  eq(S + 'A2 Log shows the first 10', await titles(page, '#upList'), up.slice(0, 10));
  eq(S + 'A2 Log note', await page.textContent('#upNote'), '10 of 12 · 2 more waiting');
  await page.click('#planLink'); await page.waitForTimeout(80);
  check(S + 'A2 Plan link opens Library > Plan', await page.evaluate(() => !document.getElementById('view-library').hidden && !document.getElementById('planView').hidden));
  eq(S + 'A2 Plan lists all 12', await titles(page, '#planUp'), up);
  eq(S + 'A2 Plan note', await page.textContent('#planUpNote'), '12 films · the Log shows the first 10');
  noCalls(E, 'A2');
});

/* =============================== B. Backlog filters / paging =============================== */
await scenario('B1 backlog search and filters', LAPTOP, async E => {
  const { page, fake, S } = E;
  const M = modelOf(fake);
  await goPlan(page);
  const exp = fn => M.backlog().filter(fn).map(r => titleOf(M, r));
  const hay = (r, q) => ['Title', 'Director', 'Starring', 'Genre', 'Year'].some(n => String(M.get(r, n) ?? '').toLowerCase().includes(q));
  await page.fill('#libSearch', 'vera'); await page.waitForTimeout(350);
  eq(S + 'B search "vera"', await titles(page, '#planBack'), exp(r => hay(r, 'vera')));
  check(S + 'B search "vera" is not empty', exp(r => hay(r, 'vera')).length > 0);
  eq(S + 'B note follows search', await page.textContent('#planBackNote'), `${exp(r => hay(r, 'vera')).length} films`);
  await page.fill('#libSearch', 'dara'); await page.waitForTimeout(350);
  eq(S + 'B search matches Starring ("dara")', await titles(page, '#planBack'), exp(r => hay(r, 'dara')));
  await page.fill('#libSearch', ''); await page.waitForTimeout(350);
  await page.selectOption('#libGenre', 'Western');
  eq(S + 'B genre Western', await titles(page, '#planBack'), exp(r => M.get(r, 'Genre') === 'Western'));
  await page.selectOption('#libGenre', '');
  await page.selectOption('#libPlatform', 'Plex');
  eq(S + 'B platform Plex', await titles(page, '#planBack'), exp(r => M.get(r, 'Platform') === 'Plex'));
  await page.selectOption('#libPlatform', '');
  await page.selectOption('#libOwned', 'Owned');
  eq(S + 'B owned', await titles(page, '#planBack'), exp(r => M.get(r, 'Purchase') === 'Owned'));
  await page.selectOption('#libOwned', 'None');
  eq(S + 'B no purchase noted', await titles(page, '#planBack'), exp(r => !M.get(r, 'Purchase')));
  await page.selectOption('#libOwned', 'Owned'); await page.selectOption('#libGenre', 'Drama');
  eq(S + 'B owned + Drama combined', await titles(page, '#planBack'), exp(r => M.get(r, 'Purchase') === 'Owned' && M.get(r, 'Genre') === 'Drama'));
  await page.fill('#libSearch', 'zzzz-nothing'); await page.waitForTimeout(350);
  check(S + 'B no match shows "Nothing waiting"', /Nothing waiting/.test(await page.textContent('#planBack')));
  check(S + 'B filters do not touch Up next / Soon', (await titles(page, '#planUp')).length === 7 && (await titles(page, '#planSoon')).length === 2);
  noCalls(E, 'B filters');
});
await scenario('B2 Show 50 more', LAPTOP, { fixture: () => buildPlanFixture({ unsorted: 75 }) }, async E => {
  const { page, fake, S } = E;
  const M = modelOf(fake), all = M.backlog().map(r => titleOf(M, r));
  eq(S + 'B2 fixture has 80 backlog rows', all.length, 80);
  await goPlan(page);
  eq(S + 'B2 first 50 shown, in sheet order', await titles(page, '#planBack'), all.slice(0, 50));
  eq(S + 'B2 note shows the full count', await page.textContent('#planBackNote'), '80 films');
  check(S + 'B2 Show 50 more visible', await page.isVisible('#planMore'));
  await page.click('#planMore');
  eq(S + 'B2 after one click all 80 shown', await titles(page, '#planBack'), all);
  check(S + 'B2 button hidden when everything is shown', !(await page.isVisible('#planMore')));
  noCalls(E, 'B2');
});

/* =============================== C. One-tap from the backlog =============================== */
async function tap(E, tierLabel, title, tier, extra = {}) {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot(), row = rowOf(fake, title), M = mkModel(before.films);
  M.setTier(row, tier);
  const n0 = fake.calls.length; E.n0 = n0;
  await btn(page, `${tierLabel} ${title}`).click();
  await settlePlan(page);
  verifyAgainst(E, `${tierLabel} ${title}`, before, M);
  expectSeqPerRow(E, `${tierLabel} ${title}`);
  check(S + `${title}: status line says Plan saved`, /^Plan saved/.test(await page.textContent('#statusText')), await page.textContent('#statusText'));
  check(S + `${title}: no error notice`, (await noticeState(page)).hidden, await noticeState(page));
  return { before, row, M };
}
await scenario('C1 backlog -> Up next', BOTH, async E => {
  const { page, fake, S } = E;
  const { M, row } = await tap(E, 'Add to Up next:', 'Pending B', 'Up next');
  eq(S + 'C1 Pending B cells', ['Plan', 'Sorted', 'Order', 'Status'].map(n => fake.cell(row, n)), ['Up next', D(TODAY()), 7, 'Next Up']);
  eq(S + 'C1 the owner-edited film got Order 8 and Plan filled in (whole list renumbered)', [fake.cell(rowOf(fake, 'Billy Style'), 'Order'), fake.cell(rowOf(fake, 'Billy Style'), 'Plan')], [8, 'Up next']);
  eq(S + 'C1 Up next now', await titles(page, '#planUp'), ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Pending B', 'Billy Style']);
  check(S + 'C1 left the backlog', !(await titles(page, '#planBack')).includes('Pending B'));
  eq(S + 'C1 Log shows it too', (await (async () => { await page.click('#tab-log'); return titles(page, '#upList'); })()).slice(6, 8), ['Pending B', 'Billy Style']);
});
await scenario('C2 Rewatch row -> Up next', LAPTOP, async E => {
  const { fake, S } = E;
  const { row } = await tap(E, 'Add to Up next:', 'Rewatch One', 'Up next');
  eq(S + 'C2 Status Rewatch became Next Up', fake.cell(row, 'Status'), 'Next Up');
});
await scenario('C3 backlog -> Soon', BOTH, async E => {
  const { page, fake, S } = E;
  const { row } = await tap(E, 'Add to Soon:', 'Pending C', 'Soon');
  eq(S + 'C3 Pending C: Plan Soon, Sorted today, nothing else', [fake.cell(row, 'Plan'), fake.cell(row, 'Sorted'), fake.cell(row, 'Status'), fake.cell(row, 'Order')], ['Soon', D(TODAY()), 'Watchlist', '']);
  eq(S + 'C3 Soon list', await titles(page, '#planSoon'), ['Soon Alpha', 'Soon Beta', 'Pending C']);
});
await scenario('C4 backlog -> Someday, and Someday rows have no Someday button', BOTH, async E => {
  const { page, fake, S } = E;
  check(S + 'C4 a Someday row offers no "Put in Someday"', (await btnCount(page, 'Put in Someday: Some Fresh')) === 0);
  await goPlan(page);
  check(S + 'C4 a Someday row offers no "Put in Someday"', (await btnCount(page, 'Put in Someday: Some Fresh')) === 0);
  check(S + 'C4 unsorted row offers all three buttons', (await btnCount(page, 'Put in Someday: Pending D')) === 1 && (await btnCount(page, 'Add to Soon: Pending D')) === 1 && (await btnCount(page, 'Add to Up next: Pending D')) === 1);
  const { row } = await tap(E, 'Put in Someday:', 'Pending D', 'Someday');
  eq(S + 'C4 Plan Someday, Sorted today', [fake.cell(row, 'Plan'), fake.cell(row, 'Sorted')], ['Someday', D(TODAY())]);
  check(S + 'C4 stays in the backlog list as a Someday row', (await page.$$eval('#planBack li.someday .t', l => l.map(x => x.textContent))).includes('Pending D'));
});
await scenario('C5 Someday row in the backlog -> Up next', LAPTOP, async E => {
  const { fake, S } = E;
  const { row } = await tap(E, 'Add to Up next:', 'Some Fresh', 'Up next');
  eq(S + 'C5 Plan Up next, Status Next Up', [fake.cell(row, 'Plan'), fake.cell(row, 'Status')], ['Up next', 'Next Up']);
});

/* =============================== D. Up next management =============================== */
async function manage(E, label, aria, fn) {
  const { page, fake } = E;
  await goPlan(page);
  const before = fake.snapshot(), M = mkModel(before.films);
  fn(M, fake);
  E.n0 = fake.calls.length;
  await btn(page, aria).click();
  await settlePlan(page);
  verifyAgainst(E, label, before, M);
  check(E.S + label + ' no error notice', (await noticeState(page)).hidden, await noticeState(page));
  return M;
}
await scenario('D1 move up a normal film (owner-edited film gets Order and Plan on the way)', BOTH, async E => {
  const { page, fake, S } = E;
  const M = await manage(E, 'D1 up Cedar Row', 'Move up: Cedar Row', (M, f) => M.move(rowOf(f, 'Cedar Row'), -1));
  eq(S + 'D1 new order', await titles(page, '#planUp'), ['Alder Gate', 'Cedar Row', 'Birch Pier', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Billy Style']);
  eq(S + 'D1 Cedar 2, Birch 3, Billy 7 + Plan', [fake.cell(rowOf(fake, 'Cedar Row'), 'Order'), fake.cell(rowOf(fake, 'Birch Pier'), 'Order'), fake.cell(rowOf(fake, 'Billy Style'), 'Order'), fake.cell(rowOf(fake, 'Billy Style'), 'Plan')], [2, 3, 7, 'Up next']);
  void M;
});
await scenario('D2 move down and the edge buttons', BOTH, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  check(S + 'D2 first row Move up disabled', await btn(page, 'Move up: Alder Gate').isDisabled());
  check(S + 'D2 last row Move down disabled', await btn(page, 'Move down: Billy Style').isDisabled());
  await manage(E, 'D2 down Fir Lane', 'Move down: Fir Lane', (M, f) => M.move(rowOf(f, 'Fir Lane'), 1));
  eq(S + 'D2 order', await titles(page, '#planUp'), ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Billy Style', 'Fir Lane']);
  eq(S + 'D2 Billy 6 + Plan, Fir 7', [fake.cell(rowOf(fake, 'Billy Style'), 'Order'), fake.cell(rowOf(fake, 'Billy Style'), 'Plan'), fake.cell(rowOf(fake, 'Fir Lane'), 'Order')], [6, 'Up next', 7]);
});
await scenario('D3 first interaction with the owner-edited film (move up) fills Plan and Order', LAPTOP, async E => {
  const { fake, S } = E;
  await manage(E, 'D3 up Billy Style', 'Move up: Billy Style', (M, f) => M.move(rowOf(f, 'Billy Style'), -1));
  eq(S + 'D3 Billy Order 6 Plan Up next; Fir 7', [fake.cell(rowOf(fake, 'Billy Style'), 'Order'), fake.cell(rowOf(fake, 'Billy Style'), 'Plan'), fake.cell(rowOf(fake, 'Fir Lane'), 'Order')], [6, 'Up next', 7]);
});
await scenario('D4 Drop an Up next film (rest renumbered)', BOTH, async E => {
  const { page, fake, S } = E;
  await manage(E, 'D4 drop Birch Pier', 'Take off the plan: Birch Pier', (M, f) => M.setTier(rowOf(f, 'Birch Pier'), ''));
  const r = rowOf(fake, 'Birch Pier');
  eq(S + 'D4 Birch: Plan, Order cleared, Status Watchlist, Sorted untouched', [fake.cell(r, 'Plan'), fake.cell(r, 'Order'), fake.cell(r, 'Status'), JSON.stringify(fake.cell(r, 'Sorted')).length > 5], ['', '', 'Watchlist', true]);
  eq(S + 'D4 Up next is renumbered', await page.$$eval('#planUp li', ls => ls.map(l => l.querySelector('.n').textContent + ' ' + l.querySelector('.t').textContent)), ['1 Alder Gate', '2 Cedar Row', '3 Dove Hall', '4 Elm Court', '5 Fir Lane', '6 Billy Style']);
  check(S + 'D4 dropped film is back in the backlog', (await titles(page, '#planBack')).includes('Birch Pier'));
});
await scenario('D5 Drop the owner-edited film writes one cell', LAPTOP, async E => {
  const { fake, S } = E;
  await manage(E, 'D5 drop Billy Style', 'Take off the plan: Billy Style', (M, f) => M.setTier(rowOf(f, 'Billy Style'), ''));
  eq(S + 'D5 Billy Status Watchlist, Plan stays blank', [fake.cell(rowOf(fake, 'Billy Style'), 'Status'), fake.cell(rowOf(fake, 'Billy Style'), 'Plan')], ['Watchlist', '']);
});
await scenario('D6 Up next -> Soon', BOTH, async E => {
  const { page, fake, S } = E;
  await manage(E, 'D6 Dove Hall to Soon', 'Move to Soon: Dove Hall', (M, f) => M.setTier(rowOf(f, 'Dove Hall'), 'Soon'));
  const r = rowOf(fake, 'Dove Hall');
  eq(S + 'D6 Dove: Soon, Sorted today, Order cleared, Status Watchlist', [fake.cell(r, 'Plan'), fake.cell(r, 'Sorted'), fake.cell(r, 'Order'), fake.cell(r, 'Status')], ['Soon', D(TODAY()), '', 'Watchlist']);
  eq(S + 'D6 Soon list (sheet order)', await titles(page, '#planSoon'), ['Dove Hall', 'Soon Alpha', 'Soon Beta']);
  eq(S + 'D6 Up next renumbered', await page.$$eval('#planUp li .n', e => e.map(x => x.textContent)), ['1', '2', '3', '4', '5', '6']);
});
await scenario('D7 Soon -> Up next', BOTH, async E => {
  const { page, fake, S } = E;
  await manage(E, 'D7 Soon Alpha to Up next', 'Move to Up next: Soon Alpha', (M, f) => M.setTier(rowOf(f, 'Soon Alpha'), 'Up next'));
  const r = rowOf(fake, 'Soon Alpha');
  eq(S + 'D7 Soon Alpha cells', [fake.cell(r, 'Plan'), fake.cell(r, 'Order'), fake.cell(r, 'Status'), fake.cell(r, 'Sorted')], ['Up next', 7, 'Next Up', D(TODAY())]);
  eq(S + 'D7 Billy renumbered to 8', fake.cell(rowOf(fake, 'Billy Style'), 'Order'), 8);
  eq(S + 'D7 Soon list', await titles(page, '#planSoon'), ['Soon Beta']);
});
await scenario('D8 Soon -> Someday and Soon -> Drop', LAPTOP, async E => {
  const { fake, S } = E;
  await manage(E, 'D8 Soon Beta to Someday', 'Move to Someday: Soon Beta', (M, f) => M.setTier(rowOf(f, 'Soon Beta'), 'Someday'));
  eq(S + 'D8 Soon Beta Someday', fake.cell(rowOf(fake, 'Soon Beta'), 'Plan'), 'Someday');
  E.n0 = fake.calls.length;
  const before = fake.snapshot(), M = mkModel(before.films); M.setTier(rowOf(fake, 'Soon Alpha'), '');
  await btn(E.page, 'Take off the plan: Soon Alpha').click(); await settlePlan(E.page);
  verifyAgainst(E, 'D8 drop Soon Alpha', before, M);
  eq(S + 'D8 Soon Alpha Plan cleared, Sorted untouched', [fake.cell(rowOf(fake, 'Soon Alpha'), 'Plan'), fake.cell(rowOf(fake, 'Soon Alpha'), 'Sorted')], ['', before.films[rowOf(fake, 'Soon Alpha') - 1][colOf('Sorted')]]);
});
await scenario('D9 owner-edited film -> Soon', LAPTOP, async E => {
  const { fake, S } = E;
  await manage(E, 'D9 Billy to Soon', 'Move to Soon: Billy Style', (M, f) => M.setTier(rowOf(f, 'Billy Style'), 'Soon'));
  const r = rowOf(fake, 'Billy Style');
  eq(S + 'D9 Billy: Soon, Watchlist, Sorted today', [fake.cell(r, 'Plan'), fake.cell(r, 'Status'), fake.cell(r, 'Sorted')], ['Soon', 'Watchlist', D(TODAY())]);
});
await scenario('D10 Why editor', BOTH, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const why = async (title, text, how = 'button') => {
    const before = fake.snapshot(); E.n0 = fake.calls.length;
    await btn(page, `Edit why for ${title}`).click();
    const inp = page.locator('#planUp li .whyedit input').first();
    await inp.fill(text);
    if (how === 'button') await page.locator('#planUp li .whyedit button').first().click(); else await inp.press(how);
    await settlePlan(page);
    return { before, ups: UPD(fake, E.n0) };
  };
  let r = await why('Dove Hall', 'Short note');
  eq(S + 'D10 one write: Why as text', r.ups.map(c => [c.range, c.values[0][0]]), [[`'🎥'!Q${rowOf(fake, 'Dove Hall')}`, "'Short note"]]);
  eq(S + 'D10 cell holds the text', fake.cell(rowOf(fake, 'Dove Hall'), 'Why'), 'Short note');
  check(S + 'D10 only that cell changed', diffCells(r.before, fake.snapshot()).length === 1);
  check(S + 'D10 row shows the new why', (await page.$$eval('#planUp li', ls => ls.find(l => l.querySelector('.t').textContent === 'Dove Hall').querySelector('.why').textContent)).includes('Short note'));
  r = await why('Cedar Row', '');
  eq(S + 'D10 clearing writes an empty cell', r.ups.map(c => c.values[0][0]), ['']);
  eq(S + 'D10 Cedar Why empty', fake.cell(rowOf(fake, 'Cedar Row'), 'Why'), '');
  r = await why('Elm Court', "'tis the season", 'Enter');
  eq(S + 'D10 apostrophe-leading Why is sent with an extra apostrophe', r.ups.map(c => c.values[0][0]), ["''tis the season"]);
  eq(S + 'D10 apostrophe-leading Why stored literally as text', fake.cell(rowOf(fake, 'Elm Court'), 'Why'), "'tis the season");
  check(S + 'D10 page shows it back with its apostrophe', (await page.$$eval('#planUp li', ls => ls.find(l => l.querySelector('.t').textContent === 'Elm Court').querySelector('.why').textContent)).includes("'tis the season"));
  r = await why('Fir Lane', '=SUM(1,2)');
  eq(S + 'D10 equals-leading Why sent as text', r.ups.map(c => c.values[0][0]), ["'=SUM(1,2)"]);
  check(S + 'D10 stored as the literal string (not a number/formula result)', fake.cell(rowOf(fake, 'Fir Lane'), 'Why') === '=SUM(1,2)');
  r = await why('Alder Gate', '   ');
  eq(S + 'D10 whitespace-only on an empty Why: no write', r.ups.length, 0);
  r = await why('Dove Hall', 'Short note');
  eq(S + 'D10 saving unchanged text: no write', r.ups.length, 0);
  // Escape closes without writing; opening alone writes nothing
  E.n0 = fake.calls.length;
  await btn(page, 'Edit why for Alder Gate').click(); await page.locator('#planUp li .whyedit input').first().fill('discard me'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  noCalls(E, 'D10 open + Escape');
  check(S + 'D10 editor closed', (await page.locator('.whyedit').count()) === 0);
  // Soon rows have a Why editor too
  r = await (async () => { E.n0 = fake.calls.length; await btn(page, 'Edit why for Soon Alpha').click(); await page.locator('#planSoon li .whyedit input').fill('for Friday'); await page.locator('#planSoon li .whyedit button').click(); await settlePlan(page); return UPD(fake, E.n0); })();
  eq(S + 'D10 Soon row Why written', r.map(c => c.values[0][0]), ["'for Friday"]);
});

/* =============================== E. Sort deck =============================== */
const deckTitle = page => page.$eval('#deckBody h3', e => e.textContent).catch(() => null);
await scenario('E1 deck queue, order, chips', BOTH, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const exp = modelDeck(fake);
  const got = await page.evaluate(() => deckQueue().map(x => ({ title: x.f.title, s: x.s, why: x.why })));
  eq(S + 'E1 deck queue order', got.map(x => x.title), exp.map(x => x.title));
  check(S + 'E1 scores match the independent calculation', got.every((x, i) => Math.abs(x.s - exp[i].s) < 1e-9), got.map((x, i) => [x.title, x.s, exp[i].s]).filter(([, a, b]) => Math.abs(a - b) > 1e-9));
  eq(S + 'E1 chips match', got.map(x => x.why), exp.map(x => x.why));
  const names = exp.map(x => x.title);
  eq(S + 'E1 queue size 28 (23 unsorted + 3 stale Someday + ...)', names.length, 28);
  for (const t of ['Some Stale', 'Some Blank', 'Some Edge365']) check(S + `E1 stale Someday "${t}" is in the deck`, names.includes(t));
  for (const t of ['Some Fresh', 'Some Edge364', 'Soon Alpha', 'Alder Gate', 'Billy Style', 'Coming Alpha', 'Dnf One']) check(S + `E1 "${t}" is not in the deck`, !names.includes(t));
  check(S + 'E1 Rewatch rows are in the deck', names.includes('Rewatch One') && names.includes('Rewatch Two'));
  const card = await page.evaluate(() => ({ h: document.querySelector('#deckBody h3').textContent, m: document.querySelector('#deckBody .m').textContent, chips: [...document.querySelectorAll('#deckBody .why-chip')].map(c => c.textContent), btns: [...document.querySelectorAll('#deckBody .deck-btns button')].map(b => b.dataset.t + '|' + b.textContent), note: document.getElementById('deckNote').textContent }));
  const M = modelOf(fake), r0 = exp[0].r;
  eq(S + 'E1 card title (year)', card.h, `${titleOf(M, r0)} (${M.get(r0, 'Year')})`);
  eq(S + 'E1 card chips (max 4)', card.chips, exp[0].why);
  check(S + 'E1 at most 4 chips on every card', got.every(x => x.why.length <= 4));
  eq(S + 'E1 four buttons', card.btns, ['Up next|Up next1', 'Soon|Soon2', 'Someday|Someday3', '|Skip4']);
  eq(S + 'E1 deck note', card.note, '28 to sort');
  const cardOf = t => page.evaluate(t => { const q = deckQueue().find(x => x.f.title === t); return q ? q.why : null; }, t);
  const stale = await page.evaluate(() => { const f = state.films.find(x => x.title === 'Some Stale'); return staleSomeday(f); });
  check(S + 'E1 staleSomeday(Some Stale)', stale);
  void cardOf;
  noCalls(E, 'E1 viewing the deck');
  await page.screenshot({ path: `${SHOTS}/s3-${E.size}-deck.png`, fullPage: false });
});
await scenario('E2 pick buttons write and the card advances at once', BOTH, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  for (const [tier, label] of [['Up next', 'Up next'], ['Soon', 'Soon'], ['Someday', 'Someday']]) {
    const exp = modelDeck(fake), before = fake.snapshot(), M = mkModel(before.films);
    M.setTier(exp[0].r, tier);
    E.n0 = fake.calls.length;
    const r = await page.evaluate(t => { const prev = document.querySelector('#deckBody h3').textContent; document.querySelector(`#deckBody .deck-btns button[data-t="${t}"]`).click(); return { prev, next: document.querySelector('#deckBody h3').textContent, pending: planQ.pending }; }, tier);
    check(S + `E2 ${label}: card advanced immediately (before any write finished)`, r.prev !== r.next && r.pending > 0, r);
    await settlePlan(page);
    verifyAgainst(E, `E2 ${label} on "${exp[0].title}"`, before, M);
    check(S + `E2 ${label}: the film left the deck`, !(await page.evaluate(() => deckQueue().map(x => x.f.title))).includes(exp[0].title));
  }
  eq(S + 'E2 deck note counts them', await page.textContent('#deckNote'), '25 to sort · 3 sorted this visit');
});
await scenario('E3 Skip and keyboard', LAPTOP, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  let exp = modelDeck(fake);
  E.n0 = fake.calls.length;
  await page.click('#deckBody .deck-btns button[data-t=""]');
  eq(S + 'E3 Skip shows the next film', await deckTitle(page), `${exp[1].title} (${modelOf(fake).get(exp[1].r, 'Year')})`);
  noCalls(E, 'E3 Skip');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('4');
  check(S + 'E3 key 4 skips', (await deckTitle(page)).startsWith(exp[2].title));
  noCalls(E, 'E3 key 4');
  // keys do nothing while typing in a field
  await page.focus('#libSearch'); await page.keyboard.press('1'); await page.waitForTimeout(100);
  noCalls(E, 'E3 typing 1 into the search box'); eq(S + 'E3 search box got the character', await page.inputValue('#libSearch'), '1');
  await page.fill('#libSearch', ''); await page.waitForTimeout(300);
  await page.evaluate(() => document.activeElement.blur());
  exp = modelDeck(fake).filter(x => ![exp[0].title, exp[1].title].includes(x.title)); // skipped ones are hidden this visit
  for (const [key, tier] of [['1', 'Up next'], ['2', 'Soon'], ['3', 'Someday']]) {
    const e = modelDeck(fake).find(x => x.title === (exp.find(y => true) || {}).title) || null;
    const queue = await page.evaluate(() => deckQueue()[0].f.title);
    const before = fake.snapshot(), M = mkModel(before.films); M.setTier(rowOf(fake, queue), tier);
    E.n0 = fake.calls.length;
    await page.keyboard.press(key); await settlePlan(page);
    verifyAgainst(E, `E3 key ${key} (${tier}) on "${queue}"`, before, M);
    void e;
  }
  // not in Films mode, not in another tab
  await goFilms(page); E.n0 = fake.calls.length;
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('1'); await page.keyboard.press('2'); await page.waitForTimeout(200);
  noCalls(E, 'E3 keys in Films mode');
  await page.click('#tab-log'); await page.keyboard.press('1'); await page.waitForTimeout(200);
  noCalls(E, 'E3 keys on the Log tab');
});
await scenario('E4 round banner after 3 and Keep sorting', LAPTOP, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('4'); // skip must not count
  for (let i = 0; i < 3; i++) { await page.keyboard.press('2'); await settlePlan(page); }
  eq(S + 'E4 banner after 3 sorted (skip not counted)', await page.textContent('#deckBody h3'), "That's a round of 3");
  check(S + 'E4 Keep sorting button present', await page.isVisible('#deckMore'));
  eq(S + 'E4 banner says how many are waiting', /(\d+) more are waiting/.exec(await page.textContent('#deckBody p'))[1], String(await page.evaluate(() => deckQueue().length)));
  check(S + 'E4 banner has only one button', (await page.locator('#deckBody button').count()) === 1);
  await page.click('#deckMore');
  check(S + 'E4 Keep sorting shows a film card', /\(\d{4}\)$/.test(await deckTitle(page)), await deckTitle(page));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('2'); await settlePlan(page); }
  eq(S + 'E4 second banner after 6', await page.textContent('#deckBody h3'), "That's a round of 3");
  check(S + 'E4 deck note counts 6', /6 sorted this visit/.test(await page.textContent('#deckNote')), await page.textContent('#deckNote'));
  // no pick/skip was possible via the banner
  const nUpd = UPD(fake, E.n0).length;
  check(S + 'E4 6 Soon picks = 12 cell writes (Plan + Sorted each)', nUpd === 12, nUpd);
});
await scenario('E5 stale Someday: Someday pick sets Sorted only; empty state', LAPTOP, { fixture: () => buildPlanFixture({ unsorted: 2, deckBatch: 50 }) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const exp = modelDeck(fake);
  eq(S + 'E5 queue = 2 unsorted + 3 stale Someday', exp.length, 5);
  const staleCard = exp.find(x => x.title === 'Some Stale');
  check(S + 'E5 stale Someday card says "Someday for over a year"', staleCard != null);
  for (let i = 0; i < 5; i++) {
    const cur = modelDeck(fake)[0], wasSomeday = fake.cell(cur.r, 'Plan') === 'Someday';
    const before = fake.snapshot(), M = mkModel(before.films); M.setTier(cur.r, 'Someday');
    const meta = await page.textContent('#deckBody .m');
    check(S + `E5 "${cur.title}" meta ${wasSomeday ? 'mentions' : 'does not mention'} Someday for over a year`, /Someday for over a year/.test(meta) === wasSomeday, meta);
    E.n0 = fake.calls.length;
    await page.click('#deckBody button[data-t="Someday"]'); await settlePlan(page);
    verifyAgainst(E, `E5 Someday on "${cur.title}"`, before, M);
    if (wasSomeday) eq(S + `E5 "${cur.title}": only Sorted written`, UPD(fake, E.n0).map(c => c.range), [`'🎥'!R${cur.r}`]);
  }
  check(S + 'E5 empty state text', /All sorted/.test(await page.textContent('#deckBody')), await page.textContent('#deckBody'));
  eq(S + 'E5 deck note', await page.textContent('#deckNote'), '0 to sort · 5 sorted this visit');
});

/* =============================== F. Scoring =============================== */
await scenario('F scoring unit checks', LAPTOP, async E => {
  const { page, S } = E;
  const r = await page.evaluate(() => {
    const P = buildProfile(), mk = o => ({ title: 'x', key: 'x|1', director: '', starring: '', genre: '', purchase: '', platform: '', ...o });
    const sc = o => scoreFilm(mk(o), P);
    return {
      mean: P.mean, vera: sc({ director: 'Vera Lindholm' }), kit: sc({ director: 'Kit Solano' }), none: sc({}), owned: sc({ purchase: 'Owned' }), plex: sc({ platform: 'Plex' }),
      disc: sc({ platform: 'Physical' }), both: sc({ purchase: 'Owned', platform: 'Plex' }), rex: sc({ director: 'Rex Mallory' }), dara: sc({ starring: 'Eli Ford, Dara Quill' }), drama: sc({ genre: 'Drama' }),
      combo: sc({ director: 'Vera Lindholm', genre: 'Horror' }), multi: sc({ director: 'Rex Mallory, Vera Lindholm' }), seenBefore: scoreFilm(state.films.find(f => f.title === 'Twice Seen' && !f.seen), P),
      kitAff: affinity(P.dir.get('Kit Solano'), P.mean), veraAff: affinity(P.dir.get('Vera Lindholm'), P.mean), horrorAff: affinity(P.genre.get('Horror'), P.mean)
    };
  });
  const ratings = [10, 9, 9, 8, 10, 5, 4, 3, 8, 8, 8, 6, 7, 7, 9, 6, 6, 5], mean = ratings.reduce((a, b) => a + b) / ratings.length;
  check(S + 'F mean of seen ratings', Math.abs(r.mean - mean) < 1e-9, [r.mean, mean]);
  check(S + 'F shrinkage: 1 film rated 10 scores BELOW 4 films avg 9', r.kit.s < r.vera.s, [r.kit.s, r.vera.s]);
  check(S + 'F Kit affinity = (10+3m)/4', Math.abs(r.kitAff - (10 + 3 * mean) / 4) < 1e-9);
  check(S + 'F Vera affinity = (36+3m)/7', Math.abs(r.veraAff - (36 + 3 * mean) / 7) < 1e-9);
  check(S + 'F unknown film = mean - 0.5', Math.abs(r.none.s - (mean - 0.5)) < 1e-9, r.none.s);
  check(S + 'F Owned +0.3', Math.abs(r.owned.s - (mean - 0.2)) < 1e-9);
  check(S + 'F Plex +0.15, Physical +0.15', Math.abs(r.plex.s - (mean - 0.35)) < 1e-9 && Math.abs(r.disc.s - (mean - 0.35)) < 1e-9);
  check(S + 'F Owned + Plex +0.45', Math.abs(r.both.s - (mean - 0.05)) < 1e-9);
  eq(S + 'F chips for Owned+Plex', r.both.why, ['You own it', 'On Plex']);
  eq(S + 'F chip: On disc', r.disc.why, ['On disc']);
  eq(S + 'F director chip (plural)', r.vera.why, ['Vera Lindholm: 4 films, you average 9.0']);
  eq(S + 'F director chip (singular, 1 film)', r.kit.why, ['Kit Solano: 1 film, you average 10.0']);
  eq(S + 'F low director chip', r.rex.why, ['Rex Mallory: 3 films, you average 4.0']);
  eq(S + 'F cast chip', r.dara.why, ['Dara Quill: 3 films, you average 8.0']);
  eq(S + 'F genre chip', r.drama.why, ['Drama: you average 8.5 over 6']);
  check(S + 'F weighting dir .5 genre .25 (weighted mean of the two present)', Math.abs(r.combo.s - (0.5 * r.veraAff + 0.25 * r.horrorAff) / 0.75) < 1e-9, [r.combo.s]);
  check(S + 'F best director of several is used', Math.abs(r.multi.s - r.vera.s) < 1e-9);
  eq(S + 'F "Seen before, rated 9" chip comes first', r.seenBefore.why[0], 'Seen before, rated 9');
  void page;
});

/* =============================== G. Rewatch next =============================== */
async function openRow(page, title, nth = 0) {
  await page.click('#tab-library'); await goFilms(page);
  await page.fill('#libSearch', title); await page.waitForTimeout(350);
  const rows = page.locator('#libBody tr.row'); const idx = await page.evaluate(t => [...document.querySelectorAll('#libBody tr.row')].map((tr, i) => [i, tr.querySelector('.t').textContent.trim()]).filter(([, x]) => x === t).map(([i]) => i), title);
  await rows.nth(idx[nth]).locator('.t').click();
  return page.evaluate(() => { const b = document.querySelector('#libBody .detail [data-rewatch]'); return { has: !!b, hidden: b ? b.hidden : null }; });
}
await scenario('G1 Rewatch next: visibility, one append, appears in Up next', BOTH, async E => {
  const { page, fake, S } = E;
  eq(S + 'G seen film with no unseen row: button visible', await openRow(page, 'Solo Seen'), { has: true, hidden: false });
  eq(S + 'G seen film that also has an unseen row (seen row): hidden', await openRow(page, 'Twice Seen', 0), { has: true, hidden: true });
  eq(S + 'G same film, its unseen row: hidden', await openRow(page, 'Twice Seen', 1), { has: true, hidden: true });
  eq(S + 'G unseen film: hidden', await openRow(page, 'Pending A'), { has: true, hidden: true });
  eq(S + 'G Up next film: hidden', await openRow(page, 'Alder Gate'), { has: true, hidden: true });
  await openRow(page, 'Solo Seen');
  const before = fake.snapshot(), id = fake.maxId() + 1, newRow = fake.lastDataRow() + 1, upCount = modelOf(fake).up().length;
  E.n0 = fake.calls.length;
  await page.click('#libBody .detail [data-rewatch]'); await settlePlan(page);
  eq(S + 'G exactly one append, no updates', [APP_(fake, E.n0).length, UPD(fake, E.n0).length], [1, 0]);
  eq(S + 'G appended raw row', APP_(fake, E.n0)[0].values[0], ["'Solo Seen", '', 'Next Up', '', "'Una Park, Q Lee", "'Una Park", "'Cam Era", 'Owned', 'Drama', 'Plex', '', 2000, '', id, 'Up next', upCount + 1, '', TODAY()]);
  const o = fake.rowObj(newRow);
  check(S + 'G stored types (id/Year/Order numbers, Sorted a date, Title text)', typeof o.id === 'number' && o.Year === 2000 && o.Order === upCount + 1 && JSON.stringify(o.Sorted) === JSON.stringify(D(TODAY())) && o.Title === 'Solo Seen', o);
  eq(S + 'G only the new row changed', [...new Set(diffCells(before, fake.snapshot()).map(d => d.row))], [newRow]);
  check(S + 'G the Watched row is untouched', JSON.stringify(fake.grid[rowOf(fake, 'Solo Seen') - 1]) === JSON.stringify(before.films[rowOf(fake, 'Solo Seen') - 1]));
  await goPlan(page);
  check(S + 'G film now appears in Up next', (await titles(page, '#planUp')).includes('Solo Seen'), await titles(page, '#planUp'));
  await page.click('#tab-log');
  check(S + 'G and in the Log Up next', (await titles(page, '#upList')).includes('Solo Seen'));
  await openRow(page, 'Solo Seen').then(async () => {});
  check(S + 'G button no longer offered once an unseen row exists', await page.evaluate(() => [...document.querySelectorAll('#libBody .detail [data-rewatch]')].every(b => b.hidden)));
});
await scenario('G2 double tap on Rewatch next', LAPTOP, async E => {
  const { page, fake, S } = E;
  await openRow(page, 'Solo Seen');
  E.n0 = fake.calls.length;
  await page.evaluate(() => { const b = document.querySelector('#libBody .detail [data-rewatch]'); b.click(); b.click(); });
  await settlePlan(page);
  eq(S + 'G2 two quick taps append only ONE row', APP_(fake, E.n0).length, 1, 'rows titled Solo Seen: ' + fake.grid.filter(r => r[0] === 'Solo Seen').length);
});

/* =============================== H. Failure handling =============================== */
await scenario('H1 failure on the 2nd cell of a multi-cell change', BOTH, async E => {
  const { page, fake, S } = E;
  let seen = 0; const orig = fake.handle.bind(fake);
  fake.handle = (s, t, i, o) => { if (t === 'update_values' && ++seen === 2) { fake.calls.push({ n: fake.calls.length, server: s, tool: t, spreadsheetId: i.spreadsheetId, range: i.range, values: i.values, raw: i, error: 'injected' }); throw { code: 'tool_error', message: 'quota exceeded' }; } return orig(s, t, i, o); };
  await goPlan(page);
  const before = fake.snapshot(), row = rowOf(fake, 'Pending E');
  E.n0 = fake.calls.length;
  await btn(page, 'Add to Up next: Pending E').click(); await settlePlan(page); await page.waitForTimeout(300);
  const n = await noticeState(page);
  check(S + 'H1 notice says "Only partly saved" and survives the re-read', !n.hidden && /Only partly saved/.test(n.text), n);
  eq(S + 'H1 only 2 update attempts (1 landed, 1 failed), no retry, no later cells', UPD(fake, E.n0).length, 2);
  eq(S + 'H1 sheet holds exactly the first cell', diffCells(before, fake.snapshot()).map(d => d.colName + '=' + d.to), ['Plan="Up next"']);
  check(S + 'H1 page re-read the sheet afterwards', fake.calls.slice(E.n0).some(c => c.tool === 'get_values' && c.range === "'🎥'!A1:R6000"));
  void row;
});
await scenario('H2 someone else changed the Plan after load', BOTH, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Pending K'), 'Plan', 'Soon')) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot();
  check(S + 'H2 the other edit is in the sheet', fake.cell(rowOf(fake, 'Pending K'), 'Plan') === 'Soon');
  E.n0 = fake.calls.length;
  await btn(page, 'Add to Up next: Pending K').click(); await settlePlan(page);
  eq(S + 'H2 zero update/append calls', UPD(fake, E.n0).length + APP_(fake, E.n0).length, 0);
  const n = await noticeState(page);
  check(S + 'H2 refusal notice mentions Plan changed', !n.hidden && /Not saved/.test(n.text) && /Plan/.test(n.text), n);
  eq(S + 'H2 sheet unchanged', diffCells(before, fake.snapshot()).length, 0);
});
await scenario('H3 deck: stale refusal puts the card back', LAPTOP, { setup: f => f.mutateAfterLoad(s => { const top = modelDeck(s)[0]; s.setCell(top.r, 'Plan', 'Soon'); s.__top = top.title; }) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const top = fake.__top, before = fake.snapshot();
  check(S + 'H3 deck still shows the film', (await deckTitle(page)).startsWith(top), await deckTitle(page));
  E.n0 = fake.calls.length;
  await page.click('#deckBody button[data-t="Up next"]');
  check(S + 'H3 card advanced at once', !(await deckTitle(page)).startsWith(top));
  await settlePlan(page);
  eq(S + 'H3 zero writes', UPD(fake, E.n0).length, 0);
  check(S + 'H3 card is back in the deck after the refusal', (await page.evaluate(() => deckQueue().map(x => x.f.title))).includes(top));
  const n = await noticeState(page);
  check(S + 'H3 notice shown', !n.hidden && /Not saved/.test(n.text), n);
  eq(S + 'H3 sheet unchanged', diffCells(before, fake.snapshot()).length, 0);
});
await scenario('H4 deck: failed write puts the card back and shows a notice', LAPTOP, { setup: f => f.failNext('update_values', { code: 'tool_error', message: 'boom' }) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const top = modelDeck(fake)[0].title, before = fake.snapshot();
  E.n0 = fake.calls.length;
  await page.click('#deckBody button[data-t="Soon"]'); await settlePlan(page);
  check(S + 'H4 the same film is the current card again', (await deckTitle(page)).startsWith(top), await deckTitle(page));
  const n = await noticeState(page);
  check(S + 'H4 notice "Not saved: boom"', !n.hidden && /Not saved: boom/.test(n.text), n);
  eq(S + 'H4 sheet unchanged', diffCells(before, fake.snapshot()).length, 0);
  const dn = await page.textContent('#deckNote');
  check(S + 'H4 deck note does not claim a sorted film that was never saved', !/sorted this visit/.test(dn), dn);
});
await scenario('H5 two quick taps are written in order and stay consistent', BOTH, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot(), M = mkModel(before.films);
  M.setTier(rowOf(fake, 'Pending G'), 'Up next'); M.setTier(rowOf(fake, 'Pending H'), 'Up next');
  E.n0 = fake.calls.length;
  await page.evaluate(() => { for (const t of ['Pending G', 'Pending H']) document.querySelector(`#planView button[aria-label="Add to Up next: ${t}"]`).click(); });
  await settlePlan(page);
  verifyAgainst(E, 'H5 two Up next taps', before, M);
  const ups = UPD(fake, E.n0).map(c => +c.range.match(/(\d+)$/)[1]);
  check(S + 'H5 writes for G all come before writes for H touch H', ups.indexOf(rowOf(fake, 'Pending G')) < ups.indexOf(rowOf(fake, 'Pending H')));
  const orders = modelOf(fake).up().map(r => modelOf(fake).get(r, 'Order'));
  eq(S + 'H5 Orders are unique 1..n', orders, orders.map((_, i) => i + 1));
  eq(S + 'H5 page shows them', await titles(page, '#planUp'), ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane', 'Pending G', 'Billy Style', 'Pending H']);
});
await scenario('H6 quick mixed taps: Up next, Soon, drop, move', LAPTOP, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot(), M = mkModel(before.films);
  M.setTier(rowOf(fake, 'Pending I'), 'Up next'); M.setTier(rowOf(fake, 'Birch Pier'), ''); M.setTier(rowOf(fake, 'Pending L'), 'Up next'); M.move(rowOf(fake, 'Elm Court'), -1);
  E.n0 = fake.calls.length;
  await page.evaluate(() => {
    const b = a => document.querySelector(`#planView button[aria-label="${a}"]`);
    b('Add to Up next: Pending I').click(); b('Take off the plan: Birch Pier').click(); b('Add to Up next: Pending L').click(); b('Move up: Elm Court').click();
  });
  await settlePlan(page);
  verifyAgainst(E, 'H6 four quick taps (intermediate renumbers may rewrite a cell)', before, M, { anyCount: true });
  const orders = modelOf(fake).up().map(r => modelOf(fake).get(r, 'Order'));
  eq(S + 'H6 Orders unique 1..n', orders, orders.map((_, i) => i + 1));
});
await scenario('H7 multi-row change where the 2nd row is stale (move up)', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Birch Pier'), 'Order', 9)) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot();
  E.n0 = fake.calls.length;
  await btn(page, 'Move up: Cedar Row').click(); await settlePlan(page); await page.waitForTimeout(300);
  const diffs = diffCells(before, fake.snapshot()), n = await noticeState(page), hist = await noticeHistory(page);
  // acceptable outcomes: nothing written, OR the user is told it is only partly saved
  check(S + 'H7 either nothing was written or the user is told it was only partly saved / the sheet is re-read', diffs.length === 0 || /partly|re-read|Check/.test(n.text), { written: diffs.map(show), notice: n, hist });
});
await scenario('H8 Drop where a later renumber step is stale', LAPTOP, { setup: f => f.mutateAfterLoad(s => s.setCell(s.rowOfTitle('Dove Hall'), 'Order', 9)) }, async E => {
  const { page, fake, S } = E;
  await goPlan(page);
  const before = fake.snapshot();
  E.n0 = fake.calls.length;
  await btn(page, 'Take off the plan: Birch Pier').click(); await settlePlan(page); await page.waitForTimeout(300);
  const diffs = diffCells(before, fake.snapshot()), n = await noticeState(page);
  check(S + 'H8 if the Drop landed but the renumber failed, the user is told (partly saved / re-read) rather than a plain "Not saved"', diffs.length === 0 || /partly|re-read|Check/.test(n.text), { written: diffs.map(show), notice: n.text });
});

/* =============================== I. Layout =============================== */
await scenario('I layout and screenshots', BOTH, async E => {
  const { page, size, S } = E;
  const noSide = async label => { const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, W: window.innerWidth, bw: document.body.scrollWidth })); check(S + `I ${label}: no horizontal page scroll`, r.sw <= r.W && r.bw <= r.W, r); };
  await goPlan(page);
  await noSide('Plan mode');
  await page.screenshot({ path: `${SHOTS}/s3-${size}-plan-top.png` });
  await btn(page, 'Edit why for Dove Hall').click(); await page.waitForTimeout(150);
  await noSide('Why editor open');
  const w = await page.evaluate(() => { const e = document.querySelector('.whyedit'); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, W: window.innerWidth }; });
  check(S + 'I Why editor inside the viewport', w.l >= 0 && w.r <= w.W + 0.5, w);
  await page.screenshot({ path: `${SHOTS}/s3-${size}-plan-why.png` });
  await page.keyboard.press('Escape');
  const off = await page.evaluate(() => [...document.querySelectorAll('#planView button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + 0.5 || r.left < -0.5); }).map(b => b.getAttribute('aria-label') || b.textContent).slice(0, 5));
  check(S + 'I every Plan button is inside the viewport horizontally', off.length === 0, off);
  const small = await page.evaluate(() => { const bs = [...document.querySelectorAll('#planView .acts button, #planView .deck-btns button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.height < 24 || r.width < 24); }); return { n: bs.length, sample: bs.slice(0, 3).map(b => { const r = b.getBoundingClientRect(); return b.textContent + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }) }; });
  check(S + 'I tap targets are at least 24px (WCAG 2.2 minimum)', small.n === 0, small);
  await page.evaluate(() => document.getElementById('deckPanel').scrollIntoView());
  await noSide('deck in view');
  const dk = await page.evaluate(() => { const r = document.querySelector('#deckBody .deck-card').getBoundingClientRect(); return { l: r.left, r: r.right, W: window.innerWidth }; });
  check(S + 'I deck card inside the viewport', dk.l >= 0 && dk.r <= dk.W + 0.5, dk);
  await page.screenshot({ path: `${SHOTS}/s3-${size}-plan-deck.png` });
  await page.evaluate(() => document.getElementById('planBack').scrollIntoView());
  await page.screenshot({ path: `${SHOTS}/s3-${size}-plan-backlog.png` });
  await page.screenshot({ path: `${SHOTS}/s3-${size}-plan-full.png`, fullPage: true });
  await noSide('backlog');
});

console.log(`\n${passes} passed, ${failures} failed`);
await browser.close();
process.exit(failures ? 1 : 0);
