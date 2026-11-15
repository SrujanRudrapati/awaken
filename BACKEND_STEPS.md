# AWAKEN — Backend + AI: granular step-by-step
Tick each box. Commit after every ✅. Paste the 💬 prompts into Claude Code.
Run everything **locally on the demo laptop** (hardware plugs in there).

---
## PHASE 0 — Setup (5:30–5:50)

- [ ] 0.1 Agree with UI person: ONE repo, Next.js App Router. You own `lib/`, `engine/`, `agents/`, `bridge/`, `app/api/`.
- [ ] 0.2 Clone repo, `cd` into it, confirm `npm run dev` works.
- [ ] 0.3 Install:
  ```bash
  npm i @anthropic-ai/sdk @google/genai supermemory pg zod serialport @serialport/parser-readline
  npm i -D tsx vitest @types/pg
  ```
- [ ] 0.4 Create `.env.local` (never commit; check `.gitignore` has `.env*`):
  ```
  ANTHROPIC_API_KEY=
  GEMINI_API_KEY=
  GEMINI_MODEL=            # copy exact Flash model id from AI Studio
  SUPERMEMORY_API_KEY=
  TIGER_DATABASE_URL=      # from Tiger Cloud console (postgres://...)
  TINYFISH_API_KEY=
  APP_URL=http://localhost:3000
  SERIAL_PORT=             # e.g. /dev/tty.usbmodem1101 or COM3 — fill later
  ```
- [ ] 0.5 Set Anthropic spend cap ($20) in console.
- [ ] 0.6 Add scripts to `package.json`:
  ```json
  "sim": "tsx bridge/simulator.ts",
  "bridge": "tsx bridge/serial.ts",
  "test": "vitest run"
  ```
- [ ] 0.7 Open Claude Code: 💬 *"Read SPEC.md and CLAUDE.md. I own backend + AI. Use plan mode. Don't touch app/(ui) or components/."*
- ✅ commit "setup"

---
## PHASE 1 — Contracts (5:50–6:10)

- [ ] 1.1 💬 *"Create `lib/schemas.ts` with zod:*
  - *`Reading` = {t, dist, ax, ay, az, jail, touch, light, snd, bottle, btn} (all numbers; jail/touch/bottle/btn 0|1)*
  - *`DeviceCommand` = union of strings: `LCD:<l1>|<l2>`, `COLOR:<blue|red|gold|green>`, `LOCK`, `UNLOCK`, `BUZZ:<alarm|chime|tick>`, `SEG:<4chars>`*
  - *`Stat` enum STR|INT|FOCUS|VIT|DISCIPLINE|CHA*
  - *`Quest` = {id, playerId, stat, title, type: 'pushup'|'squat'|'jail'|'meditate'|'lightsout'|'water'|'photo'|'gate'|'quiz', target, progress, xp, status: 'active'|'done'|'failed', deadline}*
  - *`Player` = {id, name, rank E–S, level, xp, stats per Stat, penalty:boolean}*
  - *`StreamEvent` = discriminated union: reading | rep | rep.rejected | quest.update | quest.complete | levelup | penalty | voice."*
- [ ] 1.2 Send `lib/schemas.ts` to the UI person (they build against it).
- ✅ commit "schemas"

---
## PHASE 2 — Event bus + SSE (6:10–6:40)

- [ ] 2.1 💬 *"Create `lib/bus.ts`: a singleton EventEmitter on `globalThis` (survives Next hot reload) with `publish(event: StreamEvent)` and `subscribe(fn)`."*
- [ ] 2.2 💬 *"Create `app/api/stream/route.ts`: GET returns SSE (`text/event-stream`), subscribes to the bus, writes `data: JSON\n\n`, sends a heartbeat comment every 15 s, and unsubscribes on close. Set `export const dynamic = 'force-dynamic'` and runtime nodejs."*
- [ ] 2.3 💬 *"Create `app/api/readings/route.ts`: POST accepts one Reading or an array, validates with zod, publishes `reading` (throttle publishing to 10/s), and passes each reading to `engine/router.ts` (stub for now)."*
- [ ] 2.4 Test: `npm run dev`, open `http://localhost:3000/api/stream` in browser, then:
  ```bash
  curl -X POST localhost:3000/api/readings -H 'content-type: application/json' \
   -d '{"t":1,"dist":40,"ax":0,"ay":0,"az":1,"jail":0,"touch":0,"light":500,"snd":100,"bottle":0,"btn":0}'
  ```
  → event appears in the browser.
