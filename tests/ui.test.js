import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { summarizeTerms } from '../src/domain.js';
import { parseGradeTables } from '../src/parser.js';
import { applyHighlight, createPanel, createSummary } from '../src/ui.js';

const html = `
  <main>
    <section>
      <p>2025-2026 · 1st Semester grades</p>
      <table>
        <thead><tr><th>Subject</th><th>Units</th><th>Grade</th><th>Remarks</th></tr></thead>
        <tbody>
          <tr><td>CPE 206L Data Structure</td><td>2</td><td>1.00</td><td>Passed</td></tr>
          <tr><td>COE 100 Mathematics</td><td>3</td><td>2.50</td><td>Passed</td></tr>
        </tbody>
      </table>
    </section>
  </main>
`;

function setup() {
  const dom = new JSDOM(html);
  return { dom, doc: dom.window.document, win: dom.window };
}

describe('summary strip', () => {
  it('renders the weighted figures and opens the panel', () => {
    const { doc, win } = setup();
    const onOpen = vi.fn();
    const summary = createSummary({ doc, mount: doc.querySelector('main'), onOpen });
    const terms = parseGradeTables(doc);
    summary.update(summarizeTerms(terms));

    expect(doc.querySelector('[data-role="gwa"]').textContent).toBe('1.90');
    expect(doc.querySelector('[data-role="units"]').textContent).toBe('5');
    expect(doc.querySelector('[data-role="failed"]').textContent).toBe('0');

    doc.querySelector('[data-action="open"]').dispatchEvent(new win.Event('click'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('tools panel', () => {
  it('wires the target form, exclusions, filter, and export events', () => {
    const { doc, win } = setup();
    const handlers = {
      onTargetCalculate: vi.fn(),
      onExclusionsChange: vi.fn(),
      onHighlight: vi.fn(),
      onExport: vi.fn(),
    };
    const panel = createPanel({ doc, handlers });
    panel.setEnabled(true);
    panel.setData({
      summary: { gwa: 2, units: 5, gradedSubjects: 2, failed: 0 },
      termViews: [{ label: '2025-2026 · 1st Semester', units: 5, gwa: 2, failed: 0 }],
      exclusions: ['PE'],
    });

    expect(panel.element.hidden).toBe(true);
    panel.open();
    expect(panel.element.hidden).toBe(false);

    const form = panel.element.querySelector('[data-role="target-form"]');
    form.elements.target.value = '1.5';
    form.elements.remainingUnits.value = '12';
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    expect(handlers.onTargetCalculate).toHaveBeenCalledWith({ target: 1.5, remainingUnits: 12 });

    const exclusion = panel.element.querySelector('[data-role="exclusion"][value="NSTP"]');
    expect(exclusion.checked).toBe(false);
    exclusion.checked = true;
    exclusion.dispatchEvent(new win.Event('change', { bubbles: true }));
    expect(handlers.onExclusionsChange).toHaveBeenCalledWith(['NSTP', 'PE']);

    const filter = panel.element.querySelector('[data-role="filter"]');
    filter.value = 'CPE';
    filter.dispatchEvent(new win.Event('input', { bubbles: true }));
    expect(handlers.onHighlight).toHaveBeenCalledWith('CPE');

    panel.element.querySelector('[data-action="export-csv"]').dispatchEvent(new win.Event('click'));
    expect(handlers.onExport).toHaveBeenCalledWith('csv');
  });
});

describe('subject highlighting', () => {
  it('marks matching rows and clears previous matches', () => {
    const { doc } = setup();
    expect(applyHighlight(doc, 'CPE 206L')).toBe(1);
    expect(doc.querySelectorAll('.alab-highlight')).toHaveLength(1);
    expect(applyHighlight(doc, '')).toBe(0);
    expect(doc.querySelectorAll('.alab-highlight')).toHaveLength(0);
  });
});
