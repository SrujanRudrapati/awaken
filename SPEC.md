# AWAKEN — Project Spec (SunHacks 2026)
> "Every level-up-your-life app runs on the honor system. Ours checks your work."
> Devpost due 11:00 AM Sun → **submit by 10:30 AM**. Expo 12–2 PM. Discord audience vote 2–3 PM.
> Inspired by "System" anime/RPG tropes — use OUR OWN name, art, characters. Never use the anime's name, characters or art.

---
## 0. WHAT WE NEED (checklist)

### Hardware (MLH lab)
| Part | Qty | Job |
|---|---|---|
| Microcontroller + Grove base shield (ask which board; Arduino-style → USB serial to laptop) | 1 | System Core brain |
| Ultrasonic Distance Sensor | 1 | count real push-ups (depth check) |
| 3-Axis Digital Accelerometer | 1 | squats / jumping jacks (clip-on or in hand) |
| Micro Switch (or IR Reflective Sensor) | 1 | Phone Jail: detects phone in slot |
| Servo Motor | 1 | Phone Jail lid lock |
| Touch Sensor | 1 | meditation / plank hold |
| Light Sensor | 1 | "lights out" sleep quest |
| Sound Sensor | 1 | quiet-room check for focus/meditation |
| IR Reflective Sensor (2nd, optional) | 1 | water-bottle coaster (bottle lifted/returned) |
| LCD RGB Backlight | 1 | quest + rank; blue = normal, red = Penalty Zone, gold = level up |
| Buzzer | 1 | Penalty Zone alarm, level-up chime |
| Button | 1 | accept quest / confirm |
| Red Quad Alphanumeric Display (optional) | 1 | rep counter / timer |
| NFC/RFID board + tags (optional) | 1 | check in at real-world "Gates" |
Also: USB cable, cardboard/foam box (the "System Core"), tape, a phone-sized slot, extension cord.

### Accounts / keys (get in the first 30 min)
- Anthropic API (Haiku 5.5 + Opus 5.5) — set a spend cap
- Google AI Studio (Gemini) — free key
- Supermemory
- Tiger Data (Tiger Cloud free tier)
- Maritime (3 free agents)
- TinyFish ($8 free credit)
- AWS (optional: Claude via Bedrock for AWS prize)
- GoDaddy Registry domain (code **MLHSUN75**) e.g. `awaken.study` / `awakensystem.us` (check availability)
- GitHub repo, Vercel (or similar) for the web app

### Team roles (4 people)
- **A – Hardware:** wiring, firmware, calibration, System Core box
- **B – Backend + agents:** bridge, quest engine, verification, Haiku/Gemini/Opus, Supermemory, Tiger, Maritime, TinyFish
- **C – UI:** glass "System window" web app, animations, leaderboard
- **D – Story/pitch:** mascot art, quest content, Devpost, video, demo rehearsal (helps C)

---
## 1. The idea (plain words)
Your whole life is an RPG. Every day the System gives you quests across 6 stats. **Every quest must be proven** — by sensors, photos, quizzes or real-world check-ins. Complete quests → XP → level up E-Rank → S-Rank. Miss them → **Penalty Zone** (alarm, red screen, harder quest tomorrow). Friends compete in Guilds.

### Stats & verification
| Stat | Example quest | Proof |
|---|---|---|
| STR (body) | 20 push-ups / 30 squats | ultrasonic depth reps / accelerometer reps |
| INT (study) | Study 45 min | **Phone Jail** (phone in slot, lid locked) + **Boss Quiz** (Claude asks 3 questions on what you studied; ≥2 right) |
| FOCUS (mind) | Meditate 10 min | touch sensor held + sound stays quiet |
| VIT (health) | Lights out by 11:30 / drink 6 bottles | light sensor dark / IR coaster refills |
| DISCIPLINE (chores) | Clean your desk | before + after photo → Gemini judges |
| CHA (real life) | Attend a real event this week | **Gates** found by TinyFish; check in by photo (+ NFC tag optional) |
| WAKE-UP | Up by 7:00 | alarm only stops after 10 verified squats |

### Pitch (20 s)
"Every 'level up your life' app runs on the honor system — you just tap done. Awaken is the System that checks your work. Sensors count real reps, Phone Jail locks your phone while you study and then quizzes you, photos prove your chores, and real events become dungeons. Miss a quest and you enter the Penalty Zone. Want to awaken?"

### Honest positioning
Many apps exist (Solo Level: System, Quest Leveling, Solo Hunter, Ascension System, Habitica, Notion templates). All are self-reported. **Ours verifies.** Never claim "first habit RPG."