- ✅ commit "sse"

---
## PHASE 3 — Simulator (6:40–6:55)  — never blocked by hardware

- [ ] 3.1 💬 *"Create `bridge/simulator.ts`: every 100 ms POST a Reading to `${APP_URL}/api/readings`. Modes via CLI arg: `pushup` (dist 40→10→40 cm, 1.5 s/rep, every 4th rep only goes to 22 cm = shallow), `squat` (az peaks ~1.8 g every 2 s), `jail` (jail=1 for 30 s then 0), `idle`. Log each sent rep."*
- [ ] 3.2 Run `npm run sim pushup` with the stream tab open → readings flow.
- ✅ commit "simulator"

---
## PHASE 4 — Rep verifiers (6:55–7:30)  ⭐ MOST IMPORTANT

- [ ] 4.1 💬 *"Create `engine/verifiers/pushup.ts`: class PushupCounter with `calibrate(upDist, downDist)` and `push(reading)`.*
  - *States UP→DOWN→UP. Smooth dist with a 3-sample median.*
  - *DOWN when dist ≤ downDist + 3 cm. A rep counts when it returns to ≥ upDist − 5 cm.*
  - *If it went below (upDist+downDist)/2 but never reached DOWN before going back up → emit `rep.rejected` reason 'not deep enough'.*
  - *Ignore reps faster than 0.5 s. Return events, don't publish directly."*
- [ ] 4.2 💬 *"Create `engine/verifiers/squat.ts`: magnitude = sqrt(ax²+ay²+az²), smoothed; rep when magnitude rises above 1.4 g then falls below 1.1 g; min 0.8 s between reps."*
- [ ] 4.3 💬 *"Write vitest tests for both using the simulator's waveforms: 8 full + 2 shallow push-ups → 8 reps, 2 rejected."* → `npm test` green.
- [ ] 4.4 💬 *"Create `engine/router.ts`: holds the active quest per player; routes readings to the right verifier; publishes `rep`/`rep.rejected`/`quest.update` and, when progress ≥ target, `quest.complete`."*
- [ ] 4.5 Add `POST /api/calibrate` (body {upDist, downDist}) — UI will call it after a 1-rep calibration.
- [ ] 4.6 Run `npm run sim pushup` → see `rep` events + rejected shallow reps in the stream.
- ✅ commit "verifiers"

### 🎯 GATE 7:30 — counts appear live (sim now, real sensor at Phase 5)

---
## PHASE 5 — Real hardware bridge (as soon as hardware person streams JSON)

- [ ] 5.1 Agree the exact JSON line with hardware person (SPEC §3). Baud rate: **115200**.
- [ ] 5.2 Find port: Mac `ls /dev/tty.usb*` · Windows Device Manager → COM#. Put in `.env.local`.
- [ ] 5.3 💬 *"Create `bridge/serial.ts`: open SERIAL_PORT at 115200 with ReadlineParser; for each line JSON.parse → zod validate (skip bad lines) → batch up to 5 and POST to /api/readings. Also run a tiny HTTP server on port 3001 with POST /cmd {cmd} that writes `cmd + '\n'` to serial. Auto-reconnect if unplugged."*
- [ ] 5.4 💬 *"Create `lib/device.ts` with `send(cmd: DeviceCommand)` that POSTs to localhost:3001/cmd (no-op with a warning if bridge is down)."*
- [ ] 5.5 Test: `npm run bridge`, do real push-ups over sensor → counts in UI. Test `send('COLOR:gold')` and `send('BUZZ:chime')`.
- [ ] 5.6 Calibrate with 2–3 teammates of different sizes; adjust thresholds.
- ✅ commit "serial bridge"

---
## PHASE 6 — Tiger Data (7:45–8:15)

