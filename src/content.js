import { fetchScheduleSource } from './alab-api.js';
import { DEFAULT_EXCLUSIONS, requiredAverage, summarizeTerms, toCsv, toJson } from './domain.js';
import { parseGradeTables } from './parser.js';
import {
  buildSchedulePayload,
  roomTbaScheduleUrl,
  schedulePayloadJson,
  signSchedulePayload,
  slimEnrollment,
} from './schedule.js';
import { applyHighlight, createPanel, createSummary } from './ui.js';

const STORAGE_KEY = 'alab-grade-tools:exclusions';

let exclusions = [...DEFAULT_EXCLUSIONS];
let currentTerms = [];
let currentSummary = null;
let scheduleSlim = null;
let scheduleLoading = false;
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

function downloadFile(contents, format, name = 'bulsu-grades') {
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ---------- Class schedule export (docs/schedule-payload.md) ---------- */

const SCHEDULE_STATUS = {
  'not-logged-in': 'not-logged-in',
  'alab-error': 'error',
};

async function loadSchedule() {
  if (scheduleLoading) return;
  scheduleLoading = true;
  panel.setSchedule({ status: 'loading' });
  try {
    const source = await fetchScheduleSource();
    if (!source.ok) {
      scheduleSlim = null;
      panel.setSchedule({ status: SCHEDULE_STATUS[source.reason] ?? 'error' });
      return;
    }
    const slim = slimEnrollment(source.enrollment, source.student);
    if (!slim || !slim.classes.length) {
      scheduleSlim = null;
      panel.setSchedule({ status: 'empty' });
      return;
    }
    scheduleSlim = slim;
    panel.setSchedule({ status: 'ready', classes: slim.classes.length });
  } catch {
    scheduleSlim = null;
    panel.setSchedule({ status: 'error' });
  } finally {
    scheduleLoading = false;
  }
}

// Builds a fresh signed payload on each export so expiry/nonce stay current.
async function schedulePayload() {
  if (!scheduleSlim) return null;
  const payload = buildSchedulePayload(scheduleSlim);
  if (payload.student.number) await signSchedulePayload(payload);
  return payload;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function scheduleNote(message) {
  panel.setScheduleNote(message);
  window.setTimeout(() => panel.setScheduleNote(''), 4000);
}

async function onScheduleAction(action) {
  if (action === 'refresh') {
    await loadSchedule();
    return;
  }
  const payload = await schedulePayload();
  if (!payload) {
    scheduleNote('Load the schedule first.');
    return;
  }
  if (action === 'copy') {
    const ok = await copyText(schedulePayloadJson(payload));
    scheduleNote(
      ok ? 'Schedule JSON copied to clipboard.' : 'Copy failed. Try Download JSON instead.',
    );
  } else if (action === 'download') {
    downloadFile(schedulePayloadJson(payload), 'json', 'bulsu-schedule');
    scheduleNote('Schedule JSON downloaded.');
  } else if (action === 'roomtba') {
    window.open(roomTbaScheduleUrl(payload), '_blank', 'noopener');
    scheduleNote('Opened Room TBA with your schedule.');
  }
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
      onSchedule: onScheduleAction,
    },
  });

  withInternalMutations(refresh);
  startObserver();
  void loadSchedule();
}

void init();
