'use client';
/** Shared frame for the app screens: mood-tinted aura, grain, the OATH nav. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { IrisMood } from '../../lib/irisMood';

const LINKS = [
  { href: '/today', label: 'Today' },
  { href: '/rank', label: 'Rank' },
  { href: '/band', label: 'Band' },
] as const;

interface OathShellProps {
  mood: IrisMood;
  current: '/today' | '/rank' | '/calibrate' | '/reckoning';
  isConnected?: boolean;
  className?: string;
  children: ReactNode;
}

export function OathShell({ mood, current, isConnected, className = '', children }: OathShellProps) {
  return (
    <main className={`shell ${className}`} data-mood={mood}>
      <div className="aura" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <nav className="shell-nav mono" aria-label="OATH">
        <Link href="/" className="shell-logo focusable">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0L14 8L8 16L2 8Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
          OATH
        </Link>
        <div className="shell-links">
          {isConnected !== undefined && (
            <span className="shell-live" data-offline={isConnected ? undefined : ''}>{isConnected ? '● Arbiter online' : '○ Reconnecting'}</span>
          )}
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="focusable" aria-current={link.href === current ? 'page' : undefined}>{link.label}</Link>
          ))}
        </div>
      </nav>
      {children}
    </main>
  );
}

/** Shown on app screens when nobody has sworn in on this device yet. */
export function NotSworn() {
  return (
    <section className="shell-empty">
      <p className="kick mono">The Arbiter is watching</p>
      <h1>Take the <span className="serif">Oath.</span></h1>
      <p className="lede">Nothing here counts until you are sworn. Calibration takes five minutes.</p>
      <Link href="/calibrate" className="btn mono"><i className="dot" />Begin calibration</Link>
    </section>
  );
}
