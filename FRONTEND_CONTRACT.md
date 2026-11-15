# FRONTEND_CONTRACT — Oath backend ↔ web app

The frontend builds **only** from this file. Most examples were captured from the running backend on 2026-11-15
(ids shortened); the photo, reading-trial, Calibration-result and Shards-spend success examples follow the route code
(they need a camera, a reading session or real sensor time). If something here disagrees with the server, tell the backend.

- Base URL: same origin (`/api/...`). Phone / Watch / Shortcut use `PUBLIC_URL` (HTTPS tunnel).
- Reference client: `app/hunter/*` (phone armband page) uses these routes and the stream.

---

## 0. Words — what users see vs. what the API says

The API keeps its original identifiers. **Always translate on screen** (never show the left column):

| API / JSON | Show users |
|---|---|
| quest, `questId`, `/api/quest/*` | **vow** |
| `xp`, `xpGained`, `weeklyProof` | **Proof** |
| `levelup` (level change) | **Ascension** |
| `penalty`, `kind: "penalty"` | **the Reckoning** / Reckoning vow |
| `awakening` (voice `eventType`) | **Calibration** |
| `type: "gate"` | **Field Vow** |
| player / `playerId` | the person's name (never "player") |
| System | **Iris** (the Arbiter) |
| league | **Constellation** |
| currency | **Shards** |

Stats (`STR INT FOCUS VIT DISCIPLINE CHA`) → **Body · Mind · Focus · Vitality · Discipline · Presence**.
Ranks are letters **E → D → C → B → A** (A is the top; there is no S).
Never show: player, hunter, awaken, dungeon, shadow, arise.

Design tokens (CLAUDE.md): Iris blue `#38BDF8`, Ascension gold `#FBBF24`, Reckoning red `#EF4444`, bg `#05070D`;
glass panels, mono headers like `[TODAY'S VOWS]`; respect `prefers-reduced-motion`.

---

## 1. Envelope, errors, auth

Every JSON response:

```json
{ "success": true,  "data": { ... }, "error": null }
{ "success": false, "data": null,    "error": "No one found with id nobody-here" }
```

| Status | When | Example `error` |
|---|---|---|
| 400 | body/query invalid (zod) | `"✖ Invalid input\n  → at type"` |
| 401 | machine routes without the secret | `"Unauthorized"` |
| 404 | unknown person / vow | `"No one found with id nobody-here"`, `"No vow <id> for <playerId>"` |
| 409 | not allowed right now | `"Vow <id> is already done"`, `"Not enough Shards: 200 needed, 0 held"` |
| 500 / 503 | server / DB | `"Internal error"`, `"Leaderboard unavailable"` |

`error` strings are written to be shown to users as-is.

Browser routes need **no auth** (the person is identified by `playerId`; store it in `localStorage`).
Machine routes: `X-Sync-Token: <SYNC_TOKEN>` (`/api/health`, `/api/watch`) or `Authorization: Bearer <CRON_SECRET>` (`/api/cron/daily`, `/api/demo/*`). The browser never calls these.

---

## 2. Core objects

### Player
```json
{
  "id": "demo-contract", "name": "Ada",
  "rank": "E", "level": 1, "xp": 0,
  "stats": { "STR": 0, "INT": 0, "FOCUS": 0, "VIT": 0, "DISCIPLINE": 0, "CHA": 0 },
  "proof": { "STR": 0, "INT": 0, "FOCUS": 0, "VIT": 0, "DISCIPLINE": 0, "CHA": 0 },
  "penalty": false
}
```
- `xp` = total Proof → `level = floor(xp / 50) + 1` (an increase = **Ascension**).
- `proof` = Proof per stat → **Power** = Σ √proof + 3 × √(weakest) → **rank** bands E 0 · D 30 · C 70 · B 140 · A 250. (May be absent on old records: treat as all 0.)
- `stats` = stat points (+1 per vow kept in that stat; Calibration seeds 0–5).
- `penalty: true` = currently in **the Reckoning** (red UI).

### Quest (vow)
```json
{
  "id": "ee9bdf34-…", "playerId": "demo-contract", "stat": "DISCIPLINE",
  "title": "Make your bed", "type": "photo", "target": 1, "progress": 0, "xp": 30,
  "status": "active", "deadline": "2026-11-16T06:59:59.999Z", "difficulty": "normal", "kind": "manual"
}
```
Optional fields: `targetTime` (`"23:30"`, lights-out / bedtime vows), `topic` (read vows).

