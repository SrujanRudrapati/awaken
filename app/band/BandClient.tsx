'use client';
/**
 * /band — the phone on the arm. "Begin" grants motion access and streams the accelerometer (tagged with the
 * vow's sessionId); the live stream drives the counter, the "not counted" flash and Iris's announcements.
 * The screen stays awake while a vow is active; Pocket mode blacks it out; `?debug=1` shows the rep tuning line.
 * Person: `?player=<id>` or the one remembered on this phone, else the oath form.
 */
import { MotionConfig } from 'framer-motion';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Announcement, type AnnouncementMessage } from '../../components/oath/Announcement';
import { IrisGlyph } from '../../components/oath/IrisGlyph';
import { announcementFor } from '../../components/oath/events';
import { forgetId, rememberId, rememberedId } from '../../components/oath/identity';
import { useIris } from '../../components/oath/useIris';
import { UNKNOWN_PERSON } from '../../components/oath/usePerson';
import type { Player, Quest, StreamEvent } from '../../lib/schemas';
import { createPlayer, fetchPlayerQuests, pickPhoneQuest, startQuest, upsertQuest, type PhoneQuestType } from '../hunter/api';
import { formatRepDebug, isDebugSearch, phoneExercise } from '../hunter/repDebug';
import { nextSensorPaused, type SensorPauseEvent } from '../hunter/screenGuard';
import { useMotionSender } from '../hunter/useMotionSender';
import { useRepDebug } from '../hunter/useRepDebug';
import { useWakeLock } from '../hunter/useWakeLock';
import './band.css';
import { SENSOR_STATUS, VOW_CARDS } from './labels';
import { PocketScreen } from './PocketScreen';
import { VowRing } from './VowRing';

const REJECTION_MS = 1_500;
const UNREACHABLE = 'Could not reach Iris';

