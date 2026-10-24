// Synthetic fixture for the Stage 3 (Plan) tests. Every film, person and id is invented. Does not touch buildSyntheticFixture.
import { D, HEADERS } from './fakesheet.mjs';

const pad = n => String(n).padStart(2, '0');
export const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// opts: unsorted (default 25 unsorted Watchlist rows incl. 2 Rewatch + Twice Seen's unseen row), extraUp (more Up next rows), deckBatch, billy (default true)
export function buildPlanFixture(opts = {}) {
  const { unsorted = 25, extraUp = 0, deckBatch = 3, billy = true } = opts;
  const rows = [];
  let nid = 1;
  const mk = o => {
    const r = { title: '', rating: '', status: '', date: '', starring: '', director: '', cinematography: '', purchase: '', genre: '', platform: '', release: '', year: '', notes: '', id: nid++, plan: '', order: '', why: '', sorted: '', ...o };
    rows.push([r.title, r.rating, r.status, r.date ? D(r.date) : '', r.starring, r.director, r.cinematography, r.purchase, r.genre, r.platform, r.release, r.year, r.notes, r.id, r.plan, r.order, r.why, r.sorted ? D(r.sorted) : '']);
    return r;
  };
  let dd = 300;
  const seen = o => mk({ status: 'Watched', date: isoDaysAgo(dd -= 3), ...o });
  // Vera Lindholm: 4 films, avg 9.0
  seen({ title: 'Ash Meridian', year: 2001, rating: 10, director: 'Vera Lindholm', genre: 'Drama' });
  seen({ title: 'Bright Harbour', year: 2005, rating: 9, director: 'Vera Lindholm', genre: 'Drama' });
  seen({ title: 'Cold Orchard', year: 2009, rating: 9, director: 'Vera Lindholm', genre: 'Thriller' });
  seen({ title: 'Dune Lantern', year: 2013, rating: 8, director: 'Vera Lindholm', genre: 'Drama' });
  // Kit Solano: 1 film rated 10
  seen({ title: 'Ember Voyage', year: 2015, rating: 10, director: 'Kit Solano', genre: 'Comedy' });
  // Rex Mallory: 3 films avg 4
  seen({ title: 'Flint Carnival', year: 2002, rating: 5, director: 'Rex Mallory', genre: 'Horror' });
  seen({ title: 'Gale Station', year: 2006, rating: 4, director: 'Rex Mallory', genre: 'Horror' });
  seen({ title: 'Haze Archive', year: 2010, rating: 3, director: 'Rex Mallory', genre: 'Comedy' });
  // Dara Quill: cast member, 3 films avg 8
  seen({ title: 'Ivory Signal', year: 2011, rating: 8, director: 'Noa Brandt', starring: 'Dara Quill, Eli Ford', genre: 'Mystery' });
  seen({ title: 'Jade Kingdom', year: 2014, rating: 8, director: 'Oto Weiss', starring: 'Dara Quill', genre: 'Mystery' });
  seen({ title: 'Kelp Garden', year: 2017, rating: 8, director: 'Pim Alder', starring: 'Eli Ford, Dara Quill', genre: 'Drama' });
  seen({ title: 'Lark Row', year: 1990, rating: 6, director: 'Sal Reyes', genre: 'Western' });
  seen({ title: 'Moss Pier', year: 1994, rating: 7, director: 'Sal Reyes', genre: 'Western' });
  // seen, no unseen row (Rewatch next) and seen + unseen row
  seen({ title: 'Solo Seen', year: 2000, rating: 7, director: 'Una Park', starring: 'Una Park, Q Lee', cinematography: 'Cam Era', purchase: 'Owned', platform: 'Plex', genre: 'Drama' });
  seen({ title: 'Twice Seen', year: 1999, rating: 9, director: 'Una Park', genre: 'Drama' });
  seen({ title: 'Rim A', year: 1980, rating: 6, director: 'Zed Other', genre: 'Sci Fi' });
  seen({ title: 'Rim B', year: 1981, rating: 6, director: 'Zed Other', genre: 'Sci Fi' });
  seen({ title: 'Rim C', year: 1982, rating: 5, director: 'Zed Other', genre: 'Sci Fi' });

  const T = ['Alder Gate', 'Birch Pier', 'Cedar Row', 'Dove Hall', 'Elm Court', 'Fir Lane'];
  if (billy) mk({ title: 'Billy Style', year: 2019, status: 'Next Up', genre: 'Drama', director: 'Vera Lindholm' }); // owner-edited: Status only, Plan/Order blank
  T.forEach((t, i) => mk({ title: t, year: 2018 + i, status: 'Next Up', plan: 'Up next', order: i + 1, sorted: isoDaysAgo(30 - i), genre: ['Drama', 'Comedy'][i % 2], director: i === 3 ? 'Kit Solano' : '', why: t === 'Cedar Row' ? 'Recommended by Sam' : '' }));
  for (let i = 0; i < extraUp; i++) mk({ title: 'Extra Up ' + (i + 1), year: 2000 + i, status: 'Next Up', plan: 'Up next', order: 7 + i, sorted: isoDaysAgo(5) });
  mk({ title: 'Soon Alpha', year: 2021, status: 'Watchlist', plan: 'Soon', sorted: isoDaysAgo(3), genre: 'Thriller' });
  mk({ title: 'Soon Beta', year: 2022, status: 'Watchlist', plan: 'Soon', sorted: isoDaysAgo(2), genre: 'Comedy', director: 'Kit Solano' });
  mk({ title: 'Some Stale', year: 2016, status: 'Watchlist', plan: 'Someday', sorted: isoDaysAgo(400), genre: 'Drama', director: 'Vera Lindholm' });
  mk({ title: 'Some Fresh', year: 2017, status: 'Watchlist', plan: 'Someday', sorted: isoDaysAgo(10), genre: 'Drama', director: 'Vera Lindholm' });
  mk({ title: 'Some Blank', year: 2015, status: 'Watchlist', plan: 'Someday', genre: 'Horror', director: 'Rex Mallory' });
  mk({ title: 'Some Edge365', year: 2014, status: 'Watchlist', plan: 'Someday', sorted: isoDaysAgo(365), genre: 'Western' });
  mk({ title: 'Some Edge364', year: 2013, status: 'Watchlist', plan: 'Someday', sorted: isoDaysAgo(364), genre: 'Western' });
  // unsorted Watchlist
  const DIRS = ['Vera Lindholm', 'Kit Solano', 'Rex Mallory', 'Noa Brandt', '', 'Una Park', 'Zed Unknown', '', 'Sal Reyes'];
  const GEN = ['Drama', 'Horror', 'Comedy', 'Mystery', 'Western', 'Thriller', 'Sci Fi', 'Drama'];
  const PLAT = ['', 'Plex', 'Netflix', 'Physical', '', 'Stan'];
  const PUR = ['', 'Owned', '', '', 'To Purchase'];
  const NAMES = 'Pending A,Pending B,Pending C,Pending D,Pending E,Pending F,Pending G,Pending H,Pending I,Pending J,Pending K,Pending L,Pending M,Pending N,Pending O,Pending P,Pending Q,Pending R,Pending S,Pending T,Pending U,Pending V,Pending W'.split(',');
  let k = 0;
  const unseenRow = o => mk({ status: 'Watchlist', year: 1970 + (k % 50), director: DIRS[k % DIRS.length], genre: GEN[k % GEN.length], platform: PLAT[k % PLAT.length], purchase: PUR[k % PUR.length], starring: k % 7 === 3 ? 'Dara Quill' : '', ...o });
  for (let i = 0; i < unsorted; i++, k++) {
    if (i === 5) { unseenRow({ title: 'Twice Seen', year: 1999, director: 'Una Park', genre: 'Drama', platform: '', purchase: '' }); continue; }
    if (i === 9) { unseenRow({ title: 'Rewatch One', status: 'Rewatch', director: 'Vera Lindholm', genre: 'Drama' }); continue; }
    if (i === 14) { unseenRow({ title: 'Rewatch Two', status: 'Rewatch' }); continue; }
    unseenRow({ title: i < NAMES.length ? NAMES[i] : 'Bulk ' + String(i).padStart(3, '0') });
  }
  mk({ title: 'Coming Alpha', year: 2027, status: 'Coming Soon', release: 'TBA', genre: 'Drama' });
  mk({ title: 'Coming Beta', year: 2027, status: 'Coming Soon', release: '6 Nov', genre: 'Thriller' });
  mk({ title: 'Dev One', year: 2028, status: 'In Development' });
  mk({ title: 'Unavail One', year: 1975, status: 'Unavailable', genre: 'Drama' });
  mk({ title: 'Dnf One', year: 1988, status: 'DNF', genre: 'Drama' });
  const films = [['', '', 'RATINGS'], HEADERS.slice(), ...rows];
  const settings = [['key', 'value', 'note'], ['yearlyGoal', '120', 'x'], ['upNextMax', '10', 'x'], ['deckBatch', String(deckBatch), 'x'], ['somedayResurfaceDays', '365', 'x'], ['appName', 'Film Vault', 'x']];
  return { films, settings, names: {} };
}
