'use client';
/** /rank — the letter you have proven, what the next one costs, your six stats, your Constellation, Shards and the week. */
import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Announcement, type AnnouncementMessage } from '../../components/oath/Announcement';
import {
  fetchConstellation, fetchHistory, fetchReport, fetchShards, spendShards,
  type Constellation, type PersonHistory, type ShardSpend, type Shards, type WeekReport,
} from '../../components/oath/api';
import { announcementFor } from '../../components/oath/events';
import { Iris } from '../../components/oath/Iris';
import { NotSworn, OathShell } from '../../components/oath/OathShell';
import { useIris } from '../../components/oath/useIris';
import { usePerson } from '../../components/oath/usePerson';
import { useToday } from '../../components/oath/useToday';
import { STAT_LABELS } from '../../lib/brand';
import { proofOf } from '../../lib/power';
import { StatSchema, type StreamEvent } from '../../lib/schemas';
import { RANKS, boardWindow, dailyProof, rankProgress, rungState, statFraction } from './ladder';
import './rank.css';

const IRIS_PX = 92;

export function RankClient() {
  const { personId, isReady, person, error, setError, refresh } = usePerson();
  const [history, setHistory] = useState<PersonHistory['history']>([]);
  const [constellation, setConstellation] = useState<Constellation | null>(null);
  const [shards, setShards] = useState<Shards | null>(null);
  const [report, setReport] = useState<WeekReport | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<AnnouncementMessage | null>(null);
  const [version, setVersion] = useState(0);
  const today = useToday();

  useEffect(() => {
    if (!personId) return;
    let isCurrent = true;
    const keep = <T,>(apply: (value: T) => void) => (value: T): void => {
      if (isCurrent) apply(value);
    };
    // Each panel loads on its own; one being offline must not blank the others.
    fetchHistory(personId).then(keep((data) => setHistory(data.history))).catch(() => undefined);
    fetchConstellation(personId).then(keep(setConstellation)).catch(() => undefined);
    fetchShards(personId).then(keep(setShards)).catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [personId, version]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      const moment = announcementFor(event);
      if (!moment) return;
      setAnnouncement({ id: Date.now(), ...moment });
      void refresh();
      setVersion((v) => v + 1);
    },
    [refresh],
  );
  const iris = useIris(personId, handleEvent, person?.penalty ? 'furious' : 'unimpressed');

  const handleSpend = async (spend: ShardSpend): Promise<void> => {
    if (!personId) return;
    setIsBusy(true);
    try {
      const { wallet } = await spendShards(personId, spend);
      setShards((current) => (current ? { ...current, wallet } : current));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setIsBusy(false);
    }
  };

  const handleReport = async (): Promise<void> => {
    if (!personId) return;
    setIsReportLoading(true);
    try {
      setReport(await fetchReport(personId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setIsReportLoading(false);
    }
  };

  const progress = rankProgress(person ?? {});
  const rank = person?.rank ?? progress.rank;
  const proof = proofOf(person ?? {});
  const maxProof = Math.max(...Object.values(proof), 1);
  const days = today ? dailyProof(history, today) : [];
  const maxDay = Math.max(...days.map((d) => d.proof), 1);

  return (
    <MotionConfig reducedMotion="user">
      <OathShell mood={iris.mood} current="/rank" isConnected={iris.isConnected}>
        {isReady && !personId && <NotSworn />}
        {personId && (
          <div className="rank">
            <section className="rank-hero" aria-labelledby="rank-title">
              <p className="kick mono">{person?.name ?? '…'} · Level {person?.level ?? '–'}</p>
              <h1 id="rank-title" className="sr-only">Rank {rank}</h1>
              <p className="rank-letter" aria-hidden="true">{rank}</p>
              <ol className="rank-ladder mono" aria-label="Ranks, E to A">
                {RANKS.map((rung) => (
                  <li key={rung} data-state={rungState(rung, rank)}>{rung}</li>
                ))}
              </ol>
              <div className="rank-power">
                <div className="rank-power-row mono">
                  <span>Power {progress.power}</span>
                  <span className="mute">{progress.next ? `Rank ${progress.next} at ${progress.nextAt}` : 'The top. Stay there.'}</span>
                </div>
                <div className="track" role="progressbar" aria-label="Progress to the next rank" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
                  <i style={{ transform: `scaleX(${progress.fraction})` }} />
                </div>
              </div>
              <div className="rank-iris caption glass">
                <Iris mood={iris.mood} isSpeaking={iris.isSpeaking} size={IRIS_PX} flat />
                <p aria-live="polite">
                  <span className="mono accent">Iris</span>
                  {iris.caption ?? (progress.next ? 'Power comes from every stat. Your weakest one holds the rest back.' : '…Acceptable.')}
                </p>
              </div>
            </section>

            <div className="rank-panels">
              {error && <p role="alert" className="shell-error glass">{error}</p>}

              <section className="panel glass" aria-labelledby="stats-title">
                <h2 id="stats-title" className="mono mute">Six stats · Proof</h2>
                <ul className="stats">
                  {StatSchema.options.map((stat) => (
                    <li key={stat}>
                      <span className="stats-name">{STAT_LABELS[stat]}</span>
                      <span className="track"><i style={{ transform: `scaleX(${statFraction(proof[stat], maxProof)})` }} /></span>
                      <span className="mono stats-value">{Math.round(proof[stat])}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="panel glass" aria-labelledby="week-title">
                <h2 id="week-title" className="mono mute">Proof · last 7 days</h2>
                <ol className="days" aria-label="Proof per day">
                  {days.map((day) => (
                    <li key={day.day}>
                      <span className="mono days-value">{day.proof || ''}</span>
                      <span className="days-bar"><i style={{ transform: `scaleY(${Math.max(0.02, day.proof / maxDay)})` }} /></span>
                      <span className="mono mute">{day.label}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {constellation && (
                <section className="panel glass board" data-mood="sleepy" aria-labelledby="board-title">
                  <h2 id="board-title" className="mono"><span className="accent">Constellation {constellation.name}</span> <span className="mute">· {constellation.position} of {constellation.size}</span></h2>
                  <ol>
                    {boardWindow(constellation.members, personId).map(({ position, member }) => (
                      <li key={member.id} data-me={member.id === personId || undefined}>
                        <span className="mono mute">{String(position).padStart(2, '0')}</span>
                        <span className="board-name">{member.id === personId ? 'You' : member.name}<small className="mono mute">Rank {member.rank} · Power {member.power}</small></span>
                        <span className="mono">{Math.round(member.weeklyProof)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {shards && (
                <section className="panel glass" aria-labelledby="shards-title">
                  <h2 id="shards-title" className="mono mute">Shards · earned only</h2>
                  <p className="shards-balance">{shards.wallet.balance}<span className="mono mute"> held · {shards.wallet.shields} shield{shards.wallet.shields === 1 ? '' : 's'}</span></p>
                  <div className="shards-actions">
                    <button type="button" className="chip mono focusable" disabled={isBusy || shards.wallet.balance < shards.prices.shield} onClick={() => void handleSpend({ item: 'shield' })}>
                      Shield · {shards.prices.shield}
                    </button>
                    <button type="button" className="chip mono focusable" disabled={isBusy || shards.wallet.balance < shards.prices.bonus} onClick={() => void handleSpend({ item: 'bonus' })}>
                      Bonus vow · {shards.prices.bonus}
                    </button>
                  </div>
                  <p className="mute shards-note">A shield absorbs one night of missed vows. A bonus vow pays 1.5× Proof.</p>
                </section>
              )}

              <section className="panel glass" aria-labelledby="report-title">
                <h2 id="report-title" className="mono mute">The week, judged</h2>
                {report ? (
                  <>
                    <p className="report-title">{report.report.title}</p>
                    <p className="report-verdict">{report.report.verdict}</p>
                    <p className="mute">{report.report.summary}</p>
                    <ol className="report-orders">
                      {report.report.orders.map((order) => <li key={order}>{order}</li>)}
                    </ol>
                  </>
                ) : (
                  <button type="button" className="btn btn-quiet mono" disabled={isReportLoading} onClick={() => void handleReport()}>
                    <i className="dot" />{isReportLoading ? 'Iris is weighing your week…' : "Ask for Iris's verdict"}
                  </button>
                )}
              </section>
            </div>
          </div>
        )}
        <Announcement message={announcement} onDismiss={() => setAnnouncement(null)} />
      </OathShell>
    </MotionConfig>
  );
}
