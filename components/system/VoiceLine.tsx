'use client';
/** The System's latest line, typed out next to the mascot eye. */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useSystem } from '../SystemProvider';
import { SystemEye } from './Bits';

const FALLBACK = 'The System is observing.';

function Typewriter({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setShown((n) => (n >= text.length ? n : n + 1)), 28);
    return () => clearInterval(id);
  }, [text, reduce]);

  const visible = reduce ? text : text.slice(0, shown);
  return (
    <p className="font-mono text-sm leading-relaxed text-sys-text" aria-live="polite">
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {visible}
        {!reduce && shown < text.length && <span className="caret">▍</span>}
      </span>
    </p>
  );
}

export function VoiceLine({ compact = false }: { compact?: boolean }) {
  const { state } = useSystem();
  const latest = state.voice.at(-1);
  const mood = state.penalty ? 'alert' : state.overlays[0]?.kind === 'levelup' ? 'proud' : 'calm';

  return (
    <div className={`flex items-start gap-3 ${compact ? '' : 'py-1'}`}>
      <SystemEye size={compact ? 32 : 44} mood={mood} />
      <div className="min-w-0 flex-1">
        <div className="sys-header mb-1 text-[11px]">[SYSTEM]</div>
        {/* key remounts the typewriter so each new line starts from zero */}
        <Typewriter key={latest?.seq ?? 0} text={latest?.text ?? FALLBACK} />
      </div>
    </div>
  );
}
