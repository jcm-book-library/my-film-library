// Tools tab (Discover + Tools) and the Plan Backlog (top 10 by score). Headless Playwright against a FAKE in-memory Google Sheet.
// Run: node tests/tools.test.mjs      Synthetic data only (toolsfixture.mjs, planfixture.mjs). Nothing talks to Google.
// Expectations are worked out here from the raw fixture records (an independent model), not read back from the app.
// "Today" is 7 Nov 2026 unless a scenario says otherwise (page.clock). Math.random is stubbed for the Lucky dip.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeSheet, SHEET_ID, colOf } from './fakesheet.mjs';
import { buildToolsFixture, TOOLS_TODAY } from './toolsfixture.mjs';
import { buildPlanFixture } from './planfixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_FILE || path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = (process.env.SHOTS_DIR || SCRATCH + '/shots') + '/tools';
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvlT-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', SHEET_ID) + '</body></html>');
const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

/* ---------------------------------- independent model ---------------------------------- */
const FX = buildToolsFixture();
const REC = FX.records;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const house = s => `${+s.slice(8)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(2, 4)}`;       // 19 Oct 26
const one = v => v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const keyOf = r => r.title.trim().toLowerCase() + '|' + r.year;
const ty = r => `${r.title} (${r.year})`;
const seenR = REC.filter(r => r.status === 'Watched');
const unseenR = REC.filter(r => r.status !== 'Watched');
const datedR = seenR.filter(r => r.date);
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(TOOLS_TODAY);   // 2026-11-07
const clockOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 10, 0, 0); };
// one entry per seen film: the representative row is the latest dated watch, else the first seen row; the rating is the rep's, else any rated row
const seenFilms = (() => {
  const m = new Map();
  for (const r of seenR) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].map(([key, rows]) => {
    const d = rows.filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
    const rep = d[0] || rows[0];
    return { key, rep, rating: rep.rating != null ? rep.rating : ((rows.find(r => r.rating != null) || {}).rating ?? null) };
  });
})();
const hasSeenRow = key => seenR.some(r => keyOf(r) === key);
const isUpR = r => r.status !== 'Watched' && (r.plan === 'Up next' || (r.status === 'Next Up' && !r.plan));
const upList = () => unseenR.filter(isUpR).sort((a, b) => (a.order || 1e9) - (b.order || 1e9) || a._row - b._row);
const waiting = r => r.status !== 'Watched' && (isUpR(r) || r.plan === 'Soon' || ['Watchlist', 'Rewatch'].includes(r.status) || r.plan === 'Someday');
const isOwnedR = r => r.purchase === 'Owned' || r.platform === 'Physical' || r.platform === 'Plex';
const uniq = rows => { const s = new Set(); return rows.filter(r => !s.has(keyOf(r)) && s.add(keyOf(r))); };
const POOL = {
  up: () => uniq(upList()),
  watch: () => uniq(unseenR.filter(r => r.status === 'Watchlist' && !isUpR(r) && !hasSeenRow(keyOf(r)))),
  owned: () => uniq(unseenR.filter(r => waiting(r) && isOwnedR(r) && !hasSeenRow(keyOf(r)))),
  plex: () => uniq(unseenR.filter(r => waiting(r) && r.platform === 'Plex' && !hasSeenRow(keyOf(r)))),
  rewatch: () => seenFilms.filter(s => s.rating != null && s.rating >= 8).map(s => s.rep)
};
const POOL_LABEL = { up: 'Up next', watch: 'Watchlist', owned: 'Owned and unseen', plex: 'On Plex and unseen', rewatch: 'Rewatch candidates' };
// the highlight: films rated 8+ sorted by key, indexed by a hash of yyyy-mm-dd (FNV-1a)
const fnv = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const highlightOn = date => { const l = seenFilms.filter(s => s.rating != null && s.rating >= 8).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0); return { film: l[fnv(date) % l.length], n: l.length }; };
const nextDays = (from, n) => Array.from({ length: n }, (_, i) => { const d = clockOf(from); d.setDate(d.getDate() + i); return iso(d); });

/* ---------------------------------- harness ---------------------------------- */
async function open(size, { fixture, setup, today = TODAY, theme, clip = null } = {}) {
  const fake = new FakeSheet(fixture ? fixture() : buildToolsFixture());
  if (setup) setup(fake);
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
  await page.clock.install({ time: clockOf(today) });
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
  return { page, ctx, fake, errors, badReq, size };
}
async function scenario(name, sizes, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  for (const size of sizes) {
    const S = `[${size}] ${name}: `;
    let E;
    try { E = await open(size, opts); E.S = S; await fn(E); check(S + 'no page or console errors', E.errors.length === 0, E.errors.slice(0, 3)); check(S + 'no requests outside the local stubs', E.badReq.length === 0, E.badReq.slice(0, 3)); }
    catch (e) { check(S + 'scenario ran without exception', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); }
    finally { if (E) await E.ctx.close(); }
  }
}
const BOTH = ['laptop', 'phone'], LAPTOP = ['laptop'];
const tab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(120); };
const tools = async page => { await tab(page, 'tools'); };
const txt = (page, sel) => page.$$eval(sel, es => es.map(e => e.textContent.trim()));
const one1 = (page, sel) => page.$eval(sel, e => e.textContent.trim());
const settle = async page => { await page.waitForFunction(() => planQ.pending === 0); await page.waitForTimeout(250); };
const stubRandom = (page, v) => page.evaluate(x => { Math.random = () => x; }, v);
const writes = fake => fake.calls.filter(c => c.tool !== 'get_values');
const noWrites = (E, what) => check(E.S + `${what}: the fake sheet saw no writes`, writes(E.fake).length === 0, writes(E.fake).map(c => `${c.tool} ${c.range}`));
const sig = fake => writes(fake).map(c => `${c.tool} ${c.range} ${JSON.stringify(c.values)}`);
async function setClockDay(page, day) { await page.clock.setFixedTime(clockOf(day)); await page.evaluate(() => renderTools()); }   // the page keeps its data; only "today" moves
async function openTools(E, q) { await tools(E.page); return E.page; }

/* =============================== 1. the tab =============================== */
await scenario('tab', BOTH, async E => {
  const { page, S } = E;
  const tabs = await txt(page, '.tabs [role="tab"]');
  eq(S + 'five tabs, Tools after Dashboard', tabs, ['Log', 'Library', 'Dashboard', 'Tools']);
  check(S + 'Tools is a tab with aria-controls view-tools', await page.$eval('#tab-tools', e => e.getAttribute('role') === 'tab' && e.getAttribute('aria-controls') === 'view-tools'));
  check(S + 'Tools view starts hidden', await page.$eval('#view-tools', e => e.hidden));
  await tools(page);
  check(S + 'clicking Tools shows the view and selects the tab', await page.$eval('#view-tools', e => !e.hidden) && (await page.$eval('#tab-tools', e => e.getAttribute('aria-selected'))) === 'true' && (await page.$$eval('#view-log, #view-library, #view-dashboard', v => v.every(x => x.hidden))));
  eq(S + 'the tab is remembered (mvl-tab)', await page.evaluate(() => localStorage.getItem('mvl-tab')), 'tools');
  await page.reload(); await page.waitForFunction(() => /^Live from your sheet/.test(document.getElementById('statusText').textContent)); await page.waitForTimeout(150);
  check(S + 'after a reload the Tools tab is still open', await page.$eval('#view-tools', e => !e.hidden) && (await page.$eval('#tab-tools', e => e.getAttribute('aria-selected'))) === 'true');
  check(S + 'and its panels are drawn', (await page.$$('#view-tools .panel')).length === 8);
  eq(S + 'eight panels: heads', await txt(page, '#view-tools .panel-head h2'), ['On this day', 'Highlight of the day', 'Lucky dip', 'Do I own this?', 'Stalled', 'Goal planner', 'Year in review', 'More like this']);
  eq(S + 'two bands', await txt(page, '#view-tools .band-h'), ['Discover', 'Tools']);
  await page.click('#tab-dashboard'); await page.waitForTimeout(80);
  await page.focus('#tab-dashboard'); await page.keyboard.press('ArrowRight');
  check(S + 'ArrowRight from Dashboard opens Tools and moves focus', (await page.$eval('#tab-tools', e => e.getAttribute('aria-selected'))) === 'true' && (await page.evaluate(() => document.activeElement.id)) === 'tab-tools');
  await page.keyboard.press('ArrowRight');
  check(S + 'ArrowRight wraps round to Log', (await page.$eval('#tab-log', e => e.getAttribute('aria-selected'))) === 'true');
  await page.keyboard.press('ArrowLeft');
  check(S + 'ArrowLeft wraps back to Tools', (await page.$eval('#tab-tools', e => e.getAttribute('aria-selected'))) === 'true');
  await page.keyboard.press('Home'); check(S + 'Home goes to Log', (await page.$eval('#tab-log', e => e.getAttribute('aria-selected'))) === 'true');
  await page.keyboard.press('End'); check(S + 'End goes to Tools', (await page.$eval('#tab-tools', e => e.getAttribute('aria-selected'))) === 'true');
  noWrites(E, 'opening the tab');
});

