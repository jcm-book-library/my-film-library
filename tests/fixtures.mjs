// Synthetic fixtures for the Film Vault tests. Every film, person and id here is invented.
export const HEADERS = ['Title', 'Rating', 'Status', 'Date', 'Starring', 'Director', 'Cinematography', 'Purchase', 'Genre', 'Platform', 'Release', 'Year', 'Notes', 'id', 'Plan', 'Order', 'Why', 'Sorted'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const sheetDate = d => `${d.getDate()}-${MON[d.getMonth()]}-${d.getFullYear()}`;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

const ADJ = ['Quiet', 'Paper', 'Glass', 'Last', 'Silver', 'Hollow', 'Northern', 'Velvet', 'Distant', 'Burning', 'Salt', 'Winter', 'Broken', 'Golden', 'Midnight', 'Copper'];
const NOUN = ['Harbour', 'Orchard', 'Lantern', 'Citadel', 'Meridian', 'Garden', 'Signal', 'Kingdom', 'Voyage', 'Station', 'Carnival', 'Archive'];
const DIRS = ['Mira Voss', 'Teo Hartley', 'Inés Cuarón', 'Bruno Kallas', 'Lena Okafor', 'Dmitri Parrish', 'Yuki Tanabe', 'Priya Nandakumar', 'Oskar Lindqvist', 'Ana Beltrán', 'Felix Moreau', 'Hana Seo'];
const CAST = ['Odalys Brenner', 'Jonas Whitlock', 'Carmen Ruiz', 'Ivo Petrenko', 'Sade Adeyemi', 'Rowan Ellis', 'Mei Lin Zhao', 'Gustav Holm', 'Noor Haddad', 'Pia Santoro'];
const GENRES = ['Drama', 'Thriller', 'Comedy', 'Sci-Fi', 'Horror', 'Romance', 'Documentary', 'Western'];
const PLATS = ['Streamo', 'Cinemax Plus', 'Disc', 'Reelflix', 'Library Loan'];
const OWN = ['', '', 'Owned', 'To Purchase', ''];

// opts: { today: Date, extra: n additional undated Watched rows (for the ">100 rows" fixture), noToday: bool }
export function buildFixture(opts = {}) {
  const today = opts.today || new Date();
  const R = rng(42);
  const pick = a => a[Math.floor(R() * a.length)];
  const titles = [];
  for (let i = 0; i < ADJ.length; i++) for (let j = 0; j < NOUN.length; j++) titles.push(`The ${ADJ[i]} ${NOUN[j]}`);
  let ti = 0; const nextTitle = () => titles[ti++];
  let nid = 1000; const nextId = () => String(nid++);
  const rec = []; // objects; _sheet order is shuffled later
  const mk = o => { const r = { rating: '', status: '', date: '', starring: pick(CAST), director: pick(DIRS), cinematography: '', purchase: pick(OWN), genre: pick(GENRES), platform: pick(PLATS), release: '', year: String(1950 + Math.floor(R() * 75)), notes: '', id: nextId(), plan: '', order: '', why: '', sorted: '', ...o }; rec.push(r); return r; };

  // ~25 dated Watched rows in the current year
  const cm = today.getMonth(), cy = today.getFullYear(), td = today.getDate();
  const dates = [];
  const thisMonthDays = [td, td - 1, td - 4, td - 9, td - 12].map(d => Math.max(1, d));
  if (opts.noToday) { thisMonthDays[0] = Math.max(1, td - 3); }
  thisMonthDays.forEach(d => dates.push(new Date(cy, cm, d)));
  for (let k = 0; k < 20; k++) { const m = cm > 0 ? k % cm : cm; dates.push(new Date(cy, m, 1 + ((k * 7) % 27))); }
  const dated = dates.map((d, i) => mk({ title: nextTitle(), status: 'Watched', date: sheetDate(d), rating: i === 7 ? '' : String(3 + (i % 8)), notes: i % 6 === 0 ? 'Saw it with friends' : '' }));
  dated[0].title += ' '; // trailing space
  dated[1].director = 'Mira Voss,Teo Hartley'; dated[2].director = 'Mira Voss,Teo Hartley'; dated[3].director = 'Inés Cuarón';
  dated[4].starring = 'Odalys Brenner, Jonas Whitlock'; dated[5].director = 'Mira Voss,Teo Hartley';

  // ~30 undated Watched archive rows
  const archive = [];
  for (let i = 0; i < 30; i++) archive.push(mk({ title: nextTitle(), status: 'Watched', rating: i === 5 ? '' : String(4 + (i % 7)) }));
  archive[0].director = 'Mira Voss'; archive[1].director = 'Mira Voss'; archive[2].director = 'Teo Hartley';
  archive[6].year = 'TBA';
  // rewatches: same Title + Year as a dated row (different case / spacing on purpose)
  for (let i = 0; i < 4; i++) { const src = dated[8 + i]; const a = archive[10 + i]; a.title = i % 2 ? src.title.toUpperCase() : src.title; a.year = src.year; a.director = src.director; a.rating = String(5 + i); }
  // remakes: same title, different year
  archive[20].title = dated[12].title; archive[20].year = String(Number(dated[12].year) - 30);
  archive[21].title = archive[15].title; archive[21].year = String(Number(archive[15].year) + 25);

  // 13 Next Up with Order 1..13
  for (let i = 1; i <= 13; i++) mk({ title: nextTitle(), status: 'Next Up', plan: 'Up next', order: String(i), why: i % 2 ? `Recommended by a friend (${i})` : '', year: String(2000 + i) });
  // Others
  for (let i = 0; i < 4; i++) mk({ title: nextTitle(), status: 'Watchlist' });
  ['6 Nov', 'TBA', '15 Dec'].forEach((r, i) => mk({ title: nextTitle(), status: 'Coming Soon', release: r, year: String(cy) }));
  for (let i = 0; i < 2; i++) mk({ title: nextTitle(), status: 'Rewatch' });
  for (let i = 0; i < 2; i++) mk({ title: nextTitle(), status: 'Unavailable' });
  mk({ title: nextTitle(), status: 'In Development', year: String(cy + 1) });
  mk({ title: nextTitle(), status: 'In Development', year: 'TBA' });
  for (let i = 0; i < (opts.extra || 0); i++) mk({ title: `Archive Film ${i + 1}`, status: 'Watched', rating: String(1 + (i % 10)), year: String(1960 + (i % 60)) });

  // shuffle sheet order (deterministic) so Order / date sorts are really exercised
  for (let i = rec.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [rec[i], rec[j]] = [rec[j], rec[i]]; }
  rec.forEach((r, i) => { r._row = i + 3; });

  const toRow = r => {
    const row = [r.title, r.rating, r.status, r.date, r.starring, r.director, r.cinematography, r.purchase, r.genre, r.platform, r.release, r.year, r.notes, r.id, r.plan, r.order, r.why, r.sorted];
    while (row.length && row[row.length - 1] === '') row.pop(); // Sheets drops trailing empties
    return row;
  };
  const films = [['', '', 'RATINGS'], HEADERS, ...rec.map(toRow)];
  const settings = [['key', 'value', 'note'], ['yearlyGoal', '120', 'x'], ['upNextMax', '10', 'x'], ['appName', 'Film Vault', 'x']];
  return { films, settings, records: rec, today };
}

export const emptyFixture = () => ({ films: [['', '', 'RATINGS'], HEADERS], settings: [['key', 'value', 'note']], records: [], today: new Date() });
