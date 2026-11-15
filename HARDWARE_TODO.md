# HARDWARE_TODO — steps that need a human or a device

Code for every item below is built and covered by mocks/simulator tests. These are the
real-world checks still to do, in plan order. Tick them off as you go.

---

## Phase 5 — Home Base serial bridge (Arduino on USB)

**Firmware contract** (what `bridge/serial.ts` expects):
- Serial @ **115200**, one JSON object per line (`\n`), every ~100 ms:
  `{"t":<ms since boot>,"pad":0|1,"jail":0|1,"btn":0|1,"light":0-1023,"snd":0-1023,"ax":g,"ay":g,"az":g}`
  (all fields except `t` optional; non-JSON lines like boot banners are ignored).
- Commands arrive one per line: `SEG:<exactly 4 chars>`, `LOCK`, `UNLOCK`, `BUZZ:chime|alarm|tick`.
- Pins: pad switch D3, button D2, buzzer D4, servo D5, IR D6, sound A0, light A1, display + accel on I2C.

**Steps**
- [ ] Plug the Arduino in. Close the Arduino IDE **Serial Monitor** (it locks the port).
- [ ] `ls /dev/cu.usb*` → put it in `.env.local`: `SERIAL_PORT=/dev/cu.usbmodemXXXX`
- [ ] Terminal 1: `npm run dev` · Terminal 2: `npm run bridge`
      Expect: `[bridge] serial /dev/cu.usbmodemXXXX open @115200`.
- [ ] Terminal 3: `curl -N localhost:3000/api/stream` — you should see `reading` events ~10/s.
- [ ] Press the pad 10× at a normal push-up pace → 10 `rep` events (count 1…10) on the practice quest.
      Tap it very fast twice → second tap gives `rep.rejected` "too fast". Hold > 3 s → no rep.
- [ ] Commands (each should act on the device and return `{"success":true,...}`):
  ```bash
  curl -X POST localhost:3001/cmd -d 'BUZZ:chime'
  curl -X POST localhost:3001/cmd -d 'SEG:RK-E'
  curl -X POST localhost:3001/cmd -d 'LOCK'
  curl -X POST localhost:3001/cmd -d 'UNLOCK'
  curl localhost:3001/health          # {"data":{"serial":"open"}}
  ```
- [ ] Unplug the USB cable for 5 s, plug back in → bridge logs `closed — reconnecting` then `open` again; reps resume.
- [ ] Bridge on a different laptop than the app? Use a phone hotspot (venue Wi-Fi blocks laptop-to-laptop),
      set `APP_URL=http://<app-laptop-ip>:3000` on the bridge laptop and `DEVICE_URL=http://<bridge-laptop-ip>:3001` on the app laptop.

No hardware? `SERIAL_PORT=mock npm run bridge` runs a fake Home Base (pad push-ups every 1.5 s, logs received commands).

---

## Phase 7 — Emergency quest on the real pad

Setup: `npm run dev` + `npm run bridge` (real `SERIAL_PORT`), `DEMO_MODE=1` in `.env.local`
(restart `npm run dev` after changing it). Start clean: `npm run demo:reset`.

- [ ] Create a fresh demo player (ids must start with `demo-` / `test-` so reset can remove them):
  ```bash
  curl -X POST localhost:3000/api/player -H 'content-type: application/json' -d '{"name":"Jin","id":"demo-jin"}'
  curl -X POST localhost:3000/api/quest/emergency -H 'content-type: application/json' -d '{"playerId":"demo-jin"}'
  ```
  Expect: alarm buzz, display shows `  30` and counts down once per second. Response `quest.xp` = **100** (demo bonus).
- [ ] Do 10 pad push-ups inside 30 s → display shows the rep count, then `BUZZ:chime` + `LVUP`, ~2 s later `RK-D`.
      `curl localhost:3000/api/player/demo-jin` → `rank: "D"`, `xp: 100`.
