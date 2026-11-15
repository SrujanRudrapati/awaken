'use client';
/** /today — Iris and the day's vows, live. Vows are kept by sensors, photos and trials; nothing here marks one done by hand. */
import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Announcement, type AnnouncementMessage } from '../../components/oath/Announcement';
import {
  answerQuizTrial, answerReadTrial, fetchLastNight, fetchQuizTrial, fetchReadTrial, startUrgentVow, startVow, submitPhoto,
  type NewVow as NewVowInput, type Trial,
} from '../../components/oath/api';
import { announcementFor } from '../../components/oath/events';
import { Iris } from '../../components/oath/Iris';
import { NotSworn, OathShell } from '../../components/oath/OathShell';
import { useIris } from '../../components/oath/useIris';
import { usePerson } from '../../components/oath/usePerson';
import type { NightSummary, Quest, StreamEvent } from '../../lib/schemas';
import { upsertQuest } from '../hunter/api';
import { NewVow } from './NewVow';
import './today.css';
import { TrialSheet } from './TrialSheet';
import { VowRow } from './VowRow';
import { groupVows, hoursMinutes } from './vows';

const IRIS_DESKTOP_PX = 420;
const IRIS_PHONE_PX = 128;
const WIDE_SCREEN = '(min-width: 860px)';

