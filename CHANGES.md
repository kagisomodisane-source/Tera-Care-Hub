## Correcting the PUT folklore (Base44 checkpoint 6a84f322681c41b9b2b4cff5)

**Changed**: 10 comments across 9 files, plus `src/api/db.js`

### The "full replace" claim is gone

Ten comments asserted that `update()` is a PUT that replaces the whole record. It isn't — the server merges. All ten now say what the code does and why, without the false reason. Four of them I wrote earlier in this session, which is how the mistake propagated: I read the claim in `entityUpdateHelpers.js`, believed it, and repeated it in `residencyTransfer.js`, `LocationManager.jsx`, `ShiftManagement.jsx` and `bulkReassignShifts/entry.ts`.

The root comment now carries the correction explicitly, so the next reader gets the fix rather than the folklore.

No code changed. Every whole-record merge stays exactly as it was — it works under either behaviour, and you asked to keep them. The comments now note the one real cost: sending a whole record can overwrite a field someone else changed in the meantime.

### One conflict preserved rather than erased

`MyMileageClaims.jsx` did not merely assert the rule — it recorded an observation: sending the form bare "wiped" the approval trail, the payslip reimbursement link and the GPS provenance. That contradicts what I found. Rather than delete it, the comment now keeps the claim and marks it unresolved: either it was inferred rather than observed, or the platform's behaviour changed. Merging is correct either way, so the code stays; the next person is told not to treat the old claim as fact without re-checking.

Deleting an inconvenient observation because it disagrees with a newer test would be the same mistake in the other direction.

### And a correction to my own overclaim

Last commit, `db.js` said compound filters "WORK … that is folklore and it is wrong." That was too strong, and I have softened it.

What I actually established is that the **server** answers compound queries correctly — two-field equality, `$in`, and a `$gte`/`$lte` date range all return the right rows. What I did not test is the **SDK's own path** (`GET` with `q=JSON`), which is what the eighteen work-around call sites actually use, and which needs a browser with real credentials.

Eighteen independent workarounds is meaningful evidence, and one admin-API test does not overturn it. `db.js` now states both sides, says plainly which is untested, and asks whoever can run a two-field `entity.filter()` against the live API to settle it and record the answer. The workarounds stay — they are harmless, and removing them on a half-proof is how this kind of mistake starts.

Verified: `vite build` clean; `verify:db`, `verify:recurrence`, `verify:residency`, `audit:query-keys`, `audit:query-init` all pass; lint unchanged at 928 pre-existing errors; zero wrapper-rule violations.

