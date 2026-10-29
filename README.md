# Film Vault

Film Vault is my film diary, library and dashboard. The Google Sheet "Entertainment Tracker" (tab `🎥`) holds the data, and this app reads and writes it. Sister app to Jackets & Manuscripts (jcm-book-library/my-book-library).

- **Live site:** https://jcm-book-library.github.io/my-film-library/
- **House rules:** https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md

## Themes and Settings
The app opens in the current month's film theme (Jan Jurassic Park, Feb True Romance, Mar Indiana Jones, Apr The Matrix, May Star Wars, Jun Blade Runner, Jul The Hateful Eight, Aug Interstellar, Sep No Country for Old Men, Oct My Neighbour Totoro, Nov Project Hail Mary, Dec 12 Angry Men), with a plain Default. The palette button in the header opens the theme menu and the arrows flick through themes. The gear opens **Settings**, where the theme being worn can be edited (colours, heading and text fonts, roundness, grain, light or dark), reset, or saved as a copy under "Your themes". The design is in `design/themes-board.html`.
Theme choices stay in this browser only: `mvl-theme` ("auto" or a theme id), `mvl-theme-edits` (changes per theme) and `mvl-theme-custom` (saved copies). Nothing about themes is written to the sheet.

## Favourites
The ticket stub marks a favourite film. Tapping it writes today's date into the `Favourite` column (S) of `🎥` on the film's latest row; tapping again clears it on every row of that film. It is separate from the rating. The Log page opens with three boxes: Recommended for you, Last 5 watched and Favourites (the 5 most recently picked, with See all). Without a `Favourite` column the app still works and the stubs are switched off.

## Files
| File | What it is |
|---|---|
| `app.html` | The app source. Edit this. The same file is published as the claude.ai artifact. |
| `index.html` | Built from `app.html` for GitHub Pages. Rebuild it with `python3 tools/build-pages.py`. |
| `manifest.webmanifest`, `icons/` | Home-screen install and icons. |
| `tests/` | Headless Playwright checks (`node tests/stage1.test.mjs`, plus `stage2`, `stage3`, `stage4`, `themes` and `favourites`). They use made-up films, never real data. |
| `PLAN.md` | Sheet findings, data model, decisions and stages. |
| `CLAUDE.md` | Working notes for Claude sessions in this repo. |

## How it connects
- **Inside claude.ai:** the Google Sheets connector (server `Google Sheets`: `get_values`, `append_values`, `update_values`).
- **On GitHub Pages:** press **Connect** once and paste two things: the OAuth Client ID (the same one the book app uses) and the link to your Entertainment Tracker sheet. Both are saved in this browser only (`mbl_config`, shared with the book app on the same origin), never in the code. Sign-in lasts about an hour; press **Connect** again after that. The sign-in token has its own key (`mvl-google-token`), and the remembered tab is `mvl-tab`.

## Sheet rules
Read `PLAN.md`. In short: only the `🎥` tab and tabs starting with 🎥; find a row by `id` right before every write; write only the cells that changed; never rewrite tabs or delete and re-add rows; read back and compare after any bulk change.

There is no built-in copy of the film data, and no spreadsheet id, in the page: the Pages site is public. Without a connection the app shows an empty state. The claude.ai copy of the app is published with the id filled in (the page holds a `__SHEET_ID__` placeholder for that).