| `status` | `active` · `done` · `failed` · `cancelled` |
|---|---|
| `kind` | `daily` (midnight drop) · `manual` · `emergency` (urgent, 30 s) · `penalty` (Reckoning vow) · `calibration` (measurement, 0 Proof — hide from vow lists) |
| `difficulty` | `easy` · `normal` · `hard` |

| `type` | stat | verified by | `target` unit |
|---|---|---|---|
| `pushup` | Body | Home Base pad / phone / Watch | reps |
| `squat`, `situp` | Body / Vitality | phone or Watch accel | reps |
| `jumpingjack` | Vitality | phone or Watch accel | reps |
| `punch` | Body | Watch | reps |
| `jail` | Focus | Home Base (phone in the jail) | seconds |
| `read` | Mind | Phone Jail + reading trial (§3.6) | seconds |
| `meditate` | Focus | Home Base button + quiet | seconds |
| `lightsout` | Discipline | Home Base light sensor (now) | — |
| `lightsoutby` | Discipline | Apple Watch sleep ("asleep by `targetTime`") | night |
| `bedtime` | Discipline | Apple Watch sleep ("± 30 min of `targetTime`") | night |
| `sleep` | Vitality | Apple Watch / Health (hours asleep) | hours |
| `run`, `steps`, `workout` | Vitality / Body | Apple Health Shortcut | km / steps / minutes |
| `photo` | Discipline | photo + Gemini (§3.5) | photo |
| `quiz` | Mind | 3 questions (§3.4) | trial |
| `gate` | Presence | Field Vow (real-world event) | — |

Sensor vows (`pushup`…`lightsout`, `read`) can **only** be completed by sensors. Night vows (`lightsoutby`, `bedtime`, `sleep`) stay open until **noon the next day**.

### NightSummary (sleep)
```json
{ "night": "2026-11-14", "bedtime": "2026-11-15T06:35:00.000Z", "wake": "2026-11-15T13:55:00.000Z",
  "asleepMinutes": 433, "deepMinutes": 91, "remMinutes": 126, "coreMinutes": 216, "awakenings": 2, "inBedMinutes": 460 }
```
`night` = local date of the evening. Times are UTC ISO — format in the browser's local time.

---

## 3. Routes

### 3.1 People

**POST `/api/player`** — create (or fetch existing by `id`). New people trigger Iris's Calibration greeting (voice event).
```json
// request
{ "name": "Ada", "id": "demo-contract" }          // id optional (server makes a UUID); name 1–40 chars
// response
{ "player": { ...Player }, "created": true }
```

**GET `/api/player/:id`** → `{ "player": Player, "history": [{ "day": "2026-11-14", "stat": "STR", "xp": 40 }] }` (7 days of Proof per stat, for charts).

**GET `/api/quests/:playerId`** → `{ "player": Player, "quests": [Quest, …] }` (active first, live progress).

**POST `/api/player/:id/goals`** → remembered by Iris (designer + voice use it).
```json
{ "goal": "run a 10k" }            →   { "saved": true }       // false = memory offline (not an error)
```

### 3.2 Vows

**POST `/api/quest/start`** — create + start a vow, or resume one (sensors start counting immediately).
```json
{ "playerId": "demo-contract", "type": "photo", "title": "Make your bed" }
{ "playerId": "demo-contract", "type": "lightsoutby", "targetTime": "23:30" }
{ "playerId": "demo-contract", "type": "read", "topic": "The Hobbit, chapter 5" }
{ "playerId": "demo-contract", "type": "pushup", "difficulty": "hard" }      // or "target": 30 (≥ the easy target)
{ "playerId": "demo-contract", "questId": "ee9bdf34-…" }                       // resume
// response
{ "quest": { ...Quest } }
```
Starting the same type again returns the already-active vow.

**POST `/api/quest/emergency`** → `{ "playerId": "demo-contract", "type": "pushup" }` → `{ "quest": Quest }` (10 reps in 30 s; Home Base counts down).

### 3.3 Calibration (onboarding, ~5 min)

