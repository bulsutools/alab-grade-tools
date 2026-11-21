import { normalizeText, parseGradeValue, parseUnits } from './domain.js';

const TERM_PATTERN = /(\d{4}\s*[-–]\s*\d{4})\s*·\s*([\s\S]{1,100}?)\s+grades/i;
const REQUIRED_HEADERS = ['subject', 'units', 'grade'];

function headerText(table) {
  const firstRow = table.querySelector('tr');
  if (!firstRow) return [];
  return Array.from(firstRow.querySelectorAll('th')).map((cell) =>
    normalizeText(cell.textContent).toLowerCase(),
  );
}

export function isGradeTable(table) {
  const headers = headerText(table);
  return REQUIRED_HEADERS.every((header) => headers.includes(header));
}

function findTermLabel(table) {
  let node = table.parentElement;
  let depth = 0;

  while (node && depth < 10) {
    const text = normalizeText(node.textContent);
    if (text.length <= 4000) {
      const match = text.match(TERM_PATTERN);
      if (match) return `${normalizeText(match[1])} · ${normalizeText(match[2])}`;
    }
    node = node.parentElement;
    depth += 1;
  }

  return 'Unlabeled term';
}

function parseRow(row) {
  const cells = Array.from(row.querySelectorAll('td'));
  if (cells.length < 3) return null;

  const subject = normalizeText(cells[0].textContent);
  if (!subject) return null;

  const unitsText = normalizeText(cells[1].textContent);
  const gradeText = normalizeText(cells[2].textContent);

  return {
    subject,
    unitsText,
    units: parseUnits(unitsText),
    gradeText,
    grade: parseGradeValue(gradeText),
    remark: normalizeText(cells[3]?.textContent ?? ''),
  };
}

export function parseGradeTables(root) {
  const tables = Array.from(root.querySelectorAll('table')).filter(isGradeTable);
  return tables.map((table) => ({
    label: findTermLabel(table),
    rows: Array.from(table.querySelectorAll('tr')).slice(1).map(parseRow).filter(Boolean),
  }));
}
