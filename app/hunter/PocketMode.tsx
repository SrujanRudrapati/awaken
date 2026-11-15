'use client';
/**
 * Pocket mode: a black screen (cheap on OLED, nothing to mis-tap) with a tiny rep counter.
 * Taps do nothing; hold anywhere for 2 s to leave.
 */
import { useEffect, useMemo } from 'react';
import { createLongPress } from './screenGuard';

export const POCKET_EXIT_MS = 2_000;

interface PocketModeProps {
  progress: number;
  target: number;
  onExit: () => void;
}

export function PocketMode({ progress, target, onExit }: PocketModeProps) {
  const press = useMemo(() => createLongPress(POCKET_EXIT_MS, onExit), [onExit]);
  useEffect(() => () => press.up(), [press]);

  const swallow = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      role="dialog"
      aria-label="Pocket mode. Hold for 2 seconds to exit."
      className="fixed inset-0 z-[60] flex select-none flex-col items-center justify-end bg-black pb-[max(2rem,env(safe-area-inset-bottom))]"
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      onPointerDown={(e) => {
        swallow(e);
        press.down();
      }}
      onPointerUp={press.up}
      onPointerCancel={press.up}
      onPointerLeave={press.up}
      onClick={swallow}
      onContextMenu={swallow}
    >
      <p className="font-mono text-sm text-white/40" aria-live="polite">
        {progress} / {target}
      </p>
      <p className="mt-1 font-mono text-[10px] tracking-widest text-white/20">HOLD 2 S TO EXIT</p>
    </div>
  );
}
