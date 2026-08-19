## Closing the in-run duplicate window (Base44 checkpoint 6a852c2eeba6f2d1b6ed4b59)

**Changed**: `shared/notificationHelpers`, `cleanupNotificationBacklog`, `sendOnboardingReminders`, `src/api/db.js`

The dedupe deployed at 03:53. Checking whether it was working turned up a batch of duplicates at 03:17 — 36 minutes earlier, so old behaviour rather than a failure. But the shape of that batch showed a gap worth closing.

Within that single run, "Management review required: Critical Visit Note: Joan Temple" was created for the same manager twice, **1.1 seconds apart**. Several source notifications in one pass carried the same title, and the helper's lookup can only skip a duplicate it can see. If a write is not yet visible to a read a second later, the second escalation goes through anyway.

`createNotificationIfAbsent` now takes an optional `seen` Set shared across a run, and both callers pass one. That closes the window without depending on how quickly writes become queryable — the query still catches duplicates from previous runs, the Set catches duplicates within this one.

### A query shape that fails silently

While checking, `{ created_date: { $gte: '2026-08-18T00:00:00' } }` returned zero rows despite records from 2026-08-19 plainly existing. The same range shape on `start_datetime` — an ordinary schema field — returns the right rows.

So at least one query form does silently return `[]`, and it is the one over a **server-managed** field. That does not settle the compound-filter question, which is about multi-field queries through the SDK, but it is the first hard evidence that this backend does sometimes answer a well-formed query with nothing rather than an error. It is recorded in `src/api/db.js` alongside the rest, with the practical rule: filter on your own fields and narrow dates in JS.

It also means my own earlier check — "zero notifications older than the cutoff are unarchived", which I used to clear the archive job — was itself a `created_date` range query and cannot be trusted. The conclusion may still hold, but the evidence for it does not. Re-checking it needs a different method.

Verified: 143 backend modules bundle; `vite build` clean; all five check scripts pass; lint unchanged at 928 pre-existing errors.

