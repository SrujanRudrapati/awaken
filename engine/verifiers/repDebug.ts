/** A rep counter's live state, for the /hunter ?debug=1 tuning line. Not used for verification. */
export interface RepDebug {
  calibrated: boolean;
  /** Current excursion as a fraction of the calibrated depth (raw proxy before calibration). */
  progress: number;
  /** Calibrated depth in the counter's own unit (m proxy for vertical reps, chord for jacks). */
  depth?: number;
  /** Latest |rotationRate|, deg/s (when the source sends it). */
  rotDps?: number;
  /** Most recent rejection reason. */
  lastReason?: string;
}
