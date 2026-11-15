# Morning report — night of 2026-11-15 (02:15 → ~03:20)

Branch `backend`, everything pushed. Every commit passed `npm test`, `tsc --noEmit`, `eslint .` and `next build`.
Tests went from 446 to 503. No force-push, no history rewrites, no branch or data deletes, no secrets committed, no Fable model at runtime.

> CLAUDE.md says "After 1 AM: fixes only". Items 1b and 2 below are small features you explicitly asked for; nothing else new was started.

## 1. What changed

| Commit | What |
|---|---|
| `9c7a9c6` | **Jumping jacks have their own counter** (`engine/verifiers/jackReps.ts`). Raising the rotation limit could not work: armband jacks spin at 340–505 °/s and hand-waving at 306–758 °/s, so the two overlap. The vertical counter from `abcab97` also could not count jacks at all, armband or pocket — and Calibration's Vitality stage *is* jacks. A jack is now a **one-sided swing** of the arm or thigh away from rest and back. Waving goes **both ways** through rest and is rejected as "phone waving", using the gyro-integrated swing angle (immune to the hand's linear acceleration). Depth is judged on the gyro angle, so a half jack (70° of 160°) gets "not deep enough". Squats, sit-ups and arm push-ups keep 240 °/s (`ROTATION_LIMITS_DPS`). Synthetic armband + pocket jacks pass, waving is rejected, and a 2 °/s gyro bias is tolerated. |
| `73472ea` | **`/hunter?debug=1`** shows one line: `DBG squat · depth 82% of 0.39m · rot 35°/s · last ✕ not deep enough`. The phone runs the same verifier code on the exact readings it sends, so depth and rotation are live. "last ✕" is the **server's** most recent rejection reason. |
| `857b7ca` | **Wake Lock** held while a vow is active or the sensor streams, and re-requested whenever the page becomes visible again. **Pocket mode** button while streaming: black screen, tiny `n / target` counter, ignores taps, hold 2 s to exit; it closes itself when the vow is kept. **"Sensor paused — screen was locked…"** notice if the page was hidden mid-vow; cleared by the next counted rep or a tap. |
| `301155d` | **OATH leftovers.** Photo proof: the Gemini prompt now says "Vow", and a model reason containing an old word is replaced with a neutral line (that reason is shown to people). Error messages: "No player x" → "No one found with id x", and "playerId missing" → "Missing your id — …". The banned-word test now scans **every** `app/` page, **every** `fail(...)` message in `app/api`, and engine `QuestError`/`Error` messages. |
| `4e6586d` | **Security (review High):** `/api/readings` no longer trusts "same machine". Next keeps a client-sent `X-Forwarded-For`, so anyone on the venue Wi-Fi could claim `127.0.0.1` and send pad/jail readings. Now it requires `SYNC_TOKEN` (the bridge and `npm run sim` already send it from `.env.local`), or a phone/Watch batch tagged with a vow `sessionId` (unchanged). |
| `98c93ea` | **Review High:** phone batches arriving out of order (slow tunnel) wiped the rep in progress. `/hunter` now has one POST in flight at a time; verifiers drop samples up to 2 s late instead of treating them as a restart. |
| `97c8b9b` | **Review High:** player and wallet DB upserts could land out of order and leave stale Proof/rank/Shards in Tiger. Now one write per id is in flight and newer rows coalesce (`lib/latestWriter.ts`, queues on `globalThis`). |
| `8400b0c` | **Review High:** the wallet load had no timeout (a kept vow could stall 3–5 s on bad Wi-Fi), and a failed load cached an empty wallet that then **overwrote** the stored Shards. Now it gives up after 500 ms, never writes a wallet whose stored row it couldn't read, and merges on the next good load. |

Docs updated: SPEC §3 (jack counter, readings auth) and FRONTEND_CONTRACT §3.10 (`/api/readings` auth).

## 2. Skipped, and why

