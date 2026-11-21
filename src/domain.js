export const DEFAULT_EXCLUSIONS = ['NSTP', 'PE'];

const NO_GRADE_MARKS = new Set(['—', '–', '-', '', 'n/a', 'na', 'none']);

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseGradeValue(value) {
  const text = normalizeText(value);
  if (!text || NO_GRADE_MARKS.has(text.toLowerCase())) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : null;
}

export function parseUnits(value) {
  const text = normalizeText(value).replace(/,/g, '');
  const match = text.match(/^(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : 0;
}

export function isExcludedSubject(subject, prefixes = []) {
  const normalized = normalizeText(subject).toLowerCase();
  return prefixes.some((prefix) => {
    const token = normalizeText(prefix).toLowerCase();
    if (!token) return false;
    return new RegExp(`(^|\\s)${escapeRegExp(token)}(?=\\s|$)`, 'i').test(normalized);
  });
}

export function isFailedRow(row) {
  const remark = normalizeText(row.remark).toLowerCase();
  return remark.includes('failed') || remark.includes('failure') || row.grade === 5;
}

export function summarizeTerms(terms, options = {}) {
  const excludedPrefixes = options.excludedPrefixes ?? [];
  let weighted = 0;
  let units = 0;
  let gradedSubjects = 0;
  let failed = 0;
  let allSubjects = 0;
  let allUnits = 0;

  for (const term of terms) {
    for (const row of term.rows) {
      allSubjects += 1;
      allUnits += row.units || 0;
      if (isFailedRow(row)) failed += 1;
      if (row.grade === null || isExcludedSubject(row.subject, excludedPrefixes)) continue;
      units += row.units || 0;
      weighted += row.grade * (row.units || 0);
      gradedSubjects += 1;
    }
  }

  return {
    gwa: units > 0 ? round2(weighted / units) : null,
    units: round2(units),
    weighted,
    gradedSubjects,
    failed,
    allSubjects,
    allUnits: round2(allUnits),
  };
}

export function requiredAverage({ currentGwa, currentUnits, remainingUnits, target }) {
  const current = Number(currentGwa);
  const units = Number(currentUnits);
  const remaining = Number(remainingUnits);
  const aim = Number(target);

  if (!Number.isFinite(current) || !Number.isFinite(aim) || units <= 0) {
    return { state: 'no-data' };
  }
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { state: 'need-units' };
  }

  const needed = (aim * (units + remaining) - current * units) / remaining;
  if (needed < 1) return { state: 'within-reach', value: round2(needed) };
  if (needed > 5) return { state: 'unreachable', value: round2(needed) };
  return { state: 'ok', value: round2(needed) };
}

function csvCell(value) {
  const text = normalizeText(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(terms) {
  const rows = [['term', 'subject', 'units', 'grade', 'remarks']];
  for (const term of terms) {
    for (const row of term.rows) {
      rows.push([term.label, row.subject, row.units, row.gradeText, row.remark]);
    }
  }
  return rows.map((cells) => cells.map(csvCell).join(',')).join('\n');
}

export function toJson(terms, summary, generatedAt = new Date().toISOString()) {
  return JSON.stringify(
    {
      generatedAt,
      summary,
      terms: terms.map((term) => ({
        label: term.label,
        rows: term.rows.map(({ subject, units, gradeText, remark }) => ({
          subject,
          units,
          grade: gradeText,
          remarks: remark,
        })),
      })),
    },
    null,
    2,
  );
}
