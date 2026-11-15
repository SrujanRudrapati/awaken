/**
 * Which players are disposable test/demo players. Only ids starting with `demo-`, `demo_`,
 * `test-` or `test_` (any case) qualify — `npm run demo:reset` deletes nothing else.
 * The same pattern is used in JS and as a Postgres `~*` regex, so both sides always agree.
 */
export const DEMO_PLAYER_ID_PATTERN = '^(demo|test)[-_]';

const demoIdRegex = new RegExp(DEMO_PLAYER_ID_PATTERN, 'i');

export function isDemoPlayerId(id: string): boolean {
  return demoIdRegex.test(id);
}