---
## 2. Expo demo (60–90 s)
| Time | What happens |
|---|---|
| 0–10 s | System window glows: **[A PLAYER HAS BEEN DETECTED]** → judge enters a name. System voice: "You have been chosen." |
| 10–35 s | **[EMERGENCY QUEST: 10 push-ups]** over the ultrasonic sensor. Live counter; half-reps → "REP NOT COUNTED". |
| 35–55 s | **[INT QUEST]** judge drops phone in Phone Jail → servo locks lid → 15-s "study" card on the screen → Boss Quiz question from Claude. |
| 55–70 s | **[QUEST COMPLETE] → LEVEL UP E→D**, stat points animate, judge appears on the **Hunter Leaderboard**. |
| Optional | Show the Penalty Zone: buzzer + red screen ("this is what happens if you skip"). Show a Gate: real event this weekend found by TinyFish. |
Post leaderboard + level-up clip to Discord at 2 PM.

---
## 3. Architecture
```
Home Base (Arduino + Grove) --USB serial JSON--> bridge (Node serialport) --HTTP--> /api/readings
        ▲ commands (4-digit display, servo lock, buzzer)                     ▲
iPhone /hunter (armband, DeviceMotion) ------HTTPS------------------------------┘
Apple Watch app --HTTPS /api/watch · Apple Health (Shortcuts) --HTTPS /api/health
Glass web app (Next.js) <--SSE-- Backend (Next.js API / Node)
                                   ├─ Quest Engine (deterministic: quests, XP, ranks, penalties)
                                   ├─ Verifiers (code: rep counting, timers, sensor rules)
                                   ├─ System Voice  – Claude Haiku 5.5 (dramatic lines, quest text)
                                   ├─ Quest Designer – Gemini (personalized quests; photo judging for chores/gates)
                                   ├─ Boss          – Claude Opus 5.5 (Boss Quiz grading, weekly report) — sparingly
                                   ├─ Supermemory   – player profile, goals, history, excuses
                                   ├─ Tiger Data    – every rep / focus minute / sleep event
                                   └─ TinyFish      – finds real-world Gates (events/runs/meetups)
Maritime agent (cron): midnight quest drop + Penalty Zone check + nightly Gate scan
```
**NO Claude Fable model at runtime.**

### Readings protocol (all sources → `POST /api/readings`, `ReadingSchema`)
`{"t":ms,"source":"homebase"|"phone"|"watch","pad"?:0|1,"ax"?:g,"ay"?:g,"az"?:g,"jail"?:0|1,"btn"?:0|1,"light"?:0-1023,"snd"?:0-1023}`
- Every sensor field is optional; unknown fields are stripped. `source` defaults to `homebase`.
- Home Base (every 100 ms over serial): pad (push-up switch D3), jail (IR D6), btn (D2), snd (A0), light (A1), accel (I2C).
- Phone / Watch: accelerationIncludingGravity in g (~30 Hz, batched).

Laptop → Home Base (one per line, `DeviceCommandSchema`): `SEG:<4 chars>`, `LOCK`, `UNLOCK`, `BUZZ:<chime|alarm|tick>`. Servo lock D5, buzzer D4, 4-digit display I2C.

### SSE events (backend → web app)
`reading`, `rep`, `rep.rejected` (half-rep → "REP NOT COUNTED"), `quest.update`, `quest.complete`, `levelup`, `penalty`, `voice`. Payloads: `StreamEventSchema` in `lib/schemas.ts`.
`voice` may carry `audioUrl` (Polly MP3 at `/api/voice/<hash>.mp3`); without it the browser speaks the text (`lib/voicePlayback.ts`).

### Verifiers (code, not AI — must be reliable)
- **Push-up (pad):** Home Base pad 0→1→0 = rep (counted on release). 80 ms debounce, ≥ 0.6 s between reps ("too fast"), pad held > 3 s ignored (resting).
- **Squat / jumping jack / sit-up / arm push-up (phone or Watch):** generic accel counter. First 2 slow reps calibrate the dominant axis and full depth (and count); then a rep = reach ≥ 70 % depth and return. ≥ 0.7 s per rep; partial motion → `rep.rejected` "not deep enough".
- Router picks the verifier by quest type × reading source; reps from every source add to one progress count.
- **Phone Jail:** IR sees the phone continuously for the quest duration; servo LOCK; removing early = quest failed.
- **Meditation:** button held + sound below quiet baseline for duration (short grace gaps).
- **Lights out:** light below dark threshold before deadline.
- **Photo proof (chores/gates):** Gemini vision with a strict JSON rubric (`{passed, confidence, reason}`); confidence < 0.7 → "needs better proof".
- **Boss Quiz:** Claude generates 3 questions from the topic the user entered; Haiku grades simple ones, Opus only for the weekly boss.

