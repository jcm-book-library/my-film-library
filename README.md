# Movie Library

My film diary, library and dashboard. The Google Sheet "Entertainment Tracker" (tab `🎥`) holds the data, and this app reads and writes it. Sister app to Jackets & Manuscripts (jcm-book-library/my-book-library).

## Files
| File | What it is |
|---|---|
| `app.html` | The app source. Edit this. The same file is published as the claude.ai artifact. |
| `index.html` | Built from `app.html` for GitHub Pages. Rebuild it with `python3 tools/build-pages.py`. |
| `manifest.webmanifest`, `icons/` | Home-screen install and icons. |
| `tests/` | Headless Playwright checks (`node tests/stage1.test.mjs`). They use made-up films, never real data. |
| `PLAN.md` | Sheet findings, data model, decisions and stages. |
| `CLAUDE.md` | Working notes for Claude sessions in this repo. |

## How it connects
- **Inside claude.ai:** the Google Sheets connector (server `Google Sheets`: `get_values`, `append_values`, `update_values`).
- **On GitHub Pages:** Google sign-in using the OAuth Client ID saved in the browser (`mbl_config`, shared with the book app on the same origin). Sign-in lasts about an hour; press **Connect** again after that. The sign-in token has its own key (`mvl-google-token`), and the remembered tab is `mvl-tab`.

## Sheet rules
Read `PLAN.md`. In short: only the `🎥` tab and tabs starting with 🎥; find a row by `id` right before every write; write only the cells that changed; never rewrite tabs or delete and re-add rows; read back and compare after any bulk change.

There is no built-in copy of the film data in the page, because the Pages site is public. Without a connection the app shows an empty state.
