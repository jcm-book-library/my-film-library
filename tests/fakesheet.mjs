// In-memory fake of the Google Sheets tool surface the Film Vault uses (get_values / update_values / append_values),
// built from a SYNTHETIC fixture (every film, person and id is invented). Cells are typed like Sheets with USER_ENTERED:
//   number -> JS number, text -> JS string, date -> { date: 'yyyy-mm-dd' }, empty -> ''.
// Every call is recorded in `calls`. Fault injection: dropWrites, mutateAfterLoad, failNext, failAll, appendLandsAt, beforeAppend.

export const SHEET_ID = 'TESTSHEETID000000000000000000000000'; // a made-up id: the real one is not kept in this repo
export const HEADERS = ['Title', 'Rating', 'Status', 'Date', 'Starring', 'Director', 'Cinematography', 'Purchase', 'Genre', 'Platform', 'Release', 'Year', 'Notes', 'id', 'Plan', 'Order', 'Why', 'Sorted', 'Favourite'];
export const WIDTH = HEADERS.length;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const colLetter = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = L => L.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
export const colOf = name => HEADERS.indexOf(name);
export const D = iso => ({ date: iso });
export const isDate = v => !!v && typeof v === 'object' && 'date' in v;

export function fmtCell(v) {
  if (v === '' || v == null) return '';
  if (isDate(v)) { const [y, m, d] = v.date.split('-').map(Number); return `${d}-${MON[m - 1]}-${y}`; }
  return String(v);
}
// What USER_ENTERED does with a value sent through update_values / append_values
export function coerce(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return String(raw).toUpperCase();
  const s = String(raw);
  if (s === '') return '';
  if (s.startsWith("'")) return s.slice(1);           // apostrophe = "keep as text"
  let m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return D(s.trim());
  m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m && MON.map(x => x.toLowerCase()).includes(m[2].toLowerCase())) return D(`${m[3]}-${String(MON.map(x => x.toLowerCase()).indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  const t = s.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) || /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  return s;                                            // anything else stays text
}

export function parseRange(range) {
  let m = String(range).match(/^'([^']*)'!(.*)$/) || String(range).match(/^([^'!]+)!(.*)$/);
  if (!m) throw { code: 'tool_error', message: `Unable to parse range: ${range}` };
  const tab = m[1];
  const a = m[2].match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  if (!a) throw { code: 'tool_error', message: `Unable to parse range: ${range}` };
  const c1 = colIndex(a[1]), r1 = a[2] ? +a[2] : 1;
  const c2 = a[3] ? colIndex(a[3]) : c1, r2 = a[3] ? (a[4] ? +a[4] : Infinity) : r1;
  return { tab, c1, r1, c2, r2 };
}

export class FakeSheet {
  constructor(fixture, { filmsTab = '🎥', settingsTab = '🎥 Settings', favourite = true } = {}) {
    this.filmsTab = filmsTab; this.settingsTab = settingsTab;
    this.grid = structuredClone(fixture.films).map(r => { while (r.length < WIDTH) r.push(''); return r; });
    this.settings = structuredClone(fixture.settings);
    this.names = fixture.names || {};
    this.calls = [];
    if (!favourite) this.grid[1][colOf('Favourite')] = '';   // the Favourite header is missing: the app must cope
    this.initialRows = this.grid.length;
    this._drop = []; this._fail = []; this._failAll = null; this._afterLoad = null; this._loaded = false; this._landAt = null; this._beforeAppend = null;
  }
  /* ---- hooks ---- */
  dropWrites(pred) { this._drop.push(pred); return this; }
  mutateAfterLoad(fn) { this._afterLoad = fn; return this; }
  failNext(tool, errorObj, { apply = false } = {}) { this._fail.push({ tool, err: errorObj, apply }); return this; }
  failAll(errorObj) { this._failAll = errorObj; return this; }
  appendLandsAt(row) { this._landAt = row; return this; }
  beforeAppend(fn) { this._beforeAppend = fn; return this; }
  /* ---- direct access for tests ---- */
  snapshot() { return { films: structuredClone(this.grid), settings: structuredClone(this.settings) }; }
  rowOfId(id) { const c = colOf('id'); const i = this.grid.findIndex((r, ix) => ix >= 2 && r[c] === Number(id)); return i < 0 ? 0 : i + 1; }
  rowOfTitle(title, year) { const t = colOf('Title'), y = colOf('Year'); const i = this.grid.findIndex((r, ix) => ix >= 2 && String(r[t]) === title && (year == null || r[y] === year)); return i < 0 ? 0 : i + 1; }
  cell(row, name) { return (this.grid[row - 1] || [])[colOf(name)]; }
  setCell(row, name, raw) { while (this.grid.length < row) this.grid.push(Array(WIDTH).fill('')); this.grid[row - 1][colOf(name)] = coerce(raw); }
  insertRowAbove(row) { this.grid.splice(row - 1, 0, Array(WIDTH).fill('')); }
  maxId() { const c = colOf('id'); return Math.max(0, ...this.grid.slice(2).map(r => typeof r[c] === 'number' ? r[c] : 0)); }
  maxOrder() { const c = colOf('Order'); return Math.max(0, ...this.grid.slice(2).map(r => typeof r[c] === 'number' ? r[c] : 0)); }
  rowObj(row) { const r = this.grid[row - 1] || []; return Object.fromEntries(HEADERS.map((h, i) => [h, r[i]])); }
  lastDataRow() { for (let i = this.grid.length - 1; i >= 0; i--) if (this.grid[i].some(v => v !== '')) return i + 1; return 0; }

  /* ---- the tool surface ---- */
  handle(server, tool, input, opts) {
    const call = { n: this.calls.length, server, tool, spreadsheetId: input && input.spreadsheetId, range: input && input.range, values: input && input.values, raw: structuredClone(input), opts: opts || null };
    this.calls.push(call);
    if (this._failAll) { call.error = this._failAll; throw this._failAll; }
    const fi = this._fail.findIndex(f => f.tool === tool);
    if (fi >= 0) {
      const f = this._fail.splice(fi, 1)[0]; call.error = f.err;
      if (f.apply) { try { this._do(tool, input, call, true); } catch (e) { /* ignore */ } }
      throw f.err;
    }
    return this._do(tool, input, call, false);
  }
  _tab(name) {
    if (name === this.filmsTab) return this.grid;
    if (name === this.settingsTab) return this.settings;
    throw { code: 'tool_error', message: `Unable to parse range: tab "${name}" not found` };
  }
  _do(tool, input, call, forced) {
    if (input.spreadsheetId == null) throw { code: 'tool_error', message: 'missing spreadsheetId' };
    const R = parseRange(input.range);
    const grid = this._tab(R.tab);
    if (tool === 'get_values') {
      const out = [];
      const last = Math.min(R.r2, grid.length);
      for (let r = R.r1; r <= last; r++) {
        const row = grid[r - 1] || [];
        const cells = [];
        for (let c = R.c1; c <= R.c2; c++) cells.push(fmtCell(row[c]));
        while (cells.length && cells[cells.length - 1] === '') cells.pop();
        out.push(cells);
      }
      while (out.length && out[out.length - 1].length === 0) out.pop();
      const payload = { range: input.range, majorDimension: 'ROWS' };
      if (out.length) payload.values = out;
      if (R.tab === this.filmsTab && R.r1 === 1 && R.c1 === 0 && R.c2 === WIDTH - 1 && !this._loaded) {
        this._loaded = true;
        if (this._afterLoad) { const fn = this._afterLoad; this._afterLoad = null; setTimeout(() => fn(this), 0); }
      }
      return { payload };
    }
    if (tool === 'update_values') {
      const vals = input.values || [];
      let n = 0;
      // remember which row (id/title) each write lands on at the moment of the call, so tests can prove the right row was hit
      call.targets = [];
      vals.forEach((vr, i) => { const rw = grid[R.r1 + i - 1] || []; call.targets.push({ row: R.r1 + i, id: rw[colOf('id')], title: rw[0] }); });
      vals.forEach((vr, i) => vr.forEach((v, j) => {
        const row = R.r1 + i, col = R.c1 + j;
        const info = { tool, range: input.range, values: vals, row, col: colLetter(col), colName: HEADERS[col], raw: v };
        if (!forced && this._drop.some(p => p(info))) { call.dropped = true; return; }
        while (grid.length < row) grid.push(R.tab === this.filmsTab ? Array(WIDTH).fill('') : []);
        while (grid[row - 1].length <= col) grid[row - 1].push('');
        grid[row - 1][col] = coerce(v); n++;
      }));
      return { payload: {} };
    }
    if (tool === 'append_values') {
      if (this._beforeAppend) { const fn = this._beforeAppend; this._beforeAppend = null; fn(this); }
      const rows = input.values || [];
      let row = this._landAt || (this.lastDataRow() + 1);
      this._landAt = null;
      const first = row;
      let width = 0;
      for (const vr of rows) {
        while (grid.length < row) grid.push(Array(WIDTH).fill(''));
        if (grid[row - 1].some(v => v !== '')) throw new Error('FakeSheet: append would overwrite an occupied row ' + row);
        vr.forEach((v, j) => { while (grid[row - 1].length <= j) grid[row - 1].push(''); grid[row - 1][j] = coerce(v); });
        width = Math.max(width, vr.length); row++;
      }
      return { payload: { spreadsheetId: input.spreadsheetId, updates: { spreadsheetId: input.spreadsheetId, updatedRange: `'${R.tab}'!A${first}:${colLetter(Math.max(0, width - 1))}${row - 1}`, updatedRows: rows.length, updatedColumns: width, updatedCells: rows.length * width } } };
    }
    throw { code: 'tool_error', message: `Unknown tool ${tool}` };
  }
}

/* ---- cell-level diff of two snapshots ---- */
const enc = v => JSON.stringify(v === undefined || v === null ? '' : v);
export function diffCells(before, after, tab = 'films') {
  const a = before[tab], b = after[tab], out = [];
  const n = Math.max(a.length, b.length);
  for (let r = 0; r < n; r++) {
    const w = Math.max((a[r] || []).length, (b[r] || []).length);
    for (let c = 0; c < w; c++) {
      const x = enc((a[r] || [])[c]), y = enc((b[r] || [])[c]);
      if (x !== y) out.push({ row: r + 1, col: colLetter(c), colName: HEADERS[c], from: x, to: y, ref: `${colLetter(c)}${r + 1}` });
    }
  }
  return out;
}
export const show = d => `${d.ref}(${d.colName || ''}): ${d.from} -> ${d.to}`;

/* ---- synthetic fixture: ~45 invented films ---- */
export function buildSyntheticFixture() {
  const rows = [];
  let nid = 1;
  const mk = o => {
    const r = {
      title: '', rating: '', status: '', date: '', starring: '', director: '', cinematography: '', purchase: '', genre: '', platform: '', release: '', year: '', notes: '',
      id: nid++, plan: '', order: '', why: '', sorted: '', ...o
    };
    if (o.noId) r.id = '';
    const row = [r.title, r.rating, r.status, r.date ? D(r.date) : '', r.starring, r.director, r.cinematography, r.purchase, r.genre, r.platform, r.release, r.year, r.notes, r.id, r.plan, r.order, r.why, r.sorted ? D(r.sorted) : ''];
    rows.push(row);
    return r;
  };
  const names = {};
  // 15 dated 2026 diary rows
  mk({ title: 'Harbour of Glass', year: 2019, rating: 7, status: 'Watched', date: '2026-01-04', platform: 'Netflix', director: 'Mira Voss', genre: 'Drama', starring: 'Odalys Brenner' });
  mk({ title: 'The Copper Lantern', year: 1999, rating: 8, status: 'Watched', date: '2026-01-19', platform: 'Prime', director: 'Teo Hartley', genre: 'Thriller' });
  mk({ title: 'Northern Orchard', year: 2015, rating: 6, status: 'Watched', date: '2026-02-02', platform: 'Stan', director: 'Lena Okafor', genre: 'Comedy' });
  mk({ title: 'Velvet Archive', year: 2004, rating: 9, status: 'Watched', date: '2026-02-14', platform: 'Plex', director: 'Yuki Tanabe', genre: 'Mystery' });
  mk({ title: 'Paper Kingdom', year: 2021, rating: 5, status: 'Watched', date: '2026-03-08', platform: 'Cinema', director: 'Felix Moreau', genre: 'Adventure' });
  mk({ title: 'The Glass Citadel', year: 1994, rating: 7, status: 'Watched', date: '2026-03-30', platform: 'Netflix', director: 'Hana Seo', genre: 'Crime' });
  mk({ title: 'Silver Voyage', year: 1987, rating: 8, status: 'Watched', date: '2026-04-11', platform: 'Prime', director: 'Inés Cuarón,Bruno Kallas', starring: 'Odalys Brenner, Jonas Whitlock', cinematography: 'Zoë Brandão', genre: 'Sci Fi', purchase: 'Owned' });
  mk({ title: 'Distant Signal', year: 2010, status: 'Watched', date: '2026-05-01', platform: 'Stan', director: 'Priya Nandakumar', genre: 'Sci Fi' });
  mk({ title: 'Broken Meridian', year: 2002, rating: 4, status: 'Watched', date: '2026-05-23', director: 'Oskar Lindqvist', genre: 'War' });
  mk({ title: 'Golden Station', year: 1978, rating: 9, status: 'Watched', date: '2026-06-15', platform: 'Plex', director: 'Ana Beltrán', genre: 'Romance' });
  mk({ title: 'Salt Garden', year: 2023, rating: 6, status: 'Watched', date: '2026-07-07', platform: 'Netflix', director: 'Mira Voss', genre: 'Drama' });
  mk({ title: 'Burning Carnival', year: 2016, rating: 3, status: 'Watched', date: '2026-08-09', platform: 'Cinema', director: 'Dmitri Parrish', genre: 'Horror' });
  mk({ title: 'Winter Signal', year: 1971, rating: 8, status: 'Watched', date: '2026-09-02', platform: 'Prime', director: 'Teo Hartley', genre: 'Mystery' });
  mk({ title: 'Midnight Voyage', year: 2018, rating: 7, status: 'Watched', date: '2026-10-10', platform: 'Stan', director: 'Hana Seo', genre: 'Adventure' });
  mk({ title: 'Hollow Citadel', year: 2022, rating: 6, status: 'Watched', date: '2026-10-21', platform: 'Plex', director: 'Lena Okafor', genre: 'Crime' });
  // 6 Next Up
  const up = [
    ['Quiet Harbour', 2012, '', 'Recommended by a friend', 'Drama', ''],
    ['Last Orchard', 2020, 'Netflix', '', 'Comedy', ''],
    ['The Silver Lantern', 2008, 'Cinema', 'Cinematography on my list', 'Drama', 'Ana Beltrán'],
    ['Distant Kingdom', 2001, '', '', 'Adventure', 'Felix Moreau'],
    ['Winter Archive', 2017, 'Stan', 'Soundtrack', 'Mystery', 'Yuki Tanabe'],
    ['Copper Carnival', 2024, '', '', 'Comedy', 'Bruno Kallas']
  ];
  up.forEach((u, i) => mk({ title: u[0], year: u[1], platform: u[2], why: u[3], genre: u[4], director: u[5], status: 'Next Up', plan: 'Up next', order: i + 1, sorted: '2026-09-' + String(10 + i).padStart(2, '0') }));
  // Watchlist / Coming Soon / Rewatch / Unavailable / hand-added
  mk({ title: 'Salt Carnival', year: 2013, status: 'Watchlist', genre: 'Comedy', director: 'Priya Nandakumar' });
  mk({ title: 'Golden Voyage', year: 1969, status: 'Watchlist', genre: 'Adventure' });
  mk({ title: 'Quiet Station', year: 'TBA', status: 'Watchlist', genre: 'Drama' });
  mk({ title: 'Winter Signal', year: 2008, status: 'Watchlist', genre: 'Horror', director: 'Oskar Lindqvist' });
  mk({ title: 'Frozen Meridian', year: 2026, status: 'Coming Soon', release: '6 Nov', genre: 'Sci Fi' });
  mk({ title: 'Paper Signal', year: 2026, status: 'Coming Soon', release: 'TBA', genre: 'Thriller' });
  mk({ title: 'Velvet Archive', year: 2004, status: 'Rewatch', plan: 'Soon', sorted: '2026-08-01', genre: 'Mystery', director: 'Yuki Tanabe' });
  mk({ title: 'Hollow Garden', year: 1990, status: 'Unavailable', genre: 'Drama' });
  mk({ title: 'Hand Added Thing', year: 2020, status: 'Watchlist', noId: true });
  // archive Watched (undated), roughly by rating
  mk({ title: 'The Copper Lantern', year: 1999, rating: 6, status: 'Watched', director: 'Teo Hartley', genre: 'Thriller' });
  mk({ title: 'The Glass Citadel', year: 1958, rating: 7, status: 'Watched', director: 'Bruno Kallas', genre: 'Crime' });
  mk({ title: 'Midnight Orchard', year: 1985, rating: 8, status: 'Watched', director: 'Inés Cuarón', starring: 'Carmen Ruiz, Ivo Petrenko', cinematography: 'Gustav Holm', genre: 'Drama', purchase: 'Owned', platform: 'Plex', notes: '' });
  mk({ title: '1917', year: 2019, rating: 8, status: 'Watched', genre: 'War', director: 'Dmitri Parrish' });
  mk({ title: '2012', year: 2009, rating: 5, status: 'Watched', genre: 'Sci Fi', director: 'Felix Moreau' });
  ['Crimson Harbour', 'Amber Lantern', 'Cobalt Garden', 'Pale Meridian', 'Iron Voyage', 'Ivory Station'].forEach((t, i) => mk({ title: t, year: 1960 + i * 7, rating: 7 - (i % 4), status: 'Watched', genre: ['Drama', 'Crime', 'Comedy'][i % 3], director: ['Mira Voss', 'Hana Seo'][i % 2] }));
  const films = [['', '', 'RATINGS'], HEADERS.slice(), ...rows];
  const settings = [['key', 'value', 'note'], ['yearlyGoal', '120', 'x'], ['upNextMax', '10', 'x'], ['appName', 'Film Vault', 'x']];
  return { films, settings, names };
}
