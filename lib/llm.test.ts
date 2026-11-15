import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
const parse = vi.fn();
const generateContent = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500;
  }
  class Anthropic {
    static APIError = APIError;
    messages = { create, parse };
  }
  return { default: Anthropic };
});
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: vi.fn(() => ({ type: 'json_schema' })) }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { claude, claudeJson, geminiJson } from './llm';
import { HAIKU, geminiModel } from './models';

describe('llm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = globalThis as Record<string, unknown>;
    delete g.__awakenAnthropic;
    delete g.__awakenGemini;
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it('returns null without API keys (offline demo) and never calls out', async () => {
    expect(await claude({ system: 's', prompt: 'p' })).toBeNull();
    expect(await geminiJson({ prompt: 'p' }, z.object({}))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('calls Haiku at low effort with an 8 s timeout and joins text blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: ' Rise. ' }] });

    expect(await claude({ system: 's', prompt: 'p' })).toBe('Rise.');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: HAIKU, output_config: { effort: 'low' } }),
      { timeout: 8_000 },
    );
  });

  it('null on refusal, truncation or a thrown error', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    expect(await claude({ system: 's', prompt: 'p' })).toBeNull();
    create.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'half' }] });
    expect(await claude({ system: 's', prompt: 'p' })).toBeNull();
    create.mockRejectedValueOnce(new Error('timeout'));
    expect(await claude({ system: 's', prompt: 'p' })).toBeNull();
  });

  it('claudeJson re-validates the parsed output', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const schema = z.object({ n: z.number() });
    parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: { n: 2 } });
    expect(await claudeJson({ system: 's', prompt: 'p' }, schema)).toEqual({ n: 2 });
    parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: { n: 'two' } });
    expect(await claudeJson({ system: 's', prompt: 'p' }, schema)).toBeNull();
  });

  it('geminiJson: null on invalid JSON or schema mismatch', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const schema = z.object({ ok: z.boolean() });
    generateContent.mockResolvedValueOnce({ text: '{"ok":true}' });
    expect(await geminiJson({ prompt: 'p' }, schema)).toEqual({ ok: true });
    generateContent.mockResolvedValueOnce({ text: 'not json' });
    expect(await geminiJson({ prompt: 'p' }, schema)).toBeNull();
    generateContent.mockResolvedValueOnce({ text: '{"ok":"yes"}' });
    expect(await geminiJson({ prompt: 'p' }, schema)).toBeNull();
  });

  it('refuses a Fable model id from the environment', () => {
    process.env.GEMINI_MODEL = 'claude-fable-5-2';
    expect(() => geminiModel()).toThrow(/Fable/);
  });
});