/* =============================== 2. On this day =============================== */
await scenario('On this day', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  const hits = datedR.filter(r => r.date.slice(5) === TODAY.slice(5) && r.date < TODAY.slice(0, 4)).sort((a, b) => b.date.localeCompare(a.date));
  eq(S + 'model: two earlier-year matches', hits.map(r => r.title), ['Harbour Lights', 'Paper Moon Rising']);
  eq(S + 'entries read "2025 · Title · 8/10", newest year first', await txt(page, '#otdBody .tl .t'), hits.map(r => `${r.date.slice(0, 4)} · ${r.title} · ${r.rating}/10`));
  check(S + 'no empty-state message when there are matches', !/Nothing logged/.test(await one1(page, '#otdBody')));
  eq(S + 'note shows today as 7 Nov', await one1(page, '#otdNote'), '7 Nov');
  noWrites(E, 'On this day');
});
await scenario('On this day: nothing, with a closest watch this year', LAPTOP, { today: '2026-11-09' }, async E => {
  const { page, S } = E;
  await tools(page);
  const near = datedR.filter(r => r.date.startsWith('2026') && r.date < '2026-11-09').sort((a, b) => b.date.localeCompare(a.date))[0];
  eq(S + 'model: nearest earlier watch is Closest Call on 2 Nov', [near.title, near.date], ['Closest Call', '2026-11-02']);
  check(S + 'says nothing was logged on 9 Nov in earlier years', (await txt(page, '#otdBody .tool-msg'))[0] === 'Nothing logged on 9 Nov in earlier years yet.', await txt(page, '#otdBody .tool-msg'));
  eq(S + 'then "Closest this year:" with the nearest dated watch', (await txt(page, '#otdBody .tool-msg'))[1], `Closest this year: ${house(near.date)} · ${near.title} · ${near.rating}/10`);
});
await scenario('On this day: nothing at all this year', LAPTOP, { today: '2027-02-10' }, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'only the empty message, no Closest line (no dated watch in 2027)', await txt(page, '#otdBody .tool-msg'), ['Nothing logged on 10 Feb in earlier years yet.']);
});
await scenario('On this day: a same-day watch in the current year is not an earlier year', LAPTOP, {
  setup: f => { const r = f.rowOfTitle('Closest Call'); f.setCell(r, 'Date', '2026-11-07'); }
}, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'still only the two earlier-year entries', (await txt(page, '#otdBody .tl .t')).length, 2);
});

/* =============================== 3. Highlight of the day =============================== */
await scenario('Highlight of the day', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  const h = highlightOn(TODAY), f = h.film.rep;
  check(S + 'model: the pick is rated 8 or higher', h.film.rating >= 8);
  eq(S + 'title (year)', await one1(page, '#hotdBody h3'), ty(f));
  const meta = await one1(page, '#hotdBody .m');
  check(S + 'shows the rating', meta.includes(`Rated ${h.film.rating}/10`), meta);
  check(S + 'shows the director and genre', (!f.director || meta.includes(f.director)) && (!f.genre || meta.includes(f.genre)), meta);
  eq(S + 'note counts the films rated 8+', await one1(page, '#hotdNote'), `1 of ${h.n} rated 8 or higher`);
  const stub = await page.$$('#hotdBody h3 .stub.ind');
  const isFavFilm = REC.some(r => keyOf(r) === h.film.key && r.favourite);
  check(S + 'favourite stub only when the film is a favourite', stub.length === (isFavFilm ? 1 : 0), [stub.length, isFavFilm]);
  const queued = REC.some(r => keyOf(r) === h.film.key && r.status !== 'Watched');
  const btn = await page.$eval('#hotdBody button', b => ({ t: b.textContent, d: b.disabled }));
  eq(S + 'Rewatch next button state', btn, queued ? { t: 'Already planned', d: true } : { t: 'Rewatch next', d: false });
  noWrites(E, 'Highlight');
});
await scenario('Highlight: stable on a day, only 8+, changes with the date', LAPTOP, async E => {
  const { page, S } = E;
  await tools(page);
  const t0 = await one1(page, '#hotdBody h3');
  for (let i = 0; i < 2; i++) { await page.reload(); await page.waitForFunction(() => /^Live from your sheet/.test(document.getElementById('statusText').textContent)); await page.waitForTimeout(120); }
  eq(S + 'same film after two reloads on the same date', await one1(page, '#hotdBody h3'), t0);
  await page.click('#refreshBtn'); await page.waitForTimeout(250);
  eq(S + 'and after Refresh', await one1(page, '#hotdBody h3'), t0);
  const eight = new Set(seenFilms.filter(s => s.rating >= 8).map(s => ty(s.rep)));
  const seenTitles = new Set();
  let changed = 0, bad = [];
  for (const day of nextDays(TODAY, 40)) {
    await setClockDay(page, day);
    const got = await one1(page, '#hotdBody h3'), want = ty(highlightOn(day).film.rep);
    seenTitles.add(got);
    if (got !== want || !eight.has(got)) bad.push([day, got, want]);
    if (got !== t0) changed++;
  }
  eq(S + 'for 40 days the pick matches the date hash and is always rated 8+', bad, []);
  check(S + 'the pick changes from day to day', changed > 5 && seenTitles.size >= 3, [changed, seenTitles.size]);
  noWrites(E, 'Highlight over many days');
});
await scenario('Highlight: Rewatch next reuses the Library action', LAPTOP, async E => {
  const { page, S, fake } = E;
  // find a day whose pick has nothing queued and one that is a favourite / already planned
  const days40 = nextDays(TODAY, 120);
  const dayFree = days40.find(d => !REC.some(r => keyOf(r) === highlightOn(d).film.key && r.status !== 'Watched'));
  const dayQueued = days40.find(d => REC.some(r => keyOf(r) === highlightOn(d).film.key && r.status !== 'Watched'));
  const dayFav = days40.find(d => REC.some(r => keyOf(r) === highlightOn(d).film.key && r.favourite));
  check(S + 'model: found a free day, a queued day and a favourite day', !!(dayFree && dayQueued && dayFav), [dayFree, dayQueued, dayFav]);
  await tools(page); await setClockDay(page, dayQueued);
  eq(S + 'queued film: button disabled "Already planned"', await page.$eval('#hotdBody button', b => [b.textContent, b.disabled]), ['Already planned', true]);
  await setClockDay(page, dayFav);
  check(S + 'favourite film: a stub sits beside the title', (await page.$$('#hotdBody h3 .stub.ind')).length === 1);
  await setClockDay(page, dayFree);
  const title = await page.$eval('#hotdBody h3', h => h.firstChild.textContent.trim());
  const n0 = fake.calls.length;
  await page.click('#hotdBody button'); await settle(page);
  const mine = sig(fake).slice(0), calls = fake.calls.slice(n0).filter(c => c.tool !== 'get_values');
  check(S + 'one new row was appended (the Library action)', calls.filter(c => c.tool === 'append_values').length === 1, calls.map(c => c.tool));
  eq(S + 'button now reads "Already planned" and is disabled', await page.$eval('#hotdBody button', b => [b.textContent, b.disabled]), ['Already planned', true]);
  // the same film through the Library's own button, on a fresh page
  const E2 = await open('laptop', { today: dayFree });
  try {
    const rep = highlightOn(dayFree).film.rep;
    await E2.page.click('#tab-library'); await E2.page.fill('#libSearch', rep.title); await E2.page.waitForTimeout(300);
    await E2.page.locator('#libBody tr.row', rep.date ? { hasText: house(rep.date) } : {}).first().click(); await E2.page.click('#libBody [data-rewatch]:not([hidden])'); await settle(E2.page);
    eq(S + 'writes are identical to the Library "Rewatch next"', mine, sig(E2.fake));
  } finally { await E2.ctx.close(); }
});

