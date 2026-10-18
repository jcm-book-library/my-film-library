# Plan

Status: **proposal, awaiting the owner's OK.** Nothing has been written to the
sheet yet.

## Reference

- Book app: jcm-book-library/my-book-library, branch `claude/keen-sagan-yf9rqf`,
  `v3/reading-log.html` (patterns, styles, helpers), `v3/README.md`,
  `v3/brand/BRAND.md`. GitHub Pages build: `tools/build-pages.py` on that repo.
- Sheet: "Entertainment Tracker", `1558jWeUc8gCzQuph6wOVyOocvTBhQf22UuCSXza8klc`,
  tab `🎥` (sheetId 1389438311), headers on row 2.

## What's in the 🎥 tab (read 2026-10-18)

Columns A–M: Title, Rating (/10), Status, Date, Starring, Director,
Cinematography, Purchase, Genre, Platform, Release, Year, Notes. Row 1 has
only "RATINGS" in C1.

2,291 data rows in hand-sorted blocks:

| Rows | Block |
|---|---|
| 3–97 | 2026 diary: 95 dated watches, in date order (the only dated rows) |
| 98–103 | Six titles with no status (sci-fi). Purpose unknown, asked |
| 104–211 | Plan: Next Up 13, Watchlist 33, Rewatch 10, Coming Soon 25, In Development 6, Unavailable 21 |
| 212–2293 | All-time archive, 2,082 Watched, sorted by rating, no dates |

- Rewatches appear as a second row (2026 diary row plus archive row, often
  with a different rating). The other ~50 duplicate titles are remakes, so a
  film is identified by title + year.
- No formulas anywhere. No conditional formats or protected ranges. One basic
  filter on A2:M2293.
- Types: Rating, Year and Date are numbers (Date shown as `d-mmm-yyyy`); Year
  has 7 "TBA"; Release mixes date serials and text; 9 titles are stored as
  numbers.
- Dropdowns with chips: Status (Coming Soon, Rewatch, Watched, Watching,
  Watchlist, Next Up, 2026 Watched, In Development, DNF, Unavailable),
  Purchase (Owned, To Purchase), Genre (16), Platform (11).
- Mostly empty: Starring 135, Cinematography 94, Genre 169, Platform 140,
  Purchase 51, Notes 0.
- Oddities: row 880 has only "Watched"; 62 cells have broken accents
  (e.g. `CuarÃ³n`).

## Proposed data model (option A, recommended)

One tab; each row is a watch or a plan item. The app groups rows into films
by normalised title + year.
- Watching a planned film updates that row in place (Status, Date, Rating).
- A new film or a rewatch is appended as a new row at the bottom.
- Row position doesn't matter to the app.

Alternatives offered: B, blank slot rows under the diary block; C, a separate
append-only "🎥 Diary" tab.

New columns N–R: `id` (permanent integer), `Plan` (Up next / Soon / Someday,
chips), `Order`, `Why`, `Sorted` (date). Status stays in sync with Plan
(Up next sets Next Up). New tab `🎥 Settings` (key | value).

## Stage 0: sheet setup (after OK)

1. Duplicate 🎥 as `🎥 backup <date>`.
2. Add N–R; assign ids 1…n in row order with a script; read back and compare.
3. Extend the dropdowns (CHIP), basic filter and Date/Release formats about 500
   rows below the data.
4. Create 🎥 Settings.
5. Optional: fix the 62 broken-accent cells, then read back and compare.

## Stages

1. Theme, tab bar, wordmark, Library (read-only), first Dashboard tiles;
   artifact plus Pages build.
2. Writes: Log (Today / Yesterday / date, edit past), edit/add dialog.
3. Plan: Up next, Soon, backlog, sort deck.
4. Dashboard: films per month, heatmap, ratings, decades, genres, directors,
   cinematographers, owned vs streamed, rewatches, drill-down.
5. Tools (lucky dip, Do I own this?, stalled, goal planner, year in review,
   recommendations) and Discover (on this day, highlight of the day).

## Open questions

- App name for the wordmark.
- Data model A, B or C.
- Rows 98–103 and row 880.
- Does Plex count as owned?
- Fix broken accents in Stage 0?
