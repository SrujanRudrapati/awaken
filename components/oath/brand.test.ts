/**
 * OATH words only: no screen may show player / hunter / awaken / dungeon / shadow / arise, or the old
 * terms (quest, XP, level up, system). Scans the visible text of every UI file with a real TSX parse.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { containsBannedWord } from '../../lib/brand';

const OLD_TERMS = /\b(quests?|XP|level ?up|penalty zone|system)\b/i;
const SKIP = /(^|\/)(api|hunter)(\/|$)|\.test\.tsx?$|\.css$/;

function uiFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (SKIP.test(path)) return [];
    if (entry.isDirectory()) return uiFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** String literals, template pieces and JSX text that read as prose (has a space); class lists and imports excluded. */
function visibleText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && node.name.getText() === 'className') return;
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) texts.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  const isClassList = (t: string) => t.split(/\s+/).filter((token) => /^[a-z!]+[-:]/.test(token)).length >= 2;
  const isCode = (t: string) => /[;{}]|=>|\bvec[234]\b|\buniform\b/.test(t); // shader source, CSS snippets
  return texts.filter((t) => /[A-Za-z]/.test(t) && /\s/.test(t) && !isClassList(t) && !isCode(t));
}

describe('OATH words on every screen', () => {
  const files = [...uiFiles('app'), ...uiFiles('components')];

  test('finds the UI files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  test.each(files)('%s shows no old-brand words', (file) => {
    const offenders = visibleText(file).filter((text) => containsBannedWord(text) || OLD_TERMS.test(text));
    expect(offenders).toEqual([]);
  });
});
