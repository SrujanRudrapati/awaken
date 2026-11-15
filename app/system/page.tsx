'use client';
/** Player status: rank card, Daily Quests, stat radar, System voice. */
import Link from 'next/link';
import { useSystem } from '../../components/SystemProvider';
import { RankBadge, XpBar } from '../../components/system/Bits';
import { QuestCard } from '../../components/system/QuestCard';
import { StatRadar } from '../../components/system/StatRadar';
import { SystemWindow } from '../../components/system/SystemWindow';
import { VoiceLine } from '../../components/system/VoiceLine';

export default function StatusPage() {
  const { state } = useSystem();
  const quests = Object.values(state.quests).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-5">
        <SystemWindow title="Status" tone={state.penalty ? 'danger' : 'system'}>
          <div className="flex items-center gap-4">
            <RankBadge rank={state.rank} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-xl text-sys-text">{state.name ?? 'Unregistered player'}</p>
              <p className="font-mono text-xs tracking-[0.2em] text-sys-dim">
                {state.rank}-RANK · LEVEL {state.level}
                {state.penalty && <span className="ml-2 text-danger">· PENALTY ZONE</span>}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <XpBar xp={state.xp} rank={state.rank} />
          </div>
          {!state.name && (
            <Link href="/" className="sys-button mt-5 w-full">
              Register player
            </Link>
          )}
        </SystemWindow>

        <SystemWindow title="Stats">
          <StatRadar stats={state.stats} />
        </SystemWindow>
      </div>

      <div className="flex flex-col gap-5">
        <SystemWindow>
          <VoiceLine />
        </SystemWindow>

        <SystemWindow
          title="Daily Quest"
          aside={
            <Link href="/quest" className="font-mono text-xs text-sys hover:underline">
              Live view →
            </Link>
          }
        >
          {quests.length ? (
            <ul className="flex flex-col gap-3">
              {quests.map((q) => (
                <li key={q.id}>
                  <QuestCard quest={q} live={q.id === state.activeQuestId && q.status === 'active'} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-sys/25 p-5 text-center">
              <p className="font-mono text-sm text-sys-dim">[AWAITING QUEST DROP]</p>
              <p className="mt-2 text-sm text-sys-dim">
                Quests appear here as soon as the System Core starts sending. Start a push-up over the sensor, or run{' '}
                <code className="text-sys">npm run sim pushup</code>.
              </p>
            </div>
          )}
        </SystemWindow>
      </div>
    </div>
  );
}
