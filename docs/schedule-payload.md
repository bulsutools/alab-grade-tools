# Schedule payload contract

Versioned JSON payload exported by ALAB Grade Tools for downstream consumers:
Room TBA (`room-tba#16`), per-section class hubs, planners. Schedule fields
only. **Grades are never included**, by design and by construction: the
payload is built from `GET /enrollment/me` only. `/students/me/grades` may be
read once to recover `student.number` when the enrollment payload omits it;
the grades in that response are discarded in memory and never stored or
exported.

Source endpoint: `https://alabsms-server.bulsu.edu.ph/api/v1/enrollment/me`,
authenticated with the same `POST /auth/refresh` → `accessToken` flow used by
ALAB GradeSim. Recon (room-tba#16 comments) confirmed ALAB SMS exposes
`class_offering.meetings[]` with `weekday`, `start_time`, `end_time`, `mode`,
`is_online`, and `room: {code, name}`; faculty name and section name are also
present. If a deployment omits rooms, `room` is `null` and consumers degrade
to section + time only.

## Payload shape (`v: 1`)

```json
{
  "v": 1,
  "source": "alab-grade-tools",
  "generatedAt": "2026-11-22T12:00:00.000Z",
  "term": {
    "label": "2nd Semester AY 2026-2027",
    "term": "2nd Semester",
    "academicYear": "2026-2027",
    "termNumber": 2
  },
  "student": {
    "number": "2024104115",
    "name": "Santos, John Carlo"
  },
  "classes": [
    {
      "courseCode": "CPE 307",
      "title": "OHSP",
      "units": 3,
      "section": "CPE 3C",
      "sectionTypes": ["LEC"],
      "faculty": "Jimenez, Monaliza S.",
      "meetings": [
        {
          "weekday": "Mon",
          "startTime": "14:00",
          "endTime": "17:00",
          "mode": "lecture",
          "type": "LEC",
          "isOnline": false,
          "room": { "code": "NH-509*", "name": "NH 509*" }
        }
      ]
    }
  ],
  "signature": null
}
```

Field notes:

- `term.termNumber`: 1 = 1st semester, 2 = 2nd semester, 3 = summer/midyear,
  matching ALAB SMS `academic_term.term_number`. `null` when absent.
- `sectionTypes`: deduped compact types derived from meeting modes:
  `lecture` → `LEC`, `laboratory` → `LAB`, `recitation`/`seminar` → `SEM`.
  Matches the `enlisted` refs ALAB GradeSim already sends Room TBA's planner.
- `meetings[].mode`: raw ALAB SMS mode string (`lecture`, `laboratory`,
  `recitation`, `seminar`, others pass through). `meetings[].type` is the
  compact form; `meetings[].room` is `null` for online or unassigned meetings.
- `meetings[].startTime`/`endTime`: ALAB SMS `HH:MM` 24-hour strings, kept
  verbatim. `meetings[].weekday`: short weekday string as returned (`Mon`,
  `Wed`, ...). Consumers should treat both as opaque until the receiving side
  (room-tba#16) pins the normalization rules.
- `student.number`/`student.name`: `null` when ALAB SMS does not expose them.
  Without a student number the payload is unsigned.
- `signature`: `null` or the HMAC block below. Personal-view consumers can
  ignore it; dataset contributors need it.

A JSON Schema for validation lives at `docs/schedule-payload.schema.json`.

## URL fragment transport (personal "my classes" view)

"Send to Room TBA" opens:

```
https://room-tba.bulsu.tools/#schedule=<base64url>
```

`<base64url>` is the compact JSON payload (no whitespace) encoded as
base64url. The fragment never reaches a server, so nothing is published and
no auth is needed. The receiving side (room-tba#16) parses
`location.hash` for `schedule=` and renders the personal view client-side.
Room TBA should treat unsigned or expired payloads as personal-view only;
only signed payloads feed dataset contribution.

## HMAC signature (dataset contribution, use case B)

`signature` is present only when `student.number` is known. It proves the
payload came from a build of this extension and is fresh; per room-tba#16 it
does **not** prove enrollment, because the signing key ships inside the
extension and student numbers are not secret.

```json
{
  "alg": "HMAC-SHA256",
  "kid": "alab-schedule-v1",
  "value": "<base64url HMAC-SHA256>",
  "expiresAt": 1735689600000,
  "nonce": "<base64url 16 random bytes>",
  "sectionIds": ["CPE 307|CPE 3C", "CPE 312L|CPE 3C"]
}
```

- `expiresAt`: unix-ms timestamp. Default TTL is 24 hours
  (`SIGNATURE_TTL_MS` in `src/schedule.js`). Receivers should reject expired
  signatures.
- `nonce`: 16 random bytes, base64url. Receivers dedupe on it.
- `sectionIds`: one `"<courseCode>|<section>"` per class (empty section
  yields a trailing `|`), sorted lexicographically. Receivers should
  recompute the IDs from `classes` and compare with `signature.sectionIds`
  so meeting details cannot be swapped under a valid signature.

Canonical signed string (UTF-8, fields joined by `\n`):

```
alab-schedule-v1
<student.number or "">
<sectionIds joined by ",">
<expiresAt as decimal integer>
<nonce>
```

HMAC key: SHA-256 HMAC with the raw 32-byte key, base64-encoded as
`B5cQtdDeLPDLQ7kvFFCGoFEk/w2oigSrnDHe8y2eBuI=` (constant `SIGNING_KEY_B64`
in `src/schedule.js`). The same key must be configured on the Room TBA side;
rotation means bumping `kid` to `alab-schedule-v2` and shipping a new key in
both repos.

Reference implementation: `signSchedulePayload` /
`verifyScheduleSignature` in `src/schedule.js`. Dedup key for dataset
building remains `(courseCode, section, room.code)` per room-tba#16.
