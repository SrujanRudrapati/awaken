/** How each of Iris's moods looks (source: design/iris.html). Shared by the 2D glyph and the WebGL crystal. */
import type { IrisMood } from '../../lib/irisMood';

export interface MoodLook {
  /** CSS colour. */
  color: string;
  /** 0 = eye shut, 1 = wide open. */
  lid: number;
  /** Pupil radius in eye-shader units (iris radius is 0.17). */
  pupil: number;
}

export const MOOD_LOOK: Record<IrisMood, MoodLook> = {
  unimpressed: { color: '#7DD3FC', lid: 0.36, pupil: 0.075 },
  watching: { color: '#7DD3FC', lid: 0.92, pupil: 0.085 },
  proud: { color: '#F5C46B', lid: 1, pupil: 0.11 },
  furious: { color: '#F0524F', lid: 0.3, pupil: 0.032 },
  sleepy: { color: '#B69CFF', lid: 0, pupil: 0.08 },
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
