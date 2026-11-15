'use client';
/** A trial from Iris: questions one at a time, graded by the server. Used by focus trials and reading vows. */
import { useState } from 'react';
import type { Trial, TrialResult } from '../../components/oath/api';

interface TrialSheetProps {
  title: string;
  trial: Trial;
  onSubmit: (answers: number[]) => Promise<TrialResult>;
  onClose: () => void;
}

export function TrialSheet({ title, trial, onSubmit, onClose }: TrialSheetProps) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const total = trial.questions.length;
  const question = trial.questions[Math.min(answers.length, total - 1)];

  const handleAnswer = async (index: number): Promise<void> => {
    const next = [...answers, index];
    if (next.length < total) {
      setAnswers(next);
      return;
    }
    setIsBusy(true);
    try {
      setResult(await onSubmit(next));
      setAnswers(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Iris');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={`Trial: ${title}`} data-tone={result ? (result.passed ? 'gold' : 'red') : undefined}>
      <div className="sheet-card glass">
        <div className="sheet-top mono">
          <span className="accent">Trial · {title}</span>
          <span className="mute">{result ? 'Judged' : `${Math.min(answers.length + 1, total)} / ${total}`}</span>
        </div>
        {result ? (
          <>
            <p className="sheet-title">{result.passed ? 'Vow kept.' : 'Vow broken.'}</p>
            <p className="lede">
              {result.correct} of {total} correct{result.late ? ', and late' : ''}.
              {result.passed && result.xpGained ? ` +${result.xpGained} Proof.` : ''}
            </p>
            <button type="button" className="btn mono" onClick={onClose}><i className="dot" />Close</button>
          </>
        ) : (
          <>
            <p className="sheet-question">{question.question}</p>
            <div className="sheet-options">
              {question.options.map((option, index) => (
                <button key={`${answers.length}-${option}`} type="button" className="sheet-option glass focusable" disabled={isBusy} onClick={() => void handleAnswer(index)}>
                  <span className="mono mute">{String.fromCharCode(65 + index)}</span>{option}
                </button>
              ))}
            </div>
            {error && <p role="alert" className="shell-error glass">{error}</p>}
            <button type="button" className="btn btn-quiet mono" onClick={onClose}>Leave the trial</button>
          </>
        )}
      </div>
    </div>
  );
}