interface OpenTrial {
  vow: Quest;
  trial: Trial;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function TodayClient() {
  const { personId, isReady, person, quests, setQuests, error, setError, refresh } = usePerson();
  const [announcement, setAnnouncement] = useState<AnnouncementMessage | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openTrial, setOpenTrial] = useState<OpenTrial | null>(null);
  const [night, setNight] = useState<{ summary: NightSummary; line?: string } | null>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(WIDE_SCREEN);
    const sync = (): void => setIsWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!personId) return;
    let isCurrent = true;
    fetchLastNight(personId)
      .then((summary) => {
        if (isCurrent && summary) setNight((current) => current ?? { summary });
      })
      .catch(() => undefined); // no nights yet, or sleep storage offline: the card simply stays hidden
    return () => {
      isCurrent = false;
    };
  }, [personId]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'rep':
          setQuests((qs) => qs.map((q) => (q.id === event.questId ? { ...q, progress: event.count } : q)));
          return;
        case 'rep.rejected':
          setNotes((current) => ({ ...current, [event.questId]: `✕ Not counted — ${event.reason}` }));
          return;
        case 'quest.update':
        case 'quest.complete':
          setQuests((qs) => upsertQuest(qs, event.quest));
          break;
        case 'sleep.summary':
          setNight({ summary: event.summary, line: event.line });
          return;
      }
      const moment = announcementFor(event);
      if (!moment) return;
      setAnnouncement({ id: Date.now(), ...moment });
      void refresh();
    },
    [setQuests, refresh],
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

  const handleSwear = (vow: NewVowInput | { questId: string }): Promise<void> =>
    run(async () => {
      if (!personId) return;
      const started = await startVow(personId, vow);
      setQuests((qs) => upsertQuest(qs, started));
    });

  const handleUrgent = (): Promise<void> =>
    run(async () => {
      if (!personId) return;
      const started = await startUrgentVow(personId, 'pushup');
      setQuests((qs) => upsertQuest(qs, started));
    });

  const handlePhoto = (vow: Quest, photo: File): Promise<void> =>
    run(async () => {
      if (!personId) return;
      setNotes((current) => ({ ...current, [vow.id]: 'Iris is looking…' }));
      try {
        const verdict = await submitPhoto(personId, vow.id, photo);
        setNotes((current) => ({ ...current, [vow.id]: `${verdict.passed ? '✓ Accepted' : '✕ Not accepted'} — ${verdict.reason}` }));
        await refresh();
      } catch (e) {
        setNotes((current) => ({ ...current, [vow.id]: '' }));
        throw e;
      }
    });

  const handleTrial = (vow: Quest): Promise<void> =>
    run(async () => {
      if (!personId) return;
      const trial = vow.type === 'read' ? await fetchReadTrial(personId, vow.id) : await fetchQuizTrial(personId, vow.id, vow.topic ?? vow.title);
      setOpenTrial({ vow, trial });
    });

  const submitTrial = async (answers: number[]) => {
    if (!personId || !openTrial) throw new Error('No trial is open');
    const { vow } = openTrial;
    const result = vow.type === 'read' ? await answerReadTrial(personId, vow.id, answers) : await answerQuizTrial(personId, vow.id, answers);
    void refresh();
    return result;
  };

  const groups = groupVows(quests);
  const openCount = quests.filter((q) => q.status === 'active' && q.kind !== 'calibration').length;

  return (
    <MotionConfig reducedMotion="user">
      <OathShell mood={iris.mood} current="/today" isConnected={iris.isConnected}>
        {isReady && !personId && <NotSworn />}
        {personId && (
          <div className="today">
            <aside className="today-iris">
              <Iris mood={iris.mood} isSpeaking={iris.isSpeaking} size={isWide ? IRIS_DESKTOP_PX : IRIS_PHONE_PX} />
              <p className="caption glass" aria-live="polite">
                <span className="mono accent">Iris</span>
                <span>{iris.caption ?? (openCount > 0 ? 'Your vows are open. I am watching.' : 'Nothing sworn. Swear something.')}</span>
              </p>
              <dl className="today-facts glass">
                <div><dt className="mono mute">Sworn</dt><dd>{person?.name ?? '…'}</dd></div>
                <div><dt className="mono mute">Rank</dt><dd className="today-rank">{person?.rank ?? '–'}</dd></div>
                <div><dt className="mono mute">Level</dt><dd>{person?.level ?? '–'}</dd></div>
                <div><dt className="mono mute">Proof</dt><dd>{person?.xp ?? 0}</dd></div>
              </dl>
            </aside>

            <section className="today-vows" aria-labelledby="today-title">
              <p className="kick mono">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <h1 id="today-title" className="display">Today&rsquo;s <span className="serif">vows.</span></h1>

              {error && <p role="alert" className="shell-error glass">{error}</p>}

              {night && (
                <article className="night glass" data-mood="sleepy">
                  <p className="mono accent">Last night</p>
                  <p className="night-hours">{hoursMinutes(night.summary.asleepMinutes)}</p>
                  <p className="mono mute">
                    {localTime(night.summary.bedtime)} → {localTime(night.summary.wake)} · deep {night.summary.deepMinutes} m · REM {night.summary.remMinutes} m
                  </p>
                  {night.line && <p className="night-line">{night.line}</p>}
                </article>
              )}

              {groups.length === 0 && <p className="lede">No vows yet. Iris sets them each morning, or swear one below.</p>}
              {groups.map((group) => (
                <section key={group.key} className="today-group" aria-label={group.label}>
                  <h2 className="mono mute">{group.label} · {group.vows.length}</h2>
                  <ul>
                    {group.vows.map((vow) => (
                      <VowRow key={vow.id} vow={vow} isBusy={isBusy} note={notes[vow.id]}
                        onBegin={(v) => void handleSwear({ questId: v.id })} onPhoto={(v, photo) => void handlePhoto(v, photo)} onTrial={(v) => void handleTrial(v)} />
                    ))}
                  </ul>
                </section>
              ))}

              <NewVow isBusy={isBusy} onSwear={(vow) => void handleSwear(vow)} onUrgent={() => void handleUrgent()} />
            </section>
          </div>
        )}
        {openTrial && <TrialSheet title={openTrial.vow.title} trial={openTrial.trial} onSubmit={submitTrial} onClose={() => setOpenTrial(null)} />}
        <Announcement message={announcement} onDismiss={() => setAnnouncement(null)} />
      </OathShell>
    </MotionConfig>
  );
}