/* =============================== 4. Lucky dip =============================== */
await scenario('Lucky dip', BOTH, async E => {
  const { page, S, fake } = E;
  await tools(page);
  eq(S + 'pool chips', (await txt(page, '#dipPools .chip')).map(t => t.replace(/\d+$/, '')), Object.values(POOL_LABEL));
  eq(S + 'pool chip counts match the model (one per film key)', (await txt(page, '#dipPools .chip .n')), Object.keys(POOL_LABEL).map(k => String(POOL[k]().length)));
  const genres = [...new Set(REC.map(r => r.genre).filter(Boolean))].sort();
  eq(S + 'genre select: All genres + genres present', await page.$$eval('#dipGenre option', o => o.map(x => x.textContent)), ['All genres', ...genres]);
  check(S + 'Up next is the default pool', (await page.$eval('#dipPools .chip[aria-pressed="true"]', c => c.dataset.pool)) === 'up');
  check(S + 'before a spin it says how many films are in the pool', /Press Spin to pick one of 7 films/.test(await one1(page, '#dipBody')), await one1(page, '#dipBody'));
  for (const r of [0, 0.5, 0.99]) {
    for (const k of Object.keys(POOL_LABEL)) {
      await page.click(`#dipPools [data-pool="${k}"]`); await stubRandom(page, r); await page.click('#dipSpin');
      const pool = POOL[k](), want = pool[Math.floor(r * pool.length)];
      eq(S + `pool ${k}, Math.random ${r}: picks entry ${Math.floor(r * pool.length)} of ${pool.length}`, await one1(page, '#dipBody h3'), ty(want));
    }
  }
  // details of the card
  await page.click('#dipPools [data-pool="watch"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  const first = POOL.watch()[0];
  const meta = await one1(page, '#dipBody .m');
  check(S + 'card shows director, genre and platform', [first.director, first.genre, first.platform].filter(Boolean).every(v => meta.includes(v)), meta);
  const why = await page.evaluate(() => { const f = state.films.find(x => x.title === 'Wish Owned'); return scoreFilm(f, buildProfile()).why.join(' · '); });
  check(S + 'the why-line is the scoring reason for an unseen film', (await one1(page, '#dipBody .pwhy')) === (await page.evaluate(t => scoreFilm(state.films.find(x => x.title === t), buildProfile()).why.join(' · ') || 'On your list', first.title)));
  await page.click('#dipPools [data-pool="owned"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  eq(S + 'owned pool, first film is Wish Owned, why-line mentions owning it', [await one1(page, '#dipBody h3'), /You own it/.test(await one1(page, '#dipBody .pwhy')), why.includes('You own it')], ['Wish Owned (2023)', true, true]);
  // Spin again
  await page.click('#dipPools [data-pool="watch"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  const a = await one1(page, '#dipBody h3'); await stubRandom(page, 0.99); await page.click('#dipAgain');
  const b = await one1(page, '#dipBody h3');
  eq(S + 'Spin again draws again', [a, b], [ty(POOL.watch()[0]), ty(POOL.watch()[Math.floor(0.99 * POOL.watch().length)])]);
  // buttons by pool
  await page.click('#dipPools [data-pool="up"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  eq(S + 'Up next pool: the film is already in Up next, so no Add button', await txt(page, '#dipBody .acts button'), ['Spin again', 'In Up next']);
  check(S + '… and that one is disabled', await page.$eval('#dipAdd', b => b.disabled));
  await page.click('#dipPools [data-pool="rewatch"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  eq(S + 'Rewatch pool: a seen film, so only Spin again', await txt(page, '#dipBody .acts button'), ['Spin again']);
  check(S + '… with a "Seen, rated N/10" line', /^Seen, rated \d+\/10$/.test(await one1(page, '#dipBody .pwhy')), await one1(page, '#dipBody .pwhy'));
  await page.click('#dipPools [data-pool="watch"]'); await stubRandom(page, 0); await page.click('#dipSpin');
  eq(S + 'Watchlist pool: Spin again and Add to Up next', await txt(page, '#dipBody .acts button'), ['Spin again', 'Add to Up next']);
  noWrites(E, 'spinning');
});
await scenario('Lucky dip: genre filter and empty pool', LAPTOP, async E => {
  const { page, S } = E;
  await tools(page);
  await page.click('#dipPools [data-pool="watch"]');
  await page.selectOption('#dipGenre', 'Thriller');
  const pool = POOL.watch().filter(r => r.genre === 'Thriller');
  eq(S + 'Watchlist + Thriller: pool is filtered', await one1(page, '#dipNote'), `${pool.length} in the pool`);
  eq(S + 'chip counts follow the genre', await page.$eval('#dipPools [data-pool="watch"] .n', n => n.textContent), String(pool.length));
  await stubRandom(page, 0.999); await page.click('#dipSpin');
  eq(S + 'the pick comes from the filtered pool', await one1(page, '#dipBody h3'), ty(pool[pool.length - 1]));
  await page.selectOption('#dipGenre', 'Horror');
  check(S + 'a genre with nothing in the pool says so and disables Spin', /Nothing in this pool for Horror/.test(await one1(page, '#dipBody')) && await page.$eval('#dipSpin', b => b.disabled), await one1(page, '#dipBody'));
  await page.selectOption('#dipGenre', '');
  await page.click('#dipPools [data-pool="up"]');
  check(S + 'changing the pool clears the previous result', /Press Spin/.test(await one1(page, '#dipBody')));
  noWrites(E, 'filters');
});
await scenario('Lucky dip: empty pool message', LAPTOP, { setup: f => { for (const t of ['Wish Plex', 'Wish Both', 'Echo Sequel 1', 'Echo Sequel 4', 'Echo Sequel 7', 'Echo Sequel 10']) f.setCell(f.rowOfTitle(t), 'Platform', ''); } }, async E => {
  const { page, S } = E;
  await tools(page);
  await page.click('#dipPools [data-pool="plex"]');
  eq(S + 'no unseen film on Plex: message, Spin disabled', [await one1(page, '#dipBody'), await page.$eval('#dipSpin', b => b.disabled)], ['Nothing in this pool yet.', true]);
});
await scenario('Lucky dip: Add to Up next = the Plan action', LAPTOP, async E => {
  const { page, S, fake } = E;
  await tools(page);
  await page.click('#dipPools [data-pool="watch"]'); await stubRandom(page, 1.5 / POOL.watch().length); await page.click('#dipSpin');
  const target = POOL.watch()[1];
  eq(S + 'model: the second Watchlist film is a Backlog film (Wish Owned)', target.title, 'Wish Owned');
  const n0 = fake.calls.length;
  await page.click('#dipAdd'); await settle(page);
  const mine = sig(fake);
  check(S + 'it wrote something', mine.length > 0, mine);
  eq(S + 'the button now says "In Up next" and is disabled', await page.$eval('#dipAdd', b => [b.textContent, b.disabled]), ['In Up next', true]);
  const row = fake.rowOfTitle(target.title, target.year);
  eq(S + 'the film is now Plan = Up next, Status Next Up', [fake.cell(row, 'Plan'), fake.cell(row, 'Status')], ['Up next', 'Next Up']);
  // the Plan's own button on a fresh page
  const E2 = await open('laptop');
  try {
    await E2.page.click('#tab-library'); await E2.page.click('[data-mode="plan"]'); await E2.page.fill('#libSearch', target.title); await E2.page.waitForTimeout(350);
    await E2.page.click(`#planBack button[aria-label="Add to Up next: ${target.title}"]`); await settle(E2.page);
    eq(S + 'identical cell writes to the Plan "Up next" button', mine, sig(E2.fake));
  } finally { await E2.ctx.close(); }
});

/* =============================== 5. Do I own this? =============================== */
await scenario('Do I own this?', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  const q = async v => { await page.fill('#ownQ', v); return page.$$eval('#ownList > li', ls => ls.map(l => ({ t: (l.querySelector('.t') || l).textContent.trim(), chips: [...l.querySelectorAll('.vchip')].map(c => c.textContent) }))); };
  check(S + 'before typing there is a hint', /Type part of a title/.test(await one1(page, '#ownList')));
  eq(S + 'Owned (Purchase = Owned)', await q('Wish Owned'), [{ t: 'Wish Owned (2023)', chips: ['Owned'] }]);
  eq(S + 'On disc (Platform Physical)', await q('Wish Disc'), [{ t: 'Wish Disc (2021)', chips: ['On disc'] }]);
  eq(S + 'On Plex', await q('Wish Plex'), [{ t: 'Wish Plex (2022)', chips: ['On Plex'] }]);
  eq(S + 'Streaming on <platform>', await q('Wish Stream'), [{ t: 'Wish Stream (2020)', chips: ['Streaming on Netflix'] }]);
  eq(S + 'To purchase', await q('Wish Buy'), [{ t: 'Wish Buy (2019)', chips: ['To purchase'] }]);
  eq(S + 'In your sheet, no copy noted', await q('Wish Plain'), [{ t: 'Wish Plain (2018)', chips: ['In your sheet, no copy noted'] }]);
  eq(S + 'Owned and on Plex: both chips, strongest first', await q('Wish Both'), [{ t: 'Wish Both (2017)', chips: ['Owned', 'On Plex'] }]);
  eq(S + 'a film combines all its rows (Iron Lantern: Plex on one row, Cinema on another)', await q('iron lantern'), [{ t: 'Iron Lantern (2000)', chips: ['On Plex'] }]);
  eq(S + 'Velvet Signal is Owned and on Plex', (await q('velvet'))[0].chips, ['Owned', 'On Plex']);
  eq(S + 'a film only seen in Cinema/Airplane has no copy', (await q('copper citadel'))[0].chips, ['In your sheet, no copy noted']);
  eq(S + 'accent-insensitive: "cafe" finds Café Noir', await q('cafe'), [{ t: 'Café Noir (2012)', chips: ['Owned'] }]);
  eq(S + 'case- and accent-insensitive: "CAFÉ NOIR"', (await q('CAFÉ NOIR')).length, 1);
  eq(S + 'typing the accent for an unaccented search works the other way too', (await q('café')).length, 1);
  const wish = await q('wish');
  eq(S + 'a broad search lists the strongest verdicts first', wish.map(r => r.t), ['Wish Both (2017)', 'Wish Owned (2023)', 'Wish Disc (2021)', 'Wish Plex (2022)', 'Wish Stream (2020)', 'Wish Buy (2019)', 'Wish Plain (2018)']);
  const many = await q('echo sequel');
  eq(S + 'up to 8 matches', many.length, 8);
  eq(S + 'and says 8 of 10', await one1(page, '#ownNote'), '8 of 10 matches');
  await q('zzzz');
  eq(S + 'not found', await txt(page, '#ownList li'), ['Not in your sheet.']);
  await q('');
  check(S + 'clearing the box shows the hint again', /Type part of a title/.test(await one1(page, '#ownList')));
  noWrites(E, 'Do I own this?');
});

/* =============================== 6. Stalled =============================== */
await scenario('Stalled', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  const watching = unseenR.filter(r => r.status === 'Watching').sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  eq(S + 'Watching list: title (year) in order', await txt(page, '#stallWatching .t'), watching.map(ty));
  eq(S + 'a dated Watching film shows since + how long; an undated one just the title', await page.$$eval('#stallWatching li', ls => ls.map(l => [(l.querySelector('.sub') || {}).textContent || '', (l.querySelector('.r') || {}).textContent || ''])), [['Since 20 Oct 26', '18 days'], ['', '']]);
  const stale = upList().filter(r => r.sorted && days(r.sorted, TODAY) >= 14).sort((a, b) => a.sorted.localeCompare(b.sorted));
  eq(S + 'model: three Up next films have sat 14+ days', stale.map(r => r.title), ['Up One', 'Up Four', 'Up Edge14']);
  eq(S + 'Up next list, oldest first', await txt(page, '#stallUp .t'), stale.map(ty));
  eq(S + 'each says "N days in Up next"', await page.$$eval('#stallUp .sub', s => s.map(x => x.textContent.split(' · ')[0])), ['37 days in Up next', '18 days in Up next', '14 days in Up next']);
  const all = (await txt(page, '#stallBody')).join('');
  check(S + 'Up Edge13 (13 days), Up Two (8 days), the new Burning Voyage row and Up Three (no Sorted date) are not listed', !/Up Edge13|Up Two|Up Three|Burning Voyage/.test(all));
  eq(S + 'note counts everything listed', await one1(page, '#stallNote'), '5 to look at');
  noWrites(E, 'Stalled');
});
await scenario('Stalled: stalledDays setting', LAPTOP, { fixture: () => buildToolsFixture({ stalledDays: 20 }) }, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'with stalledDays 20 only Up One qualifies', await txt(page, '#stallUp .t'), ['Up One (2020)']);
  eq(S + 'heading names the number of days', (await txt(page, '#stallBody .eyebrow'))[1], 'In Up next for 20 days or more');
});
await scenario('Stalled: nothing stalled', LAPTOP, { setup: f => { for (const t of ['Watching A', 'Watching B']) f.setCell(f.rowOfTitle(t), 'Status', 'Watchlist'); }, fixture: () => buildToolsFixture({ stalledDays: 400 }) }, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'the empty state', await txt(page, '#stallBody .tool-msg'), ['Nothing stalled.']);
});
await scenario('Stalled: Up next films without a Sorted date are never judged', LAPTOP, { setup: f => { for (const t of ['Up One', 'Up Four', 'Up Edge14']) f.setCell(f.rowOfTitle(t), 'Sorted', ''); } }, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'with no Sorted dates nothing is listed for Up next', await page.$$('#stallUp'), []);
  eq(S + 'the second list says None.', (await txt(page, '#stallBody .tool-msg')), ['None.']);
});
await scenario('Stalled: Drop = the Plan Drop', LAPTOP, async E => {
  const { page, S, fake } = E;
  await tools(page);
  await page.click('#stallUp button[aria-label="Take off the plan: Up One"]'); await settle(page);
  const mine = sig(fake);
  check(S + 'wrote cells', mine.length > 0, mine);
  check(S + 'Up One has left the list', !(await txt(page, '#stallUp .t')).includes('Up One (2020)'));
  const E2 = await open('laptop');
  try {
    await E2.page.click('#tab-library'); await E2.page.click('[data-mode="plan"]');
    await E2.page.click('#planUp button[aria-label="Take off the plan: Up One"]'); await settle(E2.page);
    eq(S + 'identical cell writes to the Plan "Drop"', mine, sig(E2.fake));
  } finally { await E2.ctx.close(); }
});