### Quest engine
- XP per quest by difficulty; rank thresholds E→D→C→B→A→S.
- Daily quests drop at 00:00 (Maritime cron). Missed by 23:59 → **Penalty Zone** next day (+1 harder quest, red UI, buzzer on device).
- Stat points on level-up (player assigns).
- Weekly Boss: multi-stat challenge.
- Guild leaderboard.

### Supermemory (load-bearing)
- `containerTag: player_<id>` — goals ("get stronger", "pass calc"), stats history, weak stats, excuses, favorite quest types, Gates attended.
- Used by Quest Designer to personalize ("INT is falling behind → bonus INT quest") and by System Voice for callbacks ("You skipped squats twice this week.").
- Without it: generic quests, no personalization, no callbacks.

### Tiger Data
```sql
CREATE TABLE events (ts timestamptz NOT NULL, player_id text, stat text, kind text,
  value real, verified boolean, source text); -- source: sensor|photo|quiz|gate
ALTER TABLE events ADD COLUMN IF NOT EXISTS detail jsonb; -- npm run db:migrate (photo verdict reason etc.)
SELECT create_hypertable('events', by_range('ts'));
-- continuous aggregates: daily XP per stat per player; weekly reps; leaderboard
```

### TinyFish (Gates)
Nightly (Maritime) + "Find Gates" button: search real public event pages near the player (campus events, 5Ks, hikes, club meetups). Return `{title, date, location, url, rank}` → shown as Gates (rank by effort). Respect site terms; read-only.

---
## 4. Glass UI ("System windows")
- Dark navy/black background with slow blue glowing particles.
- **System windows:** glass panels with glowing cyan borders (`#38BDF8`), backdrop-blur, subtle scanline, monospace headers `[DAILY QUEST]`.
- Screens: Awakening (onboarding) · Daily Quests · Live Quest (big counter) · Level Up (gold burst) · Penalty Zone (red glitch) · Stats (radar chart) · Gates (map/list) · Hunter Leaderboard.
- Sounds: chime on complete, low alarm in Penalty Zone.
- Mascot: our own original character (e.g. a small shadow-familiar or a glowing System AI eye) that speaks the System lines.
- Fonts: Geist + a mono for headers. Respect `prefers-reduced-motion`.

---
## 5. Prizes
| IN | Role |
|---|---|
| Best Overall | verified life-RPG with real hardware |
| Audience Vote | judge leaderboard + level-up clip |
| Best Gaming | full RPG loop: quests, XP, ranks, bosses, penalties |
| Best Hardware | System Core with 8+ sensors verifying quests |
| Best Mascot | original System character |
| Gemini | quest design + photo proof |
| Tiger Data | every verified action as time-series |
| Maritime | midnight drops + Penalty Zone + nightly Gates |
| TinyFish | real-world Gates from live web |
| AWS | if Claude runs via Bedrock |
| GoDaddy | domain |
| + Supermemory | sponsor integration |
OUT: MATLAB, Solana, Vultr, MongoDB, Most Impractical. Rookie only if eligible. SpaceXSI raffle only if truly using Cursor + Grok Bot.

---
## 6. Build plan
| Time | Gate |
|---|---|
| 5:15–6:00 | Get hardware; keys; repo; domain. |
| **7:30 PM** | Firmware streaming JSON; push-up + squat counters working; plain web page shows live count. |
| **9:30 PM** | Quest engine (XP, ranks, Penalty Zone), Phone Jail + servo lock, LCD/buzzer commands. |
| **11:30 PM** | Glass System windows + Level Up / Penalty animations; leaderboard. |
| **1:00 AM** | Haiku voice, Gemini quests + photo proof, Boss Quiz, Supermemory, Tiger. **Feature freeze.** |
| 1:00–5:00 | Sleep in shifts; build System Core box; Maritime cron; TinyFish Gates. |
| 5:00–7:30 | Calibrate sensors with different people; record backup video. |
| 7:30–9:30 | Devpost (AI-tool disclosure, prize sections), rehearse demo ×5. |
| **10:30 AM** | Submit (all teammates listed, prizes ticked). |

## 7. Risks
1. **Rep counting flaky across body sizes** → per-player calibration step (1 slow rep), generous thresholds, keyboard backup in demo mode.
2. **Wi-Fi** → sensors + quest engine run locally; AI lines cached fallback; hotspot.
3. **Gemini photo judging wrong** → strict rubric, confidence threshold, "retake" path.
4. **IP** → original name/art only.
5. **Scope** → if behind at 1 AM, cut CHA Gates and water coaster first; keep STR + INT (Phone Jail + Quiz) + Level Up.