- **`npm run demo:rehearse` does not exist** (not in `package.json` or `scripts/`, on any branch). I did not add it, since you said no new features. Instead I ran an equivalent end-to-end rehearsal against an **offline production build**: DB and every model/AWS key blanked, so nothing real was written or billed. The flow: join → full Calibration (pad push-ups, phone jacks, mind quiz, focus) → emergency push-ups with rank-up → phone squats (6 counted, 2 half-squats rejected) → photo proof offline → leaderboard → weekly report → Iris voice. **27/27 checks pass** on the final build. I also ran `npm run sim` live (squat and pushup) against it. The script is at `/private/tmp/claude-501/-Users-srujan-awaken/71da23c1-d92f-44f9-b9a4-593bc6322255/scratchpad/rehearse.ts` (scratch space — it may be cleared on reboot). To keep it: copy it to `scripts/demo-rehearse.ts`, add `"demo:rehearse": "tsx scripts/demo-rehearse.ts"`, and start the offline server first (command in §4).
- **Review Highs needing a design decision (not patched):**
  - Player-facing routes have no auth. Anyone who can reach the tunnel and knows a `playerId` (the leaderboard lists them) can start vows, **fire `/api/quest/emergency`** (buzzer + Reckoning), spend Shards, or post goals. A fix needs a per-player secret issued at join and checked by every route — a contract change for your UI branches.
  - The phone `sessionId` (32-bit) appears in public `GET /api/quests/:id` and on SSE `quest.update`. So someone could read it and post fake phone motion toward that vow. A fix means binding it to a per-device nonce returned only by `quest/start`, which changes `/hunter` and the contract.
  - Cheapest demo mitigation for both: don't put the tunnel URL on screen; restart the tunnel (new URL) before judging.
