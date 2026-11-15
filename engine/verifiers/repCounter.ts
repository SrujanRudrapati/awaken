/**
 * Picks the phone/Watch rep counter for an exercise: jumping jacks are a one-sided arm/leg swing
 * (jackReps.ts); squats, sit-ups and arm push-ups are vertical travel (accelReps.ts).
 */
import { AccelRepCounter, type AccelExercise } from './accelReps';
import { JackRepCounter } from './jackReps';
import type { RepDebug } from './repDebug';
import type { Verifier } from './types';

export interface RepCounter extends Verifier {
  readonly count: number;
  readonly isCalibrated: boolean;
  readonly debugState: RepDebug;
}

export function createRepCounter(exercise: AccelExercise): RepCounter {
  return exercise === 'jumpingjack' ? new JackRepCounter() : new AccelRepCounter(exercise);
}