- [ ] 6.1 In Tiger console run:
  ```sql
  CREATE TABLE players (id text PRIMARY KEY, name text, rank text DEFAULT 'E',
    level int DEFAULT 1, xp int DEFAULT 0, stats jsonb DEFAULT '{}', penalty boolean DEFAULT false,
    created_at timestamptz DEFAULT now());
  CREATE TABLE events (ts timestamptz NOT NULL, player_id text, stat text, kind text,
    value real, verified boolean, source text);
  SELECT create_hypertable('events', by_range('ts'));
  CREATE MATERIALIZED VIEW daily_xp WITH (timescaledb.continuous) AS
    SELECT time_bucket('1 day', ts) AS day, player_id, stat, sum(value) AS xp
    FROM events WHERE kind = 'xp' GROUP BY day, player_id, stat WITH NO DATA;
  SELECT add_continuous_aggregate_policy('daily_xp', start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute');
  ```
- [ ] 6.2 💬 *"Create `lib/db.ts` with a pg Pool (ssl required). Functions: upsertPlayer, getPlayer, logEvent, addXp, leaderboard(limit) ordered by xp, statHistory(playerId). Never block the hot path: logEvent is fire-and-forget with error logging."*
- [ ] 6.3 Every `rep` → `logEvent(kind:'rep')`; every quest complete → `logEvent(kind:'xp')`.
- [ ] 6.4 `GET /api/leaderboard`, `GET /api/player/:id`.
- ✅ commit "tiger"

---
## PHASE 7 — Quest engine (8:15–9:15)

- [ ] 7.1 💬 *"Create `engine/quests.ts`:*
  - *XP per quest = base by type × difficulty. Rank thresholds: E 0, D 100, C 300, B 700, A 1500, S 3000. Level = floor(xp/50)+1.*
  - *`createPlayer(name)`, `startQuest(playerId, quest)`, `completeQuest` (add xp, stat +1, check rank-up → publish `levelup` and send device COLOR:gold + BUZZ:chime + LCD 'LEVEL UP|Rank D')*
  - *`failQuest` → penalty=true, publish `penalty`, device COLOR:red + BUZZ:alarm, add a harder quest.*
  - *`emergencyQuest(playerId)` for expo: 10 push-ups in 30 s with a countdown; fail if time runs out.*
  - *`dailyDrop()` creates one quest per stat from a template list (AI personalization comes later)."*
- [ ] 7.2 API routes: `POST /api/player` (onboard), `POST /api/quest/start`, `POST /api/quest/emergency`, `GET /api/quests/:playerId`, `POST /api/cron/daily` (calls dailyDrop + penalty check).
- [ ] 7.3 Test with sim: start emergency quest → 10 reps → `quest.complete` → `levelup`.
- ✅ commit "quest engine"

---
## PHASE 8 — Phone Jail + timers (9:15–9:45)

- [ ] 8.1 💬 *"`verifiers/jail.ts`: on quest start wait for jail=1 → send LOCK → count seconds while jail=1 → if jail=0 early → failQuest('phone removed') + UNLOCK; at duration → complete + UNLOCK + trigger quiz. Demo duration configurable (15 s)."*
- [ ] 8.2 💬 *"`verifiers/meditate.ts` (touch=1 and snd below quiet baseline, allow 2-s gaps), `lightsout.ts` (light < threshold before deadline), `water.ts` (bottle 1→0→1 = refill)."*
- [ ] 8.3 Test each with `npm run sim jail` etc.
- ✅ commit "jail+timers"

### 🎯 GATE 9:30 — quests, XP, level up, penalty, Phone Jail work end-to-end

---
## PHASE 9 — AI agents (9:45–11:30)

