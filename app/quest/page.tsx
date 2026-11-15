'use client';
/** Live Quest: giant rep counter, progress ring, live sensor gauge, REP NOT COUNTED flash, calibration. */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useSystem } from '../../components/SystemProvider';
import { ProgressRing } from '../../components/system/Bits';
import { SystemWindow } from '../../components/system/SystemWindow';
import { VoiceLine } from '../../components/system/VoiceLine';
import { MAX_VALID_CM, MIN_CALIBRATION_RANGE_CM } from '../../engine/verifiers/pushup';
import { STAT_LABEL } from '../../lib/ui/ranks';
import { activeQuest } from '../../lib/ui/state';

const GAUGE_MAX_CM = 60;
const FLASH_MS = 1_400;
const CALIBRATE_MS = 5_000;

function RejectedFlash({ reason }: { reason: string }) {
  const [visible, setVisible] = useState(true);
  const reduce = useReducedMotion();
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), FLASH_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="text-center"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.3 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, x: [0, -6, 6, -3, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          role="alert"
        >
          <p className="rejected-flash text-lg sm:text-2xl">REP NOT COUNTED</p>
          <p className="font-mono text-xs text-danger-text">{reason}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DistanceGauge({ dist }: { dist: number | null }) {
  const pct = dist === null ? 0 : Math.min(1, Math.max(0, dist / GAUGE_MAX_CM)) * 100;
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-mono text-[10px] tracking-widest text-sys-dim">{GAUGE_MAX_CM}cm</span>
      <div className="gauge" role="meter" aria-label="Chest distance" aria-valuenow={dist ?? 0} aria-valuemin={0} aria-valuemax={GAUGE_MAX_CM}>
        {dist !== null && <div className="gauge-marker" style={{ bottom: `calc(${pct}% - 2px)` }} />}
      </div>
      <span className="font-mono text-xs tabular-nums text-sys-text">{dist === null ? '--' : `${dist.toFixed(0)} cm`}</span>
    </div>
  );
}

type CalState = { phase: 'idle' } | { phase: 'capturing' } | { phase: 'done'; up: number; down: number } | { phase: 'error'; message: string };

function Calibrate({ dist }: { dist: number | null }) {
  const [cal, setCal] = useState<CalState>({ phase: 'idle' });
  const range = useRef<{ min: number; max: number } | null>(null);
  const capturing = cal.phase === 'capturing';

  useEffect(() => {
    if (!capturing || dist === null || dist <= 0 || dist > MAX_VALID_CM) return;
    const r = range.current;
    range.current = r ? { min: Math.min(r.min, dist), max: Math.max(r.max, dist) } : { min: dist, max: dist };
  }, [dist, capturing]);

  useEffect(() => {
    if (!capturing) return;
    const id = setTimeout(async () => {
      const r = range.current;
      if (!r || r.max - r.min < MIN_CALIBRATION_RANGE_CM) {
        setCal({ phase: 'error', message: `Not enough movement (need ${MIN_CALIBRATION_RANGE_CM} cm between top and bottom). Try one slow, full rep.` });
        return;
      }
      const up = Math.round(r.max);
      const down = Math.round(r.min);
      try {
        const res = await fetch('/api/calibrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upDist: up, downDist: down }),
        });
        const body = (await res.json()) as { success: boolean; error: string | null };
        setCal(body.success ? { phase: 'done', up, down } : { phase: 'error', message: body.error ?? 'Calibration rejected' });
      } catch {
        setCal({ phase: 'error', message: 'Could not reach the System (is the dev server running?)' });
      }
    }, CALIBRATE_MS);
    return () => clearTimeout(id);
  }, [capturing]);

  const start = () => {
    range.current = null;
    setCal({ phase: 'capturing' });
  };

  return (
    <SystemWindow title="Calibrate">
      <p className="text-sm text-sys-dim">Do one slow, full push-up over the sensor. The System records your top and bottom.</p>
      <button type="button" className="sys-button mt-4 w-full" onClick={start} disabled={capturing}>
        {capturing ? 'Recording… do one rep' : 'Start calibration'}
      </button>
      {cal.phase === 'done' && (
        <p className="mt-3 font-mono text-xs text-sys" role="status">
          Calibrated: up {cal.up} cm · down {cal.down} cm
        </p>
      )}
      {cal.phase === 'error' && (
        <p className="mt-3 font-mono text-xs text-danger-text" role="alert">
          {cal.message}
        </p>
      )}
    </SystemWindow>
  );
}

export default function LiveQuestPage() {
  const { state } = useSystem();
  const reduce = useReducedMotion();
  const quest = activeQuest(state);
  const dist = state.reading?.dist ?? null;
  const done = quest?.status === 'done';
  const failed = quest?.status === 'failed';

  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <SystemWindow
        title={quest ? (done ? 'Quest Complete' : failed ? 'Quest Failed' : 'Quest In Progress') : 'Awaiting Player'}
        tone={done ? 'gold' : failed ? 'danger' : 'system'}
        aside={quest && <span className="font-mono text-[11px] tracking-widest text-sys-dim">{quest.stat} · {STAT_LABEL[quest.stat].toUpperCase()}</span>}
      >
        {quest ? (
          <div className="flex flex-col items-center">
            <p className="text-center text-lg text-sys-text sm:text-xl">{quest.title}</p>
            <div className="mt-6 flex w-full items-center justify-center gap-6 sm:gap-10">
              <ProgressRing value={quest.progress} max={quest.target}>
                <motion.span
                  key={state.lastRep?.seq ?? 0}
                  className="rep-count block"
                  initial={reduce ? false : { scale: 1.25, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  aria-live="polite"
                >
                  {quest.progress}
                </motion.span>
                <span className="font-mono text-sm tracking-[0.3em] text-sys-dim">/ {quest.target}</span>
              </ProgressRing>
              <div className="hidden sm:block">
                <DistanceGauge dist={dist} />
              </div>
            </div>
            <div className="mt-4 grid min-h-14 place-items-center">
              {state.rejected && <RejectedFlash key={state.rejected.seq} reason={state.rejected.reason} />}
            </div>
            {quest.xp > 0 && <p className="font-mono text-sm text-gold">Reward: +{quest.xp} XP</p>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <p className="text-sys-text">Step up to the System Core. Your first rep starts the quest.</p>
            <DistanceGauge dist={dist} />
            <p className="font-mono text-xs text-sys-dim">
              No sensor? Run <code className="text-sys">npm run sim pushup</code> or press <kbd className="kbd">R</kbd> (demo).
            </p>
          </div>
        )}
      </SystemWindow>

      <div className="flex flex-col gap-5">
        <SystemWindow>
          <VoiceLine compact />
        </SystemWindow>
        <div className="sm:hidden">
          <SystemWindow title="Sensor">
            <div className="flex justify-center">
              <DistanceGauge dist={dist} />
            </div>
          </SystemWindow>
        </div>
        <Calibrate dist={dist} />
      </div>
    </div>
  );
}
