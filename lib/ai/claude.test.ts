import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const create = vi.fn();
const parse = vi.fn();
const converse = vi.fn();

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
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = converse;
  },
  ConverseCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { HAIKU, OPUS } from '../models';
import { bedrockModelFor, claude, claudeJson, extractJson, resetClaude } from './claude';

const ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'AKIA_TEST',
  AWS_SECRET_ACCESS_KEY: 'secret',
  BEDROCK_MODEL_HAIKU: 'us.anthropic.claude-haiku-5-5-v1:0',
  BEDROCK_MODEL_OPUS: 'us.anthropic.claude-opus-5-5-v1:0',
  ANTHROPIC_API_KEY: 'sk-test',
};
const bedrockReply = (text: string, stopReason = 'end_turn') => ({ stopReason, output: { message: { content: [{ text }] } } });
const anthropicReply = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

describe('claude via Bedrock with Anthropic fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetClaude();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
  });

  it('maps Haiku/Opus to their Bedrock ids; nothing without AWS or for unknown models', () => {
    expect(bedrockModelFor(HAIKU)).toBe(ENV.BEDROCK_MODEL_HAIKU);
    expect(bedrockModelFor(OPUS)).toBe(ENV.BEDROCK_MODEL_OPUS);
    expect(bedrockModelFor('claude-other')).toBeNull();
    delete process.env.AWS_ACCESS_KEY_ID;
    expect(bedrockModelFor(OPUS)).toBeNull();
  });

  it('uses Bedrock Converse when configured and does not touch the Anthropic API', async () => {
    converse.mockResolvedValue(bedrockReply('Rank ascension confirmed.'));

    expect(await claude({ system: 's', prompt: 'p', model: OPUS })).toBe('Rank ascension confirmed.');
    expect(converse.mock.calls[0][0].input).toMatchObject({ modelId: ENV.BEDROCK_MODEL_OPUS, system: [{ text: 's' }] });
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to the Anthropic API when Bedrock errors or is cut off', async () => {
    converse.mockRejectedValueOnce(new Error('AccessDeniedException'));
    converse.mockResolvedValueOnce(bedrockReply('half a sen', 'max_tokens'));
    create.mockResolvedValue(anthropicReply('From Anthropic.'));

    expect(await claude({ system: 's', prompt: 'p' })).toBe('From Anthropic.');
    expect(await claude({ system: 's', prompt: 'p' })).toBe('From Anthropic.');
    expect(create.mock.calls[0][0].model).toBe(HAIKU);
  });

  it('without Bedrock ids it goes straight to the Anthropic API', async () => {
    delete process.env.BEDROCK_MODEL_HAIKU;
    create.mockResolvedValue(anthropicReply('Direct.'));

    expect(await claude({ system: 's', prompt: 'p' })).toBe('Direct.');
    expect(converse).not.toHaveBeenCalled();
  });

  it('claudeJson parses Bedrock JSON (even fenced), else uses Anthropic structured outputs', async () => {
    const schema = z.object({ verdict: z.string() });
    converse.mockResolvedValueOnce(bedrockReply('```json\n{"verdict":"worthy"}\n```'));
    expect(await claudeJson({ system: 's', prompt: 'p', model: OPUS }, schema)).toEqual({ verdict: 'worthy' });
    expect(converse.mock.calls[0][0].input.system[0].text).toMatch(/JSON Schema/);

    converse.mockResolvedValueOnce(bedrockReply('not json'));
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { verdict: 'fallback' } });
    expect(await claudeJson({ system: 's', prompt: 'p', model: OPUS }, schema)).toEqual({ verdict: 'fallback' });
  });

  it('refuses Fable models everywhere — request model or Bedrock env', async () => {
    expect(await claude({ system: 's', prompt: 'p', model: 'claude-fable-5-2' })).toBeNull();
    process.env.BEDROCK_MODEL_OPUS = 'us.anthropic.claude-fable-5-2';
    expect(bedrockModelFor(OPUS)).toBeNull();
    expect(converse).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('extractJson tolerates prose around the object and rejects garbage', () => {
    expect(extractJson('Here: {"a":1} done')).toEqual({ a: 1 });
    expect(extractJson('{nope')).toBeNull();
  });
});
