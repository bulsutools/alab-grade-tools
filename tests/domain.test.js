import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUSIONS,
  isExcludedSubject,
  parseGradeValue,
  parseUnits,
  requiredAverage,
  summarizeTerms,
  toCsv,
  toJson,
} from '../src/domain.js';

const terms = [
  {
    label: '2025-2026 · 1st Semester',
    rows: [
      { subject: 'COE 100 Mathematics', units: 3, grade: 2.5, gradeText: '2.50', remark: 'Passed' },
      { subject: 'NSTP 11 National Service', units: 2, grade: 1.25, gradeText: '1.25', remark: 'Passed' },
      { subject: 'CPE 205 Numerical Methods', units: 3, grade: 5, gradeText: '5.00', remark: 'Failed' },
      { subject: 'PE 11 PATHFit 2', units: 2, grade: 1, gradeText: '1.00', remark: 'Passed' },
      { subject: 'COE 105 Physics', units: 3, grade: null, gradeText: '—', remark: 'No grade' },
    ],
  },
];

describe('grade parsing', () => {
  it('parses numeric grades and skips placeholders', () => {
    expect(parseGradeValue('2.25')).toBe(2.25);
    expect(parseGradeValue('5.00')).toBe(5);
    expect(parseGradeValue('—')).toBeNull();
    expect(parseGradeValue('FDA')).toBeNull();
    expect(parseUnits('3')).toBe(3);
    expect(parseUnits('1.5')).toBe(1.5);
  });

  it('matches excluded subject tokens without matching partial words', () => {
    expect(isExcludedSubject('NSTP 11 National Service', DEFAULT_EXCLUSIONS)).toBe(true);
    expect(isExcludedSubject('PE 11 PATHFit 2', DEFAULT_EXCLUSIONS)).toBe(true);
    expect(isExcludedSubject('CPE 307 Occupational Health', DEFAULT_EXCLUSIONS)).toBe(false);
  });
});

describe('summaries', () => {
  it('weights grades by units and counts failures', () => {
    const summary = summarizeTerms(terms);
    expect(summary.gwa).toBe(2.7);
    expect(summary.units).toBe(10);
    expect(summary.gradedSubjects).toBe(4);
    expect(summary.failed).toBe(1);
    expect(summary.allSubjects).toBe(5);
    expect(summary.allUnits).toBe(13);
  });

  it('applies subject exclusions', () => {
    const summary = summarizeTerms(terms, { excludedPrefixes: DEFAULT_EXCLUSIONS });
    expect(summary.gwa).toBe(3.75);
    expect(summary.units).toBe(6);
    expect(summary.gradedSubjects).toBe(2);
  });
});

describe('target calculation', () => {
  it('computes the average needed on remaining units', () => {
    expect(requiredAverage({ currentGwa: 2.5, currentUnits: 10, remainingUnits: 10, target: 2 }))
      .toEqual({ state: 'ok', value: 1.5 });
  });

  it('reports the boundary states', () => {
    expect(requiredAverage({ currentGwa: 2.5, currentUnits: 10, remainingUnits: 10, target: 1 }))
      .toEqual({ state: 'within-reach', value: -0.5 });
    expect(requiredAverage({ currentGwa: 2.5, currentUnits: 10, remainingUnits: 10, target: 4.5 }))
      .toEqual({ state: 'unreachable', value: 6.5 });
    expect(requiredAverage({ currentGwa: 2.5, currentUnits: 10, remainingUnits: 0, target: 2 }).state)
      .toBe('need-units');
    expect(requiredAverage({ currentGwa: null, currentUnits: 0, remainingUnits: 10, target: 2 }).state)
      .toBe('no-data');
  });
});

describe('export', () => {
  it('writes a CSV with escaped cells', () => {
    const csv = toCsv([
      {
        label: '2025-2026, 1st Semester',
        rows: [{ subject: 'COE "Calculus"', units: 3, gradeText: '2.50', remark: 'Passed' }],
      },
    ]);
    expect(csv).toContain('"2025-2026, 1st Semester"');
    expect(csv).toContain('"COE ""Calculus"""');
  });

  it('writes JSON with the summary and terms', () => {
    const parsed = JSON.parse(toJson(terms, summarizeTerms(terms), '2026-01-01T00:00:00.000Z'));
    expect(parsed.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.terms).toHaveLength(1);
    expect(parsed.terms[0].rows[0].subject).toBe('COE 100 Mathematics');
  });
});
