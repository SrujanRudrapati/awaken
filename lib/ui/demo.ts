/**
 * DEMO MODE — keyboard backup for when a sensor fails on stage (CLAUDE.md rule).
 * Builds synthetic events that are fed to the LOCAL reducer only; nothing is sent
 * to the backend, and the UI shows a DEMO badge as soon as one is used.
 *
 *   R rep · X rejected rep · C complete quest · L level up · P penalty · V voice line
 */
import type { Quest, StreamEvent } from '../schemas';
import { nextRank } from './ranks';
import { activeQuest, type UiState } from './state';

export const DEMO_KEYS: Record<string, string> = {
  r: 'Count a rep',
  x: 'Reject a half-rep',
  c: 'Complete quest',
  l: 'Level up',
  p: 'Penalty Zone',
  v: 'System voice line',
};

const DEMO_PLAYER = 'demo';
const DEMO_LINES = [
  'You have been chosen. Do not disappoint the System.',
  'Weakness detected. Correct it.',
  'Acceptable. Barely.',
  'The System is watching your form.',
];

function demoQuest(state: UiState): Quest {
  return {
    id: `demo-pushup-${state.seq}`,
    playerId: DEMO_PLAYER,
    stat: 'STR',
    title: '[DEMO] Emergency Quest: 10 push-ups',
    type: 'pushup',
    target: 10,
    progress: 0,
    xp: 60,
    status: 'active',
    deadline: '2099-01-01T00:00:00.000Z',
  };
}

function runningQuest(state: UiState): Quest {
  const q = activeQuest(state);
  return q && q.status === 'active' ? q : demoQuest(state);
}

export function demoEvents(key: string, state: UiState): StreamEvent[] {
  switch (key.toLowerCase()) {
    case 'r': {
      const q = runningQuest(state);
      const progress = Math.min(q.target, q.progress + 1);
      const quest: Quest = { ...q, progress };
      const events: StreamEvent[] = [
        { type: 'rep', playerId: q.playerId, questId: q.id, count: progress },
        { type: 'quest.update', quest },
      ];
      if (progress >= q.target) {
        events.push({ type: 'quest.complete', quest: { ...quest, status: 'done' }, xpGained: q.xp });
      }
      return events;
    }
    case 'x': {
      const q = runningQuest(state);
      return [
        ...(state.quests[q.id] ? [] : [{ type: 'quest.update', quest: q } as const]),
        { type: 'rep.rejected', playerId: q.playerId, questId: q.id, reason: 'Not deep enough' },
      ];
    }
    case 'c': {
      const q = runningQuest(state);
      return [
        {
          type: 'quest.complete',
          quest: { ...q, progress: q.target, status: 'done' },
          xpGained: q.xp,
        },
      ];
    }
    case 'l': {
      const to = nextRank(state.rank);
      if (!to) return [];
      return [
        { type: 'levelup', playerId: DEMO_PLAYER, fromRank: state.rank, toRank: to, level: state.level + 1 },
      ];
    }
    case 'p': {
      const q = activeQuest(state);
      return [
        {
          type: 'penalty',
          playerId: DEMO_PLAYER,
          ...(q ? { questId: q.id } : {}),
          reason: 'Daily quest abandoned. Penalty Zone engaged.',
        },
      ];
    }
    case 'v':
      return [
        {
          type: 'voice',
          text: DEMO_LINES[state.seq % DEMO_LINES.length],
          eventType: 'demo',
          playerId: DEMO_PLAYER,
        },
      ];
    default:
      return [];
  }
}
