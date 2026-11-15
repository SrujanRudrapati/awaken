'use client';
/**
 * /calibrate — swear the oath, then four short tests (Body, Vitality, Mind, Focus) set the starting rank.
 * Reps are counted by sensors only (pad, this phone, Watch); Mind and Focus are graded by the server.
 */
import { MotionConfig } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  CALIBRATION_STAGES, StagePayload, startCalibration, submitCalibration, swear,
  type BodyVariant, type CalibrationSession, type CalibrationStage, type FocusTrial, type MindQuestion,
} from '../../components/oath/api';
import { Iris } from '../../components/oath/Iris';
import { OathShell } from '../../components/oath/OathShell';
import { useIris } from '../../components/oath/useIris';
import { usePerson } from '../../components/oath/usePerson';
import type { StreamEvent } from '../../lib/schemas';
import '../band/band.css';
import { useMotionSender } from '../hunter/useMotionSender';
import { useWakeLock } from '../hunter/useWakeLock';
import '../today/today.css';
import './calibrate.css';
import { FocusStage, MindStage, RepStage } from './stages';

const VARIANTS: readonly { id: BodyVariant; label: string; unit: string }[] = [
  { id: 'pushup', label: 'Push-ups', unit: 'push-ups' },
  { id: 'wallpushup', label: 'Wall push-ups', unit: 'wall push-ups' },
  { id: 'chairsquat', label: 'Chair squats', unit: 'chair squats' },
];
const STAGE_COPY: Record<CalibrationStage, { name: string; note: string }> = {
  body: { name: 'Body', note: '60 seconds of reps' },
  vitality: { name: 'Vitality', note: '60 seconds of jumping jacks' },
  mind: { name: 'Mind', note: 'Up to 8 questions, 2 minutes' },
  focus: { name: 'Focus', note: 'Go / no-go, 60 seconds' },
};

type Running =
  | { stage: 'body' | 'vitality'; questId: string; endsAt: string; sessionId?: string; count: number }
  | { stage: 'mind'; endsAt: string; question: MindQuestion; asked: number; lastCorrect: boolean | null }
  | { stage: 'focus'; trials: FocusTrial[]; durationMs: number };

