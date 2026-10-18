# my-film-library: working notes for Claude

Movie tracker, sister app to the book tracker "Jackets & Manuscripts"
(jcm-book-library/my-book-library). See `PLAN.md` for the data model, sheet
findings and stages.

## Use usage credits well: orchestrate across models

The owner asked for this. Keep the main session for judgement and hand
routine work to cheaper models with the Agent tool's `model` option:

- **Main session (most capable model):** planning, data-model and sheet-safety
  decisions, anything that writes to the Google Sheet, reviewing subagent
  output before it is committed or published, talking to the owner.
- **`sonnet` subagents:** building a feature or tab from a clear spec,
  porting patterns from the book app, writing and running Playwright tests,
  fixing test failures.
- **`haiku` subagents:** mechanical work: profiling sheet exports with a
  script, read-back comparisons after a bulk change, grepping the reference
  app for a pattern, checking screenshots for sideways scrolling.

Rules of thumb:
- Give each subagent a self-contained brief (files, spec, what "done" means)
  so it doesn't re-derive context.
- Subagents never write to the Google Sheet; only the main session does,
  after showing the owner the plan.
- Prefer one well-scoped subagent over several overlapping ones.

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
