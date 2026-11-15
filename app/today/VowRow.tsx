'use client';
/** One vow on the Today screen: what it is, how far along, and the single thing you can do about it. Presentational. */
import Link from 'next/link';
import { plainTitle } from '../../components/oath/events';
import type { Quest } from '../../lib/schemas';
import { fraction, isPhoneCounted, progressLabel, proofSource, statLabel, vowAction, vowTone } from './vows';

interface VowRowProps {
  vow: Quest;
  isBusy: boolean;
  note?: string;
  onBegin: (vow: Quest) => void;
  onPhoto: (vow: Quest, photo: File) => void;
  onTrial: (vow: Quest) => void;
}

export function VowRow({ vow, isBusy, note, onBegin, onPhoto, onTrial }: VowRowProps) {
  const action = vowAction(vow);
  const isCounting = vow.sessionId !== undefined && vow.status === 'active';
  return (
    <li className="vow glass" data-tone={vowTone(vow)} data-status={vow.status}>
      <div className="vow-head mono">
        <span className="accent">{statLabel(vow)}</span>
        <span className="mute">{proofSource(vow.type)}</span>
        <span className="vow-proof">{vow.status === 'done' ? '✓ ' : '+'}{vow.xp} Proof</span>
      </div>
      <div className="vow-main">
        <div className="vow-text">
          <h3>{plainTitle(vow.title)}</h3>
          <p className="mute">{progressLabel(vow)}{vow.topic ? ` · ${vow.topic}` : ''}</p>
        </div>
        {action === 'begin' && (
          <div className="vow-actions">
            {isPhoneCounted(vow.type) && <Link href="/band" className="btn btn-quiet mono">Band ↗</Link>}
            <button type="button" className="btn btn-quiet mono vow-go" disabled={isBusy} onClick={() => onBegin(vow)}>
              <i className="dot" />{isCounting ? 'Counting' : 'Begin'}
            </button>
          </div>
        )}
        {action === 'photo' && (
          <label className="btn btn-quiet mono vow-go">
            <i className="dot" />Show proof
            <input
              type="file" accept="image/*" capture="environment" className="sr-only" disabled={isBusy}
              onChange={(event) => {
                const photo = event.target.files?.[0];
                if (photo) onPhoto(vow, photo);
                event.target.value = '';
              }}
            />
          </label>
        )}
        {(action === 'quiz' || action === 'readTrial') && (
          <button type="button" className="btn btn-quiet mono vow-go" disabled={isBusy} onClick={() => onTrial(vow)}><i className="dot" />Take the trial</button>
        )}
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction(vow) * 100)}>
        <i style={{ transform: `scaleX(${fraction(vow)})` }} />
      </div>
      {note && <p className="vow-note mono" aria-live="polite">{note}</p>}
    </li>
  );
}
