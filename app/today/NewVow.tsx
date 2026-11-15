'use client';
/** Swear a new vow: quick chips for sensor vows; reading and photo vows ask for one line first. */
import { useState } from 'react';
import type { NewVow as NewVowInput } from '../../components/oath/api';

const CHIPS: readonly { key: string; label: string; vow: NewVowInput; ask?: { field: 'topic' | 'title'; prompt: string } }[] = [
  { key: 'pushup', label: 'Push-ups', vow: { type: 'pushup' } },
  { key: 'squat', label: 'Squats', vow: { type: 'squat' } },
  { key: 'jail', label: 'Phone lock', vow: { type: 'jail' } },
  { key: 'meditate', label: 'Stillness', vow: { type: 'meditate' } },
  { key: 'read', label: 'Read', vow: { type: 'read' }, ask: { field: 'topic', prompt: 'What will you read? (book, chapter)' } },
  { key: 'photo', label: 'Photo proof', vow: { type: 'photo' }, ask: { field: 'title', prompt: 'What will you prove? (e.g. Make your bed)' } },
];

interface NewVowProps {
  isBusy: boolean;
  onSwear: (vow: NewVowInput) => void;
  onUrgent: () => void;
}

export function NewVow({ isBusy, onSwear, onUrgent }: NewVowProps) {
  const [askingKey, setAskingKey] = useState<string | null>(null);
  const asking = CHIPS.find((chip) => chip.key === askingKey);

  const handleDetail = (form: FormData): void => {
    const text = String(form.get('detail') ?? '').trim();
    if (!asking?.ask || !text) return;
    onSwear({ ...asking.vow, [asking.ask.field]: text });
    setAskingKey(null);
  };

  return (
    <section className="newvow" aria-labelledby="newvow-title">
      <h2 id="newvow-title" className="mono mute">Swear a new vow</h2>
      <div className="newvow-chips">
        {CHIPS.map((chip) => (
          <button
            key={chip.key} type="button" disabled={isBusy} className="chip mono focusable" aria-pressed={chip.key === askingKey}
            onClick={() => (chip.ask ? setAskingKey(chip.key === askingKey ? null : chip.key) : onSwear(chip.vow))}
          >
            {chip.label}
          </button>
        ))}
        <button type="button" disabled={isBusy} className="chip chip-urgent mono focusable" onClick={onUrgent}>Urgent · 30 s</button>
      </div>
      {asking?.ask && (
        <form action={handleDetail} className="newvow-detail">
          <label htmlFor="newvow-detail" className="sr-only">{asking.ask.prompt}</label>
          <input id="newvow-detail" name="detail" required maxLength={80} placeholder={asking.ask.prompt} className="field glass focusable" autoFocus />
          <button type="submit" disabled={isBusy} className="btn btn-quiet mono"><i className="dot" />Swear it</button>
        </form>
      )}
    </section>
  );
}
