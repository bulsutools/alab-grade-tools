// ALAB SMS API access for the schedule export. Mirrors the auth flow used by
// alab-gradesim (extension/src/alab-content.js on the alab-sms branch): the
// httpOnly refreshToken cookie is traded for a short-lived accessToken JWT.
// Only schedule-relevant fields leave this module; grades are never stored
// or exported.

const API = 'https://alabsms-server.bulsu.edu.ph/api/v1';

async function accessToken() {
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.accessToken ? data.accessToken : null;
}

async function api(token, path) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(path);
  return res.json();
}

function studentFromGrades(data) {
  const student = data && data.data && data.data.student;
  if (!student || typeof student !== 'object') return {};
  return {
    student_no: student.student_no,
    full_name: student.full_name,
  };
}

// Fetches /enrollment/me and returns { ok, reason?, enrollment?, student? }.
// When the enrollment payload does not name the student, /students/me/grades
// is read once for student_no/full_name only — the grades themselves are
// discarded and never stored or exported.
export async function fetchScheduleSource() {
  const token = await accessToken();
  if (!token) return { ok: false, reason: 'not-logged-in' };

  let enrollment;
  try {
    enrollment = await api(token, '/enrollment/me');
  } catch {
    return { ok: false, reason: 'alab-error' };
  }
  if (!enrollment || !enrollment.registration) {
    return { ok: false, reason: 'alab-error' };
  }

  const student =
    (enrollment.student ?? enrollment.data?.student ?? enrollment.registration?.student) || {};
  let studentInfo = {
    student_no: student.student_no,
    full_name: student.full_name,
  };

  if (!studentInfo.student_no) {
    try {
      const grades = await api(token, '/students/me/grades');
      studentInfo = { ...studentInfo, ...studentFromGrades(grades) };
    } catch {
      void 0;
    }
  }

  return { ok: true, enrollment, student: studentInfo };
}
