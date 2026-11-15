'use client';
/**
 * Iris on every screen: subscribes to the live stream (SSE + polling fallback), keeps her mood and
 * latest line, voices every `voice` event with playVoice, and hands the person's own events on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSystemStream } from '../../app/hunter/useSystemStream';
import { moodFor, type IrisMood } from '../../lib/irisMood';
import type { StreamEvent } from '../../lib/schemas';
import { playVoice } from '../../lib/voicePlayback';
import { isForPerson } from './events';

const MOOD_HOLD_MS = 8_000;
const SPEAK_MS = 2_600;

export interface IrisState {
  mood: IrisMood;
  caption: string | null;
  isSpeaking: boolean;
  isConnected: boolean;
}

export function useIris(personId: string | null, onEvent?: (event: StreamEvent) => void, restMood: IrisMood = 'watching'): IrisState {
  const [eventMood, setEventMood] = useState<IrisMood | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handle = useCallback(
    (event: StreamEvent) => {
      if (!isForPerson(event, personId)) return;
      setEventMood(moodFor(event)); // same value the server sends as event.irisMood
      if (moodTimer.current) clearTimeout(moodTimer.current);
      moodTimer.current = setTimeout(() => setEventMood(null), MOOD_HOLD_MS);
      if (event.type === 'voice') {
        setCaption(event.text);
        setIsSpeaking(true);
        if (speakTimer.current) clearTimeout(speakTimer.current);
        speakTimer.current = setTimeout(() => setIsSpeaking(false), SPEAK_MS);
        void playVoice(event);
      }
      onEvent?.(event);
    },
    [personId, onEvent],
  );
  const isConnected = useSystemStream(handle);

  useEffect(
    () => () => {
      if (moodTimer.current) clearTimeout(moodTimer.current);
      if (speakTimer.current) clearTimeout(speakTimer.current);
    },
    [],
  );

  return { mood: eventMood ?? restMood, caption, isSpeaking, isConnected };
}
