# Plan

Status: **Stages 0–4, the Film Vault themes, Favourites and the interaction polish merged to `main`. Plan Backlog (top 10 by score) and the Tools tab built 2026-11-07 (PR open).** Sheet columns T `Based on`, U `Source title`, V `Poster` added 2026-11-07, not used by the app yet. Next: adaptations (Based on / Source title), then posters and the reel view.

## Reference

- Book app: jcm-book-library/my-book-library, branch `claude/keen-sagan-yf9rqf`,
  `v3/reading-log.html` (patterns, styles, helpers), `v3/README.md`,
  `v3/brand/BRAND.md`. GitHub Pages build: `tools/build-pages.py` on that repo.
- Sheet: "Entertainment Tracker" (its link is kept in the owner's browser settings and
  in the claude.ai copy of the app, not in this public repo), tab `🎥`, headers on row 2.

## What's in the 🎥 tab (read 2026-10-18)

Columns A–M: Title, Rating (/10), Status, Date, Starring, Director,
Cinematography, Purchase, Genre, Platform, Release, Year, Notes. Row 1 has
only "RATINGS" in C1.

Rows were in hand-sorted blocks: a dated diary for 2026 (the only dated rows), plan
blocks (Next Up, Watchlist, Rewatch, Coming Soon, In Development, Unavailable), then
an undated all-time archive of Watched films sorted by rating.

- Rewatches appear as a second row (a diary row plus an archive row, often with a
  different rating). Many other duplicate titles are remakes, so a film is
  identified by title + year.
- No formulas anywhere. No conditional formats or protected ranges. One basic filter.
- Types: Rating, Year and Date are numbers (Date shown as `d-mmm-yyyy`); a few Year
  values are "TBA"; Release mixes date serials and text; a few titles are stored as
  numbers.
- Dropdowns with chips: Status (Coming Soon, Rewatch, Watched, Watching,
  Watchlist, Next Up, 2026 Watched, In Development, DNF, Unavailable),
  Purchase (Owned, To Purchase), Genre (16), Platform (11).
- Starring, Cinematography, Genre, Platform and Purchase are only partly filled
  (mostly on recent rows); Notes was empty.
- Oddities found: one row with only a Status, and about 60 cells with broken accents
  (e.g. `CuarÃ³n`); both were fixed in Stage 0.

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

## Going live (2026-10-23)

- Reached `main` by pull request, following the house rules in `control-room`.
- The spreadsheet id is no longer in the code. `app.html` has a `__SHEET_ID__`
  placeholder that is filled in only when the private claude.ai artifact is published.
  On GitHub Pages the Connect dialog asks for the sheet link once, together with the
  OAuth Client ID, and keeps both in this browser (`mbl_config`, keys `clientId` and
  `sheetId`).
- Dates are shown as `19 Oct 26` (house style); the sheet keeps real dates.
- The id and some film details are still in earlier commits of this public repo. Removing
  them from history needs the owner's go-ahead.

## Stage 3 (built 2026-10-24)

- Library → Plan: Up next (ordered, ↑ ↓, Why, Soon, Drop), Soon, the watchlist in
  sheet order with one-tap Up next / Soon / Someday, and a sort deck (keys 1–4, Skip,
  a pause after every `deckBatch` films).
- A film counts as Up next when Plan = Up next, or when its Status was set to Next Up
  in the sheet and Plan is blank (it sorts last until it is first reordered; then its
  Plan and Order are filled in). Up next Orders are kept as 1..n.
- The deck ranks unsorted Watchlist/Rewatch films (and Someday ones older than
  `somedayResurfaceDays`) by your ratings of films with the same director, cast and
  genre (shrunk towards your average), plus small boosts for Owned and Plex/disc.
- "Rewatch next" (Library detail row, for a seen film with nothing planned) adds a new
  row in Up next and leaves the Watched row alone.
- Changes are queued and written with the Stage 2 rules; a change that fails part-way
  across several films is reported as partly saved and the sheet is re-read.
- Tests: `node tests/stage3.test.mjs` (774 checks), plus stage 1 (256) and 2 (545).
- Billy Elliot (id 776): its Watched row was changed to Next Up by hand, so it now
  counts as Up next and no longer as seen. Left as the owner set it.

## Film Vault look (proposal 2026-10-24)

- Name "Film Vault" as text in the theme's display font, with a classic reel icon
  (disc, five holes, hub) in the theme accent. Static icons use the Default blue.
- 13 themes: Default (near-black, Watched blue `#8fb8f2`, no drift) and one per film:
  Jurassic Park, Project Hail Mary, My Neighbour Totoro, Indiana Jones, Blade Runner,
  No Country for Old Men, Star Wars, 12 Angry Men, Interstellar, The Matrix, True
  Romance, The Hateful Eight. Inspiration only: no stills, posters or logos.
- Opens in the month's theme; a switcher flicks between themes; Default for something
  plain. Proposed months and every token are in `design/themes-board.html` (also the
  private claude.ai board); notes per film in `design/theme-notes.md`.
