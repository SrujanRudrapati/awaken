# AWAKEN — Build plan after Phase 4 (FINAL, replaces BACKEND_STEPS_2)
Now: 8:15 PM Sat. Submit: 10:30 AM Sun. Paste 💬 prompts into Claude Code. Commit + push after every ✅.
Model: Opus 5.5 by default. Fable 5.2 only where marked 🧠.

## System overview (what we're building)
| Piece | Role | Talks to backend via |
|---|---|---|
| **iPhone `/hunter` page** (armband) | wireless rep sensor + System window | HTTPS (DeviceMotion → readings) |
| **Apple Watch app** (Xcode) | squats / jumping jacks / sit-ups / punches + haptics | HTTPS `/api/watch` |
| **Apple Watch notifications** | quest alerts, level-up, penalty | ntfy push |
| **Apple Health (Shortcuts)** | runs, steps, workouts, sleep, heart rate | HTTPS `/api/health` |
| **Home Base** (Arduino on USB) | Phone Jail (IR D6 + servo D5), push-up pad (switch D3), button D2, buzzer D4, sound A0, light A1, quad display I2C, accel I2C | serial bridge |
| **Laptop dashboard** | big System screen + leaderboard | SSE `/api/stream` |

---
## PHASE 4B — Align with real hardware + multiple sensor sources (8:15–8:50)
- [ ] 💬 *"Hardware is final. Update lib/schemas.ts:
  - Reading = `{t, source:'homebase'|'phone'|'watch', pad?:0|1, ax?, ay?, az?, jail?:0|1, btn?:0|1, light?:0-1023, snd?:0-1023}` (strip unknown fields).
  - DeviceCommand = only `SEG:<4 chars>`, `LOCK`, `UNLOCK`, `BUZZ:<chime|alarm|tick>` (no LCD/COLOR).
  - Update SPEC.md §3 + CLAUDE.md event list (add rep.rejected).
  Then: engine/verifiers/padPushup.ts (pad 0→1→0 = rep, 80 ms debounce, ≥0.6 s/rep, held >3 s ignored) and engine/verifiers/accelReps.ts (generic rep counter on the dominant axis, calibrated by 2 slow reps; exercises: squat, jumpingjack, situp, armPushup; ≥0.7 s/rep; partial motion → rep.rejected 'not deep enough').
  Router: pick verifier by quest exercise + reading source. Update simulator (pad bounce, phone accel squats). Fix all tests."*
- [ ] `npm test` green, `npm run sim pushup` works. ✅ commit

## PHASE 5 — Home Base serial bridge (8:50–9:30)
- [ ] 💬 *"bridge/serial.ts: SERIAL_PORT @115200, ReadlineParser, JSON → Reading (source 'homebase'), batch ≤5 POST to /api/readings; HTTP :3001 POST /cmd writes validated DeviceCommand + '\n'; auto-reconnect. lib/device.ts send(cmd) → DEVICE_URL or localhost:3001, 1 s timeout, never throws."*
- [ ] Hardware laptop (or plug Arduino into yours): `ls /dev/cu.usb*` → SERIAL_PORT. Close Arduino Serial Monitor. `npm run bridge`.
- [ ] Test: press pad 10× → 10 reps; `BUZZ:chime`, `SEG:RK-E`, `LOCK/UNLOCK` work. ✅ commit
  (Laptops on different machines? Use a phone hotspot — venue Wi-Fi blocks laptop-to-laptop.)

## PHASE 6 — Tiger Data (9:30–9:50) (tables exist ✅)
- [ ] 💬 *"lib/db.ts (pg Pool, ssl rejectUnauthorized:false): upsertPlayer, getPlayer, updatePlayer, logEvent (fire-and-forget), leaderboard(10), statHistory(playerId,7) from daily_xp. Log reps, xp, penalties, health metrics. Routes GET /api/leaderboard, GET /api/player/[id]."*
- [ ] Verify rows appear in psql. ✅ commit

