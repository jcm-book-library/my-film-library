// Stage 1 headless tests for app.html (Log / Library / Dashboard). Run: node tests/stage1.test.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture, emptyFixture } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app.html');
const SHOTS = process.env.SHOTS_DIR || '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvl-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', 'TESTSHEETID000000000000000000000000') + '</body></html>');

const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const OK_RANGES = new Set(["'🎥'!A1:R6000", "'🎥 Settings'!A1:C50"]);
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// mode: 'ok' | 'error' | 'none' (no window.claude)
async function open(size, fixture, mode = 'ok') {
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1 });
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|accounts\.google\.com/, r => {
    const u = r.request().url();
    r.fulfill({ status: 200, contentType: u.endsWith('.js') || u.includes('gsi') ? 'application/javascript' : 'text/css', body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (mode !== 'none') {
    await page.addInitScript(({ films, settings, mode }) => {
      window.__calls = [];
      window.claude = { use: async name => name === 'mcp' ? { callTool: async (server, tool, input) => {
        window.__calls.push({ server, tool, range: input && input.range });
        if (mode === 'error') throw { code: 'server_not_connected' };
        if (tool === 'get_values' && input.range === "'🎥'!A1:R6000") return { payload: { values: films } };
        if (tool === 'get_values' && input.range === "'🎥 Settings'!A1:C50") return { payload: { values: settings } };
        throw { code: 'tool_error', message: 'unexpected call' };
      } } : null };
    }, { films: fixture.films, settings: fixture.settings, mode });
  }
  await page.goto('file://' + PAGE);
  if (mode !== 'none') await page.waitForFunction(() => { const s = document.getElementById('status'); return s && s.dataset.state !== 'loading'; }, null, { timeout: 8000 }).catch(() => {});
  return { page, ctx, errors };
}
const tab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(80); };
const texts = (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.trim()));

/* ---------- independent expectations computed from the raw fixture ---------- */
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseD = s => { const m = s && s.match(/^(\d+)-(\w{3})-(\d{4})$/); return m ? `${m[3]}-${pad(MON.indexOf(m[2]) + 1)}-${pad(m[1])}` : ''; };
const norm = t => t.toLowerCase().replace(/\s+/g, ' ').trim();
const rnd1 = v => (Math.round(v * 10) / 10).toFixed(1);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function expectations(fx) {
  const t = fx.today, Y = String(t.getFullYear()), M = `${Y}-${pad(t.getMonth() + 1)}`, todayIso = `${M}-${pad(t.getDate())}`;
  const recs = fx.records.map(r => ({ ...r, title: r.title.trim(), iso: parseD(r.date), key: norm(r.title) + '|' + (parseFloat(r.year) || '') }));
  const diary = recs.filter(r => r.status === 'Watched' && r.iso);
  const yr = diary.filter(r => r.iso.startsWith(Y)), mo = diary.filter(r => r.iso.startsWith(M));
  const rated = yr.filter(r => r.rating !== '').map(r => Number(r.rating));
  const last = [...diary].sort((a, b) => a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : b._row - a._row);
  const byKey = new Map(); for (const r of recs) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  const seen = [];
  for (const [key, rows] of byKey) {
    const s = rows.filter(r => r.status === 'Watched'); if (!s.length) continue;
    const dated = s.filter(r => r.iso).sort((a, b) => a.iso < b.iso ? 1 : -1);
    const rep = dated[0] || s[0];
    const rt = rep.rating !== '' ? Number(rep.rating) : (s.find(r => r.rating !== '') ? Number(s.find(r => r.rating !== '').rating) : null);
    seen.push({ key, rep, rating: rt, year: parseFloat(rep.year) });
  }
  const dirs = rep => rep.director.split(',').map(s => s.trim()).filter(Boolean);
  const dm = new Map(); for (const s of seen) for (const n of dirs(s.rep)) { if (!dm.has(n)) dm.set(n, []); dm.get(n).push(s.rating); }
  const topDirs = [...dm.entries()].map(([n, a]) => { const r = a.filter(x => x != null); return { n, c: a.length, r: r.length ? mean(r) : null }; })
    .sort((a, b) => b.c - a.c || (b.r ?? 0) - (a.r ?? 0) || a.n.localeCompare(b.n)).slice(0, 10);
  const dec = new Map(); for (const s of seen) { if (!Number.isFinite(s.year)) continue; const k = Math.floor(s.year / 10) * 10; if (!dec.has(k)) dec.set(k, []); dec.get(k).push(s.rating); }
  return { Y, M, todayIso, recs, diary, yr, mo, rated, last, seen, topDirs, dec, dirs,
    ratedSeen: seen.filter(s => s.rating != null).map(s => s.rating),
    rewatchesInYear: yr.filter(r => byKey.get(r.key).filter(o => o.status === 'Watched').length > 1).length,
    directorSet: new Set(seen.flatMap(s => dirs(s.rep))) };
}

