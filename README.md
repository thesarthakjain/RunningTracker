# Running Milestones · 2026

A dark, Strava-orange personal running dashboard. It reads three tabs of a
Google Sheet and computes your 2026 milestones, consistency, trends and
personal records — fully client-side, no server, no API keys, no Premium.

**Live:** https://thesarthakjain.github.io/RunningTracker/
**Data:** the Google Sheet linked in the repo (sheet ID is in `app.js`).

## What it shows

| Section | Source |
|---|---|
| Hero stats (runs, km, time, avg pace) | `Activities` tab — 2026 runs only |
| Milestone cards (first run, longest distance/time, fastest 5k/10k, first race) | `Activities` tab |
| Streaks (current + best week streak, run days) | `Activities` tab |
| Calendar heatmap (run days, orange = more km) | `Activities` tab |
| Km-by-month & km-by-week charts, most active week | `Activities` tab |
| Personal records (3k/5k/10k/15k best paces, NEW PR badge) | `Activities` tab (+ localStorage memory) |
| Upcoming Targets | `Future Tracker` tab (Goal A / Goal B) |
| Completed Milestones (notes, bibs, medals, Strava embeds, matched run stats) | `Past tracker` tab |

## Setup — one time, ~5 minutes

1. **Request your Strava data export (free):**
   - On **strava.com** (a real browser, not the app): hover your name → **Settings → My Account**.
   - Under **Download your account** → **Get Started** → **Request download**.
   - Strava emails you a ZIP link in a few hours. Download it and unzip.
2. **Add it to the sheet (raw — no cleanup needed):**
   - In the Google Sheet, **File → Import → Upload → choose `activities.csv`**.
   - Choose **Insert new sheet** (don't overwrite anything).
   - Rename that sheet tab to exactly **`Activities`**.
   - *Tip:* if dates turn into Excel serial numbers, select the date column →
     Format → Number → Plain text (the site understands both anyway).

That's it. The site parses the raw export as-is — header row, `mm:ss` or
seconds, Excel serial dates, all handled in code.

## Refreshing the data

Same two moves whenever you want fresher stats:

1. Strava → Settings → My Account → **Request download** again (free).
2. Import the new `activities.csv` into a fresh sheet, rename it
   `Activities`, and delete the old `Activities` tab.

The site picks it up on next load (the browser may cache for a few minutes —
hard-refresh if needed). A “data as of …” line under the title shows the
newest run in the sheet.

## Notes

- Only **run** activities from **2026** are counted (trail runs included,
  rides/walks excluded).
- “First race” is detected by activity name keywords
  (race, marathon, 10k, 5k, HM, IAF, tri, …) or a match against a
  `Past tracker` milestone.
- **NEW PR** badges: the site remembers the last best pace per distance in
  your browser (`localStorage`). If a refreshed best is >0.5 s/km faster,
  it flags a NEW PR until you click “Got it”.
- The `Past tracker` rows get a run-stats strip (distance/time/pace for that
  day) auto-matched by date from the `Activities` tab.
- The sheet must be shared **“Anyone with the link: Viewer”** for the site
  to read it.

## Files

- `index.html` — page shell
- `styles.css` — dark-first Strava theme
- `app.js` — sheet fetching (opensheet + Google gviz fallback), raw-export
  parser, all milestone/streak/chart math, rendering
- `images/` — race bib & medal photos (`{ID}-bib.*`, `{ID}-medal.*`)

## Deploy

Push to GitHub and enable **GitHub Pages** (Settings → Pages → Deploy from a
branch, `main` / root). That's the whole deployment.
