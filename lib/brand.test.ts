/**
 * OATH brand guard: nothing a person sees or hears may use the old vocabulary.
 * Checks real outputs (titles, canned lines, voice facts, report fallback, errors) plus the
 * visible text of the /hunter page. Identifiers (playerId, quest.*, routes) are allowed.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  getPlayer: vi.fn().mockResolvedValue(null),
  upsertPlayer: vi.fn().mockResolvedValue(undefined),
  listPlayers: vi.fn().mockResolvedValue([]),
  logEvent: vi.fn(),
}));

import { fallbackReport } from '../engine/agents/boss';
import { momentFor } from '../engine/agents/voice';
import { CANNED_LINES, sanitizeLine } from '../engine/agents/voicePersona';
import { QUEST_RULES, defaultTitle } from '../engine/progression';
import { getQuest, startQuest } from '../engine/quests';
import { BANNED_WORDS, STAT_LABELS, containsBannedWord } from './brand';
import type { Quest, QuestType } from './schemas';

const OLD_TERMS = /\b(quests?|XP|level ?up|penalty zone|system)\b/i;

function expectClean(text: string): void {
  expect(containsBannedWord(text), text).toBe(false);
}

/** Every string literal, template piece and JSX text node in a file (real parse, comments excluded). */
function visibleText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return; // module paths
    if (ts.isJsxAttribute(node) && node.name.getText() === 'className') return;
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) texts.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  const isClassList = (t: string) => t.split(/\s+/).filter((token) => /^[a-z!]+[-:]/.test(token)).length >= 2;
  // Single tokens without spaces are identifiers/keys/values ('quest.update', 'awaken.playerId'), not prose.
  return texts.filter((t) => /[A-Za-z]/.test(t) && (/\s/.test(t) || /^\[.*\]$/.test(t)) && !isClassList(t));
}

describe('OATH brand', () => {
  it('detects the banned words in any case and inflection', () => {
    for (const word of BANNED_WORDS) expect(containsBannedWord(`The ${word.toUpperCase()}s are here`)).toBe(true);
    expect(containsBannedWord('Awakening')).toBe(true);
    expect(containsBannedWord('Vow kept. Proof recorded.')).toBe(false);
  });

  it('every canned Iris line is clean, on-voice and passes the runtime filter', () => {
    for (const line of Object.values(CANNED_LINES).flat()) {
      expectClean(line);
      expect(line).not.toMatch(OLD_TERMS);
      expect(sanitizeLine(line)).toBe(line);
    }
  });

  it('every vow title and stat label is clean', () => {
    for (const type of Object.keys(QUEST_RULES) as QuestType[]) {
      const title = defaultTitle(type, 10);
      expectClean(title);
      expect(title).not.toMatch(OLD_TERMS);
    }
    expect(Object.values(STAT_LABELS)).toEqual(['Body', 'Mind', 'Focus', 'Vitality', 'Discipline', 'Presence']);
  });

  it('voice facts handed to the model use Oath vocabulary', () => {
    const quest = { id: 'q', playerId: 'p', stat: 'STR', title: 'Push-ups: 20 reps', type: 'pushup', target: 20, progress: 0, xp: 30, status: 'active', deadline: '2030-01-01T00:00:00Z' } as Quest;
    const facts = [
      momentFor({ type: 'levelup', playerId: 'p', fromRank: 'E', toRank: 'D', level: 3 }, new Set()),
      momentFor({ type: 'quest.complete', quest: { ...quest, status: 'done' }, xpGained: 30 }, new Set()),
      momentFor({ type: 'quest.update', quest: { ...quest, kind: 'daily' } }, new Set()),
      momentFor({ type: 'quest.update', quest: { ...quest, kind: 'manual' } }, new Set()),
      momentFor({ type: 'quest.update', quest: { ...quest, id: 'e', kind: 'emergency' } }, new Set()),
    ].map((m) => m?.facts ?? '');
    for (const text of facts) {
      expectClean(text);
      expect(text).not.toMatch(OLD_TERMS);
    }
  });

  it('the code-written weekly report is clean', () => {
    const report = fallbackReport({ xpByStat: { STR: 5, INT: 0, FOCUS: 0, VIT: 0, DISCIPLINE: 0, CHA: 0 }, totalXp: 5, strongest: 'STR', weakest: 'CHA', completed: 1, failed: 1, activeDays: 1 });
    for (const text of [report.title, report.verdict, report.summary, ...report.orders]) {
      expectClean(text);
      expect(text).not.toMatch(OLD_TERMS);
    }
  });

  it('engine error messages and reckoning titles are clean', async () => {
    await expect(startQuest('nobody', { type: 'pushup' })).rejects.toThrow(/No one found/);
    await expect(startQuest('nobody', { type: 'pushup' })).rejects.not.toThrow(/player/i);
    expect(getQuest('missing')).toBeUndefined();
  });

  it('/hunter shows no old-brand words', () => {
    const files = ['app/hunter/HunterClient.tsx', 'app/hunter/QuestPanel.tsx', 'app/hunter/SystemOverlay.tsx', 'app/hunter/page.tsx'];
    const texts = files.flatMap(visibleText);
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) {
      expectClean(text);
      expect(text).not.toMatch(/\b(quest|XP|level up|penalty zone|SYSTEM)\b/);
    }
  });
});