async function overflowReport(page) {
  return page.evaluate(() => {
    const W = window.innerWidth, bad = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('.table-wrap, .tabs, .heat-scroll, dialog:not([open]), script, style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > W + 1) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} right=${Math.round(r.right)}`);
    }
    return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 8) };
  });
}

const fx = buildFixture();
const E = expectations(fx);
const bigFx = buildFixture({ extra: 170 });

for (const size of ['laptop', 'phone']) {
  const S = `[${size}] `;
  /* 1. load + 2. overflow + 3. log + screenshots */
  {
    const { page, ctx, errors } = await open(size, fx);
    const status = await page.textContent('#statusText');
    check(S + '1 status says Live from your sheet', /^Live from your sheet/.test(status), status);
    check(S + '1 data-state is live', (await page.getAttribute('#status', 'data-state')) === 'live');
    const calls = await page.evaluate(() => window.__calls);
    check(S + '1 only get_values on Google Sheets', calls.length > 0 && calls.every(c => c.tool === 'get_values' && c.server === 'Google Sheets'), calls);
    check(S + '1 only the two allowed ranges, each requested', calls.every(c => OK_RANGES.has(c.range)) && new Set(calls.map(c => c.range)).size === 2, calls.map(c => c.range));
    check(S + '1 no write calls', !calls.some(c => /update|append|clear|insert/.test(c.tool)));
    check(S + '1 no console errors / pageerrors', errors.length === 0, errors);
    check(S + '1 app name from settings in title', (await page.title()) === 'Film Vault' && (await page.textContent('#wordmark')) === 'Film Vault');

    // 3 Log
    eq(S + '3 tile: films this year', await page.textContent('#sYear'), String(E.yr.length));
    check(S + '3 tile: goal sub', /of 120 goal/.test(await page.textContent('#sYearSub')), await page.textContent('#sYearSub'));
    eq(S + '3 tile: films this month', await page.textContent('#sMonth'), String(E.mo.length));
    eq(S + '3 tile: average rating', await page.textContent('#sAvg'), rnd1(mean(E.rated)));
    check(S + '3 tile: avg sub counts rated films', (await page.textContent('#sAvgSub')).includes(`${E.rated.length} rated`), await page.textContent('#sAvgSub'));
    eq(S + '3 tile: last film = Today (fixture has a row dated today)', await page.textContent('#sLast'), 'Today');
    check(S + '3 tile: month label', (await page.textContent('#sMonthLabel')) === ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][fx.today.getMonth()]);
    const ups = E.recs.filter(r => r.plan === 'Up next').sort((a, b) => Number(a.order) - Number(b.order));
    const upNums = await texts(page, '#upList li .n'), upTitles = await texts(page, '#upList li .t');
    eq(S + '3 up next numbers 1..10', upNums, Array.from({ length: 10 }, (_, i) => String(i + 1)));
    eq(S + '3 up next titles in Order', upTitles, ups.slice(0, 10).map(r => r.title));
    eq(S + '3 up next note', await page.textContent('#upNote'), '10 of 13 · 3 more waiting');
    const whys = await texts(page, '#upList li .why');
    eq(S + '3 up next why text shown', whys, ups.slice(0, 10).map(r => r.why));
    // recent diary
    const exp12 = E.last.slice(0, 12);
    eq(S + '3 recent diary titles newest first (ties: later sheet row first)', await texts(page, '#recList li .t'), exp12.map(r => r.title));
    const subs = (await texts(page, '#recList li .sub')).map(s => s.split(' · ')[0]);
    eq(S + '3 recent diary dates', subs, exp12.map(r => `${Number(r.iso.slice(8))} ${MON[Number(r.iso.slice(5, 7)) - 1]}`));
    check(S + '3 recent diary first item is dated today', exp12[0].iso === E.todayIso && subs[0] === `${fx.today.getDate()} ${MON[fx.today.getMonth()]}`, subs[0]);
    eq(S + '3 recent note', await page.textContent('#recNote'), `${E.diary.length} dated in total`);
    const soon = E.recs.filter(r => r.status === 'Coming Soon');
    eq(S + '3 coming soon titles', await texts(page, '#soonList li .t'), soon.map(r => r.title));
    eq(S + '3 coming soon release values', await texts(page, '#soonList li .r'), soon.map(r => r.release));
    // 2 overflow + screenshot
    let o = await overflowReport(page);
    check(S + '2 Log: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    await page.screenshot({ path: `${SHOTS}/${size}-log.png`, fullPage: true });
    await tab(page, 'library');
    o = await overflowReport(page);
    check(S + '2 Library: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    await page.screenshot({ path: `${SHOTS}/${size}-library.png`, fullPage: true });
    await tab(page, 'dashboard');
    o = await overflowReport(page);
    check(S + '2 Dashboard: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    await page.screenshot({ path: `${SHOTS}/${size}-dashboard.png`, fullPage: true });
    check(S + '2 no errors after visiting all tabs', errors.length === 0, errors);
    await ctx.close();
  }

  /* 3b days since last film when nothing is dated today */
  {
    const fx2 = buildFixture({ noToday: true }); const E2 = expectations(fx2);
    const { page, ctx } = await open(size, fx2);
    const days = Math.round((new Date(fx2.today.getFullYear(), fx2.today.getMonth(), fx2.today.getDate()) - new Date(E2.last[0].iso + 'T00:00:00')) / 864e5);
    const want = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days + ' days';
    eq(S + '3 tile: days since last film (no row today)', await page.textContent('#sLast'), want);
    eq(S + '3 tile: last film sub = title', await page.textContent('#sLastSub'), E2.last[0].title);
    await ctx.close();
  }

  /* 4. Library */
  {
    const { page, ctx, errors } = await open(size, fx);
    await tab(page, 'library');
    const rowsN = () => page.$$eval('#libBody tr.row', r => r.length);
    const rowTitles = () => texts(page, '#libBody tr.row .t');
    const R = E.recs;
    eq(S + '4 initial row count = all fixture rows', await rowsN(), R.length);
    check(S + '4 count text', (await page.textContent('#libCount')).startsWith(`Showing ${R.length} of ${R.length} films`), await page.textContent('#libCount'));
    const sheetOrder = [...R].sort((a, b) => a._row - b._row).map(r => r.title);
    eq(S + '4 default = sheet order', await rowTitles(), sheetOrder);
    // search
    const search = async q => { await page.fill('#libSearch', q); await page.waitForTimeout(350); };
    const hasQ = (r, q) => [r.title, r.director, r.starring, r.cinematography, r.genre, r.year].some(v => String(v).toLowerCase().includes(q));
    for (const [label, q] of [['title', 'silver'], ['director', 'teo hartley'], ['accent director', 'cuarón'], ['cast', 'odalys brenner']]) {
      await search(q);
      const want = R.filter(r => hasQ(r, q)).length;
      check(S + `4 search by ${label} ("${q}")`, want > 0 && (await rowsN()) === want, `rows ${await rowsN()} expected ${want}`);
    }
    await search('zzzz-nothing');
    check(S + '4 search with no hit shows empty state', (await page.textContent('#libBody')).includes('No films match'), await page.textContent('#libBody'));
    await search('');
    // chips
    const statuses = ['Watched', 'Watchlist', 'Next Up', 'Rewatch', 'Coming Soon', 'In Development', 'Unavailable'];
    const chipTxt = await texts(page, '#libChips .chip');
    const wantChips = ['All' + R.length, ...statuses.map(s => s + R.filter(r => r.status === s).length)];
    eq(S + '4 status chips and counts', chipTxt, wantChips);
    for (const s of statuses) {
      await page.click(`#libChips .chip[data-st="${s}"]`);
      const want = R.filter(r => r.status === s).length;
      const pills = new Set(await texts(page, '#libBody tr.row .pill'));
      check(S + `4 chip "${s}" filters rows`, (await rowsN()) === want && pills.size === 1 && pills.has(s), `rows ${await rowsN()} expected ${want} pills ${[...pills]}`);
    }
    await page.click('#libChips .chip[data-st="All"]');
    // selects
    const g = 'Drama', pl = 'Streamo';
    await page.selectOption('#libGenre', g);
    check(S + '4 genre select', (await rowsN()) === R.filter(r => r.genre === g).length && (await texts(page, '#libBody tr.row .c-gen')).every(x => x === g));
    await page.selectOption('#libGenre', '');
    await page.selectOption('#libPlatform', pl);
    check(S + '4 platform select', (await rowsN()) === R.filter(r => r.platform === pl).length && (await texts(page, '#libBody tr.row .c-plat')).every(x => x === pl));
    await page.selectOption('#libPlatform', '');
    for (const [v, fn] of [['Owned', r => r.purchase === 'Owned'], ['To Purchase', r => r.purchase === 'To Purchase'], ['None', r => !r.purchase]]) {
      await page.selectOption('#libOwned', v);
      eq(S + `4 owned select "${v}"`, await rowsN(), R.filter(fn).length);
    }
    await page.selectOption('#libOwned', '');
    await page.selectOption('#libGenre', 'Drama'); await page.click('#libChips .chip[data-st="Watched"]');
    eq(S + '4 combined filters (genre + status)', await rowsN(), R.filter(r => r.genre === 'Drama' && r.status === 'Watched').length);
    await page.selectOption('#libGenre', ''); await page.click('#libChips .chip[data-st="All"]');
    // sorting
    const cmpLow = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const byTitle = dir => [...R].sort((a, b) => cmpLow(a.title.toLowerCase(), b.title.toLowerCase()) * dir || a._row - b._row).map(r => r.title);
    await page.click('th[data-k="title"]');
    eq(S + '4 sort title 1st click ascending', await rowTitles(), byTitle(1));
    check(S + '4 aria-sort ascending', (await page.getAttribute('th[data-k="title"]', 'aria-sort')) === 'ascending');
    await page.click('th[data-k="title"]');
    eq(S + '4 sort title 2nd click reversed', await rowTitles(), byTitle(-1));
    check(S + '4 aria-sort descending', (await page.getAttribute('th[data-k="title"]', 'aria-sort')) === 'descending');
    await page.click('th[data-k="title"]');
    eq(S + '4 sort title 3rd click returns to sheet order', await rowTitles(), sheetOrder);
    check(S + '4 no aria-sort left, back-to-sheet button hidden', (await page.$('th[aria-sort]')) === null && await page.isHidden('#libSheetOrder'));
    await page.click('th[data-k="rating"]');
    let rts = (await texts(page, '#libBody tr.row .num')).map(x => x === '' ? -1 : parseFloat(x));
    check(S + '4 sort rating 1st click = highest first', rts.every((v, i) => i === 0 || rts[i - 1] >= v) && rts[0] === 10, rts.slice(0, 5));
    await page.click('th[data-k="rating"]');
    rts = (await texts(page, '#libBody tr.row .num')).map(x => x === '' ? -1 : parseFloat(x));
    check(S + '4 sort rating 2nd click = reversed (lowest first)', rts.every((v, i) => i === 0 || rts[i - 1] <= v), rts.slice(0, 5));
    await page.click('th[data-k="date"]');
    const dts = (await texts(page, '#libBody tr.row .c-date'));
    check(S + '4 sort date 1st click = newest first, undated last', dts[0] !== '' && dts[dts.length - 1] === '', [dts[0], dts[dts.length - 1]]);
    await page.click('#libSheetOrder');
    eq(S + '4 "Back to sheet order" button works', await rowTitles(), sheetOrder);
    // detail row
    const rw = R.find(r => r.status === 'Watched' && r.iso !== undefined && R.filter(o => norm(o.title) === norm(r.title) && o.year === r.year).length > 1 && r.date);
    const same = R.filter(o => norm(o.title) === norm(rw.title) && o.year === rw.year);
    await page.click(`#libBody tr.row[data-row="${rw._row}"]`);
    check(S + '4 click row opens a detail row', (await page.$$('#libBody tr.detail')).length === 1);
    const others = await texts(page, '#libBody tr.detail .others li');
    check(S + '4 detail lists the other entries for the same film (rewatch)', others.length === same.length - 1 && others.every(t => /row \d+/.test(t)), others);
    check(S + '4 detail kv shows director/row·id', (await page.textContent('#libBody tr.detail .kv')).includes(`${rw._row} · ${rw.id}`));
    await page.click(`#libBody tr.row[data-row="${rw._row}"]`);
    check(S + '4 click again closes it', (await page.$$('#libBody tr.detail')).length === 0);
    const solo = R.find(r => r.status === 'Watchlist');
    await page.click(`#libBody tr.row[data-row="${solo._row}"]`);
    check(S + '4 detail for a single entry says so', (await page.textContent('#libBody tr.detail .others')).includes('No other entries'));
    await page.click(`#libBody tr.row[data-row="${solo._row}"]`);
    // remake: same title, different year => not listed as another entry of the same film
    const remake = R.find(r => R.some(o => o !== r && norm(o.title) === norm(r.title) && o.year !== r.year));
    await page.click(`#libBody tr.row[data-row="${remake._row}"]`);
    const rmOthers = await texts(page, '#libBody tr.detail .others li');
    check(S + '4 remake (same title, different year) is not a rewatch of it', rmOthers.length === Math.max(1, R.filter(o => o !== remake && norm(o.title) === norm(remake.title) && o.year === remake.year).length) && rmOthers.every(t => !/row \d+/.test(t) || R.some(o => o._row === Number(t.match(/row (\d+)/)[1]) && o.year === remake.year)), rmOthers);
    await page.click(`#libBody tr.row[data-row="${remake._row}"]`);
    check(S + '4 Show 100 more hidden with <=100 rows', await page.isHidden('#libMore'));
    // trailing space + TBA + no rating display
    const tbaRow = R.find(r => r.year === 'TBA' && r.status === 'Watched');
    check(S + '4 Year TBA row shown as TBA', (await page.textContent(`#libBody tr.row[data-row="${tbaRow._row}"] .y`)) === 'TBA');
    check(S + '4 director "A,B" displayed as "A, B"', (await texts(page, '#libBody tr.row .c-dir')).includes('Mira Voss, Teo Hartley'));
    // column visibility
    const disp = await page.$$eval('th.c-dir, th.c-gen, th.c-plat', els => els.map(e => getComputedStyle(e).display));
    if (size === 'phone') check(S + '4 Director/Genre/Platform columns hidden on phone', disp.length === 3 && disp.every(d => d === 'none'), disp);
    else check(S + '4 Director/Genre/Platform columns visible on laptop', disp.length === 3 && disp.every(d => d !== 'none'), disp);
    const tw = await page.$eval('.table-wrap', e => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    console.log(`INFO  ${S}table-wrap inner scroll: scrollWidth ${tw.sw} vs clientWidth ${tw.cw}${tw.sw > tw.cw + 1 ? ' (table scrolls sideways inside its wrapper; allowed)' : ''}`);
    check(S + '4 no errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* 4b big library */
  {
    const { page, ctx } = await open(size, bigFx);
    await tab(page, 'library');
    const total = bigFx.records.length;
    eq(S + '4 big: 100 rows initially', await page.$$eval('#libBody tr.row', r => r.length), 100);
    check(S + '4 big: Show 100 more visible', await page.isVisible('#libMore'));
    check(S + '4 big: count text', (await page.textContent('#libCount')).startsWith(`Showing 100 of ${total}`), await page.textContent('#libCount'));
    await page.click('#libMore');
    eq(S + '4 big: 200 rows after one click', await page.$$eval('#libBody tr.row', r => r.length), 200);
    await page.click('#libMore');
    eq(S + '4 big: all rows after second click', await page.$$eval('#libBody tr.row', r => r.length), total);
    check(S + '4 big: button hidden when all shown', await page.isHidden('#libMore'));
    const o = await overflowReport(page);
    check(S + '2 big library: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    await ctx.close();
  }

  /* 5. Dashboard */
  {
    const { page, ctx, errors } = await open(size, fx);
    await tab(page, 'dashboard');
    eq(S + '5 year chips', await texts(page, '#dashPeriods .chip'), [E.Y]);
    check(S + '5 year chip pressed', (await page.getAttribute('#dashPeriods .chip', 'aria-pressed')) === 'true');
    const tiles = await page.$$eval('#dashTiles .stat', ss => ss.map(s => [s.querySelector('.eyebrow').textContent, s.querySelector('.num').textContent, s.querySelector('.sub').textContent]));
    const tv = l => tiles.find(t => t[0] === l);
    eq(S + '5 tile Films seen (unique title+year)', tv('Films seen')[1], String(E.seen.length));
    check(S + '5 unique films < watched rows (rewatch counted once)', E.seen.length < E.recs.filter(r => r.status === 'Watched').length);
    eq(S + `5 tile Watched in ${E.Y}`, tv(`Watched in ${E.Y}`)[1], String(E.yr.length));
    eq(S + '5 tile Average rating', tv('Average rating')[1], rnd1(mean(E.rated)));
    check(S + '5 tile Average rating sub has all-time', tv('Average rating')[2].includes('all time ' + rnd1(mean(E.ratedSeen))), tv('Average rating')[2]);
    eq(S + '5 tile Rewatches', tv('Rewatches')[1], String(E.rewatchesInYear));
    eq(S + '5 tile Directors (A,B counts as two)', tv('Directors')[1], String(E.directorSet.size));
    eq(S + '5 tile Watchlist (Watchlist + Next Up)', tv('Watchlist')[1], String(E.recs.filter(r => r.status === 'Watchlist' || r.status === 'Next Up').length));
    // ratings
    const rb = await page.$$eval('#ratBars li', ls => ls.map(l => [l.querySelector('.lab').textContent, Number(l.querySelector('.val').textContent.replace(/,/g, ''))]));
    eq(S + '5 ratings labels 10..1', rb.map(x => x[0]), ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']);
    eq(S + '5 ratings bars sum = rated unique films', rb.reduce((a, b) => a + b[1], 0), E.ratedSeen.length);
    const wantDist = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(r => E.ratedSeen.filter(x => Math.round(x) === r).length);
    eq(S + '5 ratings per-bar counts', rb.map(x => x[1]), wantDist);
    check(S + '5 ratings note', (await page.textContent('#ratNote')).startsWith(`${E.ratedSeen.length} films`), await page.textContent('#ratNote'));
    const fills = await page.$$eval('#ratBars .fill', f => f.map(x => x.style.width));
    check(S + '5 ratings fills have widths', fills.every(w => /%$/.test(w)) && fills.some(w => w === '100%'), fills);
    // decades
    const db = await page.$$eval('#decBars li', ls => ls.map(l => [l.querySelector('.lab').textContent, l.querySelector('.val').textContent]));
    const wantDec = [...E.dec.entries()].sort((a, b) => b[0] - a[0]).map(([k, a]) => { const r = a.filter(x => x != null); return [k + 's', `${a.length} · ${r.length ? rnd1(mean(r)) : '–'}`]; });
    eq(S + '5 decades bars (counts and averages)', db, wantDec);
    eq(S + '5 decades total excludes Year TBA', db.reduce((a, b) => a + Number(b[1].split(' ')[0]), 0), E.seen.filter(s => Number.isFinite(s.year)).length);
    // directors
    const dl = await page.$$eval('#dirList li', ls => ls.map(l => [l.children[0].textContent, l.children[1].textContent]));
    eq(S + '5 top directors names and counts', dl.map(x => [x[0], Number(x[1].match(/^(\d+)/)[1])]), E.topDirs.map(d => [d.n, d.c]));
    const m = dl.find(x => x[0] === 'Mira Voss'), t = dl.find(x => x[0] === 'Teo Hartley');
    check(S + '5 "A,B" director cell counts for both', !!m && !!t && !dl.some(x => x[0].includes(',')), dl);
    // chart
    const monthNote = await page.textContent('#monthNote');
    eq(S + '5 films-per-month note', monthNote, `${E.yr.length} in ${E.Y}`);
    const chartLoaded = await page.evaluate(() => typeof Chart !== 'undefined');
    console.log(`INFO  ${S}Chart.js ${chartLoaded ? 'loaded' : 'not available (cdnjs blocked in sandbox, routed to empty); chart pixel checks skipped'}`);
    check(S + '5 dashboard renders without Chart.js and without errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* 6. empty + error */
  {
    const { page, ctx, errors } = await open(size, emptyFixture());
    check(S + '6 empty: status live', /^Live from your sheet/.test(await page.textContent('#statusText')), await page.textContent('#statusText'));
    check(S + '6 empty: log empty states', (await page.textContent('#upList')).includes('Nothing in Up next yet.') && (await page.textContent('#recList')).includes('No dated watches yet.') && (await page.textContent('#soonList')).includes('Nothing marked Coming Soon.'));
    eq(S + '6 empty: tiles zero', [await page.textContent('#sYear'), await page.textContent('#sMonth'), await page.textContent('#sAvg'), await page.textContent('#sLast')], ['0', '0', '–', '–']);
    await tab(page, 'library');
    check(S + '6 empty: library empty state', (await page.textContent('#libBody')).includes('No films match'), await page.textContent('#libBody'));
    await tab(page, 'dashboard');
    const txt = await page.textContent('#view-dashboard');
    check(S + '6 empty: dashboard empty states', (txt.match(/Nothing to show yet/g) || []).length >= 3, (txt.match(/Nothing to show yet/g) || []).length);
    const o = await overflowReport(page);
    check(S + '6 empty: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    check(S + '6 empty: no errors', errors.length === 0, errors);
    await page.screenshot({ path: `${SHOTS}/${size}-empty-dashboard.png`, fullPage: true });
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await open(size, fx, 'error');
    eq(S + '6 error: status text', await page.textContent('#statusText'), 'Not connected');
    eq(S + '6 error: status state', await page.getAttribute('#status', 'data-state'), 'error');
    const n = await page.$eval('#notice', e => ({ hidden: e.hidden, text: e.textContent, kind: e.dataset.kind }));
    check(S + '6 error: explanatory notice for server_not_connected', !n.hidden && /isn.t connected/.test(n.text) && /Connectors/.test(n.text) && n.kind === 'error', n);
    for (const tb of ['library', 'dashboard']) await tab(page, tb);
    const o = await overflowReport(page);
    check(S + '6 error: no sideways scroll', o.sw <= o.W && o.bad.length === 0, o);
    const calls = await page.evaluate(() => window.__calls);
    check(S + '6 error: only get_values attempted', calls.every(c => c.tool === 'get_values' && OK_RANGES.has(c.range)), calls);
    check(S + '6 error: no uncaught errors', errors.every(e => !e.startsWith('pageerror')), errors);
    await page.screenshot({ path: `${SHOTS}/${size}-error.png`, fullPage: true });
    await ctx.close();
  }

  /* 7. no window.claude */
  {
    const { page, ctx, errors } = await open(size, fx, 'none');
    await page.waitForTimeout(400);
    const n = await page.$eval('#notice', e => ({ hidden: e.hidden, text: e.textContent }));
    check(S + '7 no stub: "Press Connect" notice', !n.hidden && /Press Connect/.test(n.text), n);
    eq(S + '7 no stub: button reads Connect', (await page.textContent('#refreshBtn')).trim(), 'Connect');
    eq(S + '7 no stub: status Not connected', await page.textContent('#statusText'), 'Not connected');
    check(S + '7 dialog closed before pressing', !(await page.$eval('#gDlg', d => d.open)));
    await page.click('#refreshBtn');
    await page.waitForTimeout(150);
    check(S + '7 Connect opens the Client ID dialog (#gDlg)', await page.$eval('#gDlg', d => d.open));
    await page.fill('#gClient', 'not-a-client-id'); await page.click('#gForm button[type=submit]');
    check(S + '7 invalid client id is rejected with a message', (await page.textContent('#gMsg')).includes("doesn't look like a Client ID") && await page.$eval('#gDlg', d => d.open), await page.textContent('#gMsg'));
    // the sheet link is asked for here too, and is kept in the browser (not in the page's code)
    await page.fill('#gClient', '123456-abc.apps.googleusercontent.com'); await page.fill('#gSheet', ''); await page.click('#gForm button[type=submit]');
    check(S + '7 a sheet link is required', (await page.textContent('#gMsg')).includes('link to your Entertainment Tracker') && await page.$eval('#gDlg', d => d.open), await page.textContent('#gMsg'));
    await page.fill('#gSheet', 'https://example.com/not-a-sheet'); await page.click('#gForm button[type=submit]');
    check(S + '7 a link that is not a sheet is refused', (await page.textContent('#gMsg')).includes('link to your Entertainment Tracker') && await page.$eval('#gDlg', d => d.open));
    await page.screenshot({ path: `${SHOTS}/${size}-connect-dialog.png` });
    await page.evaluate(() => { window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => { window.__asked = true; } }) } } }; });
    await page.fill('#gSheet', 'https://docs.google.com/spreadsheets/d/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_/edit?gid=0#gid=0');
    await page.click('#gForm button[type=submit]'); await page.waitForTimeout(150);
    const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('mbl_config') || '{}'));
    check(S + '7 client id and the sheet id (taken out of the link) are saved in the browser', cfg.clientId === '123456-abc.apps.googleusercontent.com' && cfg.sheetId === 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_', cfg);
    check(S + '7 sign-in is requested once both are saved', await page.evaluate(() => window.__asked === true));
    check(S + '7 the page code holds no spreadsheet-id-like string (the id is filled in only when the private artifact is published)', !/['"`][A-Za-z0-9_-]{40,}['"`]/.test(fs.readFileSync(APP, 'utf8')));
    check(S + '7 dialog closes', !(await page.$eval('#gDlg', d => d.open)));
    check(S + '7 nothing threw', errors.length === 0, errors);
    await ctx.close();
  }

  /* 8. date parsing */
  {
    const { page, ctx } = await open(size, fx);
    const r = await page.evaluate(() => [toDate('1-Jan-2026'), toDate('10-Oct-2026'), toDate(''), toDate('2026-03-04'), toDate('garbage'), toDate(undefined)]);
    eq(S + '8 toDate cases', r, ['2026-01-01', '2026-10-10', null, '2026-03-04', null, null]);
    await ctx.close();
  }
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