**POST `/api/calibration/start`**
```json
{ "playerId": "demo-contract", "age": 31, "bodyVariant": "pushup", "includeHealth": false }
// bodyVariant: "pushup" | "wallpushup" | "chairsquat"; age optional (13–110); includeHealth blends 7 days of steps + sleep into Vitality
// response
{ "session": {
    "playerId": "demo-contract", "startedAt": "2026-11-15T07:07:54.409Z", "bodyVariant": "pushup",
    "includeHealth": false, "recalibration": false,
    "stages": { "body": { "status": "pending" }, "vitality": { "status": "pending" },
                "mind": { "status": "running", "endsAt": "2026-11-15T07:09:54.542Z" }, "focus": { "status": "done", "score": 88 } },
    "result": null } }
```
409 `"Calibration was done recently. Next Calibration from 2026-12-15."` (every 30 days; re-calibration pays +50 Proof).

**POST `/api/calibration/submit`** — every response is `{ "session": Session, "stage": <stage payload> }`.

| Step | Request | `stage` payload |
|---|---|---|
| Body begin | `{ playerId, "stage": "body", "action": "begin" }` | `{ "questId": "…", "endsAt": "…" }` — 60 s; reps counted by pad/phone/Watch (show the live `rep` events) |
| Vitality begin | `{ …, "stage": "vitality", "action": "begin" }` | same (jumping jacks) |
| Body/Vitality finish | `{ …, "action": "finish" }` (optional — closes itself at 60 s) | `{ "score": 64 }` |
| Mind begin | `{ …, "stage": "mind", "action": "begin" }` | `{ "endsAt": "…", "question": { "id": "m5", "level": 2, "question": "If a train travels at 60 mph for 2 hours, how far does it go?", "options": ["90 miles","120 miles","150 miles","180 miles"] } }` |
| Mind answer | `{ …, "stage": "mind", "action": "answer", "questionId": "m5", "answerIndex": 1 }` | `{ "correct": true, "next": { …question } \| null, "done": false, "score"?: 83 }` — 2 min, ≤ 8 questions, adaptive |
| Focus begin | `{ …, "stage": "focus", "action": "begin" }` | `{ "durationMs": 60000, "endsAt": "…", "trials": [{ "i": 0, "atMs": 1500, "kind": "go" }, { "i": 1, "atMs": 2800, "kind": "go" }, …] }` (45 trials) |
| Focus submit | `{ …, "stage": "focus", "action": "submit", "responses": [{ "i": 0, "rtMs": 312 }, { "i": 3, "rtMs": null }] }` | `{ "score": 91, "hits": 33, "misses": 1, "falseAlarms": 1, "correctRejections": 10, "meanRtMs": 318, "accuracy": 0.93 }` |

