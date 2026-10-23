# Plan

Status: **Stages 0, 1 and 2 (writes) done 2026-10-23.** Next: Stage 3 (Plan).

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

## Decisions (2026-10-23)

- Data model **A**.
- App name **Movie Library** (text wordmark until a brand kit arrives).
- Rows 98–103 (six untagged sci-fi titles): kept as Watchlist items. Row 880 (empty): deleted.
- "Do I own this?" counts Purchase = Owned, Platform = Physical **and Plex**.
- Broken accents: **fix**.

## Sheet changes made on 2026-10-23

- Backup: `🎥 backup 2026-10-23 (before ids)` (sheetId 1145566128), an exact
  copy before any change (checked by script).
- Added columns N–R: `id`, `Plan`, `Order`, `Why`, `Sorted`, formatted like
  the tab. `Plan` has an Up next / Soon / Someday dropdown with chips.
- `id`: plain numbers (no formulas), equal to the row number minus 2 at the
  time of assignment, so 1–2291 with gaps at 96–101 and 878 (the rows to be
  removed). New rows get the highest id + 1. Duplicate ids turn red.
- The 13 Next Up rows (105–117) got Plan = Up next, Order 1–13 in sheet order.
- Added 500 spare rows (to 2793) with the tab's formats and the Status,
  Purchase, Genre and Platform dropdowns (chips); the filter now covers A2:R2793.
- Fixed 62 broken-accent cells in Title and Director (e.g. `CuarÃ³n` → `Cuarón`).
- New tab `🎥 Settings` (sheetId 1338861386): yearlyGoal 120, upNextMax 10,
  deckBatch 10, somedayResurfaceDays 365, stalledDays 14, appName.
- Read back after each step and compared by script: A–M unchanged apart from
  the 62 fixes; ids unique.

**Rows 98–103 and 880:** row 880 was deleted by hand. Rows 98–103 turned out to
be watchlist items, so they were kept with Status = Watchlist and given ids
2292–2297 (the highest id so far is 2297). The app finds rows by id, so row
positions don't matter.

## Notes for building the app

- Trim titles: some have trailing spaces (`Babel `).
- Archive rows (212+) have Status and Genre dropdowns but no Purchase or
  Platform dropdowns; that's how the sheet was, and was left alone.
- Some Director cells list several names separated by commas without spaces.

## Stage 1 (done 2026-10-23)

- `app.html`: the book app's stylesheet and Proton Seasons theme (month colours
  with drift), a text wordmark ("Movie Library", from 🎥 Settings `appName`), and
  three tabs: Log, Library, Dashboard. Read-only.
- Log: tiles (films this year vs goal, this month, average rating, last film),
  Up next (first 10 by Order, with a "N more waiting" note), recent diary, coming soon.
- Library: search, status chips with counts, genre / platform / owned filters,
  sortable headers (third click returns to sheet order), detail rows that list the
  other entries for the same film (a film = title + year).
- Dashboard: year chips, tiles, films per month (Chart.js 4.4.1 from cdnjs, with a
  plain bar fallback), rating distribution, decades, top directors.
- Reads `'🎥'!A1:R6000` and `'🎥 Settings'!A1:C50` only. Columns are found by header
  name. Dates are parsed from the sheet's `d-mmm-yyyy` display into `yyyy-mm-dd`.
- No built-in snapshot of the films (the Pages site is public). Without a
  connection the app shows an empty state.
- Own storage keys: `mvl-google-token`, `mvl-tab`. The Client ID key `mbl_config`
  is shared with the book app.
- Tests: `node tests/stage1.test.mjs` (synthetic data, 246 checks at 1280 and 390 px).
  Also run once against a copy of the real sheet: totals match the sheet counts.
- GitHub Pages needs a one-time setup: the repo has no `main` content yet, so
  merge this branch to `main` (or pick this branch as the Pages source) and enable
  Pages on it.

## Ideas for later stages

- Rewatch detection and the Log's "log a film" flow need a rule for matching a film
  by title + year (data has a few year mismatches such as Life of Pi 2012/2013).
- Archive rows 212+ have no Purchase or Platform dropdowns; consider adding them in
  Stage 2 when the edit dialog needs them.

## Stage 2 (done 2026-10-23)

- Log a film (Log tab): Today / Yesterday / pick a date, a search box over the sheet,
  rating 1–10 and platform. A planned film (not yet seen) is updated in place
  (Status, Date, Rating, Platform, and Plan/Order cleared if it was in Up next). A film
  already seen is added as a new rewatch row (metadata copied). A new film is added
  as a new row. A title that matches an existing film with a different year asks first.
  Up next rows have a "Watched" button that preselects the film.
- Edit / add dialog (Library detail row, Recent diary "Edit", "Add film"): writes only
  changed cells. Changing Plan stamps Sorted, Up next takes the next Order and sets
  Status to Next Up, clearing it sets Status back to Watchlist.
- Write rules in the code: find the row by id right before writing (header row, id
  column, row), check the row still holds the values the page loaded (stale check),
  write one cell per call, read the row back and confirm, never delete or rewrite
  rows. Text is written with a leading `'`, dates as yyyy-mm-dd, numbers as numbers,
  dropdown values plain.
- New rows: id = highest id + 1, appended with `append_values` anchored to the data
  block (`A2:Z<last row>`), and the landing row is checked (must be column A, the next
  row) before it is trusted. Rows without an id can't be edited from the app yet.
- If several cells are being saved and a later one fails, the app says how many were
  saved and re-reads the sheet. There is no rollback.
- Tests: `node tests/stage1.test.mjs` (246 checks) and `node tests/stage2.test.mjs`
  (545 checks against a fake sheet that records every call and diffs every cell).
- Known limits: Order values for new Up next films come from the page's loaded copy of
  the sheet, so two devices saving at once could give the same Order (Stage 3 will
  renumber); the duplicate warning in the Add dialog uses the loaded copy too.
- Not yet tried on the real sheet: the first real write should be one low-stakes entry
  (for example logging a film) with the sheet open to watch it.
