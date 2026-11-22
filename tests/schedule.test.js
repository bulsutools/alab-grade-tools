import { describe, expect, it } from 'vitest';
import {
  buildSchedulePayload,
  parseScheduleFragment,
  roomTbaScheduleUrl,
  schedulePayloadJson,
  scheduleSectionIds,
  signSchedulePayload,
  signatureMessage,
  slimEnrollment,
  verifyScheduleSignature,
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
              weekday: 'Wed',
              start_time: '09:00',
              end_time: '12:00',
              mode: 'laboratory',
              is_online: false,
              room: { code: 'EE-201', name: 'EE 201' },
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
  it('extracts schedule fields and never grade fields', () => {
    const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115' });
    expect(slim.term).toEqual({
      term: '2nd Semester',
      academicYear: '2026-2027',
      termNumber: 2,
    });
    expect(slim.student.number).toBe('2024104115');
    expect(slim.classes).toHaveLength(3);

    const lec = slim.classes[0];
    expect(lec.courseCode).toBe('CPE 307');
    expect(lec.section).toBe('CPE 3C');
    expect(lec.sectionTypes).toEqual(['LEC']);
    expect(lec.faculty).toBe('Jimenez, Monaliza S.');
    expect(lec.meetings[0]).toMatchObject({
      weekday: 'Mon',
      startTime: '14:00',
      endTime: '17:00',
      mode: 'lecture',
      type: 'LEC',
      isOnline: false,
      room: { code: 'NH-509*', name: 'NH 509*' },
    });

    const lab = slim.classes[1];
    expect(lab.sectionTypes).toEqual(['LAB']);
    expect(lab.meetings[0].room.code).toBe('EE-201');

    const nstp = slim.classes[2];
    expect(nstp.meetings).toEqual([]);
    expect(nstp.sectionTypes).toEqual([]);
  });

  it('returns null without registration subjects', () => {
    expect(slimEnrollment({})).toBeNull();
    expect(slimEnrollment({ registration: { subjects: 'nope' } })).toBeNull();
  });
});

describe('schedule payload', () => {
  const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115', full_name: 'Santos, J.' });

  it('builds a versioned payload with no grade data', () => {
    const payload = buildSchedulePayload(slim, { generatedAt: '2026-11-22T00:00:00.000Z' });
    expect(payload.v).toBe(1);
    expect(payload.source).toBe('alab-grade-tools');
    expect(payload.term.label).toBe('2nd Semester AY 2026-2027');
    expect(payload.student).toEqual({ number: '2024104115', name: 'Santos, J.' });
    expect(payload.classes).toHaveLength(3);
    expect(payload.signature).toBeNull();

    const json = schedulePayloadJson(payload);
    expect(json).not.toMatch(/"(grade|gwa|remarks?)"\s*:/i);
  });

  it('round-trips through the URL fragment', () => {
    const payload = buildSchedulePayload(slim);
    const url = roomTbaScheduleUrl(payload);
    expect(url.startsWith('https://room-tba.bulsu.tools/#schedule=')).toBe(true);
    const parsed = parseScheduleFragment(url);
    expect(parsed.v).toBe(1);
    expect(parsed.classes[0].courseCode).toBe('CPE 307');
    expect(parsed.classes[0].meetings[0].room.code).toBe('NH-509*');
  });
});

describe('HMAC signature', () => {
  const slim = slimEnrollment(ENROLLMENT, { student_no: '2024104115' });

  it('signs and verifies with the documented canonical string', async () => {
    const payload = buildSchedulePayload(slim);
    const expiresAt = 1800000000000;
    const nonce = 'testnonce123456789';
    await signSchedulePayload(payload, { expiresAt, nonce });

    const sig = payload.signature;
    expect(sig.alg).toBe('HMAC-SHA256');
    expect(sig.kid).toBe('alab-schedule-v1');
    expect(sig.expiresAt).toBe(expiresAt);
    expect(sig.nonce).toBe(nonce);
    expect(sig.sectionIds).toEqual(scheduleSectionIds(payload));

    // Canonical string matches docs/schedule-payload.md.
    const expected = signatureMessage({
      studentNumber: '2024104115',
      sectionIds: sig.sectionIds,
      expiresAt,
      nonce,
    });
    expect(expected.split('\n')).toEqual([
      'alab-schedule-v1',
      '2024104115',
      sig.sectionIds.join(','),
      String(expiresAt),
      nonce,
    ]);

    expect(await verifyScheduleSignature(payload)).toBe(true);
  });

  it('rejects tampering with signed fields', async () => {
    const payload = buildSchedulePayload(slim);
    await signSchedulePayload(payload, { nonce: 'abc' });
    // The signature covers student number + section IDs + expiry + nonce
    // (not the meeting details), so tamper a signed field.
    payload.student.number = '9999999999';
    expect(await verifyScheduleSignature(payload)).toBe(false);
  });

  it('fragment round-trip preserves the signature', async () => {
    const payload = buildSchedulePayload(slim);
    await signSchedulePayload(payload, { nonce: 'frag' });
    const parsed = parseScheduleFragment(roomTbaScheduleUrl(payload));
    expect(await verifyScheduleSignature(parsed)).toBe(true);
  });
});
