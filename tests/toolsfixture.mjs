// Synthetic fixture for the Tools tab and Backlog tests. Every film, person and id here is invented.
// "Today" in these tests is 7 Nov 2026. Known answers (worked out by hand, then re-derived in tools.test.mjs from `records`):
//  - On this day (7 Nov): Harbour Lights 2025 (8) and Paper Moon Rising 2024 (6). Closest this year before 7 Nov: Closest Call, 2 Nov 26.
//  - 2026: 12 dated watches, average 7.5, best month March (4), top genre Drama (5), top director Mira Voss (2, ties Ada Quill on count, higher average),
//    1 rewatch (Iron Lantern), first Velvet Signal (4 Jan), last Closest Call (2 Nov).
//  - Burning Voyage (seen 30 Aug 26) already has a queued Up next row. Up next films with a Sorted date: Up One 37 days, Up Four 18, Up Edge14 14 (listed); Up Edge13 13 and Up Two 8 (not); Up Three has no Sorted date (never judged).
import { D, HEADERS } from './fakesheet.mjs';

export const TOOLS_TODAY = new Date(2026, 10, 7, 10, 0, 0);   // 7 Nov 2026, local time

const W = (title, year, rating, date, o = {}) => ({ title, year, rating, date, status: 'Watched', genre: '', platform: '', purchase: '', director: '', starring: '', cinematography: '', ...o });
const U = (title, year, o = {}) => ({ title, year, rating: null, date: '', status: 'Watchlist', genre: '', platform: '', purchase: '', director: '', starring: '', cinematography: '', ...o });