/* =============================== 7. Goal planner =============================== */
// Independent model of the figures for a date and a goal (watches dated today or earlier in the year)
function goalModel(date, goal) {
  const y = date.slice(0, 4), watched = datedR.filter(r => r.date.startsWith(y) && r.date <= date).length;
  const dayOfYear = days(`${y}-01-01`, date) + 1, diy = days(`${y}-01-01`, `${+y + 1}-01-01`), left = diy - dayOfYear;
  const toGo = Math.max(0, goal - watched), pace = watched / (Math.max(dayOfYear, 14) / 7);
  return { watched, toGo, weeks: one(left / 7), need: goal <= watched ? '–' : one(toGo / (Math.max(left, 1) / 7)), pace: one(pace), proj: String(Math.round(watched + pace * left / 7)), diff: Math.round(watched - goal * dayOfYear / diy), early: dayOfYear < 14 };
}
const goalVals = page => page.$$eval('#goalBody dd', d => Object.fromEntries(d.map(x => [x.dataset.k, x.textContent])));
async function goalCase(label, { today = TODAY, goal = 120 } = {}, want) {
  await scenario('Goal planner ' + label, LAPTOP, { today, fixture: () => buildToolsFixture({ goal }) }, async E => {
    const { page, S } = E;
    await tools(page);
    const m = goalModel(today, goal);
    eq(S + 'figures', await goalVals(page), { goal: String(goal), watched: String(m.watched), togo: String(m.toGo), weeks: m.weeks, need: m.need, pace: m.pace, proj: m.proj });
    const head = await one1(page, '#goalHead');
    eq(S + 'headline', head, m.watched >= goal ? 'Goal reached' : m.diff > 0 ? `Ahead by ${m.diff}` : m.diff < 0 ? `Behind by ${-m.diff}` : 'On pace');
    if (want) eq(S + 'headline (hand-worked)', head, want.head);
    if (want && want.vals) eq(S + 'figures (hand-worked)', await goalVals(page), want.vals);
    eq(S + 'early-year note is shown only in the first two weeks', await page.$eval('#goalEarly', e => !e.hidden), m.early);
    check(S + 'progress bar width', Math.abs(parseFloat(await page.$eval('#goalBody .goalbar i', i => i.style.width)) - Math.min(100, m.watched / goal * 100)) < 0.01);
    check(S + 'no NaN or Infinity anywhere', !/NaN|Infinity/.test(await one1(page, '#goalBody')), await one1(page, '#goalBody'));
    noWrites(E, 'Goal planner');
  });
}
await goalCase('7 Nov, goal 120', {}, { head: 'Behind by 90', vals: { goal: '120', watched: '12', togo: '108', weeks: '7.7', need: '14.0', pace: '0.3', proj: '14' } });
await goalCase('5 Jan (first days of the year)', { today: '2026-01-05' }, { head: 'Behind by 1', vals: { goal: '120', watched: '1', togo: '119', weeks: '51.4', need: '2.3', pace: '0.5', proj: '27' } });
await goalCase('1 Jan, nothing watched yet', { today: '2026-01-01' }, { head: 'On pace', vals: { goal: '120', watched: '0', togo: '120', weeks: '52.0', need: '2.3', pace: '0.0', proj: '0' } });
await goalCase('31 Dec (no days left: never divides by zero)', { today: '2026-12-31' }, { head: 'Behind by 108', vals: { goal: '120', watched: '12', togo: '108', weeks: '0.0', need: '756.0', pace: '0.2', proj: '12' } });
await goalCase('goal 13: ahead', { goal: 13 }, { head: 'Ahead by 1' });
await goalCase('goal 14: on pace', { goal: 14 }, { head: 'On pace' });
await goalCase('goal 15: behind', { goal: 15 }, { head: 'Behind by 1' });
await goalCase('goal 12: reached exactly', { goal: 12 }, { head: 'Goal reached' });
await goalCase('goal 10: passed', { goal: 10 }, { head: 'Goal reached' });
await scenario('Goal planner: goal passed says by how much', LAPTOP, { fixture: () => buildToolsFixture({ goal: 10 }) }, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'sentence', await one1(page, '#goalSub'), 'You are 2 past your goal of 10.');
  eq(S + 'still to go is 0, needed per week is a dash', await goalVals(page).then(v => [v.togo, v.need]), ['0', '–']);
  eq(S + 'bar is full', await page.$eval('#goalBody .goalbar i', i => i.style.width), '100%');
});

