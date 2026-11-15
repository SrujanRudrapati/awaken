'use client';
/**
 * Holds the one SSE connection, the UI reducer, sounds and DEMO MODE keys,
 * and exposes them to every screen through context.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import type { StreamEvent } from '../lib/schemas';
import { DEMO_KEYS, demoEvents } from '../lib/ui/demo';
import { play, speak, unlockAudio } from '../lib/ui/sound';
import { initialState, reduce, type UiAction, type UiState } from '../lib/ui/state';
import { useStream, type StreamStatus } from '../lib/ui/useStream';

const NAME_KEY = 'awaken.playerName';
const SOUND_KEY = 'awaken.sound';

interface SystemContextValue {
  state: UiState;
  dispatch: (action: UiAction) => void;
  status: StreamStatus;
  sound: boolean;
  toggleSound: () => void;
  setName: (name: string | null) => void;
}

const SystemContext = createContext<SystemContextValue | null>(null);

export function useSystem(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used inside <SystemProvider>');
  return ctx;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the session still works, it just won't persist
  }
}

// Sound preference lives in localStorage; read it as an external store so SSR renders "on".
const soundListeners = new Set<() => void>();
function subscribeSound(fn: () => void): () => void {
  soundListeners.add(fn);
  return () => soundListeners.delete(fn);
}
const readSound = () => readStorage(SOUND_KEY) !== 'off';
function writeSound(on: boolean): void {
  writeStorage(SOUND_KEY, on ? 'on' : 'off');
  soundListeners.forEach((fn) => fn());
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function SystemProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reduce, null, () => initialState());
  const sound = useSyncExternalStore(subscribeSound, readSound, () => true);
  const stateRef = useRef(state);
  const soundRef = useRef(sound);

  useEffect(() => {
    stateRef.current = state;
    soundRef.current = sound;
  });

  // Restore the saved player name after hydration.
  useEffect(() => {
    const name = readStorage(NAME_KEY);
    if (name) dispatch({ type: 'setName', name });
  }, []);

  const handle = useCallback((event: StreamEvent, demo = false) => {
    dispatch({ type: 'event', event, demo });
    if (!soundRef.current) return;
    switch (event.type) {
      case 'rep':
        play('tick');
        break;
      case 'rep.rejected':
        play('reject');
        break;
      case 'quest.complete':
        play('chime');
        break;
      case 'levelup':
        play('levelup');
        break;
      case 'penalty':
        play('alarm');
        break;
      case 'voice':
        speak(event.text);
        break;
    }
  }, []);

  const status = useStream(handle);

  // Audio unlock on first gesture + DEMO MODE keys.
  useEffect(() => {
    const onGesture = () => unlockAudio();
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key === 'Escape') {
        // Escape on the Penalty Zone counts as ACKNOWLEDGE, same as the button.
        if (stateRef.current.overlays[0]?.kind === 'penalty') dispatch({ type: 'clearPenalty' });
        dispatch({ type: 'dismissOverlay' });
        return;
      }
      const key = e.key.toLowerCase();
      if (!(key in DEMO_KEYS)) return;
      for (const event of demoEvents(key, stateRef.current)) handle(event, true);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onKey);
    };
  }, [handle]);

  const toggleSound = useCallback(() => {
    const on = readSound();
    if (on) window.speechSynthesis?.cancel();
    writeSound(!on);
  }, []);

  const setName = useCallback((name: string | null) => {
    writeStorage(NAME_KEY, name);
    dispatch({ type: 'setName', name });
  }, []);

  const value = useMemo(
    () => ({ state, dispatch, status, sound, toggleSound, setName }),
    [state, status, sound, toggleSound, setName],
  );

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}
