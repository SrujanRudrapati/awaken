'use client';
/** The live vow: a huge thin counter inside a glowing ring, with the "not counted" flash. Presentational. */
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { rejectionLine } from '../../components/oath/events';
import type { Quest } from '../../lib/schemas';
import { clockLeft, padCount, vowKicker, vowUnit } from './labels';

interface VowRingProps {
  quest: Quest | null;
  rejection: string | null;
}

const RADIUS = 47;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function useClock(isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [isRunning]);
  return now;
}

export function VowRing({ quest, rejection }: VowRingProps) {
  const isUrgent = quest?.kind === 'emergency';
  const now = useClock(isUrgent);
  const fraction = quest ? Math.min(1, quest.progress / quest.target) : 0;
  const tone = rejection || quest?.kind === 'penalty' || isUrgent ? 'red' : undefined;

  return (
    <section className="vow-ring" data-tone={tone} data-rejected={rejection ? '' : undefined} aria-labelledby="vow-ring-title">
      <div className="vow-ring-top mono">
        <span id="vow-ring-title" className="accent">{quest ? vowKicker(quest) : 'No vow running'}</span>
        <span className="mute">{quest ? (isUrgent ? clockLeft(quest.deadline, now) : `+${quest.xp} Proof`) : 'Choose below'}</span>
      </div>

      <div className="vow-ring-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={RADIUS} className="vow-ring-rail" />
          <circle
            cx="50" cy="50" r={RADIUS} className="vow-ring-arc"
            strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
        <div className="vow-ring-count" aria-live="polite">
          <motion.b key={quest?.progress ?? -1} initial={{ scale: 1.12, opacity: 0.55 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35 }}>
            {padCount(quest?.progress ?? 0)}
          </motion.b>
          <span className="mono mute">{quest ? `/ ${quest.target} ${vowUnit(quest.type)}` : 'Proven, not claimed'}</span>
        </div>
      </div>

      <p className="vow-ring-flash mono" aria-live="assertive">{rejection ? `✕ ${rejectionLine(rejection)}` : ''}</p>
    </section>
  );
}
