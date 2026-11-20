import { normalizeText } from './domain.js';
import { isGradeTable } from './parser.js';

const PANEL_TEMPLATE = `
  <header class="agp-panel__header">
    <h2 id="agp-title">Grade tools</h2>
    <button type="button" class="agp-btn agp-btn--quiet" data-action="close">Close</button>
  </header>
  <div class="agp-panel__content">
    <section class="agp-section">
      <h3>Weighted GWA</h3>
      <p class="agp-gwa" data-role="gwa">—</p>
      <p class="agp-note" data-role="gwa-note">Computed from the grades shown on this page.</p>
    </section>

    <section class="agp-section">
      <h3>Terms</h3>
      <table class="agp-terms">
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col">Units</th>
            <th scope="col">GWA</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody data-role="terms-body"></tbody>
      </table>
    </section>

    <section class="agp-section">
      <h3>Target GWA</h3>
      <form class="agp-form" data-role="target-form">
        <label>
          Target GWA
          <input name="target" type="number" min="1" max="5" step="0.01" value="1.50" required />
        </label>
        <label>
          Remaining units
          <input name="remainingUnits" type="number" min="0" step="0.5" value="0" required />
        </label>
        <button type="submit" class="agp-btn agp-btn--primary">Calculate required average</button>
      </form>
      <p class="agp-note" data-role="target-result" aria-live="polite">Enter remaining units to calculate.</p>
    </section>

    <section class="agp-section">
      <fieldset class="agp-fieldset">
        <legend>Skip subjects in GWA</legend>
        <label><input type="checkbox" data-role="exclusion" value="NSTP" /> NSTP</label>
        <label><input type="checkbox" data-role="exclusion" value="PE" /> PE</label>
      </fieldset>
    </section>

    <section class="agp-section">
      <h3>Find a subject</h3>
      <div class="agp-inline">
        <label class="agp-sr-only" for="agp-subject-filter">Subject code or title</label>
        <input id="agp-subject-filter" type="search" data-role="filter" autocomplete="off" />
        <button type="button" class="agp-btn agp-btn--quiet" data-action="clear-filter">Clear</button>
      </div>
      <p class="agp-note" data-role="highlight-count">Type a subject code or title to highlight matching rows.</p>
    </section>

    <section class="agp-section">
      <h3>Export</h3>
      <div class="agp-inline">
        <button type="button" class="agp-btn agp-btn--secondary" data-action="export-csv">Download CSV</button>
        <button type="button" class="agp-btn agp-btn--secondary" data-action="export-json">Download JSON</button>
      </div>
    </section>
  </div>
`;

