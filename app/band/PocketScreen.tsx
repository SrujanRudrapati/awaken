'use client';
/** Pocket mode: a black screen with a tiny counter. Taps do nothing; hold anywhere for 2 s to leave. */
import { useEffect, useMemo } from 'react';
import { createLongPress } from '../hunter/screenGuard';
import { padCount } from './labels';

const EXIT_HOLD_MS = 2_000;

interface PocketScreenProps {
  progress: number;
  target: number;
  onExit: () => void;
}

export function PocketScreen({ progress, target, onExit }: PocketScreenProps) {
  const press = useMemo(() => createLongPress(EXIT_HOLD_MS, onExit), [onExit]);
  useEffect(() => () => press.up(), [press]);

  const swallow = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      role="dialog"
      aria-label="Pocket mode. Hold for 2 seconds to leave."
      className="band-pocket"
      onPointerDown={(event) => {
        swallow(event);
        press.down();
      }}
      onPointerUp={press.up}
      onPointerCancel={press.up}
      onPointerLeave={press.up}
      onClick={swallow}
      onContextMenu={swallow}
    >
      <p className="band-pocket-count" aria-live="polite">{padCount(progress)} <span>/ {target}</span></p>
      <p className="mono">Hold 2 s to leave</p>
    </div>
  );
}
