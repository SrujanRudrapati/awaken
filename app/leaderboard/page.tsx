'use client';
/** Hunter Leaderboard. The current player is ranked live; others are sample rows until the API exists. */
import { useSystem } from '../../components/SystemProvider';
import { RankBadge } from '../../components/system/Bits';
import { SampleNotice } from '../../components/system/SampleNotice';
import { SystemWindow } from '../../components/system/SystemWindow';
import { getLeaderboard, type HunterRow } from '../../lib/ui/samples';

export default function LeaderboardPage() {
  const { state } = useSystem();
  const me: HunterRow | null = state.name ? { name: state.name, rank: state.rank, level: state.level, xp: state.xp } : null;
  const rows = [...getLeaderboard(), ...(me ? [me] : [])].sort((a, b) => b.xp - a.xp);

  return (
    <div className="mx-auto max-w-2xl">
      <SystemWindow title="Hunter Leaderboard">
        <SampleNotice what="Leaderboard" />
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => {
            const isMe = row === me;
            return (
              <li
                key={`${row.name}-${i}`}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isMe ? 'border-sys bg-sys/10' : 'border-sys/15'}`}
              >
                <span className={`w-6 text-right font-mono text-sm ${i === 0 ? 'text-gold' : 'text-sys-dim'}`}>{i + 1}</span>
                <RankBadge rank={row.rank} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sys-text">
                    {row.name}
                    {isMe && <span className="ml-2 font-mono text-[10px] tracking-widest text-sys">YOU</span>}
                  </p>
                  <p className="font-mono text-[11px] text-sys-dim">LEVEL {row.level}</p>
                </div>
                <span className="font-mono text-sm tabular-nums text-sys">{row.xp} XP</span>
              </li>
            );
          })}
        </ol>
      </SystemWindow>
    </div>
  );
}
