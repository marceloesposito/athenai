import { describe, expect, it as test } from 'vitest';
import { it } from './it';
import { en } from './en';
import { glossaryViolations } from './glossary';

describe('dizionari', () => {
  test('stesse chiavi in italiano e in inglese', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
  });
  test('stesse variabili {x} nelle due lingue', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(en)) expect(vars(it[k]), k).toBe(vars(en[k]));
  });
  test('i nomi degli spazi non si traducono', () => {
    expect(glossaryViolations(en, it)).toEqual([]);
    expect(glossaryViolations(en, en)).toEqual([]);
  });
});
