import Link from 'next/link';
import type { Quest } from '../../lib/schemas';
import { STAT_LABEL } from '../../lib/ui/ranks';

const UNIT: Partial<Record<Quest['type'], string>> = {
  pushup: 'reps',
  squat: 'reps',
  jail: 's locked',
  meditate: 's',
  water: 'bottles',
};

const STATUS: Record<Quest['status'], { label: string; className: string }> = {
  active: { label: 'ACTIVE', className: 'text-sys' },
  done: { label: 'CLEARED', className: 'text-gold' },
  failed: { label: 'FAILED', className: 'text-danger' },
};

export function QuestCard({ quest, live }: { quest: Quest; live?: boolean }) {
  const frac = Math.min(1, quest.progress / quest.target);
  const status = STATUS[quest.status];
  return (
    <Link
      href="/quest"
      className={`block rounded-lg border p-3 transition-colors hover:bg-white/[0.03] ${
        quest.status === 'failed' ? 'border-danger/40' : quest.status === 'done' ? 'border-gold/40' : 'border-sys/25'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-sys-dim">
            {quest.stat} · {STAT_LABEL[quest.stat].toUpperCase()}
            {live && <span className="ml-2 text-sys">● LIVE</span>}
          </p>
          <p className="mt-1 truncate text-sys-text">{quest.title}</p>
        </div>
        <span className={`shrink-0 font-mono text-[11px] tracking-widest ${status.className}`}>{status.label}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full ${quest.status === 'done' ? 'bg-gold' : quest.status === 'failed' ? 'bg-danger' : 'xp-fill'}`}
            style={{ width: `${frac * 100}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-xs text-sys-dim tabular-nums">
          {quest.progress}/{quest.target} {UNIT[quest.type] ?? ''}
        </span>
        {quest.xp > 0 && <span className="shrink-0 font-mono text-xs text-gold">+{quest.xp} XP</span>}
      </div>
    </Link>
  );
}