export function CalibrateClient() {
  const { personId, isReady, person, signIn } = usePerson();
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [variant, setVariant] = useState<BodyVariant>('pushup');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const repSession = running && (running.stage === 'body' || running.stage === 'vitality') ? running.sessionId : undefined;
  const motionSender = useMotionSender(repSession);
  useWakeLock(running !== null);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type !== 'rep') return;
    setRunning((current) => (current && 'questId' in current && current.questId === event.questId ? { ...current, count: event.count } : current));
  }, []);
  const result = session?.result ?? null;
  const iris = useIris(personId, handleEvent, result ? 'proud' : running ? 'watching' : 'unimpressed');

  const run = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleOath = (form: FormData): Promise<void> =>
    run(async () => {
      let id = personId;
      if (!id) {
        const created = await swear(String(form.get('name') ?? '').trim());
        id = created.id;
        signIn(id);
      }
      const age = Number(form.get('age'));
      setSession(await startCalibration(id, { bodyVariant: variant, ...(Number.isInteger(age) && age >= 13 && age <= 110 ? { age } : {}) }));
    });

  const handleBegin = (stage: CalibrationStage): Promise<void> => {
    if ((stage === 'body' || stage === 'vitality') && motionSender.status === 'idle') void motionSender.start(); // inside the tap: iOS motion permission
    return run(async () => {
      if (!personId) return;
      if (stage === 'body' || stage === 'vitality') {
        const res = await submitCalibration(personId, { stage, action: 'begin' }, StagePayload.repBegin);
        setSession(res.session);
        setRunning({ stage, ...res.stage, count: 0 });
      } else if (stage === 'mind') {
        const res = await submitCalibration(personId, { stage, action: 'begin' }, StagePayload.mindBegin);
        setSession(res.session);
        setRunning({ stage, ...res.stage, asked: 1, lastCorrect: null });
      } else {
        const res = await submitCalibration(personId, { stage, action: 'begin' }, StagePayload.focusBegin);
        setSession(res.session);
        setRunning({ stage, trials: res.stage.trials, durationMs: res.stage.durationMs });
      }
    });
  };

  const handleRepFinish = (stage: 'body' | 'vitality'): Promise<void> =>
    run(async () => {
      if (!personId) return;
      setRunning(null);
      motionSender.stop();
      setSession((await submitCalibration(personId, { stage, action: 'finish' }, StagePayload.score)).session);
    });

  const handleMindAnswer = (answerIndex: number): Promise<void> =>
    run(async () => {
      if (!personId || running?.stage !== 'mind') return;
      const res = await submitCalibration(personId, { stage: 'mind', action: 'answer', questionId: running.question.id, answerIndex }, StagePayload.mindAnswer);
      setSession(res.session);
      const next = res.stage.next;
      setRunning(next && !res.stage.done ? { ...running, question: next, asked: running.asked + 1, lastCorrect: res.stage.correct } : null);
    });

  const handleFocusDone = (responses: { i: number; rtMs: number | null }[]): Promise<void> =>
    run(async () => {
      if (!personId) return;
      setRunning(null);
      setSession((await submitCalibration(personId, { stage: 'focus', action: 'submit', responses }, StagePayload.focusResult)).session);
    });

  const bodyUnit = VARIANTS.find((v) => v.id === (session?.bodyVariant ?? variant))?.unit ?? 'reps';
  const sensorNote = motionSender.status === 'streaming' ? 'This phone is counting. The pad and Watch count too.' : 'Counted by the rep pad, the band or the Watch — never by hand.';
  const idleLine = result ? `Rank ${result.rank}. …Acceptable.` : session ? 'Four tests. Any order. I am watching all of them.' : 'Your name first. Then we see what you are.';

  return (
    <MotionConfig reducedMotion="user">
      <OathShell mood={iris.mood} current="/calibrate" isConnected={iris.isConnected}>
        <div className="cal">
          <aside className="cal-iris">
            <Iris mood={iris.mood} isSpeaking={iris.isSpeaking} size={running ? 120 : 230} flat={running !== null} />
            <p className="caption glass" aria-live="polite"><span className="mono accent">Iris</span><span>{iris.caption ?? idleLine}</span></p>
          </aside>

          <div className="cal-main">
            {error && <p role="alert" className="shell-error glass">{error}</p>}

            {isReady && !session && (
              <form action={handleOath} className="cal-oath">
                <p className="kick mono">Calibration · 5 minutes</p>
                <h1 className="display">Take the <span className="serif">Oath.</span></h1>
                <p className="lede">Four short tests across body, vitality, mind and focus. Iris sets your starting rank. Everything after that is up to you.</p>
                {personId ? (
                  <p className="mono mute">Sworn as {person?.name ?? '…'}</p>
                ) : (
                  <>
                    <label className="sr-only" htmlFor="cal-name">Your name</label>
                    <input id="cal-name" name="name" required maxLength={40} autoComplete="nickname" placeholder="Your name" className="field glass focusable cal-field" />
                  </>
                )}
                <label className="sr-only" htmlFor="cal-age">Your age (optional)</label>
                <input id="cal-age" name="age" type="number" inputMode="numeric" min={13} max={110} placeholder="Age (optional)" className="field glass focusable cal-field" />
                <fieldset className="cal-variants">
                  <legend className="mono mute">Body test</legend>
                  {VARIANTS.map((option) => (
                    <button key={option.id} type="button" className="chip mono focusable" aria-pressed={variant === option.id} onClick={() => setVariant(option.id)}>{option.label}</button>
                  ))}
                </fieldset>
                <button type="submit" disabled={isBusy} className="btn mono"><i className="dot" />Begin</button>
              </form>
            )}

            {session && !running && !result && (
              <section aria-labelledby="cal-hub">
                <p className="kick mono">Calibration</p>
                <h1 id="cal-hub" className="display cal-title">Four <span className="serif">tests.</span></h1>
                <ul className="cal-grid">
                  {CALIBRATION_STAGES.map((stage) => {
                    const state = session.stages[stage];
                    const isDone = state.status === 'done';
                    return (
                      <li key={stage} className="cal-card glass" data-done={isDone || undefined}>
                        <span className="mono accent">{STAGE_COPY[stage].name}</span>
                        <span className="cal-card-score">{isDone ? state.score ?? '✓' : '–'}</span>
                        <span className="mute cal-card-note">{stage === 'body' ? `60 seconds of ${bodyUnit}` : STAGE_COPY[stage].note}</span>
                        {!isDone && <button type="button" className="btn btn-quiet mono" disabled={isBusy} onClick={() => void handleBegin(stage)}><i className="dot" />Begin</button>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {running && (running.stage === 'body' || running.stage === 'vitality') && (
              <RepStage label={STAGE_COPY[running.stage].name} unit={running.stage === 'body' ? bodyUnit : 'jumping jacks'} count={running.count} endsAt={running.endsAt}
                sensorNote={sensorNote} onFinish={() => void handleRepFinish(running.stage)} />
            )}
            {running?.stage === 'mind' && (
              <MindStage question={running.question} endsAt={running.endsAt} asked={running.asked} lastCorrect={running.lastCorrect} isBusy={isBusy} onAnswer={(index) => void handleMindAnswer(index)} />
            )}
            {running?.stage === 'focus' && <FocusStage trials={running.trials} durationMs={running.durationMs} onDone={(responses) => void handleFocusDone(responses)} />}

            {result && (
              <section className="cal-result" aria-labelledby="cal-result">
                <p className="kick mono">Calibration complete{result.bonusXp ? ` · +${result.bonusXp} Proof` : ''}</p>
                <h1 id="cal-result" className="sr-only">Rank {result.rank}</h1>
                <p className="cal-rank" aria-hidden="true">{result.rank}</p>
                <ul className="cal-scores">
                  {CALIBRATION_STAGES.map((stage) => (
                    <li key={stage}>
                      <span>{STAGE_COPY[stage].name}</span>
                      <span className="track"><i style={{ transform: `scaleX(${result.scores[stage] / 100})` }} /></span>
                      <span className="mono">{Math.round(result.scores[stage])}</span>
                    </li>
                  ))}
                </ul>
                <div className="cal-next">
                  <Link href="/today" className="btn mono"><i className="dot" />See today&rsquo;s vows</Link>
                  <Link href="/band" className="btn btn-quiet mono">Open the band</Link>
                </div>
              </section>
            )}
          </div>
        </div>
      </OathShell>
    </MotionConfig>
  );
}
