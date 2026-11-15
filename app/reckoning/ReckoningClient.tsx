'use client';
/** /reckoning — a vow was broken. One Reckoning vow, a clock, and Iris furious until it is paid by sensors. */
import { MotionConfig } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Announcement, type AnnouncementMessage } from '../../components/oath/Announcement';
import {
  answerQuizTrial, answerReadTrial, fetchQuizTrial, fetchReadTrial, fetchShards, spendShards, startVow, submitPhoto,
  type Shards, type Trial, type TrialResult,
} from '../../components/oath/api';
import { announcementFor, plainTitle, rejectionLine } from '../../components/oath/events';
import { Iris } from '../../components/oath/Iris';
import { NotSworn, OathShell } from '../../components/oath/OathShell';
import { useIris } from '../../components/oath/useIris';
import { usePerson } from '../../components/oath/usePerson';
import type { StreamEvent } from '../../lib/schemas';
import { padCount } from '../band/labels';
import { upsertQuest } from '../hunter/api';
import '../today/today.css';
import { TrialSheet } from '../today/TrialSheet';
import { isPhoneCounted, progressLabel, vowAction } from '../today/vows';
import { countdown, reckoningVow } from './debt';
import './reckoning.css';

const IRIS_DESKTOP_PX = 380;
const IRIS_PHONE_PX = 132;
const WIDE_SCREEN = '(min-width: 860px)';
const FLASH_MS = 1_500;

