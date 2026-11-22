// Bridge credentials shared with Room TBA's ALAB schedule endpoint
// (bulsutools/room-tba#16, docs/alab-schedule-bridge.md). This is a browser
// extension: both values ship inside the bundle and are extractable by
// anyone who reads it. They are not access control. Per the receiver doc
// they only signal "this came from an ALAB Grade Tools build" and provide
// freshness/replay bounds. Reviewers treat every contribution as unverified
// volunteer data.
//
// BRIDGE_SECRET must match Room TBA's ALAB_BRIDGE_SECRET env var byte for
// byte: the receiver passes the env string straight to createHmac, so the
// HMAC key is the UTF-8 bytes of this string, not a base64 decode of it.
// STUDENT_HASH_SALT is mixed into the student hash; Room TBA never sees the
// raw student number.

export const BRIDGE_SECRET = 'B5cQtdDeLPDLQ7kvFFCGoFEk/w2oigSrnDHe8y2eBuI=';
export const STUDENT_HASH_SALT = 'alab-grade-tools:student-hash:v1';
