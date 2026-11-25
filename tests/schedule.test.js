import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_TTL_SECONDS,
  base64UrlToString,
  buildContributionEnvelope,
  buildSchedulePayload,
  computeStudentHash,
  envelopeSigningString,
  parseScheduleFragment,
  roomTbaScheduleUrl,
  schedulePayloadJson,
  slimEnrollment,
  verifyContributionEnvelope,
} from '../src/schedule.js';

const ENROLLMENT = {
  registration: {
    academic_term: {
      academic_year: '2026-2027',
      term: '2nd Semester',
      term_number: 2,
    },
    subjects: [
      {
        subject: { code: 'CPE 307', title: 'OHSP', units: 3 },
        units: 3,
        class_offering: {
          section: { name: 'CPE 3C' },
          faculty: { full_name: 'Jimenez, Monaliza S.' },
          meetings: [
            {
              weekday: 'Mon',
              start_time: '14:00',
              end_time: '17:00',
              mode: 'lecture',
              is_online: false,
              room: { code: 'NH-509*', name: 'NH 509*' },
            },
            {
              weekday: 'wed',
              start_time: '09:00:00',
              end_time: '10:30:00',
              mode: 'recitation',
              is_online: false,
              room: { code: 'NH-509*', name: 'NH 509*' },
            },
          ],
        },
      },
      {
        subject: { code: 'CPE 312L', title: 'Digital Logic Lab', units: 1 },
        class_offering: {
          section: { name: 'CPE 3C' },
          faculty: { full_name: 'Navarra, Lech Walesa' },
          meetings: [
            {
              weekday: 'Wednesday',
              start_time: '09:00',
              end_time: '12:00',
              mode: 'laboratory',
              is_online: true,
              room: null,
            },
          ],
        },
      },
      {
        subject: { code: 'NSTP 1', title: 'NSTP', units: 3 },
        class_offering: null,
      },
    ],
  },
};

describe('slimEnrollment', () => {
  it('extracts canonical class entries, one per component type', () => {
    const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115' });
    expect(slim.term).toEqual({
      term: '2nd Semester',
      academicYear: '2026-2027',
      termNumber: 2,
    });
    expect(slim.student.number).toBe('2024104115');
    // CPE 307 has LEC + SEM meetings -> two entries; CPE 312L one LAB; NSTP none.
    expect(slim.classes).toHaveLength(3);

    const lec = slim.classes[0];
    expect(lec).toMatchObject({
      courseCode: 'CPE 307',
      courseTitle: 'OHSP',
      section: 'CPE 3C',
      type: 'LEC',
      professor: 'Jimenez, Monaliza S.',
      isOnline: false,
    });
    expect(lec.meetings).toEqual([
      {
        weekday: 'M',
        startTime: '14:00',
        endTime: '17:00',
        mode: 'LEC',
        isOnline: false,
        room: { code: 'NH-509*', name: 'NH 509*' },
      },
    ]);

    const sem = slim.classes[1];
    expect(sem.type).toBe('SEM');
    // "HH:MM:SS" normalizes to HH:MM; "wed" -> "W".
    expect(sem.meetings[0]).toMatchObject({
      weekday: 'W',
      startTime: '09:00',
      endTime: '10:30',
      mode: 'SEM',
      room: { code: 'NH-509*', name: 'NH 509*' },
    });

    const lab = slim.classes[2];
    expect(lab.type).toBe('LAB');
    expect(lab.isOnline).toBe(true);
    expect(lab.meetings[0].weekday).toBe('W');
    expect(lab.meetings[0].room).toBeNull();
  });

  it('returns null without registration subjects', () => {
    expect(slimEnrollment({})).toBeNull();
    expect(slimEnrollment({ registration: { subjects: 'nope' } })).toBeNull();
  });
});