- Theme editor in Settings (colours, heading/text font from a short Google Fonts list,
  roundness, grain/glow, light/dark, reset, save as copy). Saved per device for now;
  syncing through 🎥 Settings later.
- Fonts load on demand (only the active theme's two families).

## Film Vault themes (built 2026-10-24)

- Name Film Vault (🎥 Settings `appName` set to "Film Vault"), classic reel in the header,
  favicon in the theme accent, new PNG icons (reel in #8fb8f2 on #0f1012).
- 13 themes from `design/themes-board.html`; the app opens in the month's theme
  (Oct Totoro, Sep No Country, Apr The Matrix; others as on the board), with ‹ › and a
  menu to flick between themes, your saved copies and Default. Choice saved in
  `mvl-theme` (this device).
- Settings (gear): picker plus an editor for the active theme (colours, heading/text
  font, roundness, grain, light/dark, live contrast badges, Reset, Save as a copy).
  Stored in `mvl-theme-edits` and `mvl-theme-custom` on this device; sync later.
- Only the active theme's fonts are loaded. All theme colours route through CSS
  variables; status pills follow the theme.
- Changes from the board for readability: True Romance's header gradient starts darker
  and its reel is white; Indiana Jones's name gradient ends in orange-gold; Hateful
  Eight's drips sit left of centre on wide screens.
- Checked: every text item in 13 themes × 2 widths × 4 views measured against the
  pixels behind it (≥ 4.5); `node tests/themes.test.mjs` (164) plus stages 1–3.
- Built by a Sonnet helper from a written spec; reviewed by the lead (sheet code
  unchanged, tests re-run, screenshots checked, real-data smoke run).
- Not done yet: the alternate looks (one per film for now), syncing theme choices
  through the sheet.

## Stage 4: Dashboard and tidy layout (built 2026-10-24)

- Year chips (each year with dated watches, plus All time). Six tiles: watched,
  average rating, first-time, rewatches, top genre, owned share.
- Panels: films per month (this month in the theme's second colour), a calendar of
  days with a film, ratings 1–10, genres, decades, top people (directors, cast,
  cinematographers), where you watched (Owned, Streaming, Cinema, Other, Not recorded,
  then by platform) and rewatches (was → now rating; first 10, then "Show all").
- Owned means Purchase "Owned", or Platform Physical or Plex (same as "Do I own this?").
- A watch is a rewatch only when the same film (title + year) was seen earlier: an
  undated seen row, an earlier date, or an earlier row on the same date. The first dated
  watch of a film never counts.
- Every bar, row and calendar day opens a list of its films; a film opens the edit dialog.
- Genre, Platform, Starring and Cinematography are mostly filled for 2026 only, so on
  All time those panels say how many watches they cover; Rewatches and Calendar ask for
  a year.
- Tidy layout: boxes side by side share a height and edges; panel headings line up;
  a lone box spans the full width; 20px gaps between panels, 12px between tiles; tiles
  3 across on a laptop, equal widths on a phone. Log's Recent diary and Coming soon match.
- Checked: `node tests/stage4.test.mjs` (996, fake data, includes edge and gap checks),
  stages 1–3 and themes re-run; real-data smoke run (95 watches, 17 rewatches, 56% owned,
  checked against a separate script).
- Built by a Sonnet helper from a written spec; reviewed by the lead, who fixed the
  rewatch rule and capped the rewatch list.

## Favourites and Log picks (built 2026-10-26)

- Sheet: backup "🎥 backup 2026-10-26 (before Favourite)", then column S `Favourite` added to 🎥
  (format copied from R, filter widened to A2:S2792). Read back: S holds only the header, headers
  A–S right, dropdown chips intact. No A–R cell was written.
- `Favourite` holds a date; any value means favourite. A favourite belongs to the film (title +
  year): on writes today on the film's latest row; off clears every row of that film that has a
  value. Writes go through the Plan queue and updateFilm (row by id right before the write, one
  cell, read back). Without the column the stubs are disabled and nothing is written.
- Sticker: a ticket stub (outline when off, accent fill when on) in Library rows (first column),
  the edit dialog, Last 5, Favourites and, display-only, the dashboard drill lists. Library has a
  Favourites chip.
- Log opens with three equal boxes: Recommended for you (Plan scoring over watchlist and Soon
  films, Another, Add to Up next = the Plan action), Last 5 watched, Favourites (5 most recently
  picked, See all). Recent diary removed; Coming soon spans the full width.
- Checked: `node tests/favourites.test.mjs` (275) and stages 1–4 and themes re-run; real-data run
  with and without the column.
- Built by a Sonnet helper from a written spec; reviewed by the lead (status line now says
  "Favourite saved" rather than "Plan saved"). Sheet column added by the lead.

## Interaction polish (built 2026-11-07)

- Up next (Library > Plan): the up/down arrow buttons are replaced by a grip handle on each row (40px tap target
  on a phone). Pointer events, so mouse and touch both work (`touch-action:none` on the handle only, the page still
  scrolls); the dragged row is lifted, a drop line shows where it will land, and the page autoscrolls near the top
  and bottom edges. With the handle focused, ArrowUp / ArrowDown move the row one place and a polite live region says
  "<title> moved to position N of M". The Log's Up next stays a read-only glance.
- Writes reuse the Plan queue: the wanted order is shown at once (kept in `planUI.optimistic` until the queue drains),
  then `planQueue` runs `writeUpNextOrder`, which writes only the Order cells that differ (and Plan = Up next where it
  isn't yet). A drop in the same place makes no call. A failed write clears the optimistic order, the list goes back to
  what the sheet holds, and the message is the usual "Not saved: ..." notice. Rapid drags queue in order; the
  wanted order is applied inside the places the named films already hold, so films added meanwhile keep their place.
- Edit panel (`#filmDlg`): from 900px wide it is opened with `show()` and docked on the left (fixed, `--dock-w`
  340-420px), the page gets a left margin while it is open, Escape and Close close it, focus goes in on open and back
  to the opener on close. Picking another film swaps the contents; unsaved changes block the swap once with a message
  in the panel (ask again to discard). Below 900px it is a full-width bottom sheet (`showModal()`). Resizing across
  900px re-opens it in the other mode with the typed text kept. Ids and the save / stale-check code are unchanged.
- Back to top: 44px round accent button, fixed bottom-right (16px plus safe area), shown after 600px of scrolling,
  smooth scroll (instant with reduced motion). It steps aside while it would sit over a button or field (Log a film
  controls, Plan buttons) and while a modal is open. Accent fill with the accent-ink chevron, so it follows every theme.
- Library filters: search full width, then genre / platform / owned / Add film as four equal cells (2 x 2 on a phone),
  all 40px high, 12px gaps. Status chips are an auto-fill grid of equal cells (same height, rows share columns).
- Checked: `node tests/interact.test.mjs`, stage 1-4, themes and favourites re-run; the Stage 3 tests that clicked
  the arrows now use the keyboard path on the handle; themes also measures the handles, the button and the panel.

## Plan Backlog and Tools (built 2026-11-07)

- **Backlog** (Library > Plan): replaces "Your watchlist, in sheet order". Unseen Watchlist / Rewatch / Someday films not in Up next or Soon, one row per film, ranked by the existing scoring (`buildProfile` / `scoreFilm`; score high to low, then sheet row, as in `pickList`). Search and the filters apply first. Shows 10; "Show 10 more" adds 10 (a filter change goes back to 10). The second line of each row is the scoring reason (the `why` array joined with " · ", muted); a film's own Why note still shows as before. Rows keep Up next / Soon / Someday.
- **Tools tab** (after Dashboard, remembered in `mvl-tab`; the tab bar now also answers the arrow keys, Home and End). Read-only; no sheet columns added. Dates are shown as 19 Oct 26.
  - *On this day*: dated watches whose month and day equal today's, in earlier years ("2025 · Title · 8/10"). If none, says so and shows the closest dated watch earlier this year.
  - *Highlight of the day*: one seen film rated 8 or higher (one per film, sorted by key), picked by an FNV-1a hash of yyyy-mm-dd, so it is fixed all day. "Rewatch next" is the Library's `rewatchNext`; disabled if the film already has an unseen row.
  - *Lucky dip*: pools Up next, Watchlist, Owned and unseen, On Plex and unseen, Rewatch candidates (seen, rated 8+), plus a genre filter. "Spin" uses `Math.random`. Unseen results show the scoring reason and "Add to Up next" (`setTier`, as the Plan does).
  - *Do I own this?*: title search (case and accent insensitive, up to 8) with chips Owned, On disc, On Plex, Streaming on X (Cinema and Airplane are not counted as a copy), To purchase, or "In your sheet, no copy noted". All rows of a film are combined; strongest verdict first.
  - *Stalled*: (a) films with Status Watching (since the Date if there is one); (b) Up next films whose `Sorted` date is at least `stalledDays` (🎥 Settings, default 14) days before today, oldest first, "N days in Up next". Up next films with no Sorted date are never judged. Up next rows have a Drop button (`setTier(film, '')`, as in the Plan).
  - *Goal planner*: goal, watched so far (dated watches this year up to today), still to go, weeks left, needed per week, your pace, projected total by 31 Dec, and an "Ahead by N / Behind by N / On pace / Goal reached" line (against an even spread of the goal over the year, rounded). In the first 14 days the pace is measured over two weeks, and the days left are never less than one.
  - *Year in review*: year chips (newest first), cards for films, average, best month, top genre, top director, rewatches (the Dashboard's rule), first and last film, the five highest rated (ties newest first), and "Copy summary" (clipboard, with a text box to copy by hand if blocked).
  - *More like this*: pick a seen film; up to 8 waiting films (Up next, Soon, Backlog) sharing a director, cast member or the genre, ranked by number shared then score, with what is shared. "Top picks for you" lists the first 8 of `pickList()`. Rows open the edit panel.
- Tests: `node tests/tools.test.mjs`; stage 3 tests changed from sheet order to rank order.
- Built by a Sonnet helper from a written spec; reviewed by the lead (all suites re-run, screenshots checked, real-data run: 49 films waiting, goal planner matches a separate calculation, no writes from read-only panels).
