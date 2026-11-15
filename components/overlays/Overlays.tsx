'use client';
/** Full-screen moments: QUEST COMPLETE, LEVEL UP (gold burst), PENALTY ZONE (red glitch). */
import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Overlay } from '../../lib/ui/state';
import { STAT_LABEL } from '../../lib/ui/ranks';
import { useSystem } from '../SystemProvider';
import { RankBadge, SystemEye } from '../system/Bits';

const AUTO_DISMISS_MS: Record<Overlay['kind'], number | null> = {
  complete: 3_500,
  levelup: 6_500,
  penalty: null, // the player must acknowledge the Penalty Zone
};

export function Overlays() {
  const { state, dispatch } = useSystem();
  const reduce = useReducedMotion();
  const overlay = state.overlays[0];

  useEffect(() => {
    if (!overlay) return;
    const ms = AUTO_DISMISS_MS[overlay.kind];
    if (ms === null) return;
    const id = setTimeout(() => dispatch({ type: 'dismissOverlay' }), ms);
    return () => clearTimeout(id);
  }, [overlay, dispatch]);

  const dismiss = () => dispatch({ type: 'dismissOverlay' });

  return (
    <AnimatePresence mode="wait">
      {overlay && (
        <motion.div
          key={overlay.seq}
          className={`overlay overlay--${overlay.kind}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.35 }}
          onClick={overlay.kind === 'penalty' ? undefined : dismiss}
          role="dialog"
          aria-modal="true"
          aria-label={overlay.kind === 'levelup' ? 'Level up' : overlay.kind === 'penalty' ? 'Penalty Zone' : 'Quest complete'}
        >
          {overlay.kind === 'complete' && <Complete overlay={overlay} reduce={!!reduce} />}
          {overlay.kind === 'levelup' && <LevelUp overlay={overlay} reduce={!!reduce} />}
          {overlay.kind === 'penalty' && (
            <Penalty
              overlay={overlay}
              reduce={!!reduce}
              onAck={() => {
                dismiss();
                dispatch({ type: 'clearPenalty' });
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function pop(reduce: boolean, delay = 0) {
  return reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay } }
    : {
        initial: { opacity: 0, scale: 0.7, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: { delay, type: 'spring' as const, stiffness: 260, damping: 18 },
      };
}

function Complete({ overlay, reduce }: { overlay: Extract<Overlay, { kind: 'complete' }>; reduce: boolean }) {
  return (
    <div className="sys-window max-w-md text-center">
      <motion.h2 className="sys-header text-xl sm:text-2xl" {...pop(reduce)}>
        [QUEST COMPLETE]
      </motion.h2>
      <motion.p className="mt-4 text-lg text-sys-text" {...pop(reduce, 0.1)}>
        {overlay.quest.title}
      </motion.p>
      <motion.div className="mt-6 flex justify-center gap-6 font-mono" {...pop(reduce, 0.2)}>
        <span className="text-gold text-2xl">+{overlay.xpGained} XP</span>
        <span className="text-sys text-2xl">+1 {STAT_LABEL[overlay.quest.stat].toUpperCase()}</span>
      </motion.div>
      <p className="mt-6 font-mono text-xs text-sys-dim">tap to continue</p>
    </div>
  );
}

function LevelUp({ overlay, reduce }: { overlay: Extract<Overlay, { kind: 'levelup' }>; reduce: boolean }) {
  return (
    <div className="relative grid place-items-center">
      {!reduce && <div className="gold-burst" aria-hidden />}
      <div className="sys-window sys-window--gold relative max-w-md text-center">
        <motion.div className="flex justify-center" {...pop(reduce)}>
          <SystemEye size={56} mood="proud" />
        </motion.div>
        <motion.h2 className="levelup-title mt-3" {...pop(reduce, 0.1)}>
          LEVEL UP
        </motion.h2>
        <motion.div className="mt-6 flex items-center justify-center gap-5" {...pop(reduce, 0.3)}>
          <RankBadge rank={overlay.fromRank} />
          <span className="font-mono text-2xl text-gold" aria-hidden>
            →
          </span>
          <RankBadge rank={overlay.toRank} size="lg" />
        </motion.div>
        <motion.p className="mt-5 font-mono text-gold" {...pop(reduce, 0.45)}>
          {overlay.toRank}-RANK · LEVEL {overlay.level}
        </motion.p>
        <p className="mt-6 font-mono text-xs text-gold/60">tap to continue</p>
      </div>
    </div>
  );
}

function Penalty({ overlay, reduce, onAck }: { overlay: Extract<Overlay, { kind: 'penalty' }>; reduce: boolean; onAck: () => void }) {
  return (
    <div className="sys-window sys-window--danger max-w-md text-center">
      <motion.div className="flex justify-center" {...pop(reduce)}>
        <SystemEye size={56} mood="alert" />
      </motion.div>
      <h2 className={`penalty-title mt-3 ${reduce ? '' : 'glitch'}`} data-text="[PENALTY ZONE]">
        [PENALTY ZONE]
      </h2>
      <p className="mt-4 text-danger-text">{overlay.reason}</p>
      <p className="mt-2 font-mono text-xs text-danger-text/70">A harder quest has been added to tomorrow.</p>
      <button type="button" className="sys-button sys-button--danger mt-6" onClick={onAck} autoFocus>
        ACKNOWLEDGE
      </button>
    </div>
  );
}
