/**
 * Thin, failure-proof LLM calls. Every function resolves to null on any failure (no key,
 * timeout, refusal, bad JSON) so callers always have a canned fallback — the demo must
 * survive Wi-Fi going down. Default timeout 8 s, no retries (a late voice line is useless).
 *
 * Claude: lib/ai/claude.ts (Bedrock Converse, falling back to the Anthropic API) — re-exported here.
 * Gemini: @google/genai.
 */
import { GoogleGenAI } from '@google/genai';
import type { z } from 'zod';
import { LLM_TIMEOUT_MS } from './ai/claude';
import { geminiModel } from './models';

export { LLM_TIMEOUT_MS, claude, claudeJson, type ClaudeRequest } from './ai/claude';

const globalForLlm = globalThis as typeof globalThis & { __awakenGemini?: GoogleGenAI };

function genai(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  globalForLlm.__awakenGemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return globalForLlm.__awakenGemini;
}

function logFailure(provider: string, error: unknown): void {
  console.error(`[llm] ${provider} failed:`, error instanceof Error ? error.message : error);
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