describe('schedule payload v1', () => {
  const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115', full_name: 'Santos, J.' });

  it('matches the Room TBA payload contract: no student, no signature block', () => {
    const payload = buildSchedulePayload(slim, { exportedAt: '2026-11-22T00:00:00.000Z' });
    expect(payload.schemaVersion).toBe(1);
    expect(payload.source).toBe('alab-grade-tools');
    expect(payload.exportedAt).toBe('2026-11-22T00:00:00.000Z');
    expect(payload.term).toEqual({
      label: '2nd Semester AY 2026-2027',
      schoolYear: '2026-2027',
      semester: '2',
    });
    expect(payload.student).toBeUndefined();
    expect(payload.signature).toBeUndefined();
    expect(payload.classes).toHaveLength(3);

    const entry = payload.classes[0];
    expect(Object.keys(entry).sort()).toEqual([
      'courseCode',
      'courseTitle',
      'isOnline',
      'meetings',
      'professor',
      'section',
      'type',
    ]);
    for (const key of ['units', 'sectionTypes', 'faculty']) {
      expect(JSON.stringify(payload)).not.toContain(`"${key}"`);
    }

    const json = schedulePayloadJson(payload);
    expect(json).not.toMatch(/"(grade|gwa|remarks?|student)"\s*:/i);
    expect(json).not.toContain('2024104115');
  });

  it('round-trips through the URL fragment', () => {
    const payload = buildSchedulePayload(slim);
    const url = roomTbaScheduleUrl(payload);
    expect(url.startsWith('https://room-tba.bulsu.tools/#schedule=')).toBe(true);
    const parsed = parseScheduleFragment(url);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.classes[0].courseCode).toBe('CPE 307');
    expect(parsed.classes[0].meetings[0].room.code).toBe('NH-509*');
    expect(parsed.classes[0].meetings[0].weekday).toBe('M');
  });
});

describe('contribution envelope', () => {
  const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115' });
  const payload = () => buildSchedulePayload(slim, { exportedAt: '2026-11-22T00:00:00.000Z' });

  it('signs with the canonical string the receiver verifies', async () => {
    const now = 1_800_000_000_000;
    const envelope = await buildContributionEnvelope(payload(), {
      studentNumber: '2024104115',
      now,
      nonce: 'testnonce123456789',
    });

    expect(envelope.v).toBe(1);
    expect(envelope.exp).toBe(Math.floor(now / 1000) + ENVELOPE_TTL_SECONDS);
    expect(envelope.nonce).toBe('testnonce123456789');
    expect(envelope.studentHash).toBe(await computeStudentHash('2024104115'));
    expect(envelope.studentHash).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    // studentHash = base64url SHA-256(student_number + STUDENT_HASH_SALT).
    // Literal pins the algorithm + salt so a silent change fails loudly.
    expect(envelope.studentHash).toBe('GV-n0ZCFGAftVq6w37pSy35Sg5Ajc421zU5HnCTLq8o');

    // Canonical signing string matches room-tba signature.ts alabSigningString.
    const message = envelopeSigningString({
      studentHash: envelope.studentHash,
      exp: envelope.exp,
      nonce: envelope.nonce,
      payload: envelope.payload,
    });
    expect(message.split('\n')).toEqual([
      'alab-schedule-v1',
      envelope.studentHash,
      String(envelope.exp),
      envelope.nonce,
      envelope.payload,
    ]);

    // payload field decodes to the exact compact payload JSON.
    expect(JSON.parse(base64UrlToString(envelope.payload))).toEqual(payload());

    expect(await verifyContributionEnvelope(envelope, { now })).toBe(true);
  });

  it('rejects expired envelopes', async () => {
    const now = 1_800_000_000_000;
    // Build with a past expiry by overriding ttlSeconds.
    const envelope = await buildContributionEnvelope(payload(), {
      studentNumber: '2024104115',
      now: now - (ENVELOPE_TTL_SECONDS + 60) * 1000,
      nonce: 'expirednonce12345',
    });
    expect(await verifyContributionEnvelope(envelope, { now })).toBe(false);
  });

  it('rejects tampered envelopes', async () => {
    const now = 1_800_000_000_000;
    const envelope = await buildContributionEnvelope(payload(), {
      studentNumber: '2024104115',
      now,
      nonce: 'tampernonce123456',
    });
    expect(await verifyContributionEnvelope({ ...envelope, payload: 'AAAA' }, { now })).toBe(false);
    expect(await verifyContributionEnvelope({ ...envelope, studentHash: 'other' }, { now })).toBe(
      false,
    );
  });
});
