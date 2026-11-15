# UI_REPORT — branch `oath-ui`

Written 2026-11-15, end of the overnight run. Everything below is on `origin/oath-ui`.

## Is `oath-ui` safe to demo from?

**Yes, with one thing to check on a real iPhone first.** Every route builds, renders with no console errors and no
horizontal overflow at 390×844 and 1440×900, and was exercised against the live API (same `.env.local`, dev server on
port 3100). What a headless browser cannot prove is listed under "Not verified" — run through `/band` once on the
actual phone before judges hold it.

- `next build`: green. `npm test`: 598 tests in 70 files, all passing (457 before the run; the new ones cover the UI's
  pure helpers and the brand-word guard). `eslint app components`: clean.
- `origin/backend` was merged before every route and once more at the end; the branch contains backend up to
  `d0fff3b`. No conflicts occurred. Nothing under `app/api`, `lib/`, `engine/`, `bridge/` or `firmware/` was edited.
- No history was rewritten and nothing was force-pushed.

## What is done

| # | Route | What it is |
|---|---|---|
| 1 | `/band` | The phone page. Small 2D glass Iris, name, rank letter, Iris's line as a glass caption, huge thin counter in a glowing ring, "✕ Not counted — go deeper" flash, glass **Begin**, 2×2 glass vow cards, safe-area padding. `/hunter` is an alias (same page, `?player=` still works). |
| 2 | `/today` | Iris (3D on wide screens, 2D on phones) beside the day's vows, grouped Urgent / Reckoning / Today / Sworn by you / Kept / Broken. Begin a sensor vow, send photo proof, take a quiz or reading trial, swear a new vow, last-night sleep card. |
| 3 | `/rank` | Enormous rank letter, E–A ladder, Power and what the next letter needs, six stats, 7-day Proof, Constellation (you are always on the board), Shards, the weekly verdict on request. |
| 4 | `/` | The scroll site from `design/oath.html`: seven sections over a particle field that morphs per section, loader, cursor, live demos. |
| 5 | `/calibrate` | Name → **Begin** → four tests (Body and Vitality by sensor, Mind questions, Focus go/no-go) → starting rank letter. |
| 6 | `/reckoning` | Red screen, furious Iris, the Reckoning vow with its clock; pay it by sensor, trial or photo; "Halve it" when there are enough Shards. Calm "No debt" state otherwise. |
| 7 | Home-screen app | `app/manifest.ts` (name/short_name OATH, standalone, `#05060A`, `start_url: /band`), `app/apple-icon.png` (180 px glass Iris on `#05060A`), 192/512 icons, `apple-mobile-web-app-capable` + `black-translucent`. |

### `/band` keeps all the phone logic

Nothing in the logic was rewritten; the new screen imports it from `app/hunter/`:
`useMotionSender` (motion permission inside the tap, ~30 Hz, `?sessionId=`), `useSystemStream` + `eventPolling`
(SSE with the 5 s → 1 s polling fallback), and the backend's later additions, which arrived by merge during the night
and were ported into the new screen: `useWakeLock` (screen stays awake while a vow is active), **Pocket mode** (black
screen, tiny counter, hold 2 s to leave), the "Sensor paused — the screen was locked" notice, and the `?debug=1` rep
tuning line.

