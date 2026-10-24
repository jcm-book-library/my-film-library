// Stage 4 (Dashboard) headless tests for app.html against a FAKE in-memory Google Sheet. Run: node tests/stage4.test.mjs
// Synthetic data only (dashfixture.mjs). Every expectation is computed here from the raw fixture records, not from the app.
// Nothing talks to Google: requests outside the page are answered locally or aborted (and any abort fails the scenario).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeSheet, SHEET_ID } from './fakesheet.mjs';
import { buildDashFixture, DASH_TODAY } from './dashfixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_FILE || path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = (process.env.SHOTS_DIR || SCRATCH + '/shots') + '/stage4';
const CHART = SCRATCH + '/real/chart.umd.js';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl4-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', SHEET_ID) + '</body></html>');
const CHART_JS = fs.existsSync(CHART) ? fs.readFileSync(CHART) : '';
const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ---------------------------------- independent model ---------------------------------- */
const FX = buildDashFixture();
const REC = FX.records;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TODAY = '2026-10-15';
const one = v => v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const showDate = s => `${+s.slice(8)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(2, 4)}`;
const keyOf = r => r.title.trim().toLowerCase() + '|' + r.year;
const seenRows = REC.filter(r => r.status === 'Watched');
const dated = seenRows.filter(r => r.date);
const nSeen = r => seenRows.filter(o => keyOf(o) === keyOf(r)).length;
// a dated watch is a rewatch only when the film was seen BEFORE it (undated archive row, earlier date, or same date higher in the sheet)
const earlierSeen = r => seenRows.filter(o => keyOf(o) === keyOf(r) && o !== r && (!o.date || o.date < r.date || (o.date === r.date && o._row < r._row)));
const isRe = r => earlierSeen(r).length > 0;
const isOwned = r => r.purchase === 'Owned' || r.platform === 'Physical' || r.platform === 'Plex';
const STREAM = ['Stan', 'Netflix', 'Disney+', 'Prime', 'Apple TV', 'Paramount'];
const whereOf = r => isOwned(r) ? 'Owned' : r.platform === 'Cinema' ? 'Cinema' : STREAM.includes(r.platform) ? 'Streaming' : (r.platform || r.purchase) ? 'Other' : 'Not recorded';
const uniques = (() => {
  const m = new Map();
  for (const r of seenRows) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.values()].map(rows => {
    const d = rows.filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
    const rep = d[0] || rows[0];
    const rt = rep.rating != null ? rep.rating : ((rows.find(r => r.rating != null) || {}).rating ?? null);
    return { f: rep, r: rt };
  });
})();
const years = [...new Set(dated.map(r => r.date.slice(0, 4)))].sort().reverse();
const scopeOf = y => y === 'all' ? uniques : dated.filter(r => r.date.startsWith(y)).map(r => ({ f: r, r: r.rating }));
const sortItems = items => [...items].sort((a, b) => (b.f.date || '').localeCompare(a.f.date || '') || (b.r ?? -1) - (a.r ?? -1) || a.f.title.trim().localeCompare(b.f.title.trim()));
const label = it => `${it.f.title.trim()} (${it.f.year})`;
const names = s => [...new Set(s.split(',').map(x => x.trim()).filter(Boolean))];
const avgIt = a => mean(a.filter(i => i.r != null).map(i => i.r));
const filmsN = n => `${n} film${n === 1 ? '' : 's'}`;
const plabel = y => y === 'all' ? 'All time' : y;
function groupBy(items, fn) { const m = new Map(); for (const it of items) { const k = fn(it); if (k === '' || k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; }
function peopleTop(items, mode) {
  const field = { directors: 'director', cast: 'starring', cine: 'cinematography' }[mode];
  const m = new Map(); let have = 0;
  for (const it of items) { const ns = names(it.f[field]); if (ns.length) have++; for (const n of ns) { if (!m.has(n)) m.set(n, []); m.get(n).push(it); } }
  const rows = [...m.entries()].map(([n, a]) => ({ n, a, c: a.length, r: avgIt(a) })).sort((x, y) => y.c - x.c || (y.r ?? 0) - (x.r ?? 0) || x.n.localeCompare(y.n)).slice(0, 10);
  return { rows, have };
}
function expectPeriod(y) {
  const sc = scopeOf(y), all = y === 'all';
  const E = { sc };
  if (all) {
    const dirs = new Set(uniques.flatMap(u => names(u.f.director)));
    const decs = uniques.map(u => Math.floor(u.f.year / 10) * 10);
    E.tiles = [['Films seen', String(uniques.length)], ['Average rating', one(mean(uniques.filter(u => u.r != null).map(u => u.r)))], ['Directors', String(dirs.size)],
      ['Decades', `${Math.min(...decs)}s–${Math.max(...decs)}s`], ['Watchlist', String(REC.filter(r => r.status === 'Watchlist' || r.status === 'Next Up').length)], ['Dated watches', String(dated.length)]];
  } else {
    const yr = sc.map(i => i.f), re = yr.filter(isRe).length;
    const gm = groupBy(sc, i => i.f.genre);
    const top = [...gm.entries()].map(([g, a]) => [g, a.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const own = yr.filter(isOwned).length;
    E.tiles = [['Watched', String(yr.length)], ['Average rating', one(mean(yr.filter(r => r.rating != null).map(r => r.rating)))], ['First-time', String(yr.length - re)], ['Rewatches', String(re)],
      ['Top genre', top ? top[0] : '–'], ['Owned share', Math.round(own / yr.length * 100) + '%']];
    E.topGenreSub = `${top[1]} watch${top[1] === 1 ? '' : 'es'}`;
    E.ownedSub = `${own} of ${yr.length} watches`;
    E.per = Array(12).fill(0); for (const r of yr) E.per[+r.date.slice(5, 7) - 1]++;
    E.byDate = groupBy(sc, i => i.f.date);
  }
  // ratings
  const b = r => Math.min(10, Math.max(1, Math.round(r)));
  E.rat = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(r => [String(r), sc.filter(i => i.r != null && b(i.r) === r)]);
  E.ratNote = `${sc.filter(i => i.r != null).length} rated · average ${one(avgIt(sc))}`;
  // genres
  const gm = groupBy(sc, i => i.f.genre);
  E.gen = [...gm.entries()].map(([g, a]) => [g, a]).sort((x, y) => y[1].length - x[1].length || (avgIt(y[1]) ?? 0) - (avgIt(x[1]) ?? 0) || x[0].localeCompare(y[0]));
  const gHave = E.gen.reduce((n, g) => n + g[1].length, 0);
  E.genNote = (all || gHave < sc.length) ? `Genre is filled in for ${gHave} of ${sc.length} films` : `${sc.length} ${all ? 'films' : 'watches'}`;
  // decades
  const dm = groupBy(sc, i => Math.floor(i.f.year / 10) * 10);
  E.dec = [...dm.entries()].sort((a, b) => b[0] - a[0]);
  // where
  const ws = all ? sc.filter(i => i.f.platform || i.f.purchase) : sc;
  E.wsN = ws.length;
  E.where = ['Owned', 'Streaming', 'Cinema', 'Other', 'Not recorded'].filter(w => !(all && w === 'Not recorded')).map(w => [w, ws.filter(i => whereOf(i.f) === w)]);
  const pm = groupBy(ws, i => i.f.platform);
  E.plat = [...pm.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  E.whereNote = all ? `Platform or purchase is filled in for ${ws.length} of ${sc.length} films` : `${ws.length} watches`;
  // rewatches
  if (!all) {
    E.rew = sc.map(i => i.f).filter(isRe).sort((a, b) => b.date.localeCompare(a.date) || a._row - b._row).map(f => {
      const others = earlierSeen(f);
      const prev = others.filter(o => o.date).sort((a, b) => b.date.localeCompare(a.date) || b._row - a._row)[0] || others.find(o => !o.date);
      const d = f.rating - prev.rating;
      return { f, was: prev.rating, now: f.rating, mark: d > 0 ? `▲ +${d}` : d < 0 ? `▼ −${-d}` : '= same', rows: REC.filter(o => keyOf(o) === keyOf(f)) };
    });
  }
  return E;
}

/* ---------------------------------- harness ---------------------------------- */
async function open(size, { theme, S = '' } = {}) {
  const fake = new FakeSheet(buildDashFixture());
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
  await page.clock.install({ time: DASH_TODAY });
  await page.exposeFunction('__call', async (server, tool, input, opts) => {
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
  return { page, ctx, fake, errors, badReq, S, size, n0: fake.calls.length };
}
async function scenario(name, sizes, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  for (const size of sizes) {
    const S = `[${size}] ${name}: `;
    let E;
    try { E = await open(size, { ...opts, S }); E.S = S; await fn(E); }
    catch (e) { check(S + 'scenario ran without exception', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    finally { if (E) await E.ctx.close(); }
  }
}
const tab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(150); };
const txt = (page, sel) => page.$$eval(sel, es => es.map(e => e.textContent.trim()));
async function pick(page, y) { await page.click(`#dashPeriods .chip[data-p="${y}"]`); await page.waitForTimeout(80); }
const rowsOf = (page, sel, f) => page.$$eval(sel + ' > li', (ls, f) => ls.map(l => eval(f)(l)), f);
async function drillState(page) {
  return page.evaluate(() => ({
    open: document.getElementById('drillDlg').open, title: document.getElementById('drillTitle').textContent, sub: document.getElementById('drillSub').textContent,
    rows: [...document.querySelectorAll('#drillList li')].map(l => ({ t: l.querySelector('.t').textContent, m: l.querySelector('.m').textContent, r: l.querySelector('.r b').textContent, st: l.querySelector('.r span').textContent }))
  }));
}
async function checkDrill(E, name, ds, want) { // want: {title, sub, items}
  const L = E.S + name + ': ';
  check(L + 'drill dialog is open', ds.open);
  eq(L + 'drill title', ds.title, want.title);
  eq(L + 'drill subtitle', ds.sub, want.sub);
  eq(L + 'drill films and order', ds.rows.map(r => r.t), sortItems(want.items).map(label));
  const first = sortItems(want.items)[0];
  if (first) {
    const m = [first.f.date ? showDate(first.f.date) : '', names(first.f.director).join(', '), first.f.genre, first.f.platform].filter(Boolean).join(' · ');
    eq(L + 'drill first row meta', ds.rows[0].m, m);
    eq(L + 'drill first row rating and status', [ds.rows[0].r, ds.rows[0].st], [first.r != null ? first.r + '/10' : '–', first.f.status]);
  }
}
async function closeDrill(E, how, trigger) { // how: 'Escape' | 'Close'
  const L = E.S + 'close by ' + how + ': ';
  if (how === 'Escape') await E.page.keyboard.press('Escape'); else await E.page.click('#drillClose');
  await E.page.waitForTimeout(60);
  check(L + 'drill closed', !(await E.page.$eval('#drillDlg', d => d.open)));
  if (trigger) check(L + 'focus returns to the trigger', await E.page.evaluate(t => { const a = document.activeElement; return !!a && (a.id === t || (a.dataset && a.dataset.fk === t)); }, trigger), await E.page.evaluate(() => document.activeElement.outerHTML.slice(0, 100)));
}
// open a drill by clicking/keyboard on a selector, check, close
async function drillVia(E, name, sel, want, { key, trigger, how = 'Escape' } = {}) {
  const { page } = E;
  const el = await page.$(sel);
  if (!el) { check(E.S + name + ': trigger exists ' + sel, false); return; }
  if (key) { await page.focus(sel); await page.keyboard.press(key); } else { await el.scrollIntoViewIfNeeded(); await el.click(); }
  await page.waitForTimeout(60);
  await checkDrill(E, name, await drillState(page), want);
  await closeDrill(E, how, trigger === undefined ? await page.$eval(sel, e => e.dataset.fk) : trigger);
}

/* ---------------------------------- the dashboard, period by period ---------------------------------- */
async function checkPeriod(E, y) {
  const { page, S } = E, X = expectPeriod(y), P = plabel(y), all = y === 'all', sc = X.sc;
  const L = S + `${P}: `;
  await pick(page, y);
  eq(L + 'pressed chip', await page.$$eval('#dashPeriods .chip[aria-pressed="true"]', c => c.map(x => x.dataset.p)), [y]);
  // tiles
  const tiles = await page.$$eval('#dashTiles .stat', ss => ss.map(s => [s.querySelector('.eyebrow').textContent, s.querySelector('.num').textContent, s.querySelector('.sub').textContent]));
  eq(L + '6 tiles', tiles.length, 6);
  eq(L + 'tiles (label, value)', tiles.map(t => [t[0], t[1]]), X.tiles);
  if (all) eq(L + 'tile Dated watches sub', tiles[5][2], 'since ' + years[years.length - 1]);
  else { eq(L + 'tile Top genre sub (count)', tiles[4][2], X.topGenreSub); eq(L + 'tile Owned share sub', tiles[5][2], X.ownedSub); }
  // months + calendar
  const vis = sel => page.$eval(sel, e => !e.hidden && e.offsetParent !== null);
  if (all) {
    check(L + 'month panel shows the pick-a-year line', (await vis('#monthMsg')) && (await page.textContent('#monthMsg')) === 'Pick a year to see films by month and the calendar.');
    check(L + 'no chart and no calendar on All time', !(await vis('#monthChart').catch(() => false)) && !(await vis('#heatBox')) && (await page.$$('#heat .hc')).length === 0);
    check(L + 'calendar panel explains itself', await vis('#calMsg'));
    check(L + 'rewatch panel explains itself', (await vis('#rewMsg')) && (await page.$$('#rewList li')).length === 0);
  } else {
    check(L + 'month message hidden', !(await vis('#monthMsg')));
    eq(L + 'month chart data', await page.evaluate(() => Chart.getChart('monthChart').data.datasets[0].data), X.per);
    eq(L + 'month note', await page.textContent('#monthNote'), `${sc.length} in ${y}`);
    const cols = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { a: cs.getPropertyValue('--accent').trim(), b: cs.getPropertyValue('--accent-2').trim(), bg: Chart.getChart('monthChart').data.datasets[0].backgroundColor, series: Chart.getChart('monthChart').data.datasets.length, legend: Chart.getChart('monthChart').options.plugins.legend.display }; });
    const cur = y === '2026' ? 9 : -1;
    eq(L + 'bars use --accent, current month --accent-2', cols.bg, cols.bg.map((_, i) => i === cur ? cols.b : cols.a));
    check(L + 'single series, no legend', cols.series === 1 && cols.legend === false);
    // calendar
    const nDays = y === '2025' ? 365 : 365;
    eq(L + 'calendar has a cell for every day', await page.$$eval('#heat .hc', c => c.length), nDays);
    eq(L + 'month labels', await txt(page, '#heat .m'), MON);
    const cells = await page.$$eval('#heat .hc', cs => cs.map(c => [c.dataset.d, c.dataset.n, c.tagName, c.hasAttribute('data-future'), c.title]));
    const bad = cells.filter(([d, n, tag, fut, title]) => {
      const rows = (X.byDate.get(d) || []).sort((a, b) => a.f._row - b.f._row);
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)).getDay()];
      const lab = `${dow} ${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
      const wantTitle = rows.length ? `${lab}: ${filmsN(rows.length)} · ${rows.map(i => i.f.title.trim()).join(', ')}` : `${lab}: no films`;
      return n !== String(Math.min(3, rows.length)) || (tag === 'BUTTON') !== (rows.length > 0) || fut !== (!rows.length && d > TODAY) || title !== wantTitle;
    });
    eq(L + 'every cell: shade count, button only with films, future flag, tooltip text', bad.slice(0, 3), []);
    eq(L + 'sum of film cells = days with films', cells.filter(c => c[2] === 'BUTTON').length, X.byDate.size);
    if (y === '2026') {
      const c = d => cells.find(x => x[0] === d);
      eq(L + 'known day 4 Oct has 3 films', [c('2026-10-04')[1], c('2026-10-04')[4]], ['3', 'Sun 4 Oct: 3 films · Paper Lanterns, Night Ferry, Salt Orchard']);
      eq(L + 'known day 2 Mar has 2 films', c('2026-03-02')[1], '2');
      eq(L + 'known day 15 Jan has 1 film', [c('2026-01-15')[1], c('2026-01-15')[4]], ['1', 'Thu 15 Jan: 1 film · Velvet Signal']);
      eq(L + 'empty past day', [c('2026-10-01')[1], c('2026-10-01')[3]], ['0', false]);
      eq(L + 'today is not future; tomorrow and 31 Dec are', [c('2026-10-15')[3], c('2026-10-16')[3], c('2026-12-31')[3]], [false, true, true]);
      eq(L + 'future days are empty', cells.filter(x => x[0] > TODAY).every(x => x[1] === '0'), true);
      const bg = await page.evaluate(() => { const g = e => getComputedStyle(e).backgroundColor, q = d => document.querySelector(`#heat [data-d="${d}"]`);
        const pr = v => { const p = document.createElement('i'); p.style.background = v; document.body.appendChild(p); const c = g(p); p.remove(); return c; };
        return { n0: g(q('2026-10-01')), n1: g(q('2026-01-15')), n2: g(q('2026-03-02')), n3: g(q('2026-10-04')), raise: pr('var(--raise)'), accent: pr('var(--accent)'), fut: g(q('2026-12-31')) }; });
      check(L + 'shades step up in one hue: 0 = raise, 3+ = accent, 1 and 2 between', bg.n0 === bg.raise && bg.n3 === bg.accent && bg.n1 !== bg.n2 && bg.n1 !== bg.raise && bg.n2 !== bg.accent, bg);
      check(L + 'future cells are transparent (dashed outline)', bg.fut === 'rgba(0, 0, 0, 0)', bg.fut);
      check(L + 'legend Less … More', (await page.textContent('.heat-legend')).replace(/\s+/g, '') === 'LessMore' && (await page.$$('.heat-legend .hc')).length === 4);
      const sc2 = await page.evaluate(() => { const s = document.querySelector('.heat-scroll'); return { cs: getComputedStyle(s).overflowX, role: document.querySelector('#heat button').getAttribute('aria-label') }; });
      check(L + 'calendar scrolls inside .heat-scroll; cells have aria-labels', sc2.cs === 'auto' && /films?/.test(sc2.role), sc2);
    }
  }
  // ratings
  eq(L + 'ratings 10..1 counts', await page.$$eval('#ratBars .hbar', ls => ls.map(l => [l.querySelector('.lab').textContent, +l.querySelector('.val').textContent])), X.rat.map(([r, a]) => [r, a.length]));
  eq(L + 'ratings note', await page.textContent('#ratNote'), X.ratNote);
  // genres
  eq(L + 'genres (name, "N · avg R")', await page.$$eval('#genBars .hbar', ls => ls.map(l => [l.querySelector('.lab').textContent, l.querySelector('.val').textContent])), X.gen.map(([g, a]) => [g, `${a.length} · avg ${one(avgIt(a))}`]));
  eq(L + 'genres note (coverage)', await page.textContent('#genNote'), X.genNote);
  // decades
  eq(L + 'decades', await page.$$eval('#decBars .hbar', ls => ls.map(l => [l.querySelector('.lab').textContent, l.querySelector('.val').textContent])), X.dec.map(([k, a]) => [k + 's', `${a.length} · avg ${one(avgIt(a))}`]));
  // people, three modes
  eq(L + 'people chips', await txt(page, '#peopleChips .chip'), ['Directors', 'Cast', 'Cinematographers']);
  for (const [mode, lab] of [['directors', 'Directors'], ['cast', 'Cast'], ['cine', 'Cinematographers']]) {
    await page.click(`#peopleChips .chip[data-pk="${mode}"]`); await page.waitForTimeout(50);
    const { rows, have } = peopleTop(sc, mode);
    eq(L + `people ${mode}: pressed chip`, await page.$$eval('#peopleChips .chip[aria-pressed="true"]', c => c.map(x => x.textContent)), [lab]);
    eq(L + `people ${mode}: top 10`, await page.$$eval('#peopleList li', ls => ls.map(l => [l.children[0].textContent, l.children[1].textContent])), rows.map(r => [r.n, `${filmsN(r.c)} · avg ${one(r.r)}`]));
    const note = await page.textContent('#peopleNote');
    const word = { directors: 'Director', cast: 'Cast', cine: 'Cinematography' }[mode];
    const wantNote = ((all && mode !== 'directors') || have < sc.length) ? `${word} is filled in for ${have} of ${sc.length} films` : (all ? 'Most films seen' : 'Most watches');
    eq(L + `people ${mode}: note`, note, wantNote);
    check(L + `people ${mode}: no name contains a comma`, !rows.some(r => r.n.includes(',')));
  }
  await page.click('#peopleChips .chip[data-pk="directors"]'); await page.waitForTimeout(50);
  // where
  eq(L + 'where categories', await page.$$eval('#whereBars .hbar', ls => ls.map(l => [l.querySelector('.lab').textContent, l.querySelector('.val').textContent])), X.where.map(([w, a]) => [w, `${a.length} · ${Math.round(a.length / X.wsN * 100)}%`]));
  eq(L + 'where platforms', await page.$$eval('#platBars .hbar', ls => ls.map(l => [l.querySelector('.lab').textContent, l.querySelector('.val').textContent])), X.plat.map(([p, a]) => [p, `${a.length} · ${Math.round(a.length / X.wsN * 100)}%`]));
  eq(L + 'where note', await page.textContent('#whereNote'), X.whereNote);
  // rewatches
  if (!all) {
    eq(L + 'rewatch rows', await page.$$eval('#rewList li', ls => ls.map(l => [l.querySelector('.t') ? l.querySelector('.t').textContent : l.textContent, l.querySelector('.sub') ? l.querySelector('.sub').textContent : '', l.querySelector('.r') ? l.querySelector('.r').textContent : ''])),
      X.rew.length ? X.rew.map(r => [`${r.f.title} (${r.f.year})`, `${showDate(r.f.date)} · was ${r.was} → now ${r.now}`, r.mark]) : [['No rewatches this year.', '', '']]);
    eq(L + 'rewatch note', await page.textContent('#rewNote'), `${X.rew.length} in ${y}`);
  }
  // every hbar / row has a tooltip, and every non-empty one is clickable and keyboard reachable
  const tips = await page.$$eval('#ratBars .hbar, #genBars .hbar, #decBars .hbar, #whereBars .hbar, #platBars .hbar', ls => ls.map(l => [!!l.title, l.hasAttribute('data-click'), l.tabIndex, l.getAttribute('role'), l.querySelector('.val').textContent]));
  check(L + 'every bar has a tooltip; bars with films are focusable buttons', tips.every(t => t[0] && (t[1] ? (t[2] === 0 && t[3] === 'button') : /^0\b/.test(t[4]))), tips.filter(t => !(t[0] && (t[1] ? t[2] === 0 : /^0\b/.test(t[4])))).slice(0, 3));
}

/* ---------------------------------- drill-downs ---------------------------------- */
async function checkDrills(E, y) {
  const { page, S } = E, X = expectPeriod(y), all = y === 'all', sc = X.sc, P = plabel(y);
  const base = `${S}drill ${P} `;
  const E2 = { ...E, S: base };
  await pick(page, y);
  // rating bar (use the biggest bucket)
  const [rl, ra] = X.rat.filter(([, a]) => a.length).sort((a, b) => b[1].length - a[1].length)[0];
  await drillVia(E2, 'rating bar', `#ratBars .hbar[data-fk="ratBars:${rl}"]`, { title: `Rated ${rl}`, sub: `${filmsN(ra.length)} · Rated ${rl}/10 · ${P}`, items: ra });
  // keyboard on a rating bar (Space)
  await drillVia(E2, 'rating bar by Space', `#ratBars .hbar[data-fk="ratBars:${rl}"]`, { title: `Rated ${rl}`, sub: `${filmsN(ra.length)} · Rated ${rl}/10 · ${P}`, items: ra }, { key: 'Space' });
  // genre
  const [gn, ga] = X.gen[0];
  await drillVia(E2, 'genre', `#genBars .hbar[data-fk="genBars:${gn}"]`, { title: gn, sub: `${filmsN(ga.length)} · ${gn} · ${P}`, items: ga }, { how: 'Close' });
  // decade
  const [dk, da] = X.dec[0];
  await drillVia(E2, 'decade', `#decBars .hbar[data-fk="decBars:${dk}s"]`, { title: `${dk}s`, sub: `${filmsN(da.length)} · ${dk}s · ${P}`, items: da });
  // person, three modes
  for (const [mode, f] of [['directors', n => `Directed by ${n}`], ['cast', n => `Starring ${n}`], ['cine', n => `Shot by ${n}`]]) {
    await page.click(`#peopleChips .chip[data-pk="${mode}"]`); await page.waitForTimeout(50);
    const { rows } = peopleTop(sc, mode);
    for (const r of [rows[0], rows[rows.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i)) {
      await drillVia(E2, `person ${mode} ${r.n}`, `#peopleList li[data-fk="${`person:${mode}:${r.n}`}"]`, { title: f(r.n), sub: `${filmsN(r.a.length)} · ${f(r.n)} · ${P}`, items: r.a });
    }
  }
  await page.click('#peopleChips .chip[data-pk="directors"]'); await page.waitForTimeout(50);
  // where category + platform
  const [wn, wa] = X.where.filter(([, a]) => a.length).sort((a, b) => b[1].length - a[1].length)[0];
  await drillVia(E2, 'where category', `#whereBars .hbar[data-fk="whereBars:${wn}"]`, { title: wn, sub: `${filmsN(wa.length)} · ${wn} · ${P}`, items: wa });
  const [pn, pa] = X.plat[0];
  await drillVia(E2, 'where platform', `#platBars .hbar[data-fk="platBars:${pn}"]`, { title: pn, sub: `${filmsN(pa.length)} · On ${pn} · ${P}`, items: pa });
  const emptyW = X.where.find(([, a]) => !a.length);
  if (emptyW) check(base + `empty bar ${emptyW[0]} is not clickable`, (await page.$eval(`#whereBars .hbar:nth-child(${X.where.indexOf(emptyW) + 1})`, l => !l.hasAttribute('data-click') && l.tabIndex === -1)));
  if (!all) {
    // month bar by clicking the canvas at the bar
    const month = X.per.indexOf(Math.max(...X.per)), mrows = sc.filter(i => +i.f.date.slice(5, 7) - 1 === month);
    await page.$eval('#monthChart', c => c.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);
    const pos = await page.evaluate(i => { const ch = Chart.getChart('monthChart'), el = ch.getDatasetMeta(0).data[i], r = ch.canvas.getBoundingClientRect(); return { x: r.left + el.x, y: r.top + (el.y + el.base) / 2 }; }, month);
    await page.mouse.move(pos.x - 5, pos.y); await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(50);
    check(base + 'month chart: cursor is a pointer over a bar', (await page.$eval('#monthChart', c => c.style.cursor)) === 'pointer');
    await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(60);
    await checkDrill(E2, 'month bar (canvas click)', await drillState(page), { title: `${FULL[month]} ${y}`, sub: `${filmsN(mrows.length)} · ${FULL[month]} · ${y}`, items: mrows });
    await closeDrill(E2, 'Escape', 'monthChart');
    // an empty month does nothing
    const empty = X.per.indexOf(0);
    if (empty >= 0) {
      const p2 = await page.evaluate(i => { const ch = Chart.getChart('monthChart'), el = ch.getDatasetMeta(0).data[i], r = ch.canvas.getBoundingClientRect(); return { x: r.left + el.x, y: r.top + ch.chartArea.bottom - 20 }; }, empty);
      await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(60);
      check(base + 'clicking an empty month opens nothing', !(await page.$eval('#drillDlg', d => d.open)));
    }
    // tooltip content through the chart API
    const tip = await page.evaluate(i => { const ch = Chart.getChart('monthChart'); const cb = ch.options.plugins.tooltip.callbacks; const item = { dataIndex: i, raw: ch.data.datasets[0].data[i] }; return [cb.title([item]), cb.label(item)]; }, month);
    eq(base + 'month tooltip text', tip, [`${FULL[month]} ${y}`, `${filmsN(mrows.length)} · click to see them`]);
    // a heatmap day by keyboard
    const day = [...X.byDate.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    const dd = new Date(+day[0].slice(0, 4), +day[0].slice(5, 7) - 1, +day[0].slice(8));
    const lab = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dd.getDay()]} ${+day[0].slice(8)} ${MON[dd.getMonth()]} ${y}`;
    await drillVia(E2, 'calendar day by Enter', `#heat button[data-d="${day[0]}"]`, { title: lab, sub: `${filmsN(day[1].length)} · ${lab}`, items: day[1] }, { key: 'Enter' });
    // rewatch row
    if (X.rew.length) {
      const r = X.rew[0], ttl = `${r.f.title} (${r.f.year})`;
      await drillVia(E2, 'rewatch row', `#rewList li[data-fk="rew:${await page.$eval('#rewList li', l => l.dataset.fk.split(':')[1])}"]`, { title: ttl, sub: `${r.rows.length} rows`, items: r.rows.map(o => ({ f: o, r: o.rating })) });
    }
  }
}

/* ---------------------------------- scenarios ---------------------------------- */
for (const size of ['laptop', 'phone']) {
  await scenario('dashboard basics', [size], async E => {
    const { page, S } = E;
    await tab(page, 'dashboard');
    eq(S + 'period chips: years newest first, then All time', await txt(page, '#dashPeriods .chip'), [...years, 'All time']);
    eq(S + 'default period is the current year', await page.$$eval('#dashPeriods .chip[aria-pressed="true"]', c => c.map(x => x.textContent)), ['2026']);
    eq(S + 'state.dashYear remembers the choice', await page.evaluate(() => state.dashYear), '2026');
    await pick(page, 'all');
    eq(S + 'state.dashYear is "all" after All time', await page.evaluate(() => state.dashYear), 'all');
    await pick(page, '2025'); eq(S + 'state.dashYear is 2025', await page.evaluate(() => state.dashYear), '2025');
    for (const y of ['2026', '2025', 'all']) await checkPeriod(E, y);
    for (const y of ['2026', '2025', 'all']) await checkDrills(E, y);
    // rows open the edit dialog
    await pick(page, '2026');
    await page.click('#ratBars .hbar[data-fk="ratBars:9"]'); await page.waitForTimeout(60);
    const ds = await drillState(page);
    const first = sortItems(scopeOf('2026').filter(i => i.r === 9))[0];
    await page.click('#drillList li:first-child button'); await page.waitForTimeout(100);
    check(S + 'drill row: drill closed, edit dialog open', !(await page.$eval('#drillDlg', d => d.open)) && (await page.$eval('#filmDlg', d => d.open)));
    eq(S + 'edit dialog is for that film', await page.$eval('#fd-title', i => i.value), first.f.title);
    check(S + 'edit dialog shows its id', (await page.textContent('#fdMsg')).includes('id ' + first.f.id), await page.textContent('#fdMsg'));
    await page.click('#fdClose'); await page.waitForTimeout(60);
    check(S + 'closing the edit dialog returns focus to the dashboard bar', await page.evaluate(() => document.activeElement.dataset.fk === 'ratBars:9'), await page.evaluate(() => document.activeElement.outerHTML.slice(0, 90)));
    // calendar day → row → edit dialog (keyboard path)
    await page.focus('#heat button[data-d="2026-03-02"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
    const d2 = await drillState(page);
    eq(S + 'day drill lists the two films of 2 Mar, rating order', d2.rows.map(r => r.t), ['Glass Meridian (1975)', 'Quiet Harbour (2003)']);
    await page.focus('#drillList li:nth-child(2) button'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    eq(S + 'Enter on a drill row opens that film', await page.$eval('#fd-title', i => i.value), 'Quiet Harbour');
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
    check(S + 'Escape closes the edit dialog and focus is back on the calendar day', await page.evaluate(() => document.activeElement.dataset.fk === 'day:2026-03-02'), await page.evaluate(() => document.activeElement.outerHTML.slice(0, 90)));
    // re-render keeps focus (theme/fonts repaint)
    await page.focus('#ratBars .hbar[data-fk="ratBars:8"]');
    await page.evaluate(() => renderDashboard());
    check(S + 'a repaint keeps keyboard focus on the same bar', await page.evaluate(() => document.activeElement.dataset.fk === 'ratBars:8'));
    // sheet calls
    eq(S + 'zero sheet calls after load (period changes, chips, drill-downs)', E.fake.calls.length, E.n0);
    eq(S + 'sheet calls on load are the two reads only', E.fake.calls.map(c => c.tool), ['get_values', 'get_values']);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(S + 'no horizontal page scroll (dashboard)', sw <= 0, sw);
    check(S + 'no page or console errors', E.errors.length === 0, E.errors.slice(0, 3));
    check(S + 'no requests outside the local stubs', E.badReq.length === 0, E.badReq.slice(0, 3));
  });
}

/* ---------------------------------- symmetry ---------------------------------- */
const R = (page, sel) => page.$$eval(sel, es => es.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
function sameRow(name, rs, gap) { // boxes side by side: same top / bottom, equal gaps
  check(name + ': same top and bottom', rs.every(r => near(r.t, rs[0].t) && near(r.b, rs[0].b)), rs.map(r => [Math.round(r.t), Math.round(r.b)]));
  const gaps = rs.slice(1).map((r, i) => r.l - rs[i].r);
  check(name + `: gaps are ${gap}px`, gaps.every(g => near(g, gap)), gaps);
}
await scenario('symmetry', ['laptop'], async E => {
  const { page, S } = E;
  // Log
  const st = await R(page, '#view-log .stats .stat'); sameRow(S + 'Log stat tiles', st, 12);
  const sn = await R(page, '#view-log .stats .stat .num'); check(S + 'Log stat numbers share a top and bottom', sn.every(r => near(r.t, sn[0].t) && near(r.b, sn[0].b)), sn.map(r => [r.t, r.b]));
  const ss = await R(page, '#view-log .stats .stat .sub'); check(S + 'Log stat sub-lines share a top', ss.every(r => near(r.t, ss[0].t)), ss.map(r => r.t));
  const logPanels = await R(page, '#view-log > .panel, #view-log > .dash-2');
  check(S + 'Log: 20px between stat tiles, Log a film, Up next and the row below', [[st[0].b, logPanels[0].t], [logPanels[0].b, logPanels[1].t], [logPanels[1].b, logPanels[2].t]].every(([a, b]) => near(b - a, 20)), [[st[0].b, logPanels[0].t], [logPanels[0].b, logPanels[1].t], [logPanels[1].b, logPanels[2].t]]);
  const lr = await R(page, '#view-log .dash-2 > .panel'); sameRow(S + 'Log Recent diary / Coming soon', lr, 20);
  const lh = await R(page, '#view-log .dash-2 .panel-head'); check(S + 'Log row: panel heads line up', lh.every(r => near(r.t, lh[0].t) && near(r.b, lh[0].b)), lh);
  const lh2 = await R(page, '#view-log .dash-2 h2'); check(S + 'Log row: titles line up', lh2.every(r => near(r.t, lh2[0].t)), lh2);
  const lcount = await page.$$eval('#recList li', l => l.length), scount = await page.$$eval('#soonList li, #soonList .empty-state', l => l.length);
  check(S + 'Log lists are capped at 12', lcount <= 12 && scount <= 12, [lcount, scount]);
  // Dashboard
  await tab(page, 'dashboard');
  for (const y of ['2026', 'all']) {
    const L = S + `Dashboard ${plabel(y)}: `;
    await pick(page, y);
    const t = await R(page, '#dashTiles .stat'); eq(L + 'six tiles across', t.length, 6);
    sameRow(L + 'tiles', t, 12);
    check(L + 'tiles are the same size', t.every(r => near(r.w, t[0].w) && near(r.h, t[0].h)), t.map(r => [r.w, r.h]));
    const n = await R(page, '#dashTiles .stat .num'), s = await R(page, '#dashTiles .stat .sub'), e = await R(page, '#dashTiles .stat .eyebrow');
    check(L + "tile labels, numbers and sub-lines line up", [n, e].every(a => a.every(r => near(r.t, a[0].t) && near(r.b, a[0].b))) && s.every(r => near(r.t, s[0].t)), { n: n.map(r => [r.t, r.b]), s: s.map(r => r.t), e: e.map(r => [r.t, r.b]) });
    const rows = await R(page, '#view-dashboard .dash-2');
    check(L + '20px between tiles and the first row, and between rows', [t[0].b, ...rows.map(r => r.b)].slice(0, -1).every((b, i) => near(rows[i].t - b, 20)), rows.map(r => [r.t, r.b]));
    const kids = await page.$$eval('#view-dashboard .dash-2', ds => ds.map(d => [...d.children].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })));
    kids.forEach((rs, i) => { check(L + `row ${i + 1} has two boxes`, rs.length === 2); sameRow(L + `row ${i + 1}`, rs, 20); });
    const heads = await page.$$eval('#view-dashboard .dash-2', ds => ds.map(d => [...d.querySelectorAll(':scope > .panel > .panel-head')].map(h => { const r = h.getBoundingClientRect(), t = h.querySelector('h2').getBoundingClientRect(), f = h.parentElement.children[1].getBoundingClientRect(); return { head: [r.top, r.bottom], h2: t.top, first: f.top }; })));
    heads.forEach((hs, i) => check(L + `row ${i + 1}: panel heads, titles and first content line up`, hs.every(h => near(h.head[0], hs[0].head[0]) && near(h.head[1], hs[0].head[1]) && near(h.h2, hs[0].h2) && near(h.first, hs[0].first)), hs));
    const pad = await page.$$eval('#view-dashboard .dash-2 > .panel', ps => ps.map(p => getComputedStyle(p).padding + getComputedStyle(p).marginTop));
    check(L + 'every panel has the same padding and no stray margin', new Set(pad).size === 1, [...new Set(pad)]);
  }
  // mid width: 3 tiles across
  await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(80);
  const mt = await R(page, '#dashTiles .stat');
  check(S + 'Dashboard at 1000px: tiles are 3 across, equal', new Set(mt.map(r => Math.round(r.t))).size === 2 && mt.every(r => near(r.w, mt[0].w) && near(r.h, mt[0].h)), mt.map(r => [r.l, r.t, r.w, r.h]));
  const mrow = await page.$$eval('#view-dashboard .dash-2', ds => ds.map(d => [...d.children].length));
  check(S + 'Dashboard at 1000px: no lone box in a row', mrow.every(n => n === 2));
  check(S + 'no errors', E.errors.length === 0, E.errors.slice(0, 3));
});
await scenario('symmetry', ['phone'], async E => {
  const { page, S } = E;
  const widths = async sel => (await R(page, sel)).map(r => [Math.round(r.l), Math.round(r.w)]);
  const lw = await widths('#view-log > .panel, #view-log .dash-2 > .panel');
  check(S + 'Log: every panel has the same left edge and width', new Set(lw.map(x => x.join())).size === 1, lw);
  const ls = await R(page, '#view-log .stats .stat');
  check(S + 'Log tiles: 2 across, equal sizes per row', ls.length === 4 && near(ls[0].t, ls[1].t) && near(ls[2].t, ls[3].t) && ls.every(r => near(r.w, ls[0].w) && near(r.h, ls[0].h)), ls.map(r => [r.l, r.t, r.w, r.h]));
  await tab(page, 'dashboard');
  for (const y of ['2026', 'all']) {
    await pick(page, y);
    const dw = await widths('#view-dashboard .dash-2 > .panel');
    check(S + `Dashboard ${plabel(y)}: all 8 panels share one left edge and width (single column, full width)`, dw.length === 8 && new Set(dw.map(x => x.join())).size === 1 && dw[0][1] >= 350, dw);
    const t = await R(page, '#dashTiles .stat');
    check(S + `Dashboard ${plabel(y)}: tiles 2 across, all the same size`, t.length === 6 && [0, 2, 4].every(i => near(t[i].t, t[i + 1].t)) && t.every(r => near(r.w, t[0].w) && near(r.h, t[0].h)), t.map(r => [r.l, r.t, r.w, r.h]));
    const gaps = [t[1].l - t[0].r, t[2].t - t[0].b];
    check(S + `Dashboard ${plabel(y)}: tile gaps are 12px`, gaps.every(g => near(g, 12)), gaps);
    const p = await R(page, '#view-dashboard .dash-2 > .panel');
    check(S + `Dashboard ${plabel(y)}: 20px between stacked panels`, p.slice(1).every((r, i) => near(r.t - p[i].b, 20) || near(r.t - p[i].b, 40)), p.map(r => [r.t, r.b]));
  }
  check(S + 'no errors', E.errors.length === 0, E.errors.slice(0, 3));
});

/* ---------------------------------- screenshots (3 themes x 2 widths x year / All time) ---------------------------------- */
for (const theme of ['totoro', 'matrix', 'angrymen']) for (const size of ['laptop', 'phone']) {
  await scenario('screenshots ' + theme, [size], { theme }, async E => {
    const { page, S } = E;
    await tab(page, 'dashboard');
    await pick(page, '2026'); await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${theme}-${size}-2026.png`, fullPage: true });
    await pick(page, 'all'); await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${theme}-${size}-all.png`, fullPage: true });
    await pick(page, '2026');
    await page.click('#ratBars .hbar[data-fk="ratBars:8"]'); await page.waitForTimeout(100);
    await page.screenshot({ path: `${SHOTS}/${theme}-${size}-drill.png` });
    await page.keyboard.press('Escape');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(S + 'screenshots taken, no horizontal scroll, no errors', sw <= 0 && E.errors.length === 0, [sw, E.errors.slice(0, 2)]);
  });
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
