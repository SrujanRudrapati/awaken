'use client';
/** Full-screen System announcement (level-up gold, quest complete blue, penalty red). Tap to dismiss. */
import { AnimatePresence, motion } from 'framer-motion';

export type OverlayTone = 'gold' | 'blue' | 'red';

export interface OverlayMessage {
  id: number;
  tone: OverlayTone;
  header: string;
  title: string;
  detail?: string;
}

const TONE: Record<OverlayTone, string> = {
  gold: 'border-[#FBBF24] text-[#FBBF24] shadow-[0_0_60px_rgba(251,191,36,0.45)]',
  blue: 'border-[#38BDF8] text-[#38BDF8] shadow-[0_0_60px_rgba(56,189,248,0.45)]',
  red: 'border-[#EF4444] text-[#EF4444] shadow-[0_0_60px_rgba(239,68,68,0.5)]',
};

interface SystemOverlayProps {
  message: OverlayMessage | null;
  onDismiss: () => void;
}

export function SystemOverlay({ message, onDismiss }: SystemOverlayProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.button
          key={message.id}
          type="button"
          onClick={onDismiss}
          aria-live="assertive"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070D]/85 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={`w-full max-w-sm rounded-2xl border-2 bg-[#05070D]/90 px-6 py-10 text-center ${TONE[message.tone]}`}
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          >
            <p className="font-mono text-sm tracking-[0.3em]">{message.header}</p>
            <p className="mt-4 text-4xl font-bold uppercase text-white">{message.title}</p>
            {message.detail && <p className="mt-3 text-lg text-white/80">{message.detail}</p>}
            <p className="mt-8 font-mono text-xs text-white/40">tap to close</p>
          </motion.div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