The old `HunterClient.tsx`, `QuestPanel.tsx`, `SystemOverlay.tsx` and `PocketMode.tsx` are still in `app/hunter/` but
no route renders them. They were left in place on purpose: `lib/brand.test.ts` (backend's) reads those files, and
keeping them means backend edits to them still merge cleanly. **If backend changes `HunterClient.tsx` again, the
change has to be ported to `app/band/BandClient.tsx` by hand** — a merge will not flag it.

### Rules from the brief

- **Voice and mood.** Every screen goes through `components/oath/useIris.ts`: each `voice` event calls
  `playVoice(event)` and sets the caption; Iris's mood comes from `moodFor(event)` in `lib/irisMood.ts`, the same
  function the server uses to stamp `irisMood`. (The value is recomputed rather than read off the wire because
  `StreamEventSchema` strips `irisMood` from every event except `voice` and `sleep.summary`.) The mood holds for 8 s,
  then returns to the screen's resting mood (furious while in the Reckoning).
- **Words.** `components/oath/brand.test.ts` parses every UI file and fails on player / hunter / awaken / dungeon /
  shadow / arise and on quest / XP / level up / system in visible text. Ranks are letters E D C B A everywhere; the
  design's six named tiers on the scroll site were replaced with "Five ranks". Vow titles that arrive tagged
  (`[RECKONING] Mind Trial`) are shown without the tag.
- **Verification stays in code.** No screen can mark a sensor vow done. Buttons only start or resume a vow; reps,
  timers, photos and trials are judged by the server.
- **60 fps budget.** Both WebGL scenes are hand-written (no 3D library was added — CLAUDE.md says to ask before adding
  dependencies and nobody was awake). DPR is capped at 1.75 (`components/oath/gl/program.ts`), the field uses 22,000
  particles on desktop and 12,000 on phones, both scenes stop their frame loop when the tab is hidden or the canvas is
  off screen, and both fall back (2D Iris glyph / static backdrop) if WebGL fails or the context is lost. Under
  `prefers-reduced-motion` the 3D Iris is replaced by the 2D glyph, the particle field freezes time (it still follows
  scroll), and CSS animations are off.
- **Type.** Inter Tight for text, JetBrains Mono only on the small uppercase labels (`.mono`), Instrument Serif italic
  for the accent words, as in the design files.

## Screenshots

All in `ui-shots/` (committed), named `<screen>-390x844.png` and `<screen>-1440x900.png`.

| Screen | Files |
|---|---|
| `/band` signed in, vow running | `ui-shots/band-*.png`, `ui-shots/band-live-*.png` |
| `/band` oath form | `ui-shots/band-join-*.png` |
| `/hunter` alias | `ui-shots/hunter-alias-*.png` |
| `/today` | `ui-shots/today-*.png`, reduced motion `ui-shots/today-reduced-*.png`, nobody sworn `ui-shots/today-not-sworn-*.png` |
| `/rank` (full page) | `ui-shots/rank-*.png` |
| `/` | `ui-shots/home-hero-*.png`, `home-vow-*`, `home-proof-*`, `home-ranks-*`, `home-const-*`, `home-reckon-*`, `home-cta-*`, reduced motion `home-reduced-*` |
| `/calibrate` | `ui-shots/calibrate-oath-*.png`, `calibrate-hub-*`, `calibrate-mind-*`; phone only: `calibrate-focus-390x844.png`, `calibrate-body-390x844.png`, `calibrate-result-390x844.png` |
| `/reckoning` | `ui-shots/reckoning-*.png` (in the Reckoning), `ui-shots/reckoning-clear-*.png` (no debt) |

How they were taken: headless Chromium (software GL) against `next dev -p 3100`, console and page errors collected on
every load. The Calibration shots come from a scripted run of the whole flow (oath → Mind → Focus → Body → Vitality →
result) on the phone viewport.

## Independent review, and what was fixed

A separate reviewer read all the UI code after the routes were done. Fixed from its findings:

- `/reckoning`: the trial result sheet disappeared the moment the vow was graded (it was tied to the vow still being
  owed). It now stays until closed.
- `?player=<id>` is now saved on arrival, so tapping Today / Rank / Band from a QR-code link keeps you signed in.
- A remembered id that no longer exists (after `demo:reset`) used to leave a red error with no way out; it is now
  forgotten and the oath screen shows (`ui-shots/today-unknown-id-*.png`).
- Ordinary events (`rep`, `quest.update`) no longer calm Iris down: she stays furious through a Reckoning and proud
  after a kept vow for the full 8 s.
- The Focus test can be taken from the keyboard / assistive tech; trial sheets take focus and close on Escape; photo
  buttons show keyboard focus.
- Calibration: a failed "finish" keeps the stage on screen; a denied motion permission is retried on the next Begin and
  explained; WebGL uniform lookups are cached instead of repeated every frame.
- A first tap on any screen now primes audio and speech (see "Audio" below for what that does and does not cover).

Reported but not changed: announcements are not a persistent live region (screen readers may miss them); WebGL
buffers are not explicitly freed on unmount (the context goes with the canvas); the Mind test clock reaching 0:00 does
nothing until the next answer (the server closes the stage then).

## Not verified — check these by hand

1. **Real iPhone, real motion.** Headless Chromium has no accelerometer and no iOS permission prompt. The live
   counter was tested by starting a squat vow and running `bridge/simulator.ts` against its `sessionId`; rep and
   rejection events reached `/band` and moved the counter. The **Begin → motion permission → streaming** path on a
   physical phone was not run tonight.
2. **Audio.** `playVoice` is called on every voice event, but headless runs are silent, so nothing was heard. The
   first tap on any screen plays a silent clip and an empty utterance to unlock audio. Whether that is enough on iOS
   is unproven: `lib/voicePlayback.ts` creates a new `Audio` element per line, and iOS has at times unlocked audio per
   element. If Iris is silent on the phone, the fix is in that file (reuse one element), which was off limits tonight.
3. **Frame rate.** Headless uses software rendering, so 60 fps could not be measured. The budget limits above are in
   place; the scroll site on an older phone is the one to watch.
4. **Installed app.** Manifest and head tags are served correctly (checked in the HTML). Adding to the home screen was
   not tested. On iOS an installed app has its own storage and opens `/band` with no `?player=`, so it shows the oath
   form and **swearing there creates a new person** — there is no way yet to enter an existing id inside the installed
   app. For the demo, either swear in from inside the installed app, or use Safari with the `?player=` link.
5. **Photo proof and reading trials** on `/today` and `/reckoning` were built to the contract but not exercised end to
   end (they need a camera or a finished reading session). The quiz trial path was exercised through the API.
6. **Safari.** Only Chromium was run. The CSS uses `@property`, `color-mix`, `dvh` and `backdrop-filter`, all of which
   current Safari supports.

## Known issues

- **The simulator's squats are mostly rejected by the new rep verifier.** With `npm run sim squat <sessionId>` only
  about 3 of 7 squats counted and several came back "too slow". That is backend/simulator territory and was left
  alone, but it means the simulator is a weak stand-in for a demo fallback right now.
- **Calibration scored Body 0 / Vitality 0 in the scripted run** because no sensor was attached; that is the expected
  result of doing no reps, not a UI fault.
- `CLAUDE.md` still lists the older palette (`#38BDF8`, bg `#05070D`). The UI follows `design/oath.html` and the brief
  (`#05060A`, `#7DD3FC`, gold `#F5C46B`, red `#F0524F`, violet `#B69CFF`).
- `/rank` shows the Constellation as the top rows plus you (seven rows), not every member, and does not show the
  global top-10 leaderboard (`/api/leaderboard`).
- The `/` loader counts to 100 before the page reveals (as in the design); it adds roughly a second before first
  interaction.
- Two throwaway people were created in the shared database for testing: `demo-ui-ada` and `demo-ui-reck` (left in
  the Reckoning on purpose, useful for showing that screen). Both use the `demo-` prefix, so `npm run demo:reset`
  removes them.
- Left alone on purpose: the uncommitted `package.json` change (`allowScripts`) and the untracked `design/` folder
  were there before the run and are not part of any commit.
- The dev server this run used (port 3100) has been stopped; your own server on port 3000 was never touched.

## Where things live

- `app/oath.css` — tokens, glass, buttons, chips, Iris, shell (imported by `app/globals.css`)
- `components/oath/` — `Iris` (3D/2D chooser), `IrisCanvas` (WebGL), `IrisGlyph` (SVG), `useIris`, `usePerson`,
  `OathShell`, `Announcement`, `api.ts` (typed client), `events.ts`, `gl/` (matrix + WebGL helpers)
- `components/landing/` — scroll site, particle field, shapes, demos
- `app/band`, `app/today`, `app/rank`, `app/calibrate`, `app/reckoning` — one folder per route, each with its pure
  helpers and their tests