- [ ] Second emergency for the same player → `quest.xp` = 40 (bonus is first-time only). Let it run out:
      alarm + `FAIL` on the display, a `[PENALTY] Push-ups` quest (15 reps) appears in `/api/quests/demo-jin`.
- [ ] Cancel path: start an emergency, then start any other sensor quest
      (`POST /api/quest/start {"playerId":"demo-jin","type":"squat"}`) → the emergency shows status
      **`cancelled`** (not `failed`), no alarm, no penalty quest.
- [ ] `DEMO_MODE` unset (restart dev) + `npm run demo:reset` → new player's emergency is worth 40 XP (stays E).
- [ ] `npm run demo:reset` → `demo-jin` is gone from `/api/leaderboard` and from Tiger (`select * from players`);
      any real player is still there.

**Auth checks** (should all be 401):
```bash
curl -i -X POST localhost:3000/api/cron/daily                          # no CRON_SECRET bearer
curl -i -X POST localhost:3000/api/demo/reset                          # no CRON_SECRET bearer
```

---

## Phase 7B — HTTPS tunnel (needed for phone /hunter, Watch, Shortcuts)

`next.config.ts` already allows `*.trycloudflare.com` (and `PUBLIC_URL`'s host) as dev origins.

- [ ] `brew install cloudflared`
- [ ] Terminal: `npm run dev` · another terminal: `npm run tunnel`
      → copy the `https://<words>.trycloudflare.com` URL it prints.
- [ ] Put it in `.env.local` as `PUBLIC_URL=https://<words>.trycloudflare.com` (changes on every tunnel restart —
      update the Shortcut / Watch app / phone bookmark too).
- [ ] From the phone (cellular, not laptop Wi-Fi): open `PUBLIC_URL/api/leaderboard` → JSON with `"success":true`.
- [ ] Token check from anywhere: `curl -i -X POST $PUBLIC_URL/api/cron/daily` → **401**;
      with `-H "Authorization: Bearer $CRON_SECRET"` → 200.
- [ ] ⚠️ `.env.local` has **two** `CRON_SECRET=` and **two** `SYNC_TOKEN=` lines with different values. The last one wins.
      Delete the stale pair so the Shortcut/Watch/Maritime all use the same value.
- [ ] Later: deploy to Vercel for the public leaderboard (set the same env vars there).

---

## Phase 7C — Watch notifications (ntfy)

Sent on: daily drop `[DAILY QUEST HAS ARRIVED]`, `[EMERGENCY QUEST]` (urgent), `[PENALTY ZONE]` (urgent),
`[QUEST COMPLETE]`, `[LEVEL UP]` (high). No-op if `NTFY_TOPIC` is empty.

- [ ] iPhone: install **ntfy** (App Store) → `+` → subscribe to the exact `NTFY_TOPIC` from `.env.local`
      (server `ntfy.sh`). Allow notifications. Watch app → Notifications → ntfy → **Mirror iPhone alerts**.
- [ ] Test without the app: `curl -d 'System online' -H 'Title: [SYSTEM]' ntfy.sh/$NTFY_TOPIC` → phone + Watch buzz.
- [ ] With the app: `POST /api/quest/emergency` for a demo player → `[EMERGENCY QUEST]` on the Watch within ~2 s.
- [ ] iPhone locked + Watch on wrist: urgent alerts (emergency/penalty) still come through. If Focus mode blocks
      them, allow ntfy in Focus settings.

---

## Phase 7C — Apple Health Shortcut → `POST /api/health`

Endpoint needs `X-Sync-Token: <SYNC_TOKEN>` (401 otherwise). Body (all metrics optional, numbers or numeric text):
`{"playerId":"<id>","date":"2026-11-15","steps":8123,"distanceKm":3.2,"activeKcal":410,"workoutMinutes":35,"sleepHours":7.4,"avgHeartRate":72}`
Omit `playerId` if `.env.local` has `HEALTH_PLAYER_ID=<id>`. Completes active run (km) / steps / workout (min) / sleep (h) quests
that reached their target; partial totals show as progress.

- [ ] Test first from the laptop:
  ```bash
  curl -X POST $PUBLIC_URL/api/health -H "X-Sync-Token: $SYNC_TOKEN" -H 'content-type: application/json' \
    -d '{"playerId":"demo-jin","steps":9000}'
  ```
  → `completed` lists the steps quest (if the player has one: `POST /api/quest/start {"playerId":"demo-jin","type":"steps"}`).
- [ ] iPhone Shortcuts → **New Shortcut** "Sync with System":
  1. *Find Health Samples* — Steps, start date **is today** → *Calculate Statistics* Sum → variable `steps`
  2. Same for Walking + Running Distance (km) → `distanceKm`, Active Energy → `activeKcal`
  3. *Find Health Samples* Workouts today → *Calculate Statistics* Sum of Duration (minutes) → `workoutMinutes`
  4. *Find Health Samples* Sleep Analysis, start date **is in the last 1 day**, value Asleep → Sum of Duration (hours) → `sleepHours`
  5. *Get Contents of URL* `PUBLIC_URL/api/health`, Method **POST**, Headers `X-Sync-Token` = SYNC_TOKEN,
     Request Body **JSON**: keys above as **Number** fields, plus `playerId` (Text).
  6. *Show Result* (handy while testing).
- [ ] Run it once; allow Health access. Response `"success":true`.
- [ ] Optional automations: Shortcuts → Automation → *When a workout ends* and *Time of day 9 PM* → run "Sync with System".

---

## Phase 7C — Apple Watch app → `POST /api/watch`

Contract for the Watch app (Swift): header `X-Sync-Token: <SYNC_TOKEN>`, JSON
`{"playerId":"<id>","event":"rep"|"quest.complete","exercise":"pushup"|"squat"|"jumpingjack"|"situp"|"punch","count":<n>}`.
**`count` is cumulative for the current quest** (1, 2, 3 … — not always 1). The server adds only the increase, so a
lost or retried post fixes itself. 409 = the player's active quest is a different exercise (or none) → show it on the Watch.
Punch quests can only be counted by the Watch.

- [ ] Simulate the Watch from the laptop:
  ```bash
  curl -X POST localhost:3000/api/quest/start -H 'content-type: application/json' -d '{"playerId":"demo-jin","type":"squat","target":15}'
  for n in 1 2 3; do curl -s -X POST $PUBLIC_URL/api/watch -H "X-Sync-Token: $SYNC_TOKEN" \
    -H 'content-type: application/json' -d "{\"playerId\":\"demo-jin\",\"event\":\"rep\",\"exercise\":\"squat\",\"count\":$n}"; echo; done
  ```
  → `progress` 1, 2, 3 and `rep` events on `/api/stream`.
- [ ] On the real Watch: start a squat quest, do 5 squats → dashboard shows 5; haptic per rep.
- [ ] Airplane-mode the Watch for 3 reps, reconnect, do 1 more → count catches up (no lost reps).

---

## Phase 7C — iPhone `/hunter` armband page

- [ ] With the tunnel up (Phase 7B), open `PUBLIC_URL/hunter?player=demo-jin` in **Safari** on the iPhone
      (no `?player` → registration form; the id is remembered on the phone).
- [ ] Tap **AWAKEN** → allow *Motion & Orientation*. Status should read `SENSOR LINKED · N samples` (N climbing ~30/s).
      Denied by mistake? Settings › Apps › Safari › Motion & Orientation Access → on, reload.
- [ ] Start a squat quest (buttons on the page, or from the dashboard), tap **COUNT ON THIS PHONE ▸** if shown.
      Strap the phone to the upper arm/thigh; first **2 slow squats calibrate**, then each full squat = +1.
      A half squat flashes `✕ NOT DEEP ENOUGH`.
- [ ] Reach the target → blue `[QUEST COMPLETE]` overlay; on rank-up a gold `[LEVEL UP] Rank D` overlay.
- [ ] Screen should stay on while streaming (wake lock). If it dims, set Auto-Lock to Never for the demo.
- [ ] Arm push-ups from the phone: start a push-up quest, phone on the upper arm.

---

## Phase 8 — Phone Jail, Meditate, Lights out (Home Base)

No hardware? `npm run sim jail | meditate | lightsout` exercises each verifier end to end.

**Phone Jail** (IR D6 + servo D5). `DEMO_MODE=1` → jail quests default to **20 s**.
- [ ] `POST /api/quest/start {"playerId":"demo-jin","type":"jail"}` → display idle until the phone goes in.
- [ ] Put the phone in → servo **LOCKs**, display counts `  20` → `   1`.
- [ ] Leave it → at 0: servo **UNLOCKs**, chime, quest done (+FOCUS), and a `[FOCUS QUIZ]` quest appears.
- [ ] Again, but pull the phone out after ~5 s → **UNLOCK**, alarm, `FAIL`, Penalty Zone + a 30 s penalty jail quest.
- [ ] Brief IR flicker (wave a finger through the beam < 1 s) must NOT fail it. If it does, the IR sensor
      needs re-aiming; the grace is `FLICKER_GRACE_MS` in `engine/verifiers/jail.ts`.
- [ ] Mid-lock, start a push-up quest from the dashboard → servo must UNLOCK (never leave a phone trapped).

**Meditate** (button D2 + sound A0): first 1 s calibrates the room's quiet level — stay silent at the start.
- [ ] Start `{"type":"meditate","target":30}` → hold the button; display counts down.
- [ ] Release for < 2 s → keeps counting. Release for > 2 s → `rep.rejected "hold the button"`, timer pauses.
- [ ] Clap/talk loudly > 2 s → `rep.rejected "too loud"`. If normal breathing triggers it, raise `SOUND_MARGIN`
      in `engine/verifiers/meditate.ts` (default 60 of 1023).

**Lights out** (light A1): first 1 s calibrates the lit room — start with the lights ON.
- [ ] Start `{"type":"lightsout"}` → switch the lights off → after 2 s dark the display shows `DARK`, quest done.
- [ ] A hand shadow over the sensor (< 2 s) must not complete it.

---

## Phase 9 — AI checks (needs Wi-Fi; everything falls back to canned content offline)

- [ ] Voice: keep `curl -N localhost:3000/api/stream | grep voice` open, trigger an emergency → a `voice` line within ~1–3 s.
      Wi-Fi off → the line is a canned one (still instant).
- [ ] Focus quiz after a jail session: `POST /api/quiz {"playerId","questId","topic":"what you studied"}` →
      3 questions; `POST /api/quiz/answer {"answers":[i,i,i]}` → ≥2 right completes it (+INT).
- [x] Quest designer live call: `npm run smoke:designer` (verified 2026-11-14: Gemini picked meditate/quiz/sleep/pushup for a FOCUS/INT-weak player, ~1.3 s).
- [x] `npm run db:migrate` (adds nullable `events.detail jsonb` for photo verdict reasons) — applied to Tiger 2026-11-14.
      Re-run it on any other database; until then `logEvent` just drops `detail` and logs one warning.

### AWS setup (all optional — without it: local photo storage, browser speech, Anthropic API)

Everything is gated on env vars; nothing breaks if a step is skipped. Put the values in `.env.local`
(never commit them) and restart `npm run dev`.

- [ ] **IAM user** for the app (not root). Create an access key → `.env.local`:
  ```
  AWS_REGION=us-east-1
  AWS_ACCESS_KEY_ID=...
  AWS_SECRET_ACCESS_KEY=...
  ```
  Least-privilege inline policy (replace the bucket name):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::awaken-proofs-XXXX/proofs/*" },
      { "Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*" },
      { "Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], "Resource": "*" }
    ]
  }
  ```
- [ ] **S3 proof bucket** in the same region: keep **Block all public access ON** (default), default encryption SSE-S3.
      No bucket policy needed — the app only uses presigned GET URLs (15 min). → `S3_PROOF_BUCKET=awaken-proofs-XXXX`
- [ ] **Photo check:** start a photo quest and upload:
  ```bash
  curl -X POST localhost:3000/api/quest/start -H 'content-type: application/json' \
    -d '{"playerId":"demo-jin","type":"photo","title":"Make your bed"}'          # note the quest id
  curl -X POST localhost:3000/api/photo -F playerId=demo-jin -F questId=<id> -F photo=@bed.jpg
  ```
  Expect `"storage":"s3"` and a `photoUrl` that opens in a browser (and stops working after 15 min).
  A random photo → `"passed":false` with a reason, quest stays active (retry allowed).
  In Tiger: `select kind, value, verified, detail from events where kind='photo.verdict' order by ts desc limit 3;`
  Without AWS: `"storage":"local"`, file under `/tmp/awaken-proofs/` (`PROOF_LOCAL_DIR` to change).
- [ ] **Polly voice:** pick a neural voice (deep: `Matthew`, `Gregory`, `Stephen`; default `Matthew`) → `POLLY_VOICE=Gregory`.
      Then `npm run voice:pregen` → every canned line `ok`. Trigger a level-up → the `voice` event has
      `"audioUrl":"/api/voice/<hash>.mp3"`; open `localhost:3000<audioUrl>` → it plays.
      Cache dir `/tmp/awaken-voice` (`VOICE_CACHE_DIR`); re-run `voice:pregen` after changing the voice.
- [ ] **Frontend (teammate):** on each `voice` SSE event call `playVoice(event)` from `lib/voicePlayback.ts`
      (Polly MP3 if present, else browser `speechSynthesis`). Browsers block audio until the first click/tap —
      have a "Begin" button on the first screen.
- [ ] **Bedrock:** console → Bedrock → *Model access* → enable Claude Haiku 5.5 and Opus 5.5 (wait for "Access granted").
      Copy each model's id or cross-region inference profile id (e.g. `us.anthropic.claude-opus-...`):
      ```
      BEDROCK_MODEL_HAIKU=...
      BEDROCK_MODEL_OPUS=...
      ```
      (Never a Fable id — the code refuses it.) Keep `ANTHROPIC_API_KEY` set: it's the fallback if Bedrock errors.
- [ ] **Boss report:** `curl localhost:3000/api/report/demo-jin` → `"source":"opus"` (~5 s first time, cached 10 min;
      `?fresh=1` to regenerate). Wi-Fi off → `"source":"fallback"` with a code-written report.

---

## Phase 10 — Supermemory (optional — without it: generic quests, no voice callbacks)

- [ ] **Fix the API key.** 2026-11-14: the `SUPERMEMORY_API_KEY` in `.env.local` returns **401 Unauthorized** on
      add and search (it doesn't look like a v5 key). Create a new key in the Supermemory console → API Keys,
      replace it in `.env.local`, restart `npm run dev`.
- [ ] `npm run smoke:memory` → `remember → true`, then a recall containing "run a 5k" within ~20 s.
- [ ] Save a goal for the demo player:
  ```bash
  curl -X POST localhost:3000/api/player/demo-jin/goals -H 'content-type: application/json' -d '{"goal":"pass calculus"}'
  ```
  → `{"saved":true}`. Then fail a squat quest and clear a push-up quest; Supermemory console →
  namespace `player_demo-jin` shows "FAILED quest …" / "cleared quest …" entries (recorded by
  `engine/agents/chronicle.ts`, started from `instrumentation.ts` on server start).
- [ ] Voice callback: trigger a penalty after a recorded failure → the line may reference it ("You failed squats again…").
- [ ] Designer: `curl -X POST localhost:3000/api/cron/daily -H "authorization: Bearer $CRON_SECRET"` → the day's quests
      lean toward the goal / weak stats (compare with `npm run smoke:designer`).
- Note: `npm run demo:reset` does **not** clear Supermemory, so a demo player keeps its history across resets.
  To wipe it: Supermemory console → delete namespace `player_demo-jin`.
