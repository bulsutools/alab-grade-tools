import { DEFAULT_EXCLUSIONS, requiredAverage, summarizeTerms, toCsv, toJson } from './domain.js';
import { parseGradeTables } from './parser.js';
import { applyHighlight, createPanel, createSummary } from './ui.js';

const STORAGE_KEY = 'alab-grade-tools:exclusions';

let exclusions = [...DEFAULT_EXCLUSIONS];
let currentTerms = [];
let currentSummary = null;
let summary;
let panel;
let observer;
let internalMutation = false;
let updateQueued = false;

function withInternalMutations(callback) {
  internalMutation = true;
  try {
    return callback();
  } finally {
    internalMutation = false;
  }
}

async function loadExclusions() {
  try {
    const storage = globalThis.chrome?.storage?.local;
    if (storage?.get) {
      const result = await new Promise((resolve) => storage.get(STORAGE_KEY, resolve));
      if (Array.isArray(result[STORAGE_KEY])) return result[STORAGE_KEY];
    }
  } catch {
    void 0;
  }

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    void 0;
  }

  return [...DEFAULT_EXCLUSIONS];
}

function saveExclusions(next) {
  try {
    globalThis.chrome?.storage?.local?.set({ [STORAGE_KEY]: next });
  } catch {
    void 0;
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    void 0;
  }
}

function hostContainer() {
  return document.querySelector('main') ?? document.body;
}

function downloadFile(contents, format) {
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bulsu-grades-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function refresh() {
  currentTerms = parseGradeTables(document);
  currentSummary = summarizeTerms(currentTerms, { excludedPrefixes: exclusions });
  const termViews = currentTerms.map((term) => ({
    label: term.label,
    ...summarizeTerms([term], { excludedPrefixes: exclusions }),
  }));

  const hasData = currentTerms.length > 0;
  summary.setVisible(hasData);
  summary.update(currentSummary);
  panel.setEnabled(hasData);
  panel.setData({ summary: currentSummary, termViews, exclusions });
}

function startObserver() {
  observer = new MutationObserver((mutations) => {
    if (internalMutation || updateQueued) return;
    if (
      !mutations.some(
        (mutation) => mutation.type === 'childList' || mutation.type === 'characterData',
      )
    )
      return;

    updateQueued = true;
    window.requestAnimationFrame(() => {
      updateQueued = false;
      withInternalMutations(refresh);
    });
  });
  observer.observe(hostContainer(), { childList: true, subtree: true, characterData: true });
}

async function init() {
  exclusions = await loadExclusions();

  summary = createSummary({
    doc: document,
    mount: hostContainer(),
    onOpen: () => panel.open(),
  });

  panel = createPanel({
    doc: document,
    handlers: {
      onExclusionsChange(next) {
        exclusions = next;
        saveExclusions(next);
        withInternalMutations(refresh);
      },
      onTargetCalculate({ target, remainingUnits }) {
        const result = requiredAverage({
          currentGwa: currentSummary?.gwa,
          currentUnits: currentSummary?.units,
          remainingUnits,
          target,
        });
        panel.setTargetResult(result);
      },
      onHighlight(query) {
        const count = withInternalMutations(() => applyHighlight(document, query));
        panel.setHighlightCount(count, query);
      },
      onExport(format) {
        if (!currentTerms.length) return;
        const contents =
          format === 'csv' ? toCsv(currentTerms) : toJson(currentTerms, currentSummary);
        downloadFile(contents, format);
      },
    },
  });

  withInternalMutations(refresh);
  startObserver();
}

void init();