export function ReckoningClient() {
  const { personId, isReady, person, quests, setQuests, error, setError, refresh } = usePerson();
  const [announcement, setAnnouncement] = useState<AnnouncementMessage | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [shards, setShards] = useState<Shards | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [isWide, setIsWide] = useState(false);
  const [trial, setTrial] = useState<Trial | null>(null);
  const owed = reckoningVow(quests);
  const isInReckoning = Boolean(person?.penalty) || owed !== null;

  useEffect(() => {
    const query = window.matchMedia(WIDE_SCREEN);
    const sync = (): void => {
      setIsWide(query.matches);
      setNow(Date.now());
    };
    sync();
    query.addEventListener('change', sync);
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      query.removeEventListener('change', sync);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!personId) return;
    let isCurrent = true;
    fetchShards(personId)
      .then((data) => {
        if (isCurrent) setShards(data);
      })
      .catch(() => undefined); // Shards offline: the halve button simply stays hidden
    return () => {
      isCurrent = false;
    };
  }, [personId]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'rep':
          setQuests((qs) => qs.map((q) => (q.id === event.questId ? { ...q, progress: event.count } : q)));
          return;
        case 'rep.rejected':
          setFlash(rejectionLine(event.reason));
          return;
        case 'quest.update':
        case 'quest.complete':
          setQuests((qs) => upsertQuest(qs, event.quest));
          break;
        case 'penalty':
          setReason(event.reason);
          break;
      }
      const moment = announcementFor(event);
      if (!moment) return;
      if (event.type !== 'penalty') setAnnouncement({ id: Date.now(), ...moment }); // this screen already is the Reckoning
      void refresh();
    },
    [setQuests, refresh],
  );
  const iris = useIris(personId, handleEvent, isInReckoning ? 'furious' : 'unimpressed');

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

  const handleBegin = (): Promise<void> =>
    run(async () => {
      if (!personId || !owed) return;
      const started = await startVow(personId, { questId: owed.id });
      setQuests((qs) => upsertQuest(qs, started));
    });

  const handleHalve = (): Promise<void> =>
    run(async () => {
      if (!personId || !owed) return;
      const { wallet } = await spendShards(personId, { item: 'halve', questId: owed.id });
      setShards((current) => (current ? { ...current, wallet } : current));
      await refresh();
    });

  const handleTrial = (): Promise<void> =>
    run(async () => {
      if (!personId || !owed) return;
      setTrial(owed.type === 'read' ? await fetchReadTrial(personId, owed.id) : await fetchQuizTrial(personId, owed.id, owed.topic ?? plainTitle(owed.title)));
    });

  const submitTrial = async (answers: number[]): Promise<TrialResult> => {
    if (!personId || !owed) throw new Error('No trial is open');
    const result = owed.type === 'read' ? await answerReadTrial(personId, owed.id, answers) : await answerQuizTrial(personId, owed.id, answers);
    void refresh();
    return result;
  };

  const handlePhoto = (photo: File): Promise<void> =>
    run(async () => {
      if (!personId || !owed) return;
      setReason('Iris is looking…');
      const verdict = await submitPhoto(personId, owed.id, photo);
      setReason(`${verdict.passed ? '✓ Accepted' : '✕ Not accepted'} — ${verdict.reason}`);
      await refresh();
    });

  const action = owed ? vowAction(owed) : 'none';
  const isCounted = owed !== null && action === 'begin' && owed.target > 1;
  const canHalve = shards !== null && shards.wallet.balance >= shards.prices.halve;
  const idleLine = isInReckoning ? 'You broke a vow. Pay it. I am not leaving.' : 'No debt. Keep it that way.';

  return (
    <MotionConfig reducedMotion="user">
      <OathShell mood={iris.mood} current="/reckoning" isConnected={iris.isConnected} className={isInReckoning ? 'reckon-on' : ''}>
        {isReady && !personId && <NotSworn />}
        {personId && (
          <div className="reckon">
            <aside className="reckon-iris">
              <Iris mood={iris.mood} isSpeaking={iris.isSpeaking} size={isWide ? IRIS_DESKTOP_PX : IRIS_PHONE_PX} />
              <p className="caption glass" aria-live="polite"><span className="mono accent">Iris</span><span>{iris.caption ?? idleLine}</span></p>
            </aside>

            <section className="reckon-main" aria-labelledby="reckon-title">
              <p className="kick mono">{isInReckoning ? `${person?.name ?? '…'} · vow broken` : `${person?.name ?? '…'} · nothing owed`}</p>
              <h1 id="reckon-title" className="reckon-title" data-on={isInReckoning || undefined}>
                {isInReckoning ? <>The <span className="serif">Reckoning.</span></> : <>No <span className="serif">debt.</span></>}
              </h1>
              {error && <p role="alert" className="shell-error glass">{error}</p>}

              {owed ? (
                <article className="reckon-vow glass">
                  <div className="reckon-vow-top mono">
                    <span className="accent">Reckoning vow</span>
                    <span>{now === null ? '--:--:--' : countdown(owed.deadline, now)}</span>
                  </div>
                  <h2>{plainTitle(owed.title)}</h2>
                  {isCounted ? (
                    <p className="reckon-count" aria-live="polite">{padCount(owed.progress)}<span className="mono mute"> {progressLabel(owed).replace(/^\S+ /, '')}</span></p>
                  ) : (
                    <p className="reckon-kind">{progressLabel(owed)}</p>
                  )}
                  <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((owed.progress / owed.target) * 100)}>
                    <i style={{ transform: `scaleX(${Math.min(1, owed.progress / owed.target)})` }} />
                  </div>
                  <p className="reckon-flash mono" aria-live="assertive">{flash ? `✕ ${flash}` : reason ?? ''}</p>
                  <div className="reckon-actions">
                    {action === 'begin' && (
                      <button type="button" className="btn mono" disabled={isBusy} onClick={() => void handleBegin()}><i className="dot" />{owed.sessionId ? 'Counting' : 'Begin'}</button>
                    )}
                    {(action === 'quiz' || action === 'readTrial') && (
                      <button type="button" className="btn mono" disabled={isBusy} onClick={() => void handleTrial()}><i className="dot" />Take the trial</button>
                    )}
                    {action === 'photo' && (
                      <label className="btn mono">
                        <i className="dot" />Show proof
                        <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={isBusy}
                          onChange={(event) => {
                            const photo = event.target.files?.[0];
                            if (photo) void handlePhoto(photo);
                            event.target.value = '';
                          }} />
                      </label>
                    )}
                    {isPhoneCounted(owed.type) && <Link href="/band" className="btn btn-quiet mono">Band ↗</Link>}
                    {canHalve && <button type="button" className="btn btn-quiet mono" disabled={isBusy} onClick={() => void handleHalve()}>Halve it · {shards.prices.halve} Shards</button>}
                  </div>
                </article>
              ) : (
                <>
                  <p className="lede">
                    {isInReckoning
                      ? 'The Reckoning holds until Iris sets your Reckoning vow. Keep the next vow you swear.'
                      : 'Miss a day and the Reckoning begins: an alarm that will not stop until the vow is paid. You are clear.'}
                  </p>
                  <Link href="/today" className="btn mono reckon-back"><i className="dot" />Back to today</Link>
                </>
              )}
            </section>
          </div>
        )}
        {trial && owed && <TrialSheet title={plainTitle(owed.title)} trial={trial} onSubmit={submitTrial} onClose={() => setTrial(null)} />}
        <Announcement message={announcement} onDismiss={() => setAnnouncement(null)} />
      </OathShell>
    </MotionConfig>
  );
}