- **Review Mediums/Lows (not fixed; only Critical/High were in scope).** Most demo-relevant first:
  1. `/hunter` shows red "SIGNAL LOST — RETRYING" whenever it streams **without a vow** over the tunnel. Readings without a `sessionId` get a 401, which the page maps to offline (`useMotionSender.ts` + `motion.ts:61`). It does not happen on localhost. **Workaround: choose a vow before tapping BEGIN.**
  2. `/hunter` goes silent after a **server restart**: SSE ids restart at 1 and the client drops ids ≤ the last one seen (`useSystemStream.ts:31`). **Workaround: reload `/hunter` after restarting the server.**
  3. Meditation can keep counting after a Home Base reboot (`meditate.ts`: `lastCalmT` is not reset when `t` jumps back).
  4. Watch reps are ignored after the Watch's cumulative count resets until it passes the old count (`router.ts:286`).
  5. Starting any sensor vow cancels every running urgent vow, for **all** players (`quests.ts:315`, intentional and tested). With several phones, judge B starting squats cancels judge A's 30 s countdown.
  6. Others (details in the reviewers' notes, not written to the repo):
     - Engine: pre-Power players could be demoted B→E with a rank-up announcement; a streak shield can leave the Reckoning flag stuck; a Health sync can pay tonight's sleep vow with last night's hours; night vows made after midnight are judged against the wrong night; demo reset doesn't clear sleep/report caches; quiz and reading-trial topics can steer the answer order.
     - API: no SSE connection cap; request bodies are read in full before auth; `report?fresh=1` triggers an unauthenticated Opus call; the Maritime agent's `/chat` has no auth.
- **Known rep-counting limits:** without gyro data (e.g. a Watch sending accel only), vigorous waving can pass as jumping jacks. A uniformly slow squat (> ~4.5 s, no pause) may be partly counted. All thresholds were tuned on **synthetic** traces only — see §6.
- **Pocket mode and the "Sensor paused" notice** are covered by unit tests and the build but were **not seen on a screen**: that needs an active vow plus a streaming sensor, and creating a vow would write to Tiger. The `?debug=1` line *was* checked in a browser on the production build.
- `.env.local` defines `CRON_SECRET` and `S3_PROOF_BUCKET` **twice** (the later value wins). Values not inspected.

## 3. What you must do by hand (in order)

1. **Restart the server you left on `:3000`.** It was started at 02:15, before every commit above, so it runs old code. Stop it (Ctrl-C in its terminal).
2. **Build and start production** (§4).
3. **Restart the bridge.** `/api/readings` now requires `SYNC_TOKEN`; the bridge and sim read it from `.env.local`, so check `SYNC_TOKEN` is set there. Anything else posting readings must send `X-Sync-Token`.
4. **Start the tunnel**, then put the new `https://….trycloudflare.com` URL wherever the phone, Watch, Shortcut and Maritime need it (`PUBLIC_URL`, Maritime `AWAKEN_URL`).
5. **Real-phone tuning pass** (§6), about 10 minutes.
6. Decide on the two auth design questions in §2 (or accept them for the demo).
7. If you want the rehearsal script, copy it into the repo (§2).

## 4. Start the demo stack (exact commands)

```bash
cd ~/awaken
# 1. production build + server (port 3000)
npm run build && npm run start

# 2. Home Base bridge (new terminal) — real board, or a fake Home Base
npm run bridge                    # uses SERIAL_PORT from .env.local
# SERIAL_PORT=mock npm run bridge # no hardware

# 3. public HTTPS for phone / Watch / Shortcut (new terminal)
npm run tunnel                    # = cloudflared tunnel --url http://localhost:3000 → copy the https URL

# optional: hardware check (stop the bridge first; only one program can hold the port)
npm run hw:check -- --once

# offline rehearsal server (no DB writes, no paid APIs) — for the rehearsal script only
TIGER_DATABASE_URL= ANTHROPIC_API_KEY= GEMINI_API_KEY= SUPERMEMORY_API_KEY= TINYFISH_API_KEY= ELEVENLABS_API_KEY= \
AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= S3_PROOF_BUCKET= NTFY_TOPIC= SERIAL_PORT= BEDROCK_MODEL_HAIKU= BEDROCK_MODEL_OPUS= \
npx next start -p 3124
```

## 5. Ten-minute smoke test

1. **Laptop:** open `http://localhost:3000` and the iPhone opens `<tunnel>/hunter?debug=1`. Both show ● ONLINE. Join with a `test-…` name on the phone.
2. **Squats (phone in armband):** tap **Squats** (choose the vow *before* BEGIN), then **BEGIN**. Do 2 slow full squats (calibration; both count), 3 full squats, then 1 half squat. Expect 5 counted, and the half one flashes `✕ NOT DEEP ENOUGH` while Iris says "That does not count." Then wave the phone in your hand for 5 s: nothing counts, and the debug line shows `last ✕ phone tumbling`.
3. **Jumping jacks:** start **Jumping jacks**, do 2 calibration jacks + 5 more → 7. Wave side to side → `phone waving`, no reps.
4. **Pocket + lock:** during a vow tap **POCKET MODE**. The screen goes black with a tiny counter, taps do nothing, holding 2 s exits. Lock the phone for 5 s, unlock: a yellow "Sensor paused — screen was locked" notice appears and clears on the next rep.
5. **Home Base:** with the bridge running, start an emergency push-up vow from the laptop and do the reps on the pad. The vow is kept and the rank-up fires. Then this must be **refused (401)**: `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/readings -H 'content-type: application/json' -H 'X-Forwarded-For: 127.0.0.1' -d '{"t":1,"pad":1}'`

## 6. Real-phone threshold tuning

Open `<tunnel>/hunter?debug=1` and start the vow you're tuning. The line shows:
- `depth N% of D` — the current excursion as a share of the calibrated depth (`calibrating x` until 2 reps are done);
- `rot` — current |rotationRate| (°/s);
- `last ✕` — the server's most recent rejection.

Do 5 honest reps, then 5 cheats (half reps, waving, shaking) per exercise, and note the numbers.

| Symptom | Knob (file) | Default |
|---|---|---|
| Honest squats rejected "phone tumbling" (`rot` peaks above the limit) | `ROTATION_MAX_DPS` (`engine/verifiers/accelReps.ts`) | 240 °/s |
| Honest reps "not deep enough" (`depth` peaks at 60–70%) | `DEEP_FRACTION` (accelReps.ts; jacks import it) | 0.7 |
| Half squats still count | raise `DEEP_FRACTION` | 0.7 |
| Small people / short squats never calibrate | `CAL_MIN_M` (accelReps.ts) | 0.12 m (proxy) |
| Fast honest reps "too fast" / slow ones "too slow" | `MIN_REP_MS` / `MAX_REP_MS` (accelReps.ts) | 800 / 4000 ms |
| Brisk reps "shaking" | `SHAKE_MAX_HZ` (accelReps.ts) | 2.5 Hz |
| Honest jacks "phone waving" | `GYRO_TWO_SIDED_FRACTION`, `OPPOSITE_FRACTION` (`jackReps.ts`) | 0.35, 0.3 |
| Pocket jacks never calibrate | `CAL_MIN_SWING` (jackReps.ts) | 20° |
| Jacks "too fast"/"too slow" | `MIN_JACK_MS` / `MAX_JACK_MS` (jackReps.ts) | 450 / 3000 ms |

After changing a knob, run `npx vitest run engine/verifiers` (the synthetic squat, waving, shaking and jack traces must still pass), then `npm run build && npm run start` and re-test on the phone. If a synthetic test breaks, the new value lets a cheat through or rejects a modelled honest rep — check which one before relaxing the test.
