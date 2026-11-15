'use client';
/** App chrome: particles, top bar (hidden on the Awakening screen), overlays, penalty tint. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DEMO_KEYS } from '../lib/ui/demo';
import { Overlays } from './overlays/Overlays';
import { useSystem } from './SystemProvider';
import { ConnectionPill, RankBadge } from './system/Bits';

const NAV = [
  { href: '/system', label: 'Status' },
  { href: '/quest', label: 'Live Quest' },
  { href: '/leaderboard', label: 'Hunters' },
  { href: '/gates', label: 'Gates' },
];

// Deterministic so server and client render the same particles.
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i * 1.7) % 14,
  duration: 14 + ((i * 5) % 12),
  size: 2 + (i % 3),
}));

function Particles() {
  return (
    <div className="particles" aria-hidden>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            animationDelay: `-${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, status, sound, toggleSound } = useSystem();
  const onboarding = pathname === '/';

  return (
    <div className={`app-root ${state.penalty ? 'app-root--penalty' : ''}`}>
      <Particles />
      {!onboarding && (
        <header className="topbar">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/system" className="flex items-center gap-2">
              <RankBadge rank={state.rank} />
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="font-mono text-xs tracking-[0.3em] text-sys">AWAKEN</span>
                <span className="max-w-[12rem] truncate text-sm text-sys-text">{state.name ?? 'Unregistered player'}</span>
              </span>
            </Link>
            <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="System">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className={`nav-link ${pathname === n.href ? 'nav-link--active' : ''}`}>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {state.demo && (
                <span className="demo-badge" title={Object.entries(DEMO_KEYS).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')}>
                  DEMO MODE
                </span>
              )}
              <ConnectionPill status={status} />
              <button type="button" className="icon-button" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Mute System sounds' : 'Unmute System sounds'}>
                {sound ? '♪' : '×'}
              </button>
            </div>
          </div>
        </header>
      )}
      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">{children}</main>
      {!onboarding && (
        <footer className="mx-auto hidden w-full max-w-6xl flex-wrap gap-x-3 gap-y-1 px-4 pb-6 font-mono text-[11px] text-sys-dim/70 sm:flex">
          <span>Demo keys (sensor backup):</span>
          {Object.entries(DEMO_KEYS).map(([k, v]) => (
            <span key={k} className="whitespace-nowrap">
              <kbd className="kbd">{k.toUpperCase()}</kbd> {v}
            </span>
          ))}
        </footer>
      )}
      <Overlays />
    </div>
  );
}
