/**
 * TODO(backend): sample data for screens whose API isn't built yet.
 * Swap each `get*` for a fetch once the route exists; the shapes match SPEC §3.
 */
import type { Rank } from '../schemas';

export interface HunterRow {
  name: string;
  rank: Rank;
  level: number;
  xp: number;
}

/** SPEC §3 TinyFish Gate: `{title, date, location, url, rank}`. */
export interface Gate {
  title: string;
  date: string;
  location: string;
  url: string | null;
  rank: Rank;
}

const SAMPLE_HUNTERS: HunterRow[] = [
  { name: 'Nightowl', rank: 'C', level: 9, xp: 420 },
  { name: 'Ironside', rank: 'D', level: 6, xp: 260 },
  { name: 'Quietstorm', rank: 'D', level: 4, xp: 140 },
  { name: 'Pixel', rank: 'E', level: 2, xp: 60 },
];

const SAMPLE_GATES: Gate[] = [
  { title: 'Campus sunrise 5K', date: 'Sat · 7:00 AM', location: 'Main campus track', url: null, rank: 'C' },
  { title: 'Hackers’ board-game night', date: 'Sat · 8:00 PM', location: 'Student union, room 2', url: null, rank: 'E' },
  { title: 'Mountain trail hike', date: 'Sun · 6:30 AM', location: 'Trailhead parking lot', url: null, rank: 'B' },
  { title: 'Intro to climbing clinic', date: 'Sun · 3:00 PM', location: 'Rec center wall', url: null, rank: 'D' },
];

/** TODO(backend): GET /api/leaderboard. */
export function getLeaderboard(): HunterRow[] {
  return SAMPLE_HUNTERS;
}

/** TODO(backend): GET /api/gates (TinyFish). */
export function getGates(): Gate[] {
  return SAMPLE_GATES;
}
