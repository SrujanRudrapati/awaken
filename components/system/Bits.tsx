'use client';
/** Small shared System UI pieces: rank badge, XP bar, connection pill, mascot eye, progress ring. */
import type { Rank } from '../../lib/schemas';
import { rankProgress } from '../../lib/ui/ranks';
import type { StreamStatus } from '../../lib/ui/useStream';

export function RankBadge({ rank, size = 'md' }: { rank: Rank; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-20 w-20 text-4xl' : 'h-12 w-12 text-2xl';
  return (
    <div className={`rank-badge ${dim}`} aria-label={`${rank}-Rank`}>
      {rank}
    </div>
  );
}

export function XpBar({ xp, rank }: { xp: number; rank: Rank }) {
  const { fraction, toNext } = rankProgress(xp, rank);
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-xs text-sys-dim">
        <span>XP {xp}</span>
        <span>{toNext === null ? 'MAX RANK' : `${toNext} to next rank`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5" role="progressbar" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="xp-fill h-full rounded-full" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: 'LINKING',
  live: 'SYSTEM LIVE',
  reconnecting: 'SIGNAL LOST',
};

export function ConnectionPill({ status }: { status: StreamStatus }) {
  return (
    <span className={`conn-pill conn-pill--${status}`} role="status">
      <span className="conn-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Original mascot: the System's watching eye. */
export function SystemEye({ size = 40, mood = 'calm' }: { size?: number; mood?: 'calm' | 'alert' | 'proud' }) {
  const color = mood === 'alert' ? 'var(--danger)' : mood === 'proud' ? 'var(--gold)' : 'var(--system)';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="sys-eye" style={{ color }}>
      <path d="M4 32 C16 12 48 12 60 32 C48 52 16 52 4 32 Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="11" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <circle className="sys-eye-pupil" cx="32" cy="32" r="5.5" fill="currentColor" />
      <path d="M32 4 V10 M32 54 V60" stroke="currentColor" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

export function ProgressRing({ value, max, size = 260, children }: { value: number; max: number; size?: number; children?: React.ReactNode }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1' }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(56,189,248,0.12)" strokeWidth="4" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--system)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="ring-fill"
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}
