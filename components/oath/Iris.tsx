'use client';
/**
 * Iris, wherever she appears. `stage` picks the 3D crystal on wide screens (when motion is allowed and WebGL
 * works) and the lightweight 2D glyph on phones, under prefers-reduced-motion, or if WebGL fails.
 */
import { useCallback, useEffect, useState } from 'react';
import type { IrisMood } from '../../lib/irisMood';
import { IrisCanvas } from './IrisCanvas';
import { IrisGlyph } from './IrisGlyph';

const WIDE_SCREEN = '(min-width: 860px)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

interface IrisProps {
  mood: IrisMood;
  isSpeaking?: boolean;
  /** Edge of the square stage in px. */
  size: number;
  /** Force the 2D glyph (small placements). */
  flat?: boolean;
}

export function Iris({ mood, isSpeaking = false, size, flat = false }: IrisProps) {
  const [canRender3d, setCanRender3d] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    if (flat) return;
    const wide = window.matchMedia(WIDE_SCREEN);
    const reduced = window.matchMedia(REDUCED_MOTION);
    const sync = (): void => setCanRender3d(wide.matches && !reduced.matches);
    sync();
    wide.addEventListener('change', sync);
    reduced.addEventListener('change', sync);
    return () => {
      wide.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
    };
  }, [flat]);

  const handleUnavailable = useCallback(() => setHasFailed(true), []);
  const is3d = !flat && canRender3d && !hasFailed;

  return (
    <div className="iris-stage" data-mood={mood} style={{ width: size, height: size }}>
      {is3d ? (
        <>
          <span className="iris-stage-glow" aria-hidden="true" />
          <IrisCanvas mood={mood} isSpeaking={isSpeaking} onUnavailable={handleUnavailable} />
          <span className="sr-only">Iris, {mood}</span>
        </>
      ) : (
        <IrisGlyph mood={mood} isSpeaking={isSpeaking} size={Math.round(size * 0.46)} />
      )}
    </div>
  );
}
