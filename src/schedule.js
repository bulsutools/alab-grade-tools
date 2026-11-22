// Schedule export payload for downstream consumers (Room TBA, class hubs).
// Pure module: no DOM, no chrome.* — also runs under node for tests.
// Contract: docs/schedule-payload.md. Grades are never part of this payload.

export const SCHEDULE_PAYLOAD_VERSION = 1;
export const SIGNING_KEY_ID = 'alab-schedule-v1';
export const SIGNATURE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROOM_TBA_URL = 'https://room-tba.bulsu.tools/';

// App-level HMAC key shared with consumers (Room TBA). Public by design: it
// proves the payload came from a build of this extension and is fresh, not
// that the student is who they claim (see room-tba#16).
const SIGNING_KEY_B64 = 'B5cQtdDeLPDLQ7kvFFCGoFEk/w2oigSrnDHe8y2eBuI=';

// Raw ALAB SMS meeting.mode -> compact type consumers already understand.
const MODE_TYPE = { lecture: 'LEC', laboratory: 'LAB', recitation: 'SEM', seminar: 'SEM' };

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstString(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function toUnitCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(obj, path) {
  let node = obj;
  for (const key of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

// /enrollment/me -> { term, student, classes }. Returns null when the
// response has no registration subjects. Schedule fields only. `studentHint`
// supplies student_no/full_name when the enrollment payload omits them
// (e.g. read from /students/me/grades — grades themselves are discarded).
export function slimEnrollment(data, studentHint = {}) {
  const reg = pick(data, ['registration']) ?? pick(data, ['data', 'registration']);
  if (!reg || !Array.isArray(reg.subjects)) return null;

  const term = reg.academic_term || {};
  const student =
    pick(data, ['student']) ?? pick(data, ['data', 'student']) ?? pick(reg, ['student']) ?? {};

  const classes = [];
  for (const s of reg.subjects) {
    const offering = s && s.class_offering;
    const subject = (s && s.subject) || {};
    const code = normalizeText(subject.code);
    if (!code) continue;

    const meetings = Array.isArray(offering && offering.meetings) ? offering.meetings : [];
    const types = [...new Set(meetings.map((m) => MODE_TYPE[m && m.mode] || '').filter(Boolean))];

    classes.push({
      courseCode: code,
      title: normalizeText(subject.title),
      units: toUnitCount(s.units ?? subject.units),
      section: normalizeText(offering && offering.section && offering.section.name),
      sectionTypes: types,
      faculty: normalizeText(offering && offering.faculty && offering.faculty.full_name),
      meetings: meetings.map((m) => ({
        weekday: normalizeText(m && m.weekday),
        startTime: normalizeText(m && m.start_time),
        endTime: normalizeText(m && m.end_time),
        mode: normalizeText(m && m.mode),
        type: MODE_TYPE[m && m.mode] || '',
        isOnline: !!(m && m.is_online),
        room:
          m && m.room
            ? {
                code: normalizeText(m.room.code),
                name: normalizeText(m.room.name),
              }
            : null,
      })),
    });
  }

  return {
    term: {
      term: normalizeText(term.term),
      academicYear: normalizeText(term.academic_year),
      termNumber: Number.isInteger(term.term_number) ? term.term_number : null,
    },
    student: {
      number: firstString(
        student.student_no,
        student.studentNumber,
        student.id_number,
        studentHint.student_no,
        studentHint.studentNumber,
      ),
      name: firstString(student.full_name, student.name, studentHint.full_name),
    },
    classes,
  };
}

// Versioned, consumer-agnostic payload. `signature` is added by
// signSchedulePayload; pass sign: false to skip it.
export function buildSchedulePayload(slim, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const label = [slim.term.term, slim.term.academicYear && `AY ${slim.term.academicYear}`]
    .filter(Boolean)
    .join(' ');

  return {
    v: SCHEDULE_PAYLOAD_VERSION,
    source: 'alab-grade-tools',
    generatedAt,
    term: {
      label,
      term: slim.term.term || null,
      academicYear: slim.term.academicYear || null,
      termNumber: slim.term.termNumber,
    },
    student: {
      number: slim.student.number || null,
      name: slim.student.name || null,
    },
    classes: slim.classes,
    signature: null,
  };
}

/* ---------- HMAC signature (use case B: dataset contribution) ---------- */

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToBase64UrlString(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64Url(bytes);
}

export function base64UrlToString(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

// Section IDs are "<courseCode>|<section>" per class, sorted for stability.
export function scheduleSectionIds(payload) {
  return (payload.classes || []).map((c) => `${c.courseCode}|${c.section || ''}`).sort();
}

// Canonical signed string: version, student number, section IDs, expiry, nonce.
// Documented in docs/schedule-payload.md — keep both in sync.
export function signatureMessage({ studentNumber, sectionIds, expiresAt, nonce }) {
  return [
    SIGNING_KEY_ID,
    studentNumber ?? '',
    (sectionIds || []).join(','),
    String(expiresAt),
    nonce ?? '',
  ].join('\n');
}

async function hmacKey() {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(SIGNING_KEY_B64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// Adds payload.signature in place and returns the payload. `expiresAt` is a
// unix-ms timestamp; defaults to now + SIGNATURE_TTL_MS.
export async function signSchedulePayload(payload, options = {}) {
  const studentNumber = payload.student?.number ?? '';
  const sectionIds = scheduleSectionIds(payload);
  const expiresAt = options.expiresAt ?? Date.now() + SIGNATURE_TTL_MS;
  const nonce = options.nonce ?? randomNonce();
  const message = signatureMessage({ studentNumber, sectionIds, expiresAt, nonce });

  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    new TextEncoder().encode(message),
  );

  payload.signature = {
    alg: 'HMAC-SHA256',
    kid: SIGNING_KEY_ID,
    value: bytesToBase64Url(new Uint8Array(signature)),
    expiresAt,
    nonce,
    sectionIds,
  };
  return payload;
}

// Verifies payload.signature against the documented canonical string.
// Consumers (Room TBA) reimplement this server-side; exported for tests/docs.
export async function verifyScheduleSignature(payload, keyB64 = SIGNING_KEY_B64) {
  const sig = payload && payload.signature;
  if (!sig || sig.alg !== 'HMAC-SHA256' || sig.kid !== SIGNING_KEY_ID) return false;
  const message = signatureMessage({
    studentNumber: payload.student?.number ?? '',
    sectionIds: sig.sectionIds ?? [],
    expiresAt: sig.expiresAt,
    nonce: sig.nonce,
  });
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const padded = sig.value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const sigArr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) sigArr[i] = bin.charCodeAt(i);
  return crypto.subtle.verify('HMAC', key, sigArr, new TextEncoder().encode(message));
}

/* ---------- Serialization: clipboard, download, URL fragment ---------- */

export function schedulePayloadJson(payload, pretty = true) {
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

// base64url of the compact JSON payload, safe inside a URL fragment.
export function scheduleFragment(payload) {
  return bytesToBase64UrlString(schedulePayloadJson(payload, false));
}

// Personal "my classes" view: payload rides in the URL fragment, so it never
// reaches a server log. Receiver contract: room-tba#16.
export function roomTbaScheduleUrl(payload, base = ROOM_TBA_URL) {
  return `${base}#schedule=${scheduleFragment(payload)}`;
}

export function parseScheduleFragment(fragment) {
  const text = String(fragment ?? '');
  const hash = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text;
  const match = hash.match(/(?:^|&)schedule=([^&]+)/);
  if (!match) return null;
  try {
    return JSON.parse(base64UrlToString(match[1]));
  } catch {
    return null;
  }
}