export function BandClient() {
  const [personId, setPersonId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [person, setPerson] = useState<Player | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [focusedQuestId, setFocusedQuestId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDebug, setIsDebug] = useState(false);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [isPocket, setIsPocket] = useState(false);
  const [isSensorPaused, setIsSensorPaused] = useState(false);
  const quest = pickPhoneQuest(quests);
  const debugExercise = phoneExercise(quest?.type);
  const repDebug = useRepDebug(debugExercise, isDebug);
  const motionSender = useMotionSender(quest?.sessionId, isDebug ? repDebug.onReading : undefined);
  const isStreaming = motionSender.status === 'streaming' || motionSender.status === 'offline';
  const isVowActive = quest !== null;
  const pause = useCallback((event: SensorPauseEvent) => setIsSensorPaused((paused) => nextSensorPaused(paused, event)), []);
  const exitPocket = useCallback(() => setIsPocket(false), []);
  useWakeLock(isVowActive || isStreaming);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') pause({ type: 'hidden', vowActive: isVowActive, streaming: isStreaming });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause, isVowActive, isStreaming]);

  useEffect(() => {
    setPersonId(rememberedId()); // eslint-disable-line react-hooks/set-state-in-effect -- reads browser-only state after hydration
    setIsReady(true);
    setIsDebug(isDebugSearch(window.location.search));
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await fetchPlayerQuests(id);
      setPerson(data.player);
      setQuests(data.quests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : UNREACHABLE);
    }
  }, []);

  useEffect(() => {
    if (!personId) return;
    let isCurrent = true;
    fetchPlayerQuests(personId)
      .then((data) => {
        if (!isCurrent) return;
        setPerson(data.player);
        setQuests(data.quests);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isCurrent) return;
        const message = e instanceof Error ? e.message : UNREACHABLE;
        if (UNKNOWN_PERSON.test(message)) {
          forgetId(); // the remembered person is gone (demo reset): show the oath form again
          setPersonId(null);
          return;
        }
        setError(message);
      });
    return () => {
      isCurrent = false;
    };
  }, [personId]);

  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(() => setRejection(null), REJECTION_MS);
    return () => clearTimeout(timer);
  }, [rejection]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      if (!personId) return;
      switch (event.type) {
        case 'rep':
          pause({ type: 'rep' });
          setFocusedQuestId(event.questId);
          setQuests((qs) => qs.map((q) => (q.id === event.questId ? { ...q, progress: event.count } : q)));
          return;
        case 'rep.rejected':
          setRejection(event.reason);
          setLastRejection(event.reason);
          return;
        case 'quest.update':
          setQuests((qs) => upsertQuest(qs, event.quest));
          return;
        case 'quest.complete':
          setQuests((qs) => upsertQuest(qs, event.quest));
          setIsPocket(false); // show the moment
          break;
      }
      const moment = announcementFor(event);
      if (!moment) return;
      setAnnouncement({ id: Date.now(), ...moment });
      void refresh(personId);
    },
    [personId, refresh, pause],
  );
  const iris = useIris(personId, handleEvent, person?.penalty ? 'furious' : 'watching');

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

  const handleJoin = (form: FormData): Promise<void> =>
    run(async () => {
      const name = String(form.get('name') ?? '').trim();
      const created = await createPlayer(name);
      rememberId(created.id);
      setPersonId(created.id);
    });

  const handleFocus = (questId: string): Promise<void> =>
    run(async () => {
      if (!personId) return;
      const started = await startQuest(personId, { questId });
      setFocusedQuestId(started.id);
      setQuests((qs) => upsertQuest(qs, started));
    });

  const handleStartType = (type: PhoneQuestType): Promise<void> =>
    run(async () => {
      if (!personId) return;
      const started = await startQuest(personId, { type });
      setFocusedQuestId(started.id);
      setQuests((qs) => upsertQuest(qs, started));
    });

  const isFocused = quest !== null && quest.id === focusedQuestId;
  const mood = rejection ? 'unimpressed' : iris.mood;
  const idleLine = isStreaming ? 'Go on. I am counting.' : 'Press Begin. I count only what I can feel.';

  return (
    <MotionConfig reducedMotion="user">
      <main className="band" data-mood={mood}>
        <div className="aura" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />

        <header className="band-top mono">
          <Link href="/" className="band-logo focusable">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0L14 8L8 16L2 8Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
            OATH
          </Link>
          <span className={iris.isConnected ? 'accent' : 'band-offline'}>{iris.isConnected ? '● Arbiter online' : '○ Reconnecting'}</span>
        </header>

        {isReady && !personId && (
          <form action={handleJoin} className="band-join">
            <IrisGlyph mood="watching" size={104} />
            <h1>Take the <span className="serif">Oath.</span></h1>
            <label className="mute" htmlFor="name">Your name. Iris will remember it.</label>
            <input id="name" name="name" required maxLength={40} autoComplete="nickname" className="band-input glass focusable" />
            <button type="submit" disabled={isBusy} className="btn mono"><i className="dot" />Swear it</button>
          </form>
        )}

        {personId && (
          <div className="band-body">
            <section aria-label="You" className="band-id">
              <IrisGlyph mood={mood} size={66} isSpeaking={iris.isSpeaking} />
              <div className="band-who">
                <p className="mono mute">Sworn</p>
                <p className="band-name">{person?.name ?? '…'}</p>
                <p className="mono mute">Level {person?.level ?? '–'} · {person?.xp ?? 0} Proof</p>
              </div>
              <div className="band-rank">
                <p className="mono mute">Rank</p>
                <p className="band-rank-letter">{person?.rank ?? '–'}</p>
              </div>
            </section>

            <p className="band-caption glass" aria-live="polite">
              <span className="mono accent">Iris</span>
              <span>{iris.caption ?? idleLine}</span>
            </p>

            <VowRing quest={quest} rejection={rejection} />

            <div className="band-actions">
              {!isStreaming ? (
                <button type="button" className="btn band-begin" onClick={() => void motionSender.start()} disabled={motionSender.status === 'requesting'}>
                  <i className="dot" />Begin
                </button>
              ) : quest && !isFocused ? (
                <button type="button" className="btn band-begin" disabled={isBusy} onClick={() => void handleFocus(quest.id)}>
                  <i className="dot" />Count on this phone
                </button>
              ) : (
                <button type="button" className="btn btn-quiet mono" onClick={motionSender.stop}>Stop sensor</button>
              )}
              <p className={`mono band-status ${motionSender.status === 'streaming' ? 'accent' : 'mute'}`}>
                {SENSOR_STATUS[motionSender.status]}{isStreaming ? ` · ${motionSender.sent} samples` : ''}
              </p>
              {isStreaming && quest && (
                <button type="button" className="btn btn-quiet mono" onClick={() => setIsPocket(true)}>Pocket mode</button>
              )}
            </div>

            {isSensorPaused && (
              <button type="button" role="alert" className="band-notice glass" onClick={() => pause({ type: 'dismiss' })}>
                Sensor paused — the screen was locked. Reps while it was off were not counted. Tap to dismiss.
              </button>
            )}
            {isDebug && <p data-testid="rep-debug" className="band-debug mono">{formatRepDebug({ exercise: debugExercise, snapshot: repDebug.snapshot, serverReason: lastRejection })}</p>}

            <section aria-label="Vows this phone can count" className="band-cards">
              {VOW_CARDS.map((card) => {
                const isActive = quest?.type === card.type;
                return (
                  <button key={card.type} type="button" disabled={isBusy} className="band-card glass focusable" data-active={isActive || undefined} onClick={() => void handleStartType(card.type)}>
                    <span className="band-card-glyph" aria-hidden="true">{card.glyph}</span>
                    <span className="band-card-name">{card.name}</span>
                    <span className="mono mute">{isActive ? 'Counting' : card.stat}</span>
                  </button>
                );
              })}
            </section>

            <nav className="band-nav mono" aria-label="More">
              <Link href="/today" className="focusable">Today</Link>
              <Link href="/rank" className="focusable">Rank</Link>
              {person?.penalty && <Link href="/reckoning" className="focusable band-offline">The Reckoning</Link>}
            </nav>
          </div>
        )}

        {error && <p role="alert" className="band-error glass">{error}</p>}
        <Announcement message={announcement} onDismiss={() => setAnnouncement(null)} />
        {isPocket && quest && <PocketScreen progress={quest.progress} target={quest.target} onExit={exitPocket} />}
      </main>
    </MotionConfig>
  );
}