function formatNumber(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function createSummary({ doc, mount, onOpen }) {
  const element = doc.createElement('section');
  element.id = 'alab-grade-summary';
  element.className = 'alab-grade-summary';
  element.setAttribute('aria-label', 'Weighted grade summary');
  element.innerHTML = `
    <dl>
      <div><dt>GWA</dt><dd data-role="gwa">—</dd></div>
      <div><dt>Graded units</dt><dd data-role="units">—</dd></div>
      <div><dt>Failed</dt><dd data-role="failed">—</dd></div>
    </dl>
    <button type="button" class="agp-btn agp-btn--primary" data-action="open">Grade tools</button>
  `;
  mount.prepend(element);

  const refs = {
    gwa: element.querySelector('[data-role="gwa"]'),
    units: element.querySelector('[data-role="units"]'),
    failed: element.querySelector('[data-role="failed"]'),
  };

  element.querySelector('[data-action="open"]').addEventListener('click', onOpen);

  return {
    update(summary) {
      refs.gwa.textContent = summary.gwa === null ? '—' : summary.gwa.toFixed(2);
      refs.units.textContent = formatNumber(summary.units);
      refs.failed.textContent = formatNumber(summary.failed);
    },
    setVisible(visible) {
      element.hidden = !visible;
    },
  };
}

function targetMessage(result) {
  if (!result) return 'Enter remaining units to calculate.';
  if (result.state === 'no-data') return 'No graded subjects are available yet.';
  if (result.state === 'need-units') return 'Enter remaining units to calculate.';
  if (result.state === 'within-reach') return 'A 1.00 on every remaining unit meets the target.';
  if (result.state === 'unreachable') return 'Not reachable with the entered units.';
  return `Required average on the remaining units: ${result.value.toFixed(2)}.`;
}

export function createPanel({ doc, handlers }) {
  const element = doc.createElement('aside');
  element.id = 'alab-grade-tools-panel';
  element.className = 'agp-panel';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'false');
  element.setAttribute('aria-labelledby', 'agp-title');
  element.hidden = true;
  element.innerHTML = PANEL_TEMPLATE;
  doc.body.appendChild(element);

  const refs = {
    gwa: element.querySelector('[data-role="gwa"]'),
    gwaNote: element.querySelector('[data-role="gwa-note"]'),
    termsBody: element.querySelector('[data-role="terms-body"]'),
    targetForm: element.querySelector('[data-role="target-form"]'),
    targetResult: element.querySelector('[data-role="target-result"]'),
    exclusions: Array.from(element.querySelectorAll('[data-role="exclusion"]')),
    filter: element.querySelector('[data-role="filter"]'),
    highlightCount: element.querySelector('[data-role="highlight-count"]'),
    close: element.querySelector('[data-action="close"]'),
  };

  let enabled = false;
  let lastActive = null;

  function close() {
    if (element.hidden) return;
    element.hidden = true;
    if (lastActive && doc.contains(lastActive)) lastActive.focus();
  }

  function open() {
    if (!enabled) return;
    lastActive = doc.activeElement;
    element.hidden = false;
    refs.close.focus();
  }

  function renderTerms(views) {
    refs.termsBody.replaceChildren();

    if (!views.length) {
      const row = doc.createElement('tr');
      const cell = doc.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'No grade tables found.';
      row.appendChild(cell);
      refs.termsBody.appendChild(row);
      return;
    }

    for (const view of views) {
      const row = doc.createElement('tr');
      const values = [
        view.label,
        formatNumber(view.units),
        view.gwa === null ? '—' : view.gwa.toFixed(2),
        formatNumber(view.failed),
      ];
      for (const value of values) {
        const cell = doc.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      refs.termsBody.appendChild(row);
    }
  }

  refs.close.addEventListener('click', close);
  refs.targetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new doc.defaultView.FormData(refs.targetForm);
    handlers.onTargetCalculate({
      target: Number(data.get('target')),
      remainingUnits: Number(data.get('remainingUnits')),
    });
  });

  for (const input of refs.exclusions) {
    input.addEventListener('change', () => {
      handlers.onExclusionsChange(refs.exclusions.filter((item) => item.checked).map((item) => item.value));
    });
  }

  refs.filter.addEventListener('input', () => handlers.onHighlight(refs.filter.value));
  element.querySelector('[data-action="clear-filter"]').addEventListener('click', () => {
    refs.filter.value = '';
    handlers.onHighlight('');
    refs.filter.focus();
  });

  element.querySelector('[data-action="export-csv"]').addEventListener('click', () => handlers.onExport('csv'));
  element.querySelector('[data-action="export-json"]').addEventListener('click', () => handlers.onExport('json'));

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !element.hidden) close();
  });

  return {
    element,
    open,
    close,
    setEnabled(value) {
      enabled = value;
      if (!enabled) element.hidden = true;
    },
    setData({ summary, termViews, exclusions }) {
      refs.gwa.textContent = summary.gwa === null ? '—' : summary.gwa.toFixed(2);
      refs.gwaNote.textContent = summary.gradedSubjects
        ? `Weighted across ${summary.gradedSubjects} graded subjects and ${summary.units} units.`
        : 'No numeric grades are shown on this page yet.';
      renderTerms(termViews);
      for (const input of refs.exclusions) input.checked = exclusions.includes(input.value);
    },
    setTargetResult(result) {
      refs.targetResult.textContent = targetMessage(result);
    },
    setHighlightCount(count, query) {
      if (!normalizeText(query)) {
        refs.highlightCount.textContent = 'Type a subject code or title to highlight matching rows.';
      } else if (count > 0) {
        refs.highlightCount.textContent = `${count} matching ${count === 1 ? 'row' : 'rows'}.`;
      } else {
        refs.highlightCount.textContent = 'No matching rows.';
      }
    },
  };
}

export function applyHighlight(doc, query) {
  const needle = normalizeText(query).toLowerCase();
  let count = 0;

  for (const table of doc.querySelectorAll('table')) {
    if (!isGradeTable(table)) continue;
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;
      const subject = normalizeText(cells[0].textContent).toLowerCase();
      const match = needle.length > 0 && subject.includes(needle);
      if (match) {
        row.classList.add('alab-highlight');
        row.setAttribute('data-alab-highlight', '');
        count += 1;
      } else {
        row.classList.remove('alab-highlight');
        row.removeAttribute('data-alab-highlight');
      }
    }
  }

  return count;
}
