/**
 * Thin, failure-proof LLM calls. Every function resolves to null on any failure (no key,
 * timeout, refusal, bad JSON) so callers always have a canned fallback — the demo must
 * survive Wi-Fi going down. Default timeout 8 s, no retries (a late voice line is useless).
 *
 * Claude: Anthropic API (@anthropic-ai/sdk). Bedrock is not wired yet (needs a new dependency).
 * Gemini: @google/genai.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GoogleGenAI } from '@google/genai';
import type { z } from 'zod';
import { HAIKU, geminiModel } from './models';

export const LLM_TIMEOUT_MS = 8_000;

type Effort = 'low' | 'medium' | 'high';

export interface ClaudeRequest {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** Haiku/Opus 5.5 default to medium; short lines want low. */
  effort?: Effort;
  timeoutMs?: number;
}

const globalForLlm = globalThis as typeof globalThis & { __awakenAnthropic?: Anthropic; __awakenGemini?: GoogleGenAI };

function anthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  globalForLlm.__awakenAnthropic ??= new Anthropic({ maxRetries: 0 });
  return globalForLlm.__awakenAnthropic;
}

function genai(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  globalForLlm.__awakenGemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return globalForLlm.__awakenGemini;
}

function logFailure(provider: string, error: unknown): void {
  if (error instanceof Anthropic.APIError) {
    console.error(`[llm] ${provider} API error ${error.status ?? ''}: ${error.message}`);
    return;
  }
  console.error(`[llm] ${provider} failed:`, error instanceof Error ? error.message : error);
}

function requestBody(req: ClaudeRequest) {
  return {
    model: req.model ?? HAIKU,
    max_tokens: req.maxTokens ?? 1_024,
    system: req.system,
    output_config: { effort: req.effort ?? 'low' },
    messages: [{ role: 'user' as const, content: req.prompt }],
  };
}

/** Plain text from Claude, or null. */
export async function claude(req: ClaudeRequest): Promise<string | null> {
  const client = anthropic();
  if (!client) return null;
  try {
    const response = await client.messages.create(requestBody(req), { timeout: req.timeoutMs ?? LLM_TIMEOUT_MS });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    return text || null;
  } catch (error) {
    logFailure('claude', error);
    return null;
  }
}

/** Schema-validated JSON from Claude (structured outputs), or null. */
export async function claudeJson<T>(req: ClaudeRequest, schema: z.ZodType<T>): Promise<T | null> {
  const client = anthropic();
  if (!client) return null;
  try {
    const response = await client.messages.parse(
      { ...requestBody(req), output_config: { effort: req.effort ?? 'low', format: zodOutputFormat(schema) } },
      { timeout: req.timeoutMs ?? LLM_TIMEOUT_MS },
    );
    if (response.stop_reason === 'refusal') return null;
    const checked = schema.safeParse(response.parsed_output);
    return checked.success ? checked.data : null;
  } catch (error) {
    logFailure('claude', error);
    return null;
  }
}

export interface GeminiRequest {
  prompt: string;
  system?: string;
  model?: string;
  /** Inline images (photo proof). */
  images?: readonly { mimeType: string; base64: string }[];
  timeoutMs?: number;
}

async function geminiText(req: GeminiRequest, json: boolean): Promise<string | null> {
  const client = genai();
  if (!client) return null;
  const parts = [
    ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
    { text: req.prompt },
  ];
  try {
    const response = await client.models.generateContent({
      model: req.model ?? geminiModel(),
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: req.system,
        responseMimeType: json ? 'application/json' : undefined,
        abortSignal: AbortSignal.timeout(req.timeoutMs ?? LLM_TIMEOUT_MS),
      },
    });
    return response.text?.trim() || null;
  } catch (error) {
    logFailure('gemini', error);
    return null;
  }
}

export function gemini(req: GeminiRequest): Promise<string | null> {
  return geminiText(req, false);
}

/** JSON from Gemini validated by `schema`, or null. */
export async function geminiJson<T>(req: GeminiRequest, schema: z.ZodType<T>): Promise<T | null> {
  const text = await geminiText(req, true);
  if (!text) return null;
  try {
    const checked = schema.safeParse(JSON.parse(text));
    return checked.success ? checked.data : null;
  } catch {
    return null;
  }
}
