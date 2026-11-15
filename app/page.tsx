'use client';
/** Awakening: [A PLAYER HAS BEEN DETECTED] → name → "You have been chosen." */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { useSystem } from '../components/SystemProvider';
import { SystemEye } from '../components/system/Bits';
import { SystemWindow } from '../components/system/SystemWindow';
import { play, speak, unlockAudio } from '../lib/ui/sound';

const CHOSEN_MS = 2_400;
const MAX_NAME = 24;

export default function AwakeningPage() {
  const { state, setName, sound } = useSystem();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [chosen, setChosen] = useState(false);

  const awaken = (name: string) => {
    unlockAudio();
    setName(name);
    setChosen(true);
    if (sound) {
      play('chime');
      speak('You have been chosen.');
    }
    // TODO(backend): POST /api/player once the quest engine (Phase 7) lands.
    setTimeout(() => router.push('/system'), reduce ? 600 : CHOSEN_MS);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim().slice(0, MAX_NAME);
    if (name) awaken(name);
  };

  return (
    <div className="grid min-h-[80dvh] place-items-center">
      <motion.div
        className="w-full max-w-lg"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0.2 : 0.8, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <SystemWindow>
          <div className="flex flex-col items-center text-center">
            <SystemEye size={72} mood={chosen ? 'proud' : 'calm'} />
            <p className="mt-4 font-mono text-[11px] tracking-[0.4em] text-sys-dim">AWAKEN · SYSTEM CORE</p>

            {chosen ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
                <h1 className="sys-header text-xl sm:text-2xl">[YOU HAVE BEEN CHOSEN]</h1>
                <p className="mt-3 text-sys-text">
                  Welcome, <span className="text-sys">{state.name}</span>. Your quests await.
                </p>
              </motion.div>
            ) : (
              <>
                <h1 className="sys-header mt-6 text-lg sm:text-2xl">[A PLAYER HAS BEEN DETECTED]</h1>
                <p className="mt-3 text-sm text-sys-dim">
                  Every quest is verified. Sensors count your reps. Excuses are logged.
                </p>

                {state.name ? (
                  <div className="mt-8 flex w-full flex-col items-center gap-3">
                    <p className="text-sys-text">
                      Player <span className="text-sys">{state.name}</span> recognised.
                    </p>
                    <button type="button" className="sys-button w-full sm:w-auto" onClick={() => awaken(state.name!)}>
                      Enter the System
                    </button>
                    <button type="button" className="font-mono text-xs text-sys-dim underline-offset-4 hover:underline" onClick={() => setName(null)}>
                      Not you? Register a new player
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submit} className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
                    <label htmlFor="player-name" className="sr-only">
                      Player name
                    </label>
                    <input
                      id="player-name"
                      className="sys-input"
                      placeholder="Enter your name, player"
                      value={draft}
                      maxLength={MAX_NAME}
                      onChange={(e) => setDraft(e.target.value)}
                      autoFocus
                      autoComplete="off"
                    />
                    <button type="submit" className="sys-button shrink-0" disabled={!draft.trim()}>
                      Awaken
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </SystemWindow>
      </motion.div>
    </div>
  );
}
