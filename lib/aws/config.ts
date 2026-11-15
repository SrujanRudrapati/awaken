/**
 * AWS is optional everywhere: every AWS-backed feature checks these first and falls back
 * (local disk, browser speech, Anthropic API) so the demo never depends on AWS being set up.
 * Credentials come from the SDK's default chain; we only gate on the env so a missing setup
 * never makes the SDK probe instance metadata (slow) during a demo.
 */
export function awsRegion(): string | null {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || null;
}

export function hasAwsCredentials(): boolean {
  const keys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  return Boolean(awsRegion()) && (keys || Boolean(process.env.AWS_PROFILE));
}

/** Logs one line per failure; never includes credentials. */
export function logAwsFailure(service: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[aws] ${service} failed (${name}): ${message}`);
}
