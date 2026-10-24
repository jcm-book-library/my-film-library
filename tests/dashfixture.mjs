// Synthetic fixture for the Stage 4 (Dashboard) tests. Every film, person and id is invented.
// Dated watches across 2025 and 2026 (several on one day), rewatches that went up / down / stayed, every platform category,
// multi-director "A,B" cells, cast lists, cinematographers, undated archive films that only have director / year / rating.
import { D, HEADERS } from './fakesheet.mjs';

// [title, year, rating, date, genre, platform, purchase, director, starring, cinematography, status]
const W = (title, year, rating, date, genre, platform, purchase, director, starring, cine) =>
  ({ title, year, rating, date, genre, platform, purchase, director, starring: starring || '', cinematography: cine || '', status: 'Watched' });
const ARCH = (title, year, rating, director, status = 'Watched') => ({ title, year, rating, date: '', genre: '', platform: '', purchase: '', director, starring: '', cinematography: '', status });

export const DASH_TODAY = new Date(2026, 9, 15, 10, 0, 0); // 15 Oct 2026

export function buildDashFixture() {
  const recs = [
    // ---- 2026 (dated) ----
    W('Paper Lanterns', 1998, 8, '2026-10-04', 'Drama', 'Netflix', '', 'Mira Voss', 'Odalys Brenner, Jonas Whitlock', 'Kai Lund'),
    W('Night Ferry', 2011, 7, '2026-10-04', 'Thriller', 'Cinema', '', 'Teo Hartley,Mira Voss', 'Jonas Whitlock, Carmen Ruiz', 'Kai Lund'),
    W('Salt Orchard', 2019, 9, '2026-10-04', 'Drama', 'Plex', '', 'Lena Okafor', 'Odalys Brenner', 'Ines Malik'),
    W('Glass Meridian', 1975, 6, '2026-03-02', 'Comedy', 'Stan', '', 'Bruno Kallas', 'Carmen Ruiz, Ivo Petrenko', ''),
    W('Quiet Harbour', 2003, 6, '2026-03-02', 'Comedy', 'Physical', '', 'Bruno Kallas', 'Ivo Petrenko', 'Ines Malik'),
    W('Velvet Signal', 1987, 10, '2026-01-15', 'Drama', 'Netflix', 'Owned', 'Mira Voss', 'Odalys Brenner', 'Kai Lund'),
    W('Copper Citadel', 2022, 4, '2026-01-20', 'Horror', 'Airplane', '', 'Dmitri Parrish', 'Sade Adeyemi', ''),
    W('Hollow Kingdom', 1955, 7, '2026-02-11', 'Western', '', '', 'Felix Moreau', 'Rowan Ellis', ''),
    W('Silver Garden', 2015, 5, '2026-05-09', 'Sci-Fi', 'Disney+', '', 'Yuki Tanabe', 'Mei Lin Zhao', 'Kai Lund'),
    W('Winter Archive', 1964, 8, '2026-06-21', 'Drama', 'Apple TV', 'To Purchase', 'Felix Moreau', 'Gustav Holm', ''),
    W('Distant Carnival', 2008, null, '2026-07-04', 'Romance', 'Prime', '', 'Hana Seo', 'Noor Haddad', ''),
    W('Burning Voyage', 1991, 9, '2026-08-30', 'Sci-Fi', 'Paramount', '', 'Yuki Tanabe', 'Mei Lin Zhao, Pia Santoro', 'Ines Malik'),
    W('Golden Station', 2001, 3, '2026-09-12', 'Horror', 'Cinema', '', 'Dmitri Parrish', 'Sade Adeyemi, Rowan Ellis', ''),
    W('Midnight Lantern', 1979, 7, '2026-09-12', 'Drama', 'FTA', '', 'Hana Seo', 'Odalys Brenner, Noor Haddad', 'Kai Lund'),
    // rewatches: a dated 2026 watch of a film that has another seen row
    W('Echo Valley', 1999, 9, '2026-04-10', 'Drama', 'Plex', '', 'Lena Okafor', 'Pia Santoro', ''),
    W('Brass Compass', 2006, 5, '2026-05-22', 'Comedy', 'Stan', '', 'Bruno Kallas', 'Ivo Petrenko', ''),
    W('Pale Orchard', 1984, 8, '2026-06-03', 'Thriller', 'Netflix', '', 'Teo Hartley', 'Rowan Ellis', ''),
    W('Iron Lantern', 2000, 8, '2026-02-14', 'Drama', 'Plex', '', 'Mira Voss', 'Carmen Ruiz', 'Kai Lund'),
    // ---- 2025 (dated) ----
    W('Iron Lantern', 2000, 6, '2025-12-20', 'Drama', 'Cinema', '', 'Mira Voss', 'Carmen Ruiz', 'Kai Lund'),
    W('Salt Voyage', 2010, 7, '2025-12-20', 'Drama', 'Netflix', '', 'Lena Okafor', 'Odalys Brenner', ''),
    W('Hollow Archive', 1972, 5, '2025-11-02', 'Western', 'Cinema', '', 'Felix Moreau', 'Gustav Holm', ''),
    W('Paper Citadel', 1993, 9, '2025-06-15', 'Drama', 'Plex', '', 'Mira Voss', 'Odalys Brenner', 'Kai Lund'),
    W('Copper Meridian', 2017, 4, '2025-06-15', 'Horror', 'Stan', '', 'Dmitri Parrish', 'Sade Adeyemi', ''),
    W('Velvet Harbour', 1958, 8, '2025-01-01', 'Romance', 'Airplane', '', 'Hana Seo', 'Noor Haddad', ''),
    W('Glass Garden', 2020, 6, '2025-03-03', 'Sci-Fi', 'Netflix', 'Owned', 'Yuki Tanabe', 'Mei Lin Zhao', ''),
    W('Plain Film', 2012, 6, '2025-08-08', '', '', '', 'Bruno Kallas', '', ''),
    // ---- undated archive (director / year / rating only), including the earlier rows of the rewatched films ----
    ARCH('Echo Valley', 1999, 7, 'Lena Okafor'),
    ARCH('Brass Compass', 2006, 6, 'Bruno Kallas'),
    ARCH('Pale Orchard', 1984, 8, 'Teo Hartley'),
    ARCH('Archive Alpha', 1934, 7, 'Mira Voss'), ARCH('Archive Bravo', 1938, 8, 'Felix Moreau'), ARCH('Archive Charlie', 1946, 6, 'Hana Seo'),
    ARCH('Archive Delta', 1952, 9, 'Mira Voss'), ARCH('Archive Echo', 1957, 5, 'Bruno Kallas'), ARCH('Archive Foxtrot', 1961, 7, 'Teo Hartley,Hana Seo'),
    ARCH('Archive Golf', 1968, 8, 'Mira Voss'), ARCH('Archive Hotel', 1973, 4, 'Dmitri Parrish'), ARCH('Archive India', 1977, 9, 'Lena Okafor'),
    ARCH('Archive Juliet', 1981, 6, 'Yuki Tanabe'), ARCH('Archive Kilo', 1985, 7, 'Mira Voss'), ARCH('Archive Lima', 1989, 3, 'Dmitri Parrish'),
    ARCH('Archive Mike', 1994, 8, 'Bruno Kallas'), ARCH('Archive November', 1996, 10, 'Lena Okafor'), ARCH('Archive Oscar', 2002, 5, 'Hana Seo'),
    ARCH('Archive Papa', 2005, 7, 'Mira Voss,Yuki Tanabe'), ARCH('Archive Quebec', 2009, 6, 'Felix Moreau'), ARCH('Archive Romeo', 2013, 8, 'Teo Hartley'),
    ARCH('Archive Sierra', 2016, 7, 'Mira Voss'), ARCH('Archive Tango', 2018, null, 'Hana Seo'), ARCH('Archive Uniform', 2021, 9, 'Bruno Kallas'),
    // not seen (watchlist = Watchlist + Next Up)
    ARCH('Waiting One', 2024, null, 'Mira Voss', 'Watchlist'), ARCH('Waiting Two', 2023, null, '', 'Watchlist'), ARCH('Waiting Three', 2025, null, '', 'Next Up'),
    ARCH('Coming Alpha', 2027, null, '', 'Coming Soon')
  ];
  let id = 100;
  recs.forEach((r, i) => { r.id = id++; r._row = i + 3; r.plan = ''; r.order = ''; r.why = ''; r.sorted = ''; r.release = ''; r.notes = ''; });
  const rows = recs.map(r => [r.title, r.rating ?? '', r.status, r.date ? D(r.date) : '', r.starring, r.director, r.cinematography, r.purchase, r.genre, r.platform, r.release, r.year, r.notes, r.id, r.plan, r.order, r.why, r.sorted ? D(r.sorted) : '']);
  const films = [['', '', 'RATINGS'], HEADERS.slice(), ...rows];
  const settings = [['key', 'value', 'note'], ['yearlyGoal', '120', 'x'], ['upNextMax', '10', 'x'], ['appName', 'Film Vault', 'x']];
  return { films, settings, names: {}, records: recs, today: DASH_TODAY };
}
