/**
 * Demo reset (POST /api/demo/reset, `npm run demo:reset`): forgets matching (demo/test) people from memory —
 * players, vows, countdowns, sensor sessions, quizzes and reading trials, Calibration sessions and results,
 * wallets and baselines — and re-arms DEMO_MODE's guaranteed rank-up for the next urgent vow.
 * Tiger rows are deleted separately by db.deleteDemoPlayers.
 */
import { forgetBaselines } from '../lib/baselines';
import { forgetWallets } from '../lib/wallet';
import { forgetQuizzes } from './agents/quiz';
import { forgetReadingTrials } from './agents/readingTrial';
import { forgetCalibration } from './calibration/session';
import { armDemoRankUp, purgePlayers, questIdsOf } from './quests';

export function resetDemoState(shouldReset: (playerId: string) => boolean): { memoryPlayers: number } {
  const questIds = questIdsOf(shouldReset);
  forgetQuizzes(questIds);
  forgetReadingTrials(questIds);
  forgetCalibration(shouldReset);
  const memoryPlayers = purgePlayers(shouldReset); // also ends their vows' sensor sessions
  forgetWallets(shouldReset);
  forgetBaselines(shouldReset);
  armDemoRankUp();
  return { memoryPlayers };
}