Focus test UI: start a clock at "begin"; at each `atMs` show the stimulus (GO = tap, NO-GO = don't tap) for ~1 s; record `rtMs` from stimulus to tap
(or `null`). Submit within 30 s after `endsAt`. Stages can run in any order. After the 4th: `session.result` =
```json
{ "rank": "D", "overall": 58, "scores": { "body": 64, "vitality": 41, "mind": 83, "focus": 91 },
  "stats": { "STR": 3, "VIT": 2, "INT": 4, "FOCUS": 5, "DISCIPLINE": 0, "CHA": 0 }, "recalibration": false, "bonusXp": 0, … }
```
Starting rank is E–C (never higher). SSE: `calibration.stage` per stage, `calibration.complete` at the end.

### 3.4 Focus trial (after Phone Jail) — `quiz` vows

**POST `/api/quiz`** `{ "playerId", "questId", "topic": "photosynthesis" }` →
`{ "questId": "…", "questions": [{ "question": "In which organelle does photosynthesis take place in plant cells?", "options": ["Mitochondrion","Chloroplast","Nucleus","Ribosome"] }, …×3] }`

**POST `/api/quiz/answer`** `{ "playerId", "questId", "answers": [1, 2, 1] }` →
`{ "correct": 0, "passed": false, "answers": [1, 2, 1], "xpGained": 0, "leveledUp": false }` (≥ 2/3 keeps the vow; fewer → Reckoning; `answers` = correct indexes revealed).

### 3.5 Photo proof

**POST `/api/photo`** — `multipart/form-data`: `playerId`, `questId`, `photo` (jpeg/png/webp/heic, ≤ 8 MB).
```json
{ "passed": true, "confidence": 0.92, "reason": "Bed is made and the room is tidy.",
  "storage": "s3", "photoUrl": "https://…signed (15 min)…", "xpGained": 30, "leveledUp": false }
```
`passed:false` keeps the vow active (retry). `photoUrl` is null when stored locally.

### 3.6 Reading vow

1. `POST /api/quest/start { "playerId", "type": "read", "topic": "The Hobbit, chapter 5" }` → phone goes in the jail; reading time counts.
2. When time is up the vow stays `active` with `progress == target` (display shows `QUIZ`).
3. **POST `/api/read/trial`** `{ "playerId", "questId" }` → `{ "questions": [{ "question", "options" }×3], "secondsPerQuestion": 30, "deadline": "…" }`.
   409 `"Iris could not write the trial right now. Try again in a moment."` = retry (never a free pass).
4. **POST `/api/read/answer`** `{ "playerId", "questId", "answers": [1, 0, 3] }` → `{ "correct": 2, "passed": true, "late": false, "answers": [1,0,2], "xpGained": 40, "leveledUp": false }`.
   One attempt; after `deadline` (+5 s) everything counts wrong.

### 3.7 Sleep

**GET `/api/sleep?playerId=demo-sleep3&days=7`** (days 1–30) → `{ "playerId": "demo-sleep3", "days": 7, "nights": [NightSummary, …] }` (newest first).

### 3.8 Leaderboard, Constellation, Shards, weekly report

**GET `/api/leaderboard`** (`?includeDemo=1` also counts Proof earned in DEMO_MODE) →
```json
{ "week": "last 7 days", "includeDemo": false,
  "players": [{ "id": "demo-seed-climber", "name": "Bo", "rank": "D", "level": 16, "power": 53.3, "weeklyProof": 170 }, …] }
```
Top 10 by `weeklyProof` (verified only), then Power.

**GET `/api/constellation/:playerId`** →
```json
{ "name": "Lyra", "index": 0, "size": 17, "position": 13,
  "members": [{ "id": "demo-seed-climber", "name": "Bo", "rank": "D", "power": 53.3, "weeklyProof": 170 }, …] }
```

**GET `/api/shards/:playerId`** →
```json
{ "wallet": { "playerId": "demo-contract", "balance": 0, "earned": 0, "shields": 0, "cosmetics": [], "lastHalveAt": null },
  "prices": { "shield": 200, "halve": 300, "bonus": 150 },
  "catalog": [{ "id": "frame-ember", "name": "Ember frame", "cost": 100 }, { "id": "title-unbroken", "name": "Title: The Unbroken", "cost": 200 },
              { "id": "aura-starlight", "name": "Starlight aura", "cost": 300 }, { "id": "sigil-iris", "name": "Iris's sigil", "cost": 500 }] }
```
Shards are **earn-only** (1 per 10 Proof kept, +20 per Ascension). No purchase UI.

**POST `/api/shards/spend`**
```json
{ "playerId": "…", "item": "shield" }                         // max 3 held; absorbs one midnight's missed vows
{ "playerId": "…", "item": "bonus" }                          // extra vow, 1.5× Proof → detail.quest
{ "playerId": "…", "item": "halve", "questId": "<Reckoning vow>" }   // once / 7 days → detail.quest (new target)
{ "playerId": "…", "item": "cosmetic", "cosmeticId": "frame-ember" }
// response
{ "wallet": { … }, "detail": { … } }
// 409 "Not enough Shards: 200 needed, 0 held"
```

**GET `/api/report/:playerId`** (`?fresh=1` regenerates; cached 10 min; Opus ~5 s) →
```json
{ "playerId": "…", "generatedAt": "…", "source": "opus",
  "facts": { "xpByStat": { "STR": 0, … }, "totalXp": 0, "strongest": null, "weakest": "CHA", "completed": 0, "failed": 1, "activeDays": 0 },
  "report": { "title": "A Week of Silence", "verdict": "Zero Proof, zero active days, one vow broken, and the Reckoning now holds you.",
              "summary": "Seven days passed and you gave none of them to your vows. …", "orders": ["Show up once each day; …", "…", "…"] } }
```
`source: "fallback"` = written by code when Opus is offline (same shape). Translate `facts` stat ids with the labels in §0.

### 3.9 Voice files

**GET `/api/voice/<sha256>.mp3`** — `audio/mpeg`, immutable. Only ever use the `audioUrl` from a `voice` event.

### 3.10 Machine routes (not for the browser — listed for completeness)

| Route | Caller | Auth |
|---|---|---|
| `POST /api/readings` | Home Base bridge, `/hunter` phone page | none (LAN/tunnel) |
| `POST /api/watch` `{ playerId, event: "rep"\|"quest.complete", exercise, count }` | Apple Watch app | `X-Sync-Token` |
| `POST /api/health` (totals or sleep) | iPhone Shortcut (§6) | `X-Sync-Token` |
| `POST /api/cron/daily` | midnight cron | Bearer CRON_SECRET |
| `POST /api/demo/reset`, `POST /api/demo/seed { playerId }` | `npm run demo:reset`, `npm run demo:seed-others` | Bearer CRON_SECRET |

---

## 4. Live stream (SSE)

```ts
const stream = new EventSource('/api/stream');
stream.onmessage = (e) => {
  const event = JSON.parse(e.data);           // every event has `type` and `irisMood`
  if (event.playerId && event.playerId !== myId && event.type !== 'reading') return; // filter to the signed-in person
  switch (event.type) { /* … */ }
};
```
Comment lines (`: ping` every 10 s, plus a 2 KB comment on connect to flush proxies) keep the connection alive;
`EventSource` reconnects by itself. Each frame has an `id: <n>` line (`e.lastEventId`). Filter by `playerId`
(the stream carries everyone's events; `reading` has no playerId — it is the Home Base).

### 4.1 Polling fallback — use it on every screen

Some networks (the cloudflared quick tunnel used for phones) buffer SSE, so the stream can go silent.
**If no SSE message arrives for 5 s, poll `GET /api/events?since=<lastId>` every 1 s** until SSE talks again.
De-duplicate by id: skip any event whose id ≤ the last one you handled (from either path).

```
GET /api/events?since=41
→ { "success": true, "data": { "lastId": 43, "events": [
     { "id": 42, "type": "rep", "playerId": "p1", "questId": "q1", "count": 3, "irisMood": "watching" },
     { "id": 43, "type": "quest.update", "quest": { … }, "irisMood": "watching" } ] }, "error": null }
```
- Same event JSON as the stream, plus `id`. Raw `reading` events are **not** included; the newest 500 events are kept.
- First poll with no known id: just store `lastId` (don't replay history; load current state over REST).
- If `lastId` comes back **lower** than yours, the server restarted: store the new `lastId`, refetch REST state.
- `since` must be a non-negative integer (else 400).
- Reference implementation: `app/hunter/useSystemStream.ts` + `app/hunter/eventPolling.ts` (copy them).

**Every event includes `irisMood`**: `watching` · `unimpressed` · `proud` · `furious` · `sleepy` → Iris's face/colour.

| `type` | payload (besides `type`, `irisMood`) | mood | show |
|---|---|---|---|
| `reading` | `reading: { t, source: "homebase"\|"phone"\|"watch", pad?, btn?, light?, snd?, ax?, ay?, az?, jail? }` (≤ 10/s) | watching | live sensor widgets |
| `rep` | `playerId, questId, count` | watching | rep counter |
| `rep.rejected` | `playerId, questId, reason` ("too fast", "not deep enough", photo reason…) | unimpressed | "✕ DOES NOT COUNT" |
| `quest.update` | `quest: Quest` | watching | upsert the vow |
| `quest.complete` | `quest: Quest, xpGained` | proud | `[VOW KEPT] +N Proof` |
| `levelup` | `playerId, fromRank, toRank, level` | proud | **Ascension** (gold) |
| `rank.up` | `playerId, fromRank, toRank, power` | proud | new rank letter |
| `rank.passed` | `playerId, passedId, passedName, weeklyProof` | proud | "You passed Bo this week" |
| `penalty` | `playerId, questId?, reason` | furious | **the Reckoning** (red) |
| `calibration.stage` | `playerId, stage: body\|vitality\|mind\|focus, status: started\|done, score?, detail?, endsAt?` | watching | Calibration progress |
| `calibration.complete` | `playerId, rank, overall, scores { body, vitality, mind, focus }, recalibration, bonusXp` | proud | result screen |
| `sleep.summary` | `playerId, summary: NightSummary, line` | sleepy | morning card with Iris's `line` |
| `voice` | `text, eventType, playerId?, audioUrl?, irisMood` | per line | caption + `playVoice` (§5) |

Example frames (captured):
```
data: {"type":"sleep.summary","playerId":"demo-sleep4","summary":{"night":"2026-11-14",…},"line":"Last night is on the record. Do better or do it again.","irisMood":"sleepy"}
data: {"type":"voice","text":"Last night is on the record. Do better or do it again.","eventType":"sleep","playerId":"demo-sleep4","audioUrl":"/api/voice/55bd920e….mp3","irisMood":"sleepy"}
data: {"type":"voice","text":"Ash has sworn the first vow, and the Arbiter takes note. Calibration begins now; …","eventType":"awakening","playerId":"demo-sleep4","audioUrl":"/api/voice/c3ebb8f7….mp3","irisMood":"watching"}
```
`voice.eventType` ∈ `awakening` (Calibration) · `levelup` · `penalty` · `emergency` · `quest.complete` · `quest.start` · `daily` · `sleep` · `rep.rejected` · `health.sync`.

---

## 5. Iris's voice — `playVoice`

```ts
import { playVoice } from '@/lib/voicePlayback';   // lib/voicePlayback.ts (browser-safe)

case 'voice':
  setCaption(event.text);                 // already tag-free; ≤ 2 sentences
  setIrisMood(event.irisMood);
  void playVoice(event);                  // → 'audio' | 'speech' | 'none'
```
- With `audioUrl`: plays the ElevenLabs (or Polly) MP3. Without it, or if playback is blocked: browser `speechSynthesis` (low, slow).
- **Browsers block audio until the first user gesture** — the first screen needs a "Begin" button (any tap/click unlocks it).
- Queue lines yourself if you don't want overlaps; `speechSynthesis` cancels the previous line automatically.

---

## 6. Apple Health Shortcut (sleep + totals)

**Sleep — "Send Sleep to Iris"** (Shortcuts → +):
1. **Find Health Samples** → **Sleep Analysis**, Start Date **is in the last 1 day**, sort by Start Date (oldest first).
2. **Repeat with Each**: **Dictionary** → `start` = Repeat Item › Start Date (ISO 8601), `end` = Repeat Item › End Date (ISO 8601),
   `stage` = Repeat Item › Value (`In Bed`, `Core`, `Deep`, `REM`, `Awake`, `Asleep` — any case).
3. After End Repeat: **Dictionary** `type` = `sleep`, `playerId` = your id, `samples` (Array) = Repeat Results.
4. **Get Contents of URL** `PUBLIC_URL/api/health`, POST, headers `X-Sync-Token` + `Content-Type: application/json`, body = that Dictionary.
5. Automation: daily 08:00 (or "when Sleep Focus turns off") → run it. Re-runs are safe (deduped).

Response: `{ "playerId", "added": 17, "lastNight": NightSummary, "vows": [{ "questId", "type": "lightsoutby", "kept": true, "bonusXp": 10, "detail": "Asleep at 23:35, before 23:45 (room confirmed dark)." }], "announced": true }`.

**Totals — "Sync with Iris"**: POST `PUBLIC_URL/api/health` with `X-Sync-Token` and
`{ "playerId": "…", "steps": 8200, "distanceKm": 5.1, "activeKcal": 540, "workoutMinutes": 35, "sleepHours": 7.2 }` →
`{ "playerId", "completed": [{ "id", "title", "xp" }], "progressed": [{ "id", "title", "progress", "target" }], "leveledUp": false }`.

---

## 7. Screens → routes (suggested flow)

1. **Swear the oath**: name (+ optional age) → `POST /api/player` → "Begin" (unlocks audio) → Calibration (§3.3).
2. **Today**: `GET /api/quests/:id` + stream (`quest.update`, `rep`, `quest.complete`). Group by `kind`; hide `calibration`.
3. **Vow detail**: start/resume via `/api/quest/start`; photo vows → §3.5; quiz/read → §3.4 / §3.6; sleep vows show `targetTime`.
4. **Morning**: `sleep.summary` card + `GET /api/sleep`.
5. **Board**: `/api/leaderboard` (this week) and `/api/constellation/:id`; react to `rank.passed`.
6. **Shards**: `/api/shards/:id` + spend.
7. **Week**: `/api/report/:id` (show a spinner ~5 s on first open).

## 8. Demo helpers (backend terminal)

`npm run demo:reset` · `npm run demo:seed-others -- <id>` · `npm run demo:sleep -- <id> --tonight [--short]` ·
`npm run hw:check` · `npm run voice:pregen`. `DEMO_MODE=1`: Phone Jail / reading = 20 s, Calibration can be redone, the first
urgent vow guarantees a rank-up — and that Proof is kept off the leaderboard unless `?includeDemo=1`.