/* =============================== 8. Year in review =============================== */
function yirModel(Y) {
  const yr = datedR.filter(r => r.date.startsWith(Y));
  const rated = yr.filter(r => r.rating != null);
  const per = Array(12).fill(0); yr.forEach(r => per[+r.date.slice(5, 7) - 1]++);
  const mx = Math.max(...per), bm = per.indexOf(mx);
  const gc = new Map(); yr.forEach(r => r.genre && gc.set(r.genre, (gc.get(r.genre) || 0) + 1));
  const topG = [...gc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const dc = new Map(); yr.forEach(r => r.director.split(',').map(x => x.trim()).filter(Boolean).forEach(n => { if (!dc.has(n)) dc.set(n, []); dc.get(n).push(r.rating); }));
  const topD = [...dc.entries()].map(([n, a]) => ({ n, c: a.length, r: mean(a.filter(x => x != null)) })).sort((a, b) => b.c - a.c || (b.r ?? 0) - (a.r ?? 0) || a.n.localeCompare(b.n))[0];
  const isRe = r => seenR.some(o => keyOf(o) === keyOf(r) && o !== r && (!o.date || o.date < r.date || (o.date === r.date && o._row < r._row)));
  const best = rated.slice().sort((a, b) => b.rating - a.rating || b.date.localeCompare(a.date) || a._row - b._row).slice(0, 5);
  const byD = yr.slice().sort((a, b) => a.date.localeCompare(b.date) || a._row - b._row);
  return { n: yr.length, avg: one(mean(rated.map(r => r.rating))), nRated: rated.length, bm: yr.length ? FULL[bm] : '–', bmN: mx, topG, topD, re: yr.filter(isRe).length, best, first: byD[0], last: byD[byD.length - 1] };
}
const cardsOf = page => page.$$eval('#yirBody .yir-card', cs => Object.fromEntries(cs.map(c => [c.querySelector('.eyebrow').textContent, [c.querySelector('.v').textContent, c.querySelector('.s').textContent]])));
await scenario('Year in review', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  eq(S + 'year chips, newest first, each year with dated watches', await txt(page, '#yirYears .chip'), ['2026', '2025', '2024']);
  eq(S + 'default is the current year', await page.$eval('#yirYears .chip[aria-pressed="true"]', c => c.textContent), '2026');
  for (const Y of ['2026', '2025', '2024']) {
    await page.click(`#yirYears [data-year="${Y}"]`);
    const m = yirModel(Y), L = S + Y + ': ';
    const c = await cardsOf(page);
    eq(L + 'films watched', c['Films watched'][0], String(m.n));
    eq(L + 'average rating', c['Average rating'], [m.avg, `${m.nRated} rated`]);
    eq(L + 'best month', c['Best month'], [m.bm, `${m.bmN} film${m.bmN === 1 ? '' : 's'}`]);
    eq(L + 'top genre', c['Top genre'][0], m.topG ? m.topG[0] : '–');
    eq(L + 'top director', c['Top director'][0], m.topD ? m.topD.n : '–');
    eq(L + 'rewatches (a rewatch only when the same film was seen earlier)', c['Rewatches'][0], String(m.re));
    eq(L + 'first film', c['First film'], [m.first.title, house(m.first.date)]);
    eq(L + 'last film', c['Last film'], [m.last.title, house(m.last.date)]);
    eq(L + 'highest rated: up to 5, ties newest first', await txt(page, '#yirBest .t'), m.best.map(ty));
    eq(L + 'highest rated: rating and date', await page.$$eval('#yirBest li', ls => ls.map(l => [l.querySelector('.r').textContent, l.querySelector('.sub').textContent])), m.best.map(r => [`${r.rating}/10`, house(r.date)]));
  }
  // hand-worked 2026 answers
  await page.click('#yirYears [data-year="2026"]');
  const c = await cardsOf(page);
  eq(S + '2026 by hand: 12 films, 7.5 average', [c['Films watched'][0], c['Average rating'][0]], ['12', '7.5']);
  eq(S + '2026 by hand: March, Drama, Mira Voss (beats Ada Quill on average), 1 rewatch', [c['Best month'][0], c['Top genre'][0], c['Top director'][0], c['Rewatches'][0]], ['March', 'Drama', 'Mira Voss', '1']);
  eq(S + '2026 by hand: top five', await txt(page, '#yirBest .t'), ['Velvet Signal (1987)', 'Burning Voyage (1991)', 'Salt Orchard (2019)', 'Night Ferry (2011)', 'Paper Lanterns (1998)']);
  eq(S + '2025: Iron Lantern counts as a rewatch because an undated earlier row exists', (await (async () => { await page.click('#yirYears [data-year="2025"]'); return (await cardsOf(page))['Rewatches'][0]; })()), '1');
  noWrites(E, 'Year in review');
});
await scenario('Year in review: Copy summary', LAPTOP, async E => {
  const { page, S } = E;
  await tools(page);
  await page.evaluate(() => { window.__clip = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; } } }); });
  await page.click('#yirCopy');
  eq(S + 'says Copied', await one1(page, '#yirMsg'), 'Copied');
  const m = yirModel('2026');
  const want = ['Film Vault: 2026 in review', 'Films watched: 12 (1 rewatch)', 'Average rating: 7.5', 'Best month: March (4 films)', 'Top genre: Drama (5)', 'Top director: Mira Voss (2)',
    'Highest rated: ' + m.best.map(r => `${r.title} (${r.rating})`).join(', '), 'First film: Velvet Signal (1987), 4 Jan 26', 'Last film: Closest Call (2005), 2 Nov 26'].join('\n');
  eq(S + 'clipboard text', await page.evaluate(() => window.__clip), want);
  check(S + 'the fallback text box stays hidden when copying works', await page.$eval('#yirText', t => t.hidden));
  // blocked
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } }); });
  await page.click('#yirCopy');
  check(S + 'blocked: a message says so', /blocked/i.test(await one1(page, '#yirMsg')), await one1(page, '#yirMsg'));
  eq(S + 'blocked: the summary is shown to copy by hand', await page.$eval('#yirText', t => [t.hidden, t.value]), [false, want]);
  await page.click('#yirYears [data-year="2025"]');
  check(S + 'changing year clears the message and the text box', (await one1(page, '#yirMsg')) === '' && await page.$eval('#yirText', t => t.hidden));
  await page.click('#yirCopy');
  check(S + 'blocked (or missing clipboard) still tells the person', /blocked/i.test(await one1(page, '#yirMsg')));
  noWrites(E, 'Copy summary');
});
await scenario('Year in review: no dated watches', LAPTOP, { setup: f => { for (let r = 3; r < f.grid.length + 1; r++) f.setCell(r, 'Date', ''); } }, async E => {
  const { page, S } = E;
  await tools(page);
  check(S + 'empty state', /No dated watches yet/.test(await one1(page, '#yirBody')), await one1(page, '#yirBody'));
  check(S + 'On this day and Goal still draw', /Nothing logged on 7 Nov/.test(await one1(page, '#otdBody')) && (await goalVals(page)).watched === '0');
});

