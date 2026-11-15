'use client';
/** The four Calibration stages as presentational pieces: rep window (Body, Vitality), Mind questions, Focus go / no-go. */
import { useEffect, useRef, useState } from 'react';
import type { FocusTrial, MindQuestion } from '../../components/oath/api';
import { padCount } from '../band/labels';
import { STIMULUS_MS, recordTap, secondsLeft, stimulusAt, toResponses, type Taps } from './focus';

const RADIUS = 47;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const WINDOW_S = 60;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface RepStageProps {
  label: string;
  unit: string;
  count: number;
  endsAt: string;
  sensorNote: string;
  onFinish: () => void;
}

/** 60 seconds of reps, counted by the pad, this phone or the Watch. Finishes itself when the window closes. */
export function RepStage({ label, unit, count, endsAt, sensorNote, onFinish }: RepStageProps) {
  const now = useNow(250);
  const left = secondsLeft(endsAt, now);
  const finish = useRef(onFinish);
  useEffect(() => {
    finish.current = onFinish;
  }, [onFinish]);
  useEffect(() => {
    const timer = setTimeout(() => finish.current(), Math.max(0, Date.parse(endsAt) - Date.now()) + 400);
    return () => clearTimeout(timer);
  }, [endsAt]);

  return (
    <section className="cal-stage" aria-label={label}>
      <div className="vow-ring">
        <div className="vow-ring-top mono"><span className="accent">{label}</span><span className="mute">0:{String(left).padStart(2, '0')}</span></div>
        <div className="vow-ring-dial">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r={RADIUS} className="vow-ring-rail" />
            <circle cx="50" cy="50" r={RADIUS} className="vow-ring-arc" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - left / WINDOW_S)} />
          </svg>
          <div className="vow-ring-count" aria-live="polite"><b>{padCount(count)}</b><span className="mono mute">{unit}</span></div>
        </div>
      </div>
      <p className="mono mute cal-note">{sensorNote}</p>
      <button type="button" className="btn btn-quiet mono" onClick={onFinish}>I am done</button>
    </section>
  );
}

interface MindStageProps {
  question: MindQuestion;
  endsAt: string;
  asked: number;
  lastCorrect: boolean | null;
  isBusy: boolean;
  onAnswer: (index: number) => void;
}

export function MindStage({ question, endsAt, asked, lastCorrect, isBusy, onAnswer }: MindStageProps) {
  const now = useNow(500);
  const left = secondsLeft(endsAt, now);
  return (
    <section className="cal-stage cal-mind" aria-label="Mind">
      <div className="sheet-top mono">
        <span className="accent">Mind · question {asked}</span>
        <span className="mute">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
      </div>
      <p className="sheet-question">{question.question}</p>
      <div className="sheet-options">
        {question.options.map((option, index) => (
          <button key={`${question.id}-${index}`} type="button" className="sheet-option glass focusable" disabled={isBusy} onClick={() => onAnswer(index)}>
            <span className="mono mute">{String.fromCharCode(65 + index)}</span>{option}
          </button>
        ))}
      </div>
      <p className="mono cal-note" aria-live="polite">{lastCorrect === null ? 'Harder if you are right. Easier if you are not.' : lastCorrect ? '✓ Correct' : '✕ Wrong'}</p>
    </section>
  );
}

interface FocusStageProps {
  trials: readonly FocusTrial[];
  durationMs: number;
  onDone: (responses: { i: number; rtMs: number | null }[]) => void;
}

/** Go / no-go: tap on the blue shard, hold still on the red cross. Runs on its own clock from mount. */
export function FocusStage({ trials, durationMs, onDone }: FocusStageProps) {
  const startedAt = useRef<number | null>(null);
  const taps = useRef<Taps>({});
  const [current, setCurrent] = useState<FocusTrial | null>(null);
  const [progress, setProgress] = useState(0);
  const [isTapped, setIsTapped] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let raf = 0;
    let lastIndex: number | null = null;
    const start = performance.now();
    startedAt.current = start;
    const tick = (): void => {
      const elapsed = performance.now() - start;
      if (elapsed >= durationMs + STIMULUS_MS) {
        done.current(toResponses(trials, taps.current));
        return;
      }
      const trial = stimulusAt(trials, elapsed);
      if ((trial?.i ?? null) !== lastIndex) {
        lastIndex = trial?.i ?? null;
        setCurrent(trial);
        setIsTapped(false);
        setProgress(Math.min(1, elapsed / durationMs));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trials, durationMs]);

  const handleTap = (): void => {
    if (startedAt.current === null) return;
    const before = taps.current;
    taps.current = recordTap(before, trials, performance.now() - startedAt.current);
    if (taps.current !== before) setIsTapped(true);
  };

  return (
    <section className="cal-stage" aria-label="Focus">
      <div className="sheet-top mono"><span className="accent">Focus · tap the shard, never the cross</span></div>
      <button type="button" className="cal-pad glass" data-kind={current?.kind} data-tapped={isTapped || undefined} onPointerDown={handleTap}
        onClick={(event) => {
          if (event.detail === 0) handleTap(); // keyboard / assistive activation has no pointerdown
        }}
        aria-label="Tap when the shard appears">
        <span aria-hidden="true">{current ? (current.kind === 'go' ? '◇' : '✕') : '·'}</span>
      </button>
      <div className="track cal-progress"><i style={{ transform: `scaleX(${progress})` }} /></div>
    </section>
  );
}