## PHASE 7 — Quest engine (9:50–10:45) 🧠 Fable for design review
- [ ] 💬 *"engine/quests.ts (replace practice-quest auto-start): stats STR/INT/FOCUS/VIT/DISCIPLINE/CHA; quest types pushup(pad|armPushup), squat, jumpingjack, situp, punch, jail, meditate(btn+quiet), lightsout, run(health), steps(health), workout(health), sleep(health), photo, gate, quiz. XP by type×difficulty; ranks E0 D100 C300 B700 A1500 S3000; level=floor(xp/50)+1. createPlayer, startQuest, completeQuest (xp, stat+1, logEvent, levelup → publish + device BUZZ:chime + SEG:LVUP then SEG:RK-x), failQuest (penalty, BUZZ:alarm, SEG:FAIL, harder quest), emergencyQuest (10 reps in 30 s, SEG countdown), dailyDrop() from templates. Routes: POST /api/player, POST /api/quest/start, POST /api/quest/emergency, GET /api/quests/[playerId], POST /api/cron/daily."*
- [ ] 🧠 (Fable) *"Review engine/quests.ts + router for state bugs and demo-breaking edge cases. List only."* → fix.
- [ ] Test emergency quest end-to-end on pad. ✅ commit

## PHASE 7B — Deploy HTTPS (10:45–11:05)  ⚠️ needed for phone, Watch, Shortcuts
- [x] Easiest for live hardware: **cloudflared tunnel from the demo laptop**:
  ```bash
  brew install cloudflared
  cloudflared tunnel --url http://localhost:3000
  ```
  → copy the `https://….trycloudflare.com` URL = `PUBLIC_URL` (changes on restart; that's OK).
- [ ] Also deploy to Vercel later for the public leaderboard page.
- [x] Add `SYNC_TOKEN` (random string) + `PUBLIC_URL` to .env.local.

## PHASE 7C — Phone sensor + Watch notifications + Health sync (11:05 PM–12:30 AM)
- [x] **Phone `/hunter` page** 💬 *"app/hunter: mobile-first System-window glass page. Button 'AWAKEN' → request DeviceMotionEvent.requestPermission() (iOS), then stream accelerationIncludingGravity ~30 Hz, batched every 200 ms to POST /api/readings with source 'phone'. Show active quest, live rep count, rep.rejected flashes, level-up animation (subscribe to /api/stream). Big, readable, works in an armband."* → test on a real iPhone via PUBLIC_URL.
- [x] **Watch notifications** 💬 *"lib/notify.ts: push(title, message, priority) via ntfy (POST https://ntfy.sh/${NTFY_TOPIC}). Call on new daily quests ('[DAILY QUEST HAS ARRIVED]'), emergency quest, penalty warning, quest complete, level up."* → install **ntfy** app on iPhone, subscribe to the topic (use a long random topic name), allow notifications, check they mirror to the Watch.
- [x] **Health sync endpoint** 💬 *"POST /api/health with X-Sync-Token, body {date, steps, distanceKm, activeKcal, workoutMinutes, sleepHours, avgHeartRate?}; zod; log to Tiger; auto-complete matching quests (run/steps/workout/sleep) with voice + levelup + notify."*
- [ ] **iPhone Shortcut** (teammate, no code): Shortcuts → New → *Find Health Samples* (steps today, walking+running distance today, active energy today, sleep yesterday, workouts today) → *Get Contents of URL* `PUBLIC_URL/api/health`, Method POST, header X-Sync-Token, JSON body → name it "Sync with System". Optional: Automation → when a workout ends / at 9 PM → run it. Test once.
- [x] **Watch app endpoint** 💬 *"POST /api/watch {playerId, event:'rep'|'quest.complete', exercise, count} with X-Sync-Token → router (source 'watch')."*
- ✅ commit after each

## PHASE 8 — Phone Jail + timers (12:30–1:00 AM)
- [x] 💬 *"verifiers/jail.ts: wait jail=1 (IR) → LOCK → count while jail=1 (1-s flicker grace) → early removal = fail + UNLOCK → done = UNLOCK + 'quiz.ready'. Demo 20 s, SEG countdown. verifiers/meditate.ts (btn=1 + snd below baseline+margin, 2-s grace). verifiers/lightsout.ts (light below calibrated threshold before deadline)."*
- ✅ commit

## PHASE 9 — AI + AWS (1:00–2:30 AM)
- [x] 💬 *"lib/models.ts (HAIKU 'claude-haiku-5-5', OPUS 'claude-opus-5-5', GEMINI env; NEVER Fable at runtime). lib/llm.ts: claude() via Bedrock (Converse, AWS_REGION, BEDROCK_*_ID) if set else Anthropic API; gemini(); 8 s timeouts; null on failure."*
- [x] 🧠 **Voice** (Fable for the persona prompt) 💬 *"agents/voice.ts: Haiku, cold dramatic original System persona, ≤15 words; canned fallbacks; publish `voice`. lib/aws/polly.ts: speak(text) → Polly neural deep voice mp3 cached in public/voice/; voice events carry audioUrl; pre-generate canned lines."*
- [x] 💬 *"agents/quiz.ts (3 MCQ via Haiku, graded in code, ≥2/3 passes; triggered after Phone Jail)."*
- [x] 💬 *"agents/designer.ts (Gemini daily quests JSON, only our quest types, fallback templates) + agents/photoProof.ts (Gemini vision {passed,confidence,reason}, <0.7 fails; images stored via lib/aws/s3.ts) + agents/boss.ts (Opus weekly report on demand)."*
- ✅ commit after each

## PHASE 10 — Supermemory (2:30–3:00 AM)
- [x] 💬 *"lib/memory.ts remember/recall with containerTag player_<id>; save goals + per-quest summaries; feed into designer + voice."* ✅ commit

### 🎯 3:00 AM — FEATURE FREEZE
- [x] 🧠 (Fable) *"Review the whole backend vs SPEC.md: bugs, race conditions, demo risks. List only."* → fix top 5.
  - Fixed: urgent-vow countdown vs slow DB, slow lookup overwriting a stored player, Watch double-count on re-open, /api/player 503 offline, quiz/trial/mind double-start. Still open: SSE over quick tunnel (test on phone), phone/watch readings carry no playerId, no Maritime caller for /api/cron/daily, demo:reset leftovers, jail clock regression, gate photo check-in.

## APPLE WATCH APP (parallel, teammate, as soon as Xcode finishes)
1. Xcode → Settings → Accounts → add Apple ID. iPhone: Settings → Privacy & Security → Developer Mode ON. Watch: same.
2. New Project → iOS App with Watch App (SwiftUI). Open folder in Claude Code:
   💬 *"Build watchOS app 'Awaken System': System-window UI (dark, cyan glow, [DAILY QUEST]); HKWorkoutSession (HealthKit capability) to stay active; CMMotionManager deviceMotion 50 Hz; rep counters for squats, jumping jacks, sit-ups, punches (2-rep calibration); haptic .success per rep, .notification on complete; POST to PUBLIC_URL/api/watch with X-Sync-Token; fetch active quest from /api/quests/:playerId. Minimal, compile-clean."*
3. Select the Watch scheme + your Watch → Run. First install can take a while.
4. **Hard stop: not running on the Watch by 1:30 AM → drop it** (phone sensor + ntfy cover the demo). Push-ups stay on phone/pad (wrist barely moves in push-ups).

## Overnight / Morning
- [ ] Demo mode keys (P/S/J/L/F) with "DEMO INPUT" badge.
- [ ] Maritime cron → `PUBLIC_URL/api/cron/daily` (or Vercel URL) + screenshot logs.
- [ ] TinyFish Gates (no agent_config) → data/gates.json.
- [ ] Wi-Fi-off test: Home Base reps/jail/level-up still work, AI uses canned lines.
- [ ] 5 full rehearsals. Devpost (sponsor lines + AI disclosure). **Submit 10:30.**

## Priority if behind
1 Home Base pad push-ups + level up (display/buzzer/voice) → 2 Phone Jail + quiz → 3 phone `/hunter` squats → 4 Watch notifications (ntfy) → 5 leaderboard → 6 Health sync → 7 Watch app → 8 memory/photo/Maritime/Gates.
