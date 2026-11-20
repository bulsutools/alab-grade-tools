import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { isGradeTable, parseGradeTables } from '../src/parser.js';

const html = `
  <main>
    <section class="card">
      <p>2025-2026 · 1st Semester grades</p>
      <table>
        <thead><tr><th>Subject</th><th>Units</th><th>Grade</th><th>Remarks</th></tr></thead>
        <tbody>
          <tr><td>COE 100 Mathematics for Engineers</td><td>3</td><td>2.50</td><td>Passed</td></tr>
          <tr><td>COE 105 Physics for Engineers</td><td>3</td><td>—</td><td>No grade</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <p>2025-2026 · Summer grades</p>
      <table>
        <thead><tr><th>Subject</th><th>Units</th><th>Grade</th><th>Remarks</th></tr></thead>
        <tbody>
          <tr><td>CPE 206L Data Structure and Algorithm</td><td>2</td><td>1.00</td><td>Passed</td></tr>
        </tbody>
      </table>
    </section>
    <table>
      <thead><tr><th>Grade</th><th>Description</th></tr></thead>
      <tbody><tr><td>5.00</td><td>Failed</td></tr></tbody>
    </table>
  </main>
`;

describe('grade table parsing', () => {
  const doc = new JSDOM(html).window.document;

  it('detects only grade tables', () => {
    const tables = Array.from(doc.querySelectorAll('table'));
    expect(tables.map(isGradeTable)).toEqual([true, true, false]);
  });

  it('extracts term labels and rows', () => {
    const terms = parseGradeTables(doc);
    expect(terms).toHaveLength(2);
    expect(terms[0].label).toBe('2025-2026 · 1st Semester');
    expect(terms[1].label).toBe('2025-2026 · Summer');
    expect(terms[0].rows).toHaveLength(2);
    expect(terms[0].rows[0].subject).toBe('COE 100 Mathematics for Engineers');
    expect(terms[0].rows[0].grade).toBe(2.5);
    expect(terms[0].rows[1].grade).toBeNull();
  });
});
