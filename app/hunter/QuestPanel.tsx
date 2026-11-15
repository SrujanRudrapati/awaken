'use client';
/** The active phone quest: big rep counter, progress bar, rejection flash, start buttons. Presentational. */
import { motion } from 'framer-motion';
import type { Quest } from '../../lib/schemas';
import { PHONE_QUEST_TYPES, type PhoneQuestType } from './api';

const TYPE_LABEL: Record<PhoneQuestType, string> = {
  squat: 'Squats',
  pushup: 'Push-ups',
  jumpingjack: 'Jumping jacks',
  situp: 'Sit-ups',
};

interface QuestPanelProps {
  quest: Quest | null;
  isFocused: boolean;
  rejection: string | null;
  isBusy: boolean;
  onFocus: (questId: string) => void;
  onStartType: (type: PhoneQuestType) => void;
}

const panel = 'rounded-2xl border border-[#38BDF8]/40 bg-white/[0.03] p-5 shadow-[0_0_30px_rgba(56,189,248,0.15)] backdrop-blur';
const actionButton =
  'w-full rounded-xl border border-[#38BDF8] bg-[#38BDF8]/10 py-4 font-mono text-lg tracking-widest text-[#38BDF8] active:scale-[0.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]';

export function QuestPanel({ quest, isFocused, rejection, isBusy, onFocus, onStartType }: QuestPanelProps) {
  if (!quest) {
    return (
      <section className={panel} aria-labelledby="no-quest">
        <p id="no-quest" className="font-mono text-sm tracking-[0.25em] text-[#38BDF8]">[NO ACTIVE VOW]</p>
        <p className="mt-2 text-white/70">Choose training. The armband will count your reps.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {PHONE_QUEST_TYPES.map((type) => (
            <button key={type} type="button" disabled={isBusy} className={actionButton} onClick={() => onStartType(type)}>
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const isEmergency = quest.kind === 'emergency';
  const pct = Math.min(100, Math.round((quest.progress / quest.target) * 100));
  const header = isEmergency ? '[URGENT VOW]' : quest.kind === 'penalty' ? '[RECKONING VOW]' : quest.kind === 'daily' ? "[TODAY'S VOW]" : '[VOW]';
  const accent = isEmergency || quest.kind === 'penalty' ? 'text-[#EF4444]' : 'text-[#38BDF8]';

  return (
    <section className={panel} aria-labelledby="quest-title">
      <p className={`font-mono text-sm tracking-[0.25em] ${accent}`}>{header}</p>
      <h2 id="quest-title" className="mt-2 text-2xl font-semibold text-white">{quest.title}</h2>

      <div className="mt-6 flex items-baseline justify-center gap-3" aria-live="polite">
        <motion.span
          key={quest.progress}
          className="font-mono text-[7rem] leading-none font-bold text-white drop-shadow-[0_0_20px_rgba(56,189,248,0.7)]"
          initial={{ scale: 1.25, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          {quest.progress}
        </motion.span>
        <span className="font-mono text-3xl text-white/50">/ {quest.target}</span>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <motion.div className="h-full origin-left bg-[#38BDF8]" initial={false} animate={{ scaleX: pct / 100 }} style={{ width: '100%' }} />
      </div>
      <p className="mt-2 text-right font-mono text-sm text-[#FBBF24]">+{quest.xp} XP</p>

      <p className="mt-3 min-h-7 text-center font-mono text-lg text-[#EF4444]" aria-live="assertive">
        {rejection ? `✕ ${rejection.toUpperCase()}` : ''}
      </p>

      {!isFocused && (
        <button type="button" disabled={isBusy} className={`${actionButton} mt-2`} onClick={() => onFocus(quest.id)}>
          COUNT ON THIS PHONE ▸
        </button>
      )}
    </section>
  );
}
