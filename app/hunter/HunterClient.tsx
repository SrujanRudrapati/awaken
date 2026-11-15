'use client';
/**
 * /hunter — the iPhone armband. AWAKEN grants motion access and streams the accelerometer;
 * the System stream drives the live rep count, rejection flashes and level-up / penalty overlays.
 * Player: `?player=<id>` or the one remembered on this phone, else a join form.
 */
import { MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import type { Player, Quest, StreamEvent } from '../../lib/schemas';
import { createPlayer, fetchPlayerQuests, pickPhoneQuest, startQuest, upsertQuest, type PhoneQuestType } from './api';
import { QuestPanel } from './QuestPanel';
import { SystemOverlay, type OverlayMessage } from './SystemOverlay';
import { useMotionSender, type MotionStatus } from './useMotionSender';
import { useSystemStream } from './useSystemStream';

const STORAGE_KEY = 'awaken.playerId';
const REJECTION_MS = 1_500;

const STATUS_TEXT: Record<MotionStatus, string> = {
  idle: 'SENSOR OFFLINE',
  requesting: 'REQUESTING ACCESS…',
  streaming: 'SENSOR LINKED',
  denied: 'MOTION ACCESS DENIED — Settings › Safari › Motion & Orientation',
  unsupported: 'NO MOTION SENSOR ON THIS DEVICE',
  offline: 'SIGNAL LOST — RETRYING',
};

function rememberedPlayerId(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('player');
  try {
    return fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fromUrl;
  }
}

function remember(playerId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, playerId);
  } catch {
    // private mode: the URL still works
  }
}

