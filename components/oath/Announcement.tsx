'use client';
/** Full-screen glass announcement from Iris (vow kept, Ascension, the Reckoning). Tap anywhere to close. */
import { AnimatePresence, motion } from 'framer-motion';

export type AnnouncementTone = 'blue' | 'gold' | 'red';

export interface AnnouncementMessage {
  id: number;
  tone: AnnouncementTone;
  header: string;
  title: string;
  detail?: string;
}

interface AnnouncementProps {
  message: AnnouncementMessage | null;
  onDismiss: () => void;
}

export function Announcement({ message, onDismiss }: AnnouncementProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.button
          key={message.id}
          type="button"
          onClick={onDismiss}
          aria-live="assertive"
          className="announce"
          data-tone={message.tone}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.span
            className="announce-card glass"
            initial={{ scale: 0.86, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 20 }}
          >
            <span className="mono accent">{message.header}</span>
            <span className="announce-title">{message.title}</span>
            {message.detail && <span className="announce-detail">{message.detail}</span>}
            <span className="mono mute">Tap to close</span>
          </motion.span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
