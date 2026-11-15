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
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

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
      const mood = moodFor(event); // same value the server sends as event.irisMood
      if (mood !== 'watching' || event.type === 'voice') {
        // ordinary events (rep, quest.update…) must not calm a furious or proud Iris
        setEventMood(mood);
        if (moodTimer.current) clearTimeout(moodTimer.current);
        moodTimer.current = setTimeout(() => setEventMood(null), MOOD_HOLD_MS);
      }
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

  // Browsers keep audio and speech locked until a tap: prime both on the first one, on any screen.
  useEffect(() => {
    const prime = (): void => {
      try {
        const silent = new Audio(SILENT_WAV);
        silent.volume = 0;
        void silent.play().catch(() => undefined);
        if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      } catch {
        // no audio on this device: captions still show
      }
    };
    window.addEventListener('pointerdown', prime, { once: true });
    return () => window.removeEventListener('pointerdown', prime);
  }, []);

  useEffect(
    () => () => {
      if (moodTimer.current) clearTimeout(moodTimer.current);
      if (speakTimer.current) clearTimeout(speakTimer.current);
    },
    [],
  );

  return { mood: eventMood ?? restMood, caption, isSpeaking, isConnected };
}