- [ ] 9.1 💬 *"Create `lib/models.ts`: `HAIKU='claude-haiku-5-5'`, `OPUS='claude-opus-5-5'`, `GEMINI=process.env.GEMINI_MODEL`. Add a comment: NEVER use any Fable model at runtime. Create `lib/llm.ts` helpers: `claude(model, system, user, maxTokens)` and `gemini(prompt, schema?, images?)` with 8 s timeouts and try/catch returning null."*
- [ ] 9.2 **System voice** 💬 *"`agents/voice.ts`: `say(eventType, context)` → Haiku, system prompt = cold, dramatic game 'System' (original character, no anime names), ≤15 words, output plain text. Cache by eventType+key. Fallback canned lines per event. Publish `voice` event."* Test: complete a quest → line appears.
- [ ] 9.3 **Boss Quiz** 💬 *"`agents/quiz.ts`: `makeQuiz(topic)` → Haiku returns JSON {questions:[{q, options[4], answerIndex}]} (3 questions, validated with zod, retry once). `grade(answers)` in code. ≥2 correct = INT quest passes. Routes: POST /api/quiz/start, POST /api/quiz/answer."*
- [ ] 9.4 **Quest designer** 💬 *"`agents/designer.ts`: Gemini gets player goals + weak stats (from Supermemory later) → returns JSON array of 6 daily quests using only our quest types and sensible targets; validate with zod; fallback to template list. Use it in dailyDrop()."*
- [ ] 9.5 **Photo proof** 💬 *"`agents/photoProof.ts`: Gemini vision with before+after images (base64) and the quest text → JSON {passed, confidence, reason}. confidence < 0.7 → not passed. Route POST /api/proof (multipart)."* Test with two desk photos.
- [ ] 9.6 **Boss / weekly report** 💬 *"`agents/boss.ts`: Opus writes a 5-line honest weekly report from statHistory + memories. Only on button press (POST /api/report). max_tokens 400."*
- ✅ commit after each agent

---
## PHASE 10 — Supermemory (11:30–12:15)

- [ ] 10.1 Check Supermemory docs for the current SDK calls (add + search with containerTag). Pin the version in package.json.
- [ ] 10.2 💬 *"`lib/memory.ts`: `remember(playerId, text)` → add with containerTag `player_<id>`; `recall(playerId, query, limit=5)` → search. On onboarding save goals; after each quest complete/fail save a one-line summary ('Skipped squats', 'Passed calc quiz 3/3'). Wrap in try/catch; never block gameplay."*
- [ ] 10.3 Pass `recall()` results into designer + voice prompts. Test: fail squats twice → voice says something about skipping squats.
- ✅ commit "memory"

### 🎯 GATE 1:00 AM — AI + memory working → FEATURE FREEZE

---
## PHASE 11 — Overnight extras (only if gates are green)

- [ ] 11.1 **Maritime** (45 min): follow Maritime quickstart; tiny agent with cron `0 0 * * *` that POSTs to your public `/api/cron/daily` (expose via deployed Vercel URL or a tunnel) + nightly gate scan. Screenshot its run log for Devpost.
- [ ] 11.2 **TinyFish Gates** (45 min): 💬 *"`agents/gates.ts`: call TinyFish (check docs for current endpoint) with goal 'find 5 public events/runs/meetups near Tempe AZ this week; return title, date, location, url' → zod validate → save to `data/gates.json` + Tiger. Route GET /api/gates returns saved results."* Run 2–3 times only.
- [ ] 11.3 **Demo mode**: keys `P` = fake push-up rep, `S` = squat, `J` = toggle jail, `L` = level up. Show a small "DEMO INPUT" badge when used.
- [ ] 11.4 Deploy a copy to Vercel for the public leaderboard page (env vars set there too).

---
## PHASE 12 — Morning (7:00–10:30)
- [ ] Full run-through with real hardware ×5 with different people.
- [ ] Unplug Wi-Fi → confirm reps/quests/level-up still work (AI falls back to canned lines).
- [ ] Help write Devpost "How we built it": one line per sponsor tool + AI disclosure (built with Claude Code; runtime uses Haiku 5.5, Opus 5.5, Gemini; no Fable at runtime).
- [ ] Submit by **10:30 AM**.

---
## If stuck > 30 min
Skip it, note it here, move to the next step. Priority order if time runs out:
1. Push-up counter + level up (must have)
2. Phone Jail + quiz
3. Voice lines
4. Tiger leaderboard
5. Supermemory
6. Photo proof
7. Maritime, TinyFish Gates
