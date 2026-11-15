'use client';
/** The signed-in person and their vows, loaded over REST and kept fresh by the caller's stream handler. */
import { useCallback, useEffect, useState } from 'react';
import { fetchPlayerQuests } from '../../app/hunter/api';
import type { Player, Quest } from '../../lib/schemas';
import { rememberId, rememberedId } from './identity';

const UNREACHABLE = 'Could not reach Iris';

export interface PersonState {
  personId: string | null;
  /** False until the browser-only identity has been read. */
  isReady: boolean;
  person: Player | null;
  quests: Quest[];
  setQuests: React.Dispatch<React.SetStateAction<Quest[]>>;
  error: string | null;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
  signIn: (id: string) => void;
}

export function usePerson(): PersonState {
  const [personId, setPersonId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [person, setPerson] = useState<Player | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPersonId(rememberedId()); // eslint-disable-line react-hooks/set-state-in-effect -- reads browser-only state after hydration
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!personId) return;
    let isCurrent = true;
    fetchPlayerQuests(personId)
      .then((data) => {
        if (!isCurrent) return;
        setPerson(data.player);
        setQuests(data.quests);
        setError(null);
      })
      .catch((e: unknown) => {
        if (isCurrent) setError(e instanceof Error ? e.message : UNREACHABLE);
      });
    return () => {
      isCurrent = false;
    };
  }, [personId]);

  const refresh = useCallback(async () => {
    if (!personId) return;
    try {
      const data = await fetchPlayerQuests(personId);
      setPerson(data.player);
      setQuests(data.quests);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : UNREACHABLE);
    }
  }, [personId]);

  const signIn = useCallback((id: string) => {
    rememberId(id);
    setPersonId(id);
  }, []);

  return { personId, isReady, person, quests, setQuests, error, setError, refresh, signIn };
}
