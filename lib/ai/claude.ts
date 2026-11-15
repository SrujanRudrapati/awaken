/**
 * Claude calls. Bedrock (Converse) first when the model has a Bedrock id configured
 * (BEDROCK_MODEL_HAIKU / BEDROCK_MODEL_OPUS) and AWS is set up; on any Bedrock failure the
 * same request goes to the Anthropic API with whatever time is left. Every function resolves
 * to null on failure so callers always have a canned fallback. Fable models are refused.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { awsRegion, hasAwsCredentials, logAwsFailure } from '../aws/config';
import { HAIKU, OPUS, isFable } from '../models';

export const LLM_TIMEOUT_MS = 8_000;
/** Below this, a fallback call can't finish in time — don't start it. */
const MIN_FALLBACK_MS = 1_000;
const DEFAULT_MAX_TOKENS = 1_024;

type Effort = 'low' | 'medium' | 'high';

export interface ClaudeRequest {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** Haiku/Opus 5.5 default to medium; short lines want low. (Anthropic API only.) */
  effort?: Effort;
  timeoutMs?: number;
}

const globalForClaude = globalThis as typeof globalThis & { __awakenAnthropic?: Anthropic; __awakenBedrock?: BedrockRuntimeClient };

function anthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  globalForClaude.__awakenAnthropic ??= new Anthropic({ maxRetries: 0 });
  return globalForClaude.__awakenAnthropic;
}

function bedrock(): BedrockRuntimeClient {
  globalForClaude.__awakenBedrock ??= new BedrockRuntimeClient({ region: awsRegion() ?? undefined, maxAttempts: 1 });
  return globalForClaude.__awakenBedrock;
}

/** The Bedrock model id (or inference profile) for one of our Claude models, if configured. */
export function bedrockModelFor(model: string): string | null {
  const id = model === OPUS ? process.env.BEDROCK_MODEL_OPUS : model === HAIKU ? process.env.BEDROCK_MODEL_HAIKU : undefined;
  if (!id || !hasAwsCredentials()) return null;
  if (isFable(id)) {
    console.error(`[llm] refusing Fable model on Bedrock (${id})`);
    return null;
  }
  return id;
}

function logFailure(provider: string, error: unknown): void {
  if (error instanceof Anthropic.APIError) {
    console.error(`[llm] ${provider} API error ${error.status ?? ''}: ${error.message}`);
    return;
  }
  console.error(`[llm] ${provider} failed:`, error instanceof Error ? error.message : error);
}

interface Budget {
  remaining: () => number;
}

function budget(timeoutMs = LLM_TIMEOUT_MS): Budget {
  const deadline = Date.now() + timeoutMs;
  return { remaining: () => deadline - Date.now() };
}

// ── Bedrock ─────────────────────────────────────────────────────────────────

async function bedrockText(modelId: string, req: ClaudeRequest, system: string, time: Budget): Promise<string | null> {
  try {
    const response = await bedrock().send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text: req.prompt }] }],
        inferenceConfig: { maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS },
      }),
      { abortSignal: AbortSignal.timeout(Math.max(time.remaining(), 1)) },
    );
    if (response.stopReason !== 'end_turn' && response.stopReason !== 'stop_sequence') return null;
    const text = (response.output?.message?.content ?? []).map((block) => block.text ?? '').join('').trim();
    return text || null;
  } catch (error) {
    logAwsFailure('bedrock', error);
    return null;
  }
}

/** Pulls the outermost JSON object out of a model reply (tolerates code fences / stray prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function jsonInstructions(schema: z.ZodType): string {
  try {
    return `\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
  } catch {
    return '\n\nRespond with ONLY a JSON object (no prose, no code fences).';
  }
}

// ── Anthropic API ───────────────────────────────────────────────────────────

function requestBody(req: ClaudeRequest, model: string) {
  return {
    model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: req.system,
    output_config: { effort: req.effort ?? 'low' },
    messages: [{ role: 'user' as const, content: req.prompt }],
  };
}

async function anthropicText(req: ClaudeRequest, model: string, time: Budget): Promise<string | null> {
  const client = anthropic();
  if (!client || time.remaining() < MIN_FALLBACK_MS) return null;
  try {
    const response = await client.messages.create(requestBody(req, model), { timeout: time.remaining() });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text || null;
  } catch (error) {
    logFailure('claude', error);
    return null;
  }
}

async function anthropicJson<T>(req: ClaudeRequest, model: string, schema: z.ZodType<T>, time: Budget): Promise<T | null> {
  const client = anthropic();
  if (!client || time.remaining() < MIN_FALLBACK_MS) return null;
  try {
    const response = await client.messages.parse(
      { ...requestBody(req, model), output_config: { effort: req.effort ?? 'low', format: zodOutputFormat(schema) } },
      { timeout: time.remaining() },
    );
    if (response.stop_reason === 'refusal') return null;
    const checked = schema.safeParse(response.parsed_output);
    return checked.success ? checked.data : null;
  } catch (error) {
    logFailure('claude', error);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

function resolveModel(req: ClaudeRequest): string | null {
  const model = req.model ?? HAIKU;
  if (!isFable(model)) return model;
  console.error(`[llm] refusing Fable model at runtime (${model})`);
  return null;
}

/** Plain text from Claude (Bedrock, then Anthropic API), or null. */
export async function claude(req: ClaudeRequest): Promise<string | null> {
  const model = resolveModel(req);
  if (!model) return null;
  const time = budget(req.timeoutMs);
  const bedrockId = bedrockModelFor(model);
  const viaBedrock = bedrockId ? await bedrockText(bedrockId, req, req.system, time) : null;
  return viaBedrock ?? anthropicText(req, model, time);
}

/** Schema-validated JSON from Claude (Bedrock, then Anthropic structured outputs), or null. */
export async function claudeJson<T>(req: ClaudeRequest, schema: z.ZodType<T>): Promise<T | null> {
  const model = resolveModel(req);
  if (!model) return null;
  const time = budget(req.timeoutMs);
  const bedrockId = bedrockModelFor(model);
  if (bedrockId) {
    const text = await bedrockText(bedrockId, req, req.system + jsonInstructions(schema), time);
    const checked = schema.safeParse(text ? extractJson(text) : null);
    if (checked.success) return checked.data;
  }
  return anthropicJson(req, model, schema, time);
}

/** Test hook. */
export function resetClaude(): void {
  globalForClaude.__awakenAnthropic = undefined;
  globalForClaude.__awakenBedrock = undefined;
}
