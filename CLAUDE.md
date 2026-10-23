# my-film-library: working notes for Claude

**Read the house rules first:** [HOUSE-RULES.md](https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md) in `control-room` (plain text: https://raw.githubusercontent.com/jcm-book-library/control-room/main/HOUSE-RULES.md). They cover Google Sheet safety, branches and pull requests into `main`, using cheaper models to save usage credits, and the build template. The notes below are this repo's own; where they are more specific, they win. The project charter is `project.json`.

Movie tracker, sister app to the book tracker "Jackets & Manuscripts"
(jcm-book-library/my-book-library). See `PLAN.md` for the data model, sheet
findings and stages.

Model use: see "Using models" in the house rules.
- Subagents never write to the Google Sheet; only the main session does,
  after showing the owner the plan.

## Non-negotiables (from the owner's brief)

- Only touch the `🎥` tab and new tabs prefixed with 🎥. Never read or write
  Books, Reading Log, App Settings, Ratings, Contents, Wishlist, Calibre
  Review or any "Books backup" tab. Scope every Sheets call to a 🎥 range.
- Before writing: dated backup tab, find the row by `id` right before each
  write, write only changed cells. Never rewrite tabs, never delete and re-add
  rows.
- Dates `yyyy-mm-dd`, numbers as numbers, text prefixed with `'`. Keep the
  dropdown chips (`customUiMode: CHIP` set explicitly).
- After any bulk change, read the tab back and compare with a script.
- Build in stages; test headless with Playwright (Chromium at
  `/opt/pw-browsers/chromium`, stubbed `window.claude`) at laptop and phone
  width before every publish; commit and push each stage.
- Don't put model identifiers in commits, code or docs.