export function HunterClient() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [focusedQuestId, setFocusedQuestId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayMessage | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const motionSender = useMotionSender();

  useEffect(() => {
    setPlayerId(rememberedPlayerId()); // eslint-disable-line react-hooks/set-state-in-effect -- reads browser-only state after hydration
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await fetchPlayerQuests(id);
      setPlayer(data.player);
      setQuests(data.quests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Iris');
    }
  }, []);

  useEffect(() => {
    if (!playerId) return;
    let isCurrent = true;
    fetchPlayerQuests(playerId)
      .then((data) => {
        if (!isCurrent) return;
        setPlayer(data.player);
        setQuests(data.quests);
        setError(null);
      })
      .catch((e: unknown) => {
        if (isCurrent) setError(e instanceof Error ? e.message : 'Could not reach Iris');
      });
    return () => {
      isCurrent = false;
    };
  }, [playerId]);

  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(() => setRejection(null), REJECTION_MS);
    return () => clearTimeout(timer);
  }, [rejection]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      if (!playerId) return;
      switch (event.type) {
        case 'rep':
          if (event.playerId === playerId) {
            setFocusedQuestId(event.questId);
            setQuests((qs) => qs.map((q) => (q.id === event.questId ? { ...q, progress: event.count } : q)));
          }
          return;
        case 'rep.rejected':
          if (event.playerId === playerId) setRejection(event.reason);
          return;
        case 'quest.update':
          if (event.quest.playerId === playerId) setQuests((qs) => upsertQuest(qs, event.quest));
          return;
        case 'quest.complete':
          if (event.quest.playerId !== playerId) return;
          setQuests((qs) => upsertQuest(qs, event.quest));
          setOverlay({ id: Date.now(), tone: 'blue', header: '[VOW KEPT]', title: event.quest.title, detail: `+${event.xpGained} Proof` });
          void refresh(playerId);
          return;
        case 'levelup':
          if (event.playerId !== playerId) return;
          setOverlay({ id: Date.now(), tone: 'gold', header: '[ASCENSION]', title: `Rank ${event.toRank}`, detail: `Level ${event.level}` });
          void refresh(playerId);
          return;
        case 'penalty':
          if (event.playerId !== playerId) return;
          setOverlay({ id: Date.now(), tone: 'red', header: '[THE RECKONING]', title: 'Vow broken', detail: event.reason });
          void refresh(playerId);
          return;
        case 'voice':
          if (!event.playerId || event.playerId === playerId) setVoice(event.text);
          return;
      }
    },
    [playerId, refresh],
  );
  const isConnected = useSystemStream(handleEvent);

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
      remember(created.id);
      setPlayerId(created.id);
    });

  const handleFocus = (questId: string): Promise<void> =>
    run(async () => {
      if (!playerId) return;
      const quest = await startQuest(playerId, { questId });
      setFocusedQuestId(quest.id);
      setQuests((qs) => upsertQuest(qs, quest));
    });

  const handleStartType = (type: PhoneQuestType): Promise<void> =>
    run(async () => {
      if (!playerId) return;
      const quest = await startQuest(playerId, { type });
      setFocusedQuestId(quest.id);
      setQuests((qs) => upsertQuest(qs, quest));
    });

  const quest = pickPhoneQuest(quests);
  const isStreaming = motionSender.status === 'streaming' || motionSender.status === 'offline';

  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-dvh bg-[#05070D] px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10 text-white">
        <header className="flex items-center justify-between font-mono text-xs tracking-[0.2em]">
          <span className="text-[#38BDF8]">[IRIS]</span>
          <span className={isConnected ? 'text-[#38BDF8]' : 'text-[#EF4444]'}>{isConnected ? '● ONLINE' : '○ RECONNECTING'}</span>
        </header>

        {!playerId ? (
          <form action={handleJoin} className="mt-16 space-y-4">
            <h1 className="font-mono text-sm tracking-[0.3em] text-[#38BDF8]">[SWEAR THE OATH]</h1>
            <label className="block text-lg text-white/80" htmlFor="name">Your name. Iris will remember it.</label>
            <input id="name" name="name" required maxLength={40} autoComplete="nickname"
              className="w-full rounded-xl border border-[#38BDF8]/50 bg-white/5 px-4 py-4 text-2xl text-white outline-none focus:border-[#38BDF8]" />
            <button type="submit" disabled={isBusy} className="w-full rounded-xl bg-[#38BDF8] py-4 font-mono text-lg font-bold tracking-widest text-[#05070D] disabled:opacity-50">
              ACCEPT
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-5">
            <section aria-label="Profile" className="flex items-end justify-between">
              <div>
                <p className="font-mono text-xs tracking-[0.25em] text-white/50">SWORN</p>
                <p className="text-3xl font-bold">{player?.name ?? '…'}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-5xl font-bold text-[#FBBF24] drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]">{player?.rank ?? '-'}</p>
                <p className="font-mono text-xs text-white/60">LV {player?.level ?? '-'} · {player?.xp ?? 0} Proof</p>
              </div>
            </section>

            {!isStreaming ? (
              <button type="button" onClick={() => void motionSender.start()}
                className="w-full rounded-2xl border-2 border-[#38BDF8] bg-[#38BDF8]/15 py-8 font-mono text-4xl font-bold tracking-[0.4em] text-[#38BDF8] shadow-[0_0_40px_rgba(56,189,248,0.35)] active:scale-[0.98]">
                BEGIN
              </button>
            ) : (
              <button type="button" onClick={motionSender.stop} className="w-full rounded-xl border border-white/20 py-3 font-mono text-sm tracking-widest text-white/60">
                STOP SENSOR
              </button>
            )}
            <p className={`text-center font-mono text-xs tracking-widest ${motionSender.status === 'streaming' ? 'text-[#38BDF8]' : 'text-white/50'}`}>
              {STATUS_TEXT[motionSender.status]}{isStreaming ? ` · ${motionSender.sent} samples` : ''}
            </p>

            <QuestPanel quest={quest} isFocused={quest !== null && quest.id === focusedQuestId} rejection={rejection}
              isBusy={isBusy} onFocus={(id) => void handleFocus(id)} onStartType={(type) => void handleStartType(type)} />

            {voice && <p className="text-center font-mono text-sm italic text-[#38BDF8]/90" aria-live="polite">“{voice}”</p>}
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/10 p-3 text-sm text-[#EF4444]">{error}</p>}
        <SystemOverlay message={overlay} onDismiss={() => setOverlay(null)} />
      </main>
    </MotionConfig>
  );
}
