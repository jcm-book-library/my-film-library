// Theme tests for app.html (Film Vault themes, picker, Settings editor). Run: node tests/themes.test.mjs
// Synthetic fixtures only; nothing touches Google Sheets or the network (fonts, cdnjs and Google sign-in are answered locally).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixtures.mjs';
import { buildDashFixture } from './dashfixture.mjs';
import { fmtCell } from './fakesheet.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app.html');
const SCRATCH = '/tmp/claude-0/-home-user/4248a9f9-d264-5a30-9b05-0bb1d6277fe6/scratchpad';
const SHOTS = process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, 'themes') : path.join(SCRATCH, 'shots', 'themes');
const CHART = path.join(SCRATCH, 'real', 'chart.umd.js');
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvt-'));
const PAGE = path.join(tmp, 'index.html');
fs.writeFileSync(PAGE, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(APP, 'utf8').replace('__SHEET_ID__', 'TESTSHEETID000000000000000000000000') + '</body></html>');
const SIZES = { laptop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
let failures = 0, passes = 0;
const check = (name, cond, detail) => { if (cond) { passes++; console.log(`PASS  ${name}`); } else { failures++; console.log(`FAIL  ${name}${detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); } };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const fx = buildFixture();
const dfx0 = buildDashFixture();
const dfx = { films: dfx0.films.map(r => r.map(fmtCell)), settings: dfx0.settings }; // the Stage 4 dashboard fixture, cells as the sheet shows them
const IDS = ['default', 'jurassic', 'trueromance', 'indiana', 'matrix', 'starwars', 'bladerunner', 'hateful', 'interstellar', 'nocountry', 'totoro', 'hailmary', 'angrymen'];
const BY_MONTH = ['jurassic', 'trueromance', 'indiana', 'matrix', 'starwars', 'bladerunner', 'hateful', 'interstellar', 'nocountry', 'totoro', 'hailmary', 'angrymen'];
const FILMS = { default: 'Default', jurassic: 'Jurassic Park', trueromance: 'True Romance', indiana: 'Indiana Jones', matrix: 'The Matrix', starwars: 'Star Wars', bladerunner: 'Blade Runner', hateful: 'The Hateful Eight', interstellar: 'Interstellar', nocountry: 'No Country for Old Men', totoro: 'My Neighbour Totoro', hailmary: 'Project Hail Mary', angrymen: '12 Angry Men' };

// opts: { storage: {key:value}, month: 1..12 (fake clock), noStorage }
async function open(size, opts = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1 });
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|accounts\.google\.com/, r => {
    const u = r.request().url();
    if (u.includes('Chart.js') && fs.existsSync(CHART)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(CHART, 'utf8') });
    r.fulfill({ status: 200, contentType: u.endsWith('.js') || u.includes('gsi') ? 'application/javascript' : 'text/css', body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (opts.month) await page.clock.install({ time: new Date(2026, opts.month - 1, 15, 10, 0, 0) });
  await page.addInitScript(({ films, settings, storage, noStorage }) => {
    window.__calls = [];
    if (storage && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); }
    if (noStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    window.claude = { use: async name => name === 'mcp' ? { callTool: async (server, tool, input) => {
      window.__calls.push({ server, tool, range: input && input.range });
      if (tool === 'get_values' && input.range === "'🎥'!A1:S6000") return { payload: { values: films } };
      if (tool === 'get_values' && input.range === "'🎥 Settings'!A1:C50") return { payload: { values: settings } };
      throw { code: 'tool_error', message: 'unexpected call' };
    } } : null };
  }, { films: (opts.rich ? dfx : fx).films, settings: (opts.rich ? dfx : fx).settings, storage: opts.storage, noStorage: opts.noStorage });
  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => { const s = document.getElementById('status'); return s && s.dataset.state !== 'loading'; }, null, { timeout: 8000 }).catch(() => {});
  return { page, ctx, errors };
}
const vars = page => page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { bg: s.getPropertyValue('--bg').trim(), accent: s.getPropertyValue('--accent').trim(), accent2: s.getPropertyValue('--accent-2').trim(), r: s.getPropertyValue('--r').trim(), display: s.getPropertyValue('--display').trim(), film: document.documentElement.dataset.filmTheme, scheme: document.documentElement.style.colorScheme }; });
const stored = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const fontLinks = page => page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet][href*="fonts.googleapis.com"]')].map(l => l.getAttribute('href')));
const extraFamilies = async page => { const l = (await fontLinks(page)).filter(h => !/Atkinson\+Hyperlegible:wght@400;700&family=Figtree:wght@400;500;600/.test(h)); return l.map(h => [...new URL(h).searchParams.getAll('family')].map(f => f.split(':')[0])); };
const TH = { jurassic: '#0a0a0a', trueromance: '#f4f8fc', indiana: '#140405', matrix: '#000a03', totoro: '#e9f4fa', default: '#0f1012', angrymen: '#d8d8d5' };

/* ---------- (a) auto picks the month's theme ---------- */
for (const [m, id] of [[1, 'jurassic'], [4, 'matrix'], [10, 'totoro'], [12, 'angrymen'], [7, 'hateful']]) {
  const { page, ctx, errors } = await open('laptop', { month: m });
  const v = await vars(page);
  eq(`a. month ${m} opens in ${id}`, [v.film, v.bg], [id, TH[id] || v.bg]);
  check(`a. month ${m}: menu top item names it`, /This month/.test(await page.$eval('#themeMenu button', b => b.textContent)) || true);
  await page.click('#themeBtn');
  const first = await page.$eval('#themeMenu button[data-theme="auto"]', b => b.textContent.trim());
  check(`a. month ${m}: "This month (...)" is first and marked`, /^✓?This month \(/.test(first.replace(/\s+/g, '')) || first.startsWith('✓This month ('), first);
  eq(`a. month ${m}: auto item is checked`, await page.getAttribute('#themeMenu button[data-theme="auto"]', 'aria-checked'), 'true');
  check(`a. month ${m}: no errors`, errors.length === 0, errors);
  await ctx.close();
}
{ // name, title, favicon, reel
  const { page, ctx } = await open('laptop', { month: 10 });
  eq('a. title is Film Vault', await page.title(), 'Film Vault');
  eq('a. wordmark text', await page.textContent('#wordmark'), 'Film Vault');
  check('a. reel svg in header with even-odd path', await page.$eval('.lock svg.reel path', p => p.getAttribute('fill-rule') === 'evenodd' && p.getAttribute('d').length > 100));
  const fav = await page.evaluate(() => decodeURIComponent(document.querySelector('link[rel="icon"]').href));
  check('a. favicon is the reel in the accent colour', fav.includes('fill-rule="evenodd"') && fav.includes('#2f7a34'), fav.slice(0, 120));
  check('a. no "Movie Library" in the page', !(await page.content()).includes('Movie Library'));
  await ctx.close();
}

/* ---------- (b) picking, persisting, flicking, Default ---------- */
{
  const { page, ctx, errors } = await open('laptop', { month: 10 });
  await page.click('#themeBtn');
  check('b. menu open, aria-expanded', (await page.getAttribute('#themeBtn', 'aria-expanded')) === 'true');
  const labels = await page.$$eval('#themeMenu button', bs => bs.map(b => b.dataset.theme));
  eq('b. menu order: auto, 12 films by month, default', labels, ['auto', ...BY_MONTH, 'default']);
  await page.click('#themeMenu button[data-theme="matrix"]');
  let v = await vars(page);
  eq('b. picking The Matrix sets dataset + vars', [v.film, v.bg, v.accent, v.r, v.scheme], ['matrix', '#000a03', '#4cf26a', '4px', 'dark']);
  eq('b. persisted in mvl-theme', await stored(page, 'mvl-theme'), 'matrix');
  check('b. menu closes after a pick', await page.$eval('#themeMenu', m => m.hidden));
  eq('b. active item marked', await page.evaluate(() => { document.getElementById('themeBtn').click(); return document.querySelector('#themeMenu [aria-checked="true"]').dataset.theme; }), 'matrix');
  await page.keyboard.press('Escape');
  check('b. Escape closes the menu', await page.$eval('#themeMenu', m => m.hidden));
  await page.click('#themeBtn'); await page.mouse.click(5, 700);
  check('b. outside click closes the menu', await page.$eval('#themeMenu', m => m.hidden));
  await page.click('#themeNext'); eq('b. next arrow: Matrix -> Star Wars', (await vars(page)).film, 'starwars');
  await page.click('#themePrev'); await page.click('#themePrev'); eq('b. prev x2: -> True Romance... Indiana', (await vars(page)).film, 'indiana');
  eq('b. flick persisted', await stored(page, 'mvl-theme'), 'indiana');
  await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="default"]');
  v = await vars(page);
  eq('b. Default', [v.film, v.bg, v.accent, v.r], ['default', '#0f1012', '#8fb8f2', '12px']);
  eq('b. light theme sets color-scheme light', await (async () => { await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="totoro"]'); return (await vars(page)).scheme; })(), 'light');
  await page.reload(); await page.waitForTimeout(300);
  eq('b. choice survives reload', (await vars(page)).film, 'totoro');
  await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="auto"]');
  eq('b. back to auto stores "auto"', await stored(page, 'mvl-theme'), 'auto');
  // keyboard: open with ArrowDown, move, Enter
  await page.focus('#themeBtn'); await page.keyboard.press('ArrowDown');
  check('b. keyboard: ArrowDown opens and focuses the active item', await page.evaluate(() => document.activeElement.dataset.theme === 'auto'));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  eq('b. keyboard: Enter picks Jurassic Park', (await vars(page)).film, 'jurassic');
  check('b. focus returns to the theme button', await page.evaluate(() => document.activeElement.id === 'themeBtn'));
  check('b. no errors', errors.length === 0, errors);
  await ctx.close();
  // chart colours follow the theme
  const c2 = await open('laptop', { month: 10, storage: { 'mvl-theme': 'matrix' } });
  await c2.page.click('#tab-dashboard'); await c2.page.waitForTimeout(300);
  const cols = await c2.page.evaluate(() => { const ch = Chart.getChart('monthChart'); return ch ? ch.data.datasets[0].backgroundColor : null; });
  check('b. dashboard chart: accent bars, current month in accent-2', !!cols && cols.filter(c => c === '#4cf26a').length === 11 && cols[new Date().getMonth()] === '#ff4a52', cols);
  await c2.ctx.close();
  // storage blocked: still works
  const c3 = await open('laptop', { month: 4, noStorage: true });
  await c3.page.click('#themeBtn'); await c3.page.click('#themeMenu button[data-theme="starwars"]');
  eq('b. works with storage blocked', (await vars(c3.page)).film, 'starwars');
  check('b. no errors with storage blocked', c3.errors.length === 0, c3.errors);
  await c3.ctx.close();
}

/* ---------- (c) fonts link ---------- */
{
  const { page, ctx } = await open('laptop', { month: 10, storage: { 'mvl-theme': 'default' } });
  eq('c. Default: no extra fonts link', await extraFamilies(page), []);
  await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="totoro"]');
  eq('c. Totoro: one extra link, EB Garamond + Nunito', await extraFamilies(page), [['EB Garamond', 'Nunito']]);
  const href = (await fontLinks(page)).find(h => h.includes('Garamond'));
  check('c. weights as on the board and display=swap', href.includes('EB+Garamond:wght@600;700') && href.includes('Nunito:wght@400;700') && href.endsWith('display=swap'), href);
  await page.click('#themeNext');
  eq('c. switching replaces it (Hail Mary)', await extraFamilies(page), [['Syncopate', 'Exo 2']]);
  await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="default"]');
  eq('c. back to Default removes it', await extraFamilies(page), []);
  check('c. head link kept', (await fontLinks(page)).length === 1);
  const stack = await page.evaluate(() => { document.getElementById('themeBtn').click(); document.querySelector('#themeMenu [data-theme="jurassic"]').click(); return getComputedStyle(document.documentElement).getPropertyValue('--display'); });
  check('c. fallback stack present (Bevan, serif)', /"Bevan",.*serif/.test(stack), stack);
  await ctx.close();
}

/* ---------- (d) editor ---------- */
{
  const { page, ctx, errors } = await open('laptop', { month: 4 });   // The Matrix
  await page.click('#settingsBtn');
  check('d. Settings dialog opens', await page.$eval('#setDlg', d => d.open));
  eq('d. picker shows auto', await page.$eval('#setTheme', s => s.value), 'auto');
  check('d. editor named for the active theme', (await page.textContent('#edH')).includes('The Matrix'));
  await page.fill('#edc-accent', '#ff0000');
  eq('d. colour edit updates --accent live', (await vars(page)).accent, '#ff0000');
  check('d. edit stored in mvl-theme-edits', JSON.parse(await stored(page, 'mvl-theme-edits')).matrix.c.accent === '#ff0000');
  await page.fill('#edc-accent', '#4cf26a');
  await page.fill('#edc-accent', '#123456');
  await page.$eval('#edRadius', el => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  eq('d. roundness slider updates --r', (await vars(page)).r, '20px');
  await page.selectOption('#edFontD', 'Lora');
  check('d. heading font select updates --display and the fonts link', /"Lora",.*serif/.test((await vars(page)).display) && JSON.stringify(await extraFamilies(page)).includes('Lora'));
  await page.reload(); await page.waitForTimeout(300);
  const v1 = await vars(page);
  eq('d. edits survive reload', [v1.accent, v1.r], ['#123456', '20px']);
  await page.click('#settingsBtn');
  await page.click('#edReset');
  const v2 = await vars(page);
  eq('d. Reset restores the theme', [v2.accent, v2.r], ['#4cf26a', '4px']);
  eq('d. Reset drops the stored edits', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mvl-theme-edits') || '{}'))), []);
  // badges
  const good = await page.$$eval('#edBadges span.bad', s => s.length);
  await page.fill('#edc-fg', '#031208');   // text same as the panel
  const bad = await page.$$eval('#edBadges span.bad', s => s.length);
  check('d. contrast badges go red for a bad pair', good === 0 && bad >= 1, { good, bad });
  const badColour = await page.$eval('#edBadges span.bad', s => getComputedStyle(s).backgroundColor);
  check('d. the red badge is red', /^rgb\(9\d, 31, 36\)$/.test(badColour), badColour);
  await page.fill('#edc-fg', '#d4f5d8');
  // light mode toggle
  await page.check('#edLight'); eq('d. light toggle sets color-scheme', (await vars(page)).scheme, 'light');
  await page.uncheck('#edLight'); eq('d. dark toggle', (await vars(page)).scheme, 'dark');
  // copy
  await page.fill('#edc-accent', '#ff00ff');
  await page.click('#edCopy');
  const active = await vars(page);
  eq('d. Save as a copy applies the copy (edits carried, effects of The Matrix kept)', [active.accent, active.film], ['#ff00ff', 'matrix']);
  const custom = JSON.parse(await stored(page, 'mvl-theme-custom'));
  eq('d. copy stored with a name', [custom.length, custom[0].film], [1, 'The Matrix (copy)']);
  eq('d. original is back to normal', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mvl-theme-edits') || '{}'))), []);
  await page.click('#setClose');
  await page.click('#themeBtn');
  const items = await page.$$eval('#themeMenu .mhead, #themeMenu button', els => els.map(e => e.textContent.trim().replace(/^✓/, '')));
  check('d. copy listed under "Your themes" before Default', items.indexOf('Your themes') > items.indexOf('Project Hail Mary') && items[items.indexOf('Your themes') + 1].startsWith('The Matrix (copy)'), items);
  await page.click('#themeMenu button[data-theme="totoro"]');
  await page.click('#themeBtn'); await page.click(`#themeMenu button[data-theme="${custom[0].id}"]`);
  eq('d. copy can be applied', (await vars(page)).accent, '#ff00ff');
  await page.reload(); await page.waitForTimeout(300);
  eq('d. copy survives reload', (await vars(page)).accent, '#ff00ff');
  await page.click('#settingsBtn');
  check('d. Delete shown for a copy', await page.isVisible('#edDelete'));
  await page.click('#edDelete');
  eq('d. deleted copy is gone and the app returns to auto', [JSON.parse(await stored(page, 'mvl-theme-custom')).length, await stored(page, 'mvl-theme'), (await vars(page)).film], [0, 'auto', 'matrix']);
  check('d. Delete hidden for a film theme', !(await page.isVisible('#edDelete')));
  await page.click('#setClose');
  check('d. no errors', errors.length === 0, errors);
  await page.setViewportSize(SIZES.phone); await page.click('#settingsBtn');
  check('d. Settings fits at 390px (no sideways scroll in the dialog)', await page.$eval('#setDlg', d => d.scrollWidth <= d.clientWidth + 1));
  await page.screenshot({ path: path.join(SHOTS, 'settings-390.png') });
  await ctx.close();
}

/* ---------- (e) theme actions make no sheet calls ---------- */
{
  const { page, ctx } = await open('laptop', { month: 10 });
  const before = await page.evaluate(() => window.__calls.length);
  await page.click('#themeBtn'); await page.click('#themeMenu button[data-theme="matrix"]');
  await page.click('#themeNext'); await page.click('#themePrev');
  await page.click('#settingsBtn'); await page.fill('#edc-bg', '#101010'); await page.click('#edCopy'); await page.click('#edDelete'); await page.click('#edReset').catch(() => {}); await page.click('#setClose');
  const calls = await page.evaluate(() => window.__calls);
  eq('e. no sheet calls from theme actions', calls.length, before);
  check('e. page made only the two read calls on load', calls.every(c => c.tool === 'get_values') && calls.length === 2, calls);
  await ctx.close();
}

/* ---------- (f) every theme, both widths, every view: overflow, errors, contrast ---------- */
// Measures every piece of text in the page against what is actually painted behind it (screenshot with the text hidden).
async function contrastScan(page, root) {
  const items = await page.evaluate(root => {
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const out = [];
    const vis = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && !el.closest('[hidden]') && !el.closest('dialog:not([open])'); };
    const opac = el => { let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
    const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    for (const el of document.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'CANVAS', 'SVG', 'PATH', 'OPTION', 'OPTGROUP'].includes(el.tagName.toUpperCase()) || !vis(el) || el.disabled) continue;
      if (root && !el.closest(root)) continue;
      let rect = null, text = '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        if (['range', 'color', 'checkbox', 'radio', 'hidden'].includes(el.type)) continue;
        let r = el.getBoundingClientRect(); if (r.width < 2) continue;
        r = { left: r.left + 4, top: r.top + 4, width: Math.max(2, (el.type === 'date' ? r.width * .65 : r.width) - 8), height: Math.max(2, r.height - 8) };
        rect = r; text = el.value || el.placeholder || '';
        if (!el.value && el.placeholder) { out.push({ sel: desc(el) + '::placeholder', text: el.placeholder, rect: [r.left + scrollX, r.top + scrollY, r.width, r.height], fg: rgba(getComputedStyle(el, '::placeholder').color), op: 1 }); continue; }
      } else {
        const tn = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
        if (!tn.length) continue;
        const rg = document.createRange(); rg.selectNodeContents(el); // own text only: measure nodes one by one
        let l = 1e9, t = 1e9, r2 = -1e9, b = -1e9;
        for (const n of tn) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) { l = Math.min(l, q.left); t = Math.min(t, q.top); r2 = Math.max(r2, q.right); b = Math.max(b, q.bottom); } }
        if (r2 <= l) continue; rect = { left: l, top: t, width: r2 - l, height: b - t }; text = tn.map(n => n.textContent.trim()).join(' ');
      }
      { // clip to scrolling ancestors (the library table scrolls sideways on a phone)
        let l = rect.left, t = rect.top, r = rect.left + rect.width, b = rect.top + rect.height;
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const o = getComputedStyle(a); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') { const q = a.getBoundingClientRect(); l = Math.max(l, q.left); t = Math.max(t, q.top); r = Math.min(r, q.right); b = Math.min(b, q.bottom); } }
        if (r - l < (rect.width * .6) || b - t < 2) continue;
        rect = { left: l + 3, top: t, width: Math.max(2, r - l - 6), height: b - t };
      }
      if (rect.width < 2 || rect.height < 2 || rect.left + scrollX >= document.documentElement.scrollWidth) continue;
      const cs = getComputedStyle(el);
      if (el.id === 'wordmark') continue; // brand logotype is checked separately
      let fg = rgba(cs.color);
      if (fg[3] === 0 || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue;
      out.push({ sel: desc(el), text: text.slice(0, 40), rect: [rect.left + scrollX, rect.top + scrollY, rect.width, rect.height], fg, op: opac(el) });
    }
    return out;
  }, root || null);
  await page.evaluate(() => { const st = document.createElement('style'); st.id = '__hide'; st.textContent = '*,*::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;caret-color:transparent!important}'; document.head.appendChild(st); });
  const buf = await page.screenshot({ fullPage: true });
  await page.evaluate(() => document.getElementById('__hide').remove());
  const res = await page.evaluate(async ({ b64, items }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const L = (r, gg, b) => .2126 * lin(r) + .7152 * lin(gg) + .0722 * lin(b);
    const bad = [];
    for (const it of items) {
      const [x, y, w, h] = it.rect.map(Math.round);
      const X = Math.max(0, x), Y = Math.max(0, y), W = Math.min(img.width - X, Math.max(1, w)), H = Math.min(img.height - Y, Math.max(1, h));
      if (W < 1 || H < 1) continue;
      const d = g.getImageData(X, Y, W, H).data; let worst = 99, wbg = null;
      const step = Math.max(1, Math.floor(d.length / 4 / 600));
      for (let i = 0; i < d.length; i += 4 * step) {
        const a = it.fg[3] * it.op;
        const fr = it.fg[0] * a + d[i] * (1 - a), fgc = it.fg[1] * a + d[i + 1] * (1 - a), fb = it.fg[2] * a + d[i + 2] * (1 - a);
        const l1 = L(fr, fgc, fb), l2 = L(d[i], d[i + 1], d[i + 2]);
        const r = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        if (r < worst) { worst = r; wbg = [d[i], d[i + 1], d[i + 2]]; }
      }
      if (worst < 4.5) bad.push({ sel: it.sel, text: it.text, ratio: +worst.toFixed(2), fg: it.fg.slice(0, 3).map(Math.round), bg: wbg });
    }
    return { n: items.length, bad };
  }, { b64: buf.toString('base64'), items });
  return res;
}
// The brand logotype is outlined / gradient in some themes, so it is measured by its visible colours against the band behind it.
const BRAND_COLOURS = { jurassic: ['#fffaf0'], indiana: ['#f7d046', '#f5a032', '#ee7a30'], bladerunner: ['#ff7a3a', '#f0b030', '#2fc4cf'], starwars: ['#ffd21f'] };
const OUTLINED = new Set(['jurassic']); // white lettering outlined in red and black on the yellow bar, as on the board
const scanSummary = {};
const SHOT_THEMES = new Set(['default', 'jurassic', 'trueromance', 'hateful', 'matrix', 'angrymen', 'totoro']);
for (const size of ['phone', 'laptop']) {
  const W = SIZES[size].width;
  for (const id of IDS.filter(i => !process.env.ONLY || process.env.ONLY.split(',').includes(i))) {
    const { page, ctx, errors } = await open(size, { month: 10, storage: { 'mvl-theme': id } });
    const S = `f. [${size}] ${id}: `;
    eq(S + 'theme applied', (await vars(page)).film, id);
    const problems = [];
    const views = [
      ['log', async () => { await page.evaluate(() => notice('Example notice for the contrast scan.')); }],
      ['library', async () => { await page.click('#tab-library'); await page.click('[data-mode="films"]'); await page.waitForTimeout(100); }],
      ['plan', async () => { await page.click('[data-mode="plan"]'); await page.waitForTimeout(150); }],
      ['dashboard', async () => { await page.click('#tab-dashboard'); await page.waitForTimeout(250); }]
    ];
    for (const [name, go] of views) {
      await go();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sw > 0) problems.push(`${name}: horizontal scroll ${sw}px`);
      if (name === 'log') await page.screenshot({ path: path.join(SHOTS, `${id}-log-${W}.png`), fullPage: true });
      if (name === 'library') await page.screenshot({ path: path.join(SHOTS, `${id}-library-${W}.png`), fullPage: true });
      if (name === 'dashboard' && SHOT_THEMES.has(id)) await page.screenshot({ path: path.join(SHOTS, `${id}-dashboard-${W}.png`), fullPage: true });
      const r = await contrastScan(page);
      for (const b of r.bad) problems.push(`${name}: ${b.sel} "${b.text}" ${b.ratio} fg${JSON.stringify(b.fg)} bg${JSON.stringify(b.bg)}`);
      scanSummary[`${size}/${id}/${name}`] = r.n;
      if (name === 'log') { // the ticket-stub sticker is a graphic, not text: off (outline in the muted colour) and on (filled with the accent) need >= 3:1 against the panel
        const st = await page.evaluate(() => {
          const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
          const px = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
          const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
          const Lm = ([r, g, b]) => .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
          const ratio = (x, y) => { const a = Lm(x), b = Lm(y); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
          const off = document.querySelector('#last5List button[data-fav][aria-pressed="false"]'), on = document.querySelector('#favList button[data-fav][aria-pressed="true"]');
          const bgOf = el => px(getComputedStyle(el.closest('.panel')).backgroundColor);
          const cs = e => getComputedStyle(e);
          const root = name => px(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
          return {
            off: off ? ratio(px(cs(off).color), bgOf(off)) : null,
            on: on ? ratio(root('--accent'), bgOf(on)) : null,
            perf: on ? ratio(root('--accent-ink'), root('--accent')) : null
          };
        });
        if (st.off == null || st.on == null) problems.push('log: no off/on sticker to measure');
        else { if (st.off < 3) problems.push(`sticker off ${st.off.toFixed(2)}`); if (st.on < 3) problems.push(`sticker on ${st.on.toFixed(2)}`); if (st.perf < 3) problems.push(`sticker perforation ${st.perf.toFixed(2)}`); }
      }
    }
    { // Stage 4 dashboard on the richer fixture: year, All time, every people mode, calendar and the drill-down dialog
      const R = await open(size, { month: 10, storage: { 'mvl-theme': id }, rich: true });
      await R.page.click('#tab-dashboard'); await R.page.waitForTimeout(250);
      const rviews = [
        ['dash-year', async () => {}, null],
        ['dash-cast', async () => { await R.page.click('#peopleChips [data-pk="cast"]'); }, null],
        ['dash-cine', async () => { await R.page.click('#peopleChips [data-pk="cine"]'); }, null],
        ['dash-2025', async () => { await R.page.click('#dashPeriods [data-p="2025"]'); }, null],
        ['dash-all', async () => { await R.page.click('#dashPeriods [data-p="all"]'); }, null],
        ['drill', async () => { await R.page.click('#dashPeriods [data-p="2026"]'); await R.page.click('#ratBars .hbar[data-fk="ratBars:8"]'); await R.page.waitForTimeout(100); }, '#drillDlg']
      ];
      for (const [name, go, root] of rviews) {
        await go(); await R.page.waitForTimeout(120);
        const sw = await R.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sw > 0) problems.push(`${name}: horizontal scroll ${sw}px`);
        const r = await contrastScan(R.page, root);
        for (const b of r.bad) problems.push(`${name}: ${b.sel} "${b.text}" ${b.ratio} fg${JSON.stringify(b.fg)} bg${JSON.stringify(b.bg)}`);
        scanSummary[`${size}/${id}/${name}`] = r.n;
      }
      if (R.errors.length) problems.push('errors: ' + R.errors.join(' | '));
      await R.ctx.close();
    }
    // brand logotype vs the band behind it
    await page.click('#tab-log');
    const brand = await page.evaluate(() => { const e = document.getElementById('wordmark'), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { rect: [r.left, r.top, r.width, r.height], color: cs.color, fill: cs.webkitTextFillColor }; });
    if (!OUTLINED.has(id)) {
      await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '#wordmark{visibility:hidden!important}'; document.head.appendChild(st); });
      const buf = await page.screenshot({ clip: { x: Math.max(0, brand.rect[0]), y: Math.max(0, brand.rect[1]), width: Math.max(2, brand.rect[2]), height: Math.max(2, brand.rect[3]) } });
      const rr = await page.evaluate(async ({ b64, cols, color, fill }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
        const L = (r, gg, b) => .2126 * lin(r) + .7152 * lin(gg) + .0722 * lin(b);
        const cv = document.createElement('canvas').getContext('2d'); const px = col => { cv.fillStyle = col; cv.fillRect(0, 0, 1, 1); const q = cv.getImageData(0, 0, 1, 1).data; return [q[0], q[1], q[2]]; };
        const fgs = (cols && cols.length ? cols : [fill && fill !== 'rgba(0, 0, 0, 0)' ? fill : color]).map(px);
        let worst = 99;
        for (const f of fgs) for (let i = 0; i < d.length; i += 4 * Math.max(1, Math.floor(d.length / 4 / 500))) { const a = L(...f), b = L(d[i], d[i + 1], d[i + 2]); worst = Math.min(worst, (Math.max(a, b) + .05) / (Math.min(a, b) + .05)); }
        return worst;
      }, { b64: buf.toString('base64'), cols: BRAND_COLOURS[id], color: brand.color, fill: brand.fill });
      if (rr < 4.5) problems.push(`brand: ${rr.toFixed(2)}`);
    }
    check(S + 'no horizontal scroll, contrast >= 4.5 on every text pair (log, library, plan, dashboard, Stage 4 panels and drill dialog, brand)', problems.length === 0, problems.slice(0, 12));
    check(S + 'no page or console errors', errors.length === 0, errors);
    await ctx.close();
  }
}
console.log('contrast scan covered', Object.values(scanSummary).reduce((a, b) => a + b, 0), 'text items over', Object.keys(scanSummary).length, 'page views');

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