/* =============================== 9. More like this + Top picks =============================== */
await scenario('More like this', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  check(S + 'before a pick there is a hint', /Pick a film you have seen/.test(await one1(page, '#recBody')));
  await page.fill('#recQ', 'night');
  eq(S + 'search lists seen films only', await txt(page, '#recPick .t'), ['Night Ferry (2011)']);
  await page.fill('#recQ', 'wish');
  eq(S + 'unseen films are not offered', await txt(page, '#recPick'), ['No seen film matches that.']);
  await page.fill('#recQ', 'night'); await page.click('#recPick button');
  eq(S + 'heading names the film', await one1(page, '#recHead'), 'Because you watched Night Ferry (2011)');
  // model: shared director / cast / genre with Night Ferry
  const base = REC.find(r => r.title === 'Night Ferry');
  const nm = s => s.split(',').map(x => x.trim()).filter(Boolean);
  const cands = uniq(unseenR.filter(r => waiting(r) && !hasSeenRow(keyOf(r)))).map(r => {
    const sd = nm(r.director).filter(n => nm(base.director).includes(n)), sc = nm(r.starring).filter(n => nm(base.starring).includes(n)), sg = r.genre && r.genre === base.genre ? 1 : 0;
    return { r, n: sd.length + sc.length + sg, sd, sc, sg };
  }).filter(x => x.n > 0);
  const byCount = c => cands.filter(x => x.n === c).map(x => x.r.title).sort();
  const got = await txt(page, '#mltList .t');
  const gotTitles = got.map(t => t.replace(/ \(\d+\)$/, ''));
  eq(S + 'model: 9 candidates; Like G (Unavailable) and Like H (Coming Soon) are not offered', [cands.length, cands.some(x => /Like [GH]/.test(x.r.title))], [9, false]);
  eq(S + 'shows at most 8', gotTitles.length, 8);
  eq(S + 'note says 8 of 9', await one1(page, '#mltNote'), '8 of 9');
  const counts = gotTitles.map(t => cands.find(x => x.r.title === t).n);
  eq(S + 'ranked by shared things, most first', counts, [...counts].sort((a, b) => b - a));
  eq(S + 'the 3-shared films come first', gotTitles.slice(0, byCount(3).length).sort(), byCount(3));
  eq(S + 'then the 2-shared films', gotTitles.slice(byCount(3).length, byCount(3).length + byCount(2).length).sort(), byCount(2));
  // ties broken by the Plan score, then sheet order
  const ties = await page.evaluate(titles => { const P = buildProfile(); return titles.map(t => { const f = state.films.find(x => x.title === t && !x.seen); return [t, scoreFilm(f, P).s, f._row]; }); }, gotTitles);
  const sc = Object.fromEntries(ties.map(t => [t[0], t]));
  let tieOk = true;
  for (let i = 1; i < gotTitles.length; i++) {
    const a = sc[gotTitles[i - 1]], b = sc[gotTitles[i]];
    if (counts[i - 1] === counts[i] && !(a[1] > b[1] || (a[1] === b[1] && a[2] < b[2]))) tieOk = false;
  }
  check(S + 'ties are ordered by score, then sheet row', tieOk, ties);
  const subs = Object.fromEntries((await page.$$eval('#mltList li', ls => ls.map(l => [l.querySelector('.t').textContent.replace(/ \(\d+\)$/, ''), l.querySelector('.sub').textContent]))));
  eq(S + 'row text: Like A shares director, cast and genre', subs['Like A'], 'Same director: Ben Roe · Shared cast: Cora Vale · Same genre: Thriller');
  eq(S + 'row text: Like E shares one of two directors and the genre', subs['Like E'], 'Same director: Ben Roe · Same genre: Thriller');
  eq(S + 'row text: Like C shares a cast member and the genre', subs['Like C'], 'Shared cast: Dex Hill · Same genre: Thriller');
  eq(S + 'Up next and Soon films are included', [gotTitles.includes('Soon One'), got.some(t => /^Up Three/.test(t)) || cands.some(x => x.r.title === 'Up Three')], [true, true]);
  eq(S + 'the film itself is never listed', gotTitles.includes('Night Ferry'), false);
  // opening a row opens the edit panel
  await page.click('#mltList button'); await page.waitForTimeout(150);
  check(S + 'a row opens the film in the edit panel', await page.$eval('#filmDlg', d => d.open) && (await page.inputValue('#fd-title')) === gotTitles[0]);
  await page.click('#fdClose'); await page.waitForTimeout(100);
  // a film that shares nothing
  await page.fill('#recQ', 'closest'); await page.click('#recPick button');
  check(S + 'a film that nothing waiting shares says so (or lists its matches)', (await page.$$('#mltList')).length === 1 || /Nothing waiting shares/.test(await one1(page, '#recBody')));
  noWrites(E, 'More like this');
});
await scenario('Top picks for you', BOTH, async E => {
  const { page, S } = E;
  await tools(page);
  const want = await page.evaluate(() => pickList().slice(0, 8).map(x => [titleYear(x.f), x.why.join(' · ') || 'On your watchlist']));
  eq(S + 'first 8 of pickList() with their why-lines', await page.$$eval('#topPicks li', ls => ls.map(l => [l.querySelector('.t').textContent, l.querySelector('.sub').textContent])), want);
  eq(S + 'eight rows', want.length, 8);
  const notUp = await page.evaluate(() => pickList().slice(0, 8).every(x => !isUp(x.f) && !x.f.seen));
  check(S + 'none is already in Up next or seen', notUp);
  await page.click('#topPicks button'); await page.waitForTimeout(150);
  check(S + 'a row opens the edit panel', await page.$eval('#filmDlg', d => d.open) && (await page.inputValue('#fd-title')) === want[0][0].replace(/ \(\d+\)$/, ''));
  await page.click('#fdClose');
  noWrites(E, 'Top picks');
});

