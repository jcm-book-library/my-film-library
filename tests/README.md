# Stage 1 tests

Headless Playwright checks for `app.html` (Log, Library, Dashboard) at laptop (1280x800) and phone (390x844) widths.
Uses a stubbed `window.claude.use('mcp')` and synthetic fixtures only (`fixtures.mjs`); nothing touches Google Sheets or the network (cdnjs, Google Fonts and Google sign-in requests are answered with empty 200s).

Run: `node tests/stage1.test.mjs`

- Needs Playwright at `/opt/node-tools/node_modules/playwright` and Chromium at `/opt/pw-browsers/chromium`.
- Prints one PASS/FAIL line per check, exits non-zero if any fail.
- Screenshots go to `$SHOTS_DIR` (default: the session scratchpad `shots/` folder).
- Chart.js is not available offline, so chart pixels are not checked; the page is verified to render without it.