export function buildToolsFixture({ goal = 120, stalledDays } = {}) {
  const recs = [
    // ---- dated, earlier years ----
    W('Harbour Lights', 2010, 8, '2025-11-07', { genre: 'Drama', director: 'Ada Quill', platform: 'Netflix' }),
    W('Paper Moon Rising', 2001, 6, '2024-11-07', { genre: 'Comedy', director: 'Cleo Marsh' }),
    W('Winter Gate', 1999, 9, '2025-03-03', { genre: 'Thriller', director: 'Ben Roe', starring: 'Cora Vale, Dex Hill' }),
    W('Iron Lantern', 2000, 6, '2025-12-20', { genre: 'Drama', director: 'Mira Voss', platform: 'Cinema' }),
    // ---- dated, 2026 ----
    W('Velvet Signal', 1987, 10, '2026-01-04', { genre: 'Drama', director: 'Mira Voss', purchase: 'Owned', platform: 'Plex', starring: 'Odalys Brenner' }),
    W('Copper Citadel', 2022, 4, '2026-01-20', { genre: 'Horror', director: 'Dmitri Parrish', platform: 'Airplane' }),
    W('Iron Lantern', 2000, 8, '2026-02-14', { genre: 'Drama', director: 'Mira Voss', platform: 'Plex' }),
    W('Glass Meridian', 1975, 6, '2026-03-02', { genre: 'Comedy', director: 'Bruno Kallas', platform: 'Stan' }),
    W('Quiet Harbour', 2003, 7, '2026-03-02', { genre: 'Comedy', director: 'Bruno Kallas', platform: 'Physical' }),
    W('Night Ferry', 2011, 9, '2026-03-15', { genre: 'Thriller', director: 'Ben Roe', starring: 'Cora Vale, Dex Hill', platform: 'Netflix' }),
    W('Salt Orchard', 2019, 9, '2026-03-28', { genre: 'Drama', director: 'Ada Quill', starring: 'Odalys Brenner' }),
    W('Silver Garden', 2015, 5, '2026-05-09', { genre: 'Sci Fi', director: 'Yuki Tanabe', platform: 'Disney+' }),
    W('Winter Archive', 1964, 8, '2026-06-21', { genre: 'Drama', director: 'Felix Moreau', platform: 'Apple TV' }),
    W('Burning Voyage', 1991, 9, '2026-08-30', { genre: 'Sci Fi', director: 'Yuki Tanabe', platform: 'Paramount' }),
    W('Paper Lanterns', 1998, 8, '2026-10-04', { genre: 'Drama', director: 'Ada Quill', platform: 'Netflix' }),
    W('Closest Call', 2005, 7, '2026-11-02', { director: 'Hana Seo' }),
    // ---- undated archive (seen, no date) ----
    W('Iron Lantern', 2000, 7, '', { genre: 'Drama', director: 'Mira Voss' }),
    W('Archive Alpha', 1934, 9, '', { genre: 'Drama', director: 'Mira Voss' }),
    W('Archive Bravo', 1938, 7, '', { director: 'Felix Moreau' }),
    W('Archive Charlie', 1946, 8, '', { genre: 'Western', director: 'Hana Seo' }),
    // ---- Up next (Sorted dates relative to 7 Nov 2026) ----
    U('Up One', 2020, { status: 'Next Up', plan: 'Up next', order: 1, sorted: '2026-10-01', genre: 'Drama' }),
    U('Up Two', 2021, { status: 'Next Up', plan: 'Up next', order: 2, sorted: '2026-10-30', genre: 'Comedy' }),
    U('Up Three', 2022, { status: 'Next Up', plan: 'Up next', order: 3, genre: 'Thriller' }),
    U('Up Four', 2019, { status: 'Next Up', plan: 'Up next', order: 4, sorted: '2026-10-20', genre: 'Sci Fi', director: 'Yuki Tanabe' }),
    U('Up Edge14', 2018, { status: 'Next Up', plan: 'Up next', order: 5, sorted: '2026-10-24' }),
    U('Up Edge13', 2017, { status: 'Next Up', plan: 'Up next', order: 6, sorted: '2026-10-25' }),
    U('Burning Voyage', 1991, { status: 'Next Up', plan: 'Up next', order: 7, sorted: '2026-11-03', genre: 'Sci Fi', director: 'Yuki Tanabe' }),   // a rewatch already queued
    // ---- Watching ----
    U('Watching A', 2018, { status: 'Watching', date: '2026-10-20' }),
    U('Watching B', 2017, { status: 'Watching' }),
    // ---- Soon and the watchlist (ownership cases) ----
    U('Soon One', 2023, { plan: 'Soon', sorted: '2026-11-01', genre: 'Thriller', director: 'Ben Roe' }),
    U('Wish Owned', 2023, { purchase: 'Owned', genre: 'Drama', director: 'Ada Quill' }),
    U('Wish Plex', 2022, { platform: 'Plex', genre: 'Sci Fi' }),
    U('Wish Disc', 2021, { platform: 'Physical', genre: 'Thriller', director: 'Ben Roe', starring: 'Cora Vale' }),
    U('Wish Stream', 2020, { platform: 'Netflix', genre: 'Comedy' }),
    U('Wish Buy', 2019, { purchase: 'To Purchase' }),
    U('Wish Plain', 2018, {}),
    U('Wish Both', 2017, { purchase: 'Owned', platform: 'Plex', genre: 'Western' }),
    U('Café Noir', 2012, { purchase: 'Owned', genre: 'Drama' }),
    U('Rewatch Cand', 2000, { status: 'Rewatch', genre: 'Comedy' }),
    // ---- More like this: base film Night Ferry (Thriller, Ben Roe, Cora Vale, Dex Hill) ----
    U('Like A', 2014, { genre: 'Thriller', director: 'Ben Roe', starring: 'Cora Vale' }),
    U('Like B', 2015, { genre: 'Drama', director: 'Ben Roe' }),
    U('Like C', 2016, { genre: 'Thriller', starring: 'Dex Hill' }),
    U('Like D', 2013, { genre: 'Thriller' }),
    U('Like E', 2012, { genre: 'Thriller', director: 'Ben Roe, Zed Zee' }),
    U('Like I', 2010, { genre: 'Thriller' }),
    U('Like G', 2011, { status: 'Unavailable', genre: 'Thriller', director: 'Ben Roe' }),
    U('Like H', 2027, { status: 'Coming Soon', genre: 'Thriller', director: 'Ben Roe' }),
    // ---- ten look-alike titles (more than 8 matches) ----
    ...Array.from({ length: 10 }, (_, i) => U('Echo Sequel ' + (i + 1), 2000 + i, i % 3 === 0 ? { platform: 'Plex' } : {}))
  ];
  let id = 1;
  recs.forEach((r, i) => { r.id = id++; r._row = i + 3; r.plan ||= ''; r.order ??= ''; r.why ||= ''; r.sorted ||= ''; r.release ||= ''; r.notes ||= ''; r.favourite ||= ''; });
  recs.find(r => r.title === 'Velvet Signal').favourite = '2026-02-01';
  recs.find(r => r.title === 'Winter Gate').favourite = '2025-05-05';
  const rows = recs.map(r => [r.title, r.rating ?? '', r.status, r.date ? D(r.date) : '', r.starring, r.director, r.cinematography, r.purchase, r.genre, r.platform, r.release, r.year, r.notes, r.id, r.plan, r.order, r.why, r.sorted ? D(r.sorted) : '', r.favourite ? D(r.favourite) : '']);
  const films = [['', '', 'RATINGS'], HEADERS.slice(), ...rows];
  const settings = [['key', 'value', 'note'], ['yearlyGoal', String(goal), 'x'], ['upNextMax', '10', 'x'], ['appName', 'Film Vault', 'x']];
  if (stalledDays) settings.push(['stalledDays', String(stalledDays), 'x']);
  return { films, settings, names: {}, records: recs };
}