/* =============================== 10. read-only overall =============================== */
await scenario('read-only: a tour of every control writes nothing', LAPTOP, async E => {
  const { page, S } = E;
  await tools(page);
  await stubRandom(page, 0.3);
  for (const k of Object.keys(POOL_LABEL)) { await page.click(`#dipPools [data-pool="${k}"]`); await page.click('#dipSpin'); await page.click('#dipAgain').catch(() => {}); }
  for (const q of ['wish', 'echo', 'zz', 'cafe']) await page.fill('#ownQ', q);
  for (const y of ['2025', '2024', '2026']) await page.click(`#yirYears [data-year="${y}"]`);
  await page.fill('#recQ', 'burning'); await page.click('#recPick button');
  await page.click('#refreshBtn'); await page.waitForTimeout(200);
  noWrites(E, 'whole tour');
});

/* =============================== 11. Backlog (Plan) =============================== */
const planTitles = page => page.$$eval('#planBack > li .t', es => es.map(e => e.textContent));
async function backlogModel(page, filter) {   // the existing scorer, ordered by score desc then sheet row, one per film
  return page.evaluate(f => {
    const P = buildProfile(), seen = new Set(), out = [];
    const rows = state.films.filter(inBacklog).filter(x => new Function('x', 'return ' + f)(x));
    for (const sc of rows.map(x => scoreFilm(x, P)).sort((a, b) => b.s - a.s || a.f._row - b.f._row)) { if (seen.has(sc.f.key)) continue; seen.add(sc.f.key); out.push([sc.f.title, sc.s, sc.why.join(' · '), sc.f._row]); }
    return out;
  }, filter || 'true');
}
await scenario('Backlog: top 10 by score', BOTH, { fixture: () => buildPlanFixture({ unsorted: 25 }), setup: f => { f.setCell(f.rowOfTitle('Pending A'), 'Why', 'Recommended by Sam'); } }, async E => {
  const { page, S } = E;
  await tab(page, 'library'); await page.click('[data-mode="plan"]'); await page.waitForTimeout(150);
  eq(S + 'heading is Backlog', await one1(page, '#planBackH'), 'Backlog');
  const rank = await backlogModel(page);
  eq(S + 'the first 10 are the top 10 by score (existing scoring, ties by sheet row)', await planTitles(page), rank.slice(0, 10).map(r => r[0]));
  check(S + 'model: scores are not in sheet order (so this is a real ranking)', JSON.stringify(rank.slice(0, 10).map(r => r[3])) !== JSON.stringify([...rank.slice(0, 10).map(r => r[3])].sort((a, b) => a - b)));
  check(S + 'model: scores never go up down the list', rank.every((r, i) => i === 0 || rank[i - 1][1] >= r[1]));
  const note = await one1(page, '#planBackNote');
  check(S + 'note says Top 10 by score and counts the films waiting', /Top 10 by score/.test(note) && new RegExp(`^${rank.length} films waiting`).test(note), note);
  eq(S + 'ten rows', (await planTitles(page)).length, 10);
  // scoring reason on the second line, muted
  const rows = await page.$$eval('#planBack > li', ls => ls.map(l => ({ t: l.querySelector('.t').textContent, reason: (l.querySelector('.reason') || {}).textContent || null, why: l.querySelector('.why').textContent, color: l.querySelector('.reason') ? getComputedStyle(l.querySelector('.reason')).color : null })));
  const byTitle = Object.fromEntries(rank.map(r => [r[0], r[2]]));
  check(S + 'each row shows the scoring reason joined with " · " (or none when there is none)', rows.every(r => (byTitle[r.t] ? r.reason === byTitle[r.t] : r.reason === null)), rows.map(r => [r.t, r.reason, byTitle[r.t]]));
  check(S + 'at least one row has a reason with " · " in it and one is muted-coloured', rows.some(r => r.reason && r.reason.includes(' · ')) && rows.every(r => !r.color || r.color === rows.find(x => x.color).color));
  const pa = rank.findIndex(r => r[0] === 'Pending A');
  if (pa >= 0 && pa < 10) eq(S + 'a film\'s own Why note still shows, as before', rows.find(r => r.t === 'Pending A').why, '“Recommended by Sam”');
  eq(S + 'rows keep Up next / Soon / Someday actions', await page.$$eval('#planBack > li:first-child .acts button', b => b.map(x => x.textContent)), ['Up next', 'Soon', 'Someday']);
  // Show more
  eq(S + 'button reads Show 10 more', await one1(page, '#planMore'), 'Show 10 more');
  await page.click('#planMore');
  eq(S + 'Show more adds 10 (20 shown, still in rank order)', await planTitles(page), rank.slice(0, 20).map(r => r[0]));
  await page.click('#planMore');
  eq(S + 'and 10 more again (all remaining)', await planTitles(page), rank.slice(0, 30).map(r => r[0]));
  check(S + 'the button is gone when everything is shown', await page.$eval('#planMore', b => b.hidden));
  check(S + 'the note says Top 30 by score then', /Top 30 by score/.test(await one1(page, '#planBackNote')), await one1(page, '#planBackNote'));
  // filters apply before ranking
  await page.fill('#libSearch', 'vera'); await page.waitForTimeout(350);
  const rv = await backlogModel(page, "[x.title,x.director,x.starring,x.genre,x.year].some(v => String(v ?? '').toLowerCase().includes('vera'))");
  eq(S + 'search "vera" filters first, back to the first page of 10, ranked', await planTitles(page), rv.slice(0, 10).map(r => r[0]));
  await page.fill('#libSearch', '');  await page.waitForTimeout(350);
  await page.selectOption('#libGenre', 'Drama'); await page.waitForTimeout(100);
  const rd = await backlogModel(page, "x.genre === 'Drama'");
  eq(S + 'genre filter applies before ranking', await planTitles(page), rd.slice(0, 10).map(r => r[0]));
  await page.selectOption('#libOwned', 'Owned'); await page.waitForTimeout(100);
  const ro = await backlogModel(page, "x.genre === 'Drama' && x.purchase === 'Owned'");
  eq(S + 'genre + owned', await planTitles(page), ro.slice(0, 10).map(r => r[0]));
  check(S + 'and the count follows the filters', new RegExp(`^${ro.length} films? waiting`).test(await one1(page, '#planBackNote')), await one1(page, '#planBackNote'));
});
await scenario('Backlog: a short list and the Up next action still work', LAPTOP, { fixture: () => buildPlanFixture({ unsorted: 4 }) }, async E => {
  const { page, S, fake } = E;
  await tab(page, 'library'); await page.click('[data-mode="plan"]'); await page.waitForTimeout(150);
  const rank = await backlogModel(page);
  check(S + 'fewer than 10 waiting: all shown, no Show more', (await planTitles(page)).length === rank.length && await page.$eval('#planMore', b => b.hidden), rank.length);
  const t = (await planTitles(page))[0];
  await page.click(`#planBack button[aria-label="Add to Up next: ${t}"]`); await settle(page);
  check(S + 'Up next from the Backlog still writes Plan = Up next', fake.cell(fake.rowOfTitle(t), 'Plan') === 'Up next');
  check(S + 'and the film leaves the Backlog', !(await planTitles(page)).includes(t));
});

