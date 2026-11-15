# CLAUDE.md — Awaken
Read `SPEC.md` first; it is the source of truth. Use plan mode for changes touching more than 2 files.

## Stack
Home Base: Arduino UNO R4 WiFi + Grove (micro-switch push-up pad D6, button D2, buzzer D4, light A0, sound A1, MMA7660 accel + HT16K33 alphanumeric display on I2C; optional servo D5 + IR D7) · bridge: Node serialport → HTTP · iPhone `/hunter` (DeviceMotion) + Apple Watch app + Apple Health Shortcut → HTTPS · Next.js (App Router) + TypeScript strict + Tailwind + Framer Motion + zod · `@anthropic-ai/sdk` (Haiku 5.5 voice/quiz, Opus 5.5 boss/weekly) · `@google/genai` (quests + photo proof) · `supermemory` SDK (pin version) · `pg` (Tiger Data) · TinyFish API (Gates) · Maritime CLI (cron agent).

## Layout
- `firmware/` (A) · `bridge/` (A/B)
- `engine/quests.ts`, `engine/verifiers/` (deterministic) (B)
- `engine/agents/` voice (Haiku), designer (Gemini), boss (Opus) (B)
- `lib/memory.ts`, `lib/db.ts`, `lib/schemas.ts` (zod; Lead only)
- `agents/maritime/` midnight drop + penalty + gates (B)
- `app/` System windows UI (C)

## Rules
- Never call any Fable model at runtime. Model ids in `lib/models.ts`.
- Verification is code-first: sensor verifiers decide reps/timers. LLMs never mark a sensor quest complete.
- Photo proof: Gemini returns `{passed, confidence, reason}`; < 0.7 confidence = not passed.
- Readings/device protocol + SSE event names fixed in SPEC §3: `reading`, `rep`, `rep.rejected`, `quest.update`, `quest.complete`, `levelup`, `penalty`, `voice`.
- Demo mode: keyboard shortcuts to simulate reps if a sensor fails (clearly labelled).
- Use only original names/art; never the anime's name, characters or artwork.
- Keys in `.env.local`; never commit. Ask before adding deps. After 1 AM: fixes only.

## Design
System blue `#38BDF8`, level-up gold `#FBBF24`, penalty red `#EF4444`, bg `#05070D`. Glass panels with glowing borders, mono headers like `[DAILY QUEST]`. Respect `prefers-reduced-motion`.

## Mistakes log
-
