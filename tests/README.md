# Stage 1 tests

Headless Playwright checks for `app.html` (Log, Library, Dashboard) at laptop (1280x800) and phone (390x844) widths.
Uses a stubbed `window.claude.use('mcp')` and synthetic fixtures only (`fixtures.mjs`); nothing touches Google Sheets or the network (cdnjs, Google Fonts and Google sign-in requests are answered with empty 200s).

Run: `node tests/stage1.test.mjs`

- Needs Playwright at `/opt/node-tools/node_modules/playwright` and Chromium at `/opt/pw-browsers/chromium`.
- Prints one PASS/FAIL line per check, exits non-zero if any fail.
- Screenshots go to `$SHOTS_DIR` (default: the session scratchpad `shots/` folder).
- Chart.js is not available offline, so chart pixels are not checked; the page is verified to render without it.

# Stage 2 tests (write paths)

`node tests/stage2.test.mjs` runs the Log / edit / add write paths against `fakesheet.mjs`, an in-memory fake of the Google Sheets tools (`get_values`, `update_values`, `append_values`) built from an invented ~45-film fixture. It mimics USER_ENTERED (a leading `'` makes text, `yyyy-mm-dd` becomes a date shown as `d-Mmm-yyyy`, numeric-looking text becomes a number), records every call, and has fault hooks: `dropWrites`, `mutateAfterLoad`, `failNext`, `failAll`, `appendLandsAt`, `beforeAppend`.

- Each scenario gets a fresh page and a fresh fake, diffs the grid cell by cell before and after, and asserts the exact cells and `update_values` calls. Happy paths run at laptop and phone width.
- Global safety checks (spreadsheetId, only the 🎥 / 🎥 Settings tabs, single-cell updates inside A..R below the header, one-row appends at `A1`, no row loss, no page errors, no outside network) run after every scenario.
- Prints one PASS/FAIL line per check, exits non-zero on any failure. Screenshots (`s2-*.png`) go to `$SHOTS_DIR`.
- Nothing contacts Google; any request outside the local stubs is aborted and fails the scenario.

Run both suites: `node tests/stage1.test.mjs && node tests/stage2.test.mjs`
