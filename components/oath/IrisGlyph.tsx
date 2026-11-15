'use client';
/** Iris in 2D: a glass shard with a living eye. Lightweight (SVG + CSS), used on phones and as the WebGL fallback. */
import { useId } from 'react';
import type { IrisMood } from '../../lib/irisMood';
import { MOOD_LOOK } from './moods';

interface IrisGlyphProps {
  mood: IrisMood;
  /** Width in px; height is 4/3 of it. */
  size?: number;
  isSpeaking?: boolean;
  className?: string;
}

const IRIS_RADIUS = 8.5;
const PUPIL_SCALE = IRIS_RADIUS / 0.17;

export function IrisGlyph({ mood, size = 96, isSpeaking = false, className = '' }: IrisGlyphProps) {
  const id = useId();
  const look = MOOD_LOOK[mood];
  return (
    <span
      className={`iris-glyph ${className}`}
      data-mood={mood}
      data-speaking={isSpeaking || undefined}
      style={{ width: size, height: (size * 4) / 3, ['--lid' as string]: look.lid }}
      role="img"
      aria-label={`Iris, ${mood}`}
    >
      <span className="iris-glyph-glow" aria-hidden="true" />
      <svg viewBox="0 0 120 160" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}f1`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--a)" stopOpacity=".05" />
          </linearGradient>
          <linearGradient id={`${id}f2`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--a)" stopOpacity=".2" />
            <stop offset="1" stopColor="#05060A" stopOpacity=".1" />
          </linearGradient>
          <radialGradient id={`${id}ir`}>
            <stop offset="0" stopColor="#fff" />
            <stop offset=".35" stopColor="var(--a)" />
            <stop offset="1" stopColor="var(--a)" stopOpacity=".35" />
          </radialGradient>
          <clipPath id={`${id}al`}>
            <path d="M33 80 Q60 61 87 80 Q60 99 33 80Z" />
          </clipPath>
        </defs>
        <g className="iris-glyph-body">
          <path d="M60 6 L106 80 L60 154 L14 80Z" fill="rgba(8,12,20,.72)" />
          <path d="M60 6 L48 80 L14 80Z" fill={`url(#${id}f1)`} />
          <path d="M60 6 L106 80 L48 80Z" fill={`url(#${id}f2)`} />
          <path d="M60 154 L48 80 L14 80Z" fill={`url(#${id}f2)`} opacity=".7" />
          <path d="M60 154 L106 80 L48 80Z" fill={`url(#${id}f1)`} opacity=".45" />
          <path d="M60 6 L106 80 L60 154 L14 80Z M14 80 L106 80 M60 6 L48 80 L60 154" fill="none" stroke="var(--a)" strokeWidth="1" strokeOpacity=".7" strokeLinejoin="round" />
          <path d="M60 6 L14 80" stroke="#fff" strokeWidth="1.2" strokeOpacity=".55" />
        </g>
        <g className="iris-glyph-eye">
          <g clipPath={`url(#${id}al)`}>
            <rect x="30" y="58" width="60" height="44" fill="#03050a" />
            <circle cx="60" cy="80" r={IRIS_RADIUS} fill={`url(#${id}ir)`} />
            <circle cx="60" cy="80" r={Math.max(1.6, look.pupil * PUPIL_SCALE)} fill="#02030a" className="iris-glyph-pupil" />
            <circle cx="57.4" cy="77.4" r="1.5" fill="#fff" opacity=".95" />
            <rect className="iris-glyph-lid iris-glyph-lid-top" x="28" y="56" width="64" height="24" />
            <rect className="iris-glyph-lid iris-glyph-lid-bottom" x="28" y="80" width="64" height="24" />
          </g>
          <path d="M33 80 Q60 61 87 80 Q60 99 33 80Z" fill="none" stroke="var(--a)" strokeWidth="1" strokeOpacity=".55" />
        </g>
      </svg>
    </span>
  );
}