/* =============================== 12. symmetry =============================== */
const R = (page, sel) => page.$$eval(sel, es => es.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
await scenario('symmetry', LAPTOP, async E => {
  const { page, S } = E;
  await tools(page);
  // exercise the tallest states first
  await stubRandom(page, 0); await page.click('#dipPools [data-pool="watch"]'); await page.click('#dipSpin');
  await page.fill('#ownQ', 'wish'); await page.fill('#recQ', 'night'); await page.click('#recPick button');
  await page.waitForTimeout(100);
  const rows = await page.$$eval('#view-tools .dash-2', ds => ds.map(d => [...d.children].map(c => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })));
  eq(S + 'four rows of two panels', rows.map(r => r.length), [2, 2, 2, 2]);
  rows.forEach((rs, i) => {
    check(S + `row ${i + 1}: same top, height and width`, rs.every(r => near(r.t, rs[0].t) && near(r.h, rs[0].h) && near(r.w, rs[0].w)), rs.map(r => [r.t, r.h, r.w]));
    check(S + `row ${i + 1}: 20px gap`, near(rs[1].l - rs[0].r, 20), rs[1].l - rs[0].r);
  });
  const vgaps = rows.slice(1).map((rs, i) => rs[0].t - rows[i][0].b);
  check(S + 'rows inside the Tools band are 20px apart; the band heading sits between the two bands', near(vgaps[1], 20) && near(vgaps[2], 20) && vgaps[0] > 40, vgaps);
  const heads = await R(page, '#view-tools .dash-2 > .panel > .panel-head');
  const byRow = [0, 1, 2, 3].map(i => heads.slice(i * 2, i * 2 + 2));
  check(S + 'panel heads in a row have the same top and height', byRow.every(h => near(h[0].t, h[1].t) && near(h[0].h, h[1].h)), byRow);
  check(S + 'every panel head is at least 32px tall (shared minimum)', heads.every(h => h.h >= 31.5), heads.map(h => h.h));
  const pad = await page.$$eval('#view-tools .panel', ps => ps.map(p => getComputedStyle(p).padding));
  check(S + 'all panels have the same padding', new Set(pad).size === 1, [...new Set(pad)]);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(S + 'no horizontal page scroll', sw <= 0, sw);
  const inside = await page.$$eval('#view-tools .panel', ps => ps.every(p => [...p.querySelectorAll('*')].every(e => { const r = e.getBoundingClientRect(), q = p.getBoundingClientRect(); return !r.width || (r.left >= q.left - 1 && r.right <= q.right + 1); })));
  check(S + 'nothing spills out of a panel', inside);
  await page.screenshot({ path: SHOTS + '/sym-laptop.png', fullPage: true });
});
await scenario('symmetry', ['phone'], async E => {
  const { page, S } = E;
  await tools(page);
  await stubRandom(page, 0); await page.click('#dipPools [data-pool="watch"]'); await page.click('#dipSpin');
  await page.fill('#ownQ', 'wish'); await page.fill('#recQ', 'night'); await page.click('#recPick button');
  await page.waitForTimeout(100);
  const ps = await R(page, '#view-tools .panel');
  eq(S + 'eight panels, stacked', ps.length, 8);
  check(S + 'same left edge and width', ps.every(p => near(p.l, ps[0].l) && near(p.w, ps[0].w)), ps.map(p => [p.l, p.w]));
  check(S + 'stacked, none beside another', ps.every((p, i) => i === 0 || p.t >= ps[i - 1].b - 1), ps.map(p => [p.t, p.b]));
  check(S + '16px side gutters', near(ps[0].l, 16) && near(390 - ps[0].r, 16), [ps[0].l, 390 - ps[0].r]);
  const gaps = ps.slice(1).map((p, i) => p.t - ps[i].b);
  check(S + 'panels inside a band are 20px apart; the band heading sits between the bands', [0, 2, 3, 4, 5, 6].every(i => near(gaps[i], 20)) && gaps[1] > 40, gaps);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(S + 'no horizontal page scroll', sw <= 0, sw);
  const inside = await page.$$eval('#view-tools .panel', pp => pp.every(p => [...p.querySelectorAll('*')].every(e => { const r = e.getBoundingClientRect(), q = p.getBoundingClientRect(); return !r.width || (r.left >= q.left - 1 && r.right <= q.right + 1); })));
  check(S + 'nothing spills out of a panel', inside);
  const small = await page.$$eval('#view-tools button, #view-tools input, #view-tools select', es => es.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 20), Math.round(r.height)]; }).filter(x => x[1] < 28));
  check(S + 'no tiny tap targets', small.length === 0, small);
  await page.screenshot({ path: SHOTS + '/sym-phone.png', fullPage: true });
});

/* =============================== 13. empty data =============================== */
await scenario('empty sheet: every panel has a sensible empty state', BOTH, { fixture: () => ({ films: [['', '', 'RATINGS'], buildToolsFixture().films[1]], settings: [['key', 'value', 'note'], ['yearlyGoal', '120', 'x']], names: {} }) }, async E => {
  const { page, S } = E;
  await tools(page);
  const t = await one1(page, '#view-tools');
  check(S + 'no NaN, undefined, Infinity or null on the page', !/NaN|undefined|Infinity|null/.test(t), t.slice(0, 200));
  check(S + 'Highlight says there is no film', /No film rated 8 or higher/.test(await one1(page, '#hotdBody')));
  check(S + 'Lucky dip: empty pool', /Nothing in this pool/.test(await one1(page, '#dipBody')));
  check(S + 'Stalled: Nothing stalled.', (await one1(page, '#stallBody')) === 'Nothing stalled.');
  check(S + 'Year in review: no dated watches', /No dated watches yet/.test(await one1(page, '#yirBody')));
  check(S + 'More like this and Top picks have hints', /Pick a film/.test(await one1(page, '#recBody')) && /Nothing to recommend yet/.test(await one1(page, '#topPicks')));
  eq(S + 'Goal planner shows 0 watched', (await goalVals(page)).watched, '0');
  await page.fill('#ownQ', 'x'); eq(S + 'Do I own this? on an empty sheet', await one1(page, '#ownList'), 'Not in your sheet.');
});

/* =============================== 14. screenshots (looked at by eye; the files are not compared) =============================== */
for (const theme of ['totoro', 'matrix', 'default']) {
  await scenario('screenshot ' + theme, BOTH, { theme }, async E => {
    const { page, S, size } = E;
    await tools(page);
    await stubRandom(page, 0.2); await page.click('#dipPools [data-pool="watch"]'); await page.click('#dipSpin');
    await page.fill('#ownQ', 'wish'); await page.fill('#recQ', 'night'); await page.click('#recPick button');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/tools-${theme}-${size === 'laptop' ? '1280' : '390'}.png`, fullPage: true });
    check(S + 'screenshot taken', true);
  });
}
for (const size of BOTH) {
  await scenario('screenshot plan backlog', [size], { fixture: () => buildPlanFixture({ unsorted: 25 }), theme: 'totoro' }, async E => {
    const { page, S } = E;
    await tab(page, 'library'); await page.click('[data-mode="plan"]'); await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('planBackH').scrollIntoView());
    await page.waitForTimeout(100);
    await page.locator('#planBack').locator('xpath=ancestor::section').screenshot({ path: `${SHOTS}/plan-backlog-${size === 'laptop' ? '1280' : '390'}.png` });
    check(S + 'screenshot taken', true);
  });
}

console.log(`\n${passes} passed, ${failures} failed`);
await browser.close();
process.exit(failures ? 1 : 0);
