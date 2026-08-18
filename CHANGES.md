## An SDK wrapper, and two pieces of folklore disproved (Base44 checkpoint 6a84f1b9760274d54ad8186c)

**New**: `src/api/db.js`, `src/api/dbFactory.js`, `scripts/verify-db-wrapper.mjs`
**Changed**: 214 files (820 call sites), `eslint.config.js`, `entityUpdateHelpers.jsx` → `.js`

### The premise changed before I built it

The wrapper was meant to make partial updates impossible, because `update()` is `axios.put` and `entityUpdateHelpers.js` said PUT was a full replace. Before writing it I checked both assumptions against production data, read-only. Both were wrong.

**update() merges.** `DocumentReadReceipt` rows written by `CarePlanViewer` with only `{ view_count }` still hold `document_title`, `user_email`, `document_id`, `client_id` and `document_type`, with `updated_date` later than `created_date`. `Notification` rows written with only `{ read, action_taken }` keep their title and message. So the 185 partial-update call sites are not bugs, and forcing whole-record writes would have meant an extra fetch wherever only an id is in scope plus a real risk of a stale record overwriting someone else's concurrent edit.

**Compound filters work**, including operators — `{status, is_overnight}` and `{status: {$in: [...]}}` both return correct rows. Comments in seven files claim they silently return `[]`. That is folklore, and a guard built on it would have broken 365 working call sites.

This also means my earlier claim that bulk status change "could never have worked" was wrong: `Shift.update(id, {status})` merges and works. That claim came from inference, not evidence.

### What was built instead

`db.Shift.list(...)` behaves exactly like the SDK call it replaces. The only behaviour added is the one thing the old comment was right about: **server-managed fields are stripped from every write**. Sending `id`, `created_date` or `created_by` back can fail validation and lose the whole save, which is easy to do by accident whenever a record read from the API is spread into a write — and only about a third of the 304 update sites were guarding against it.

Partial updates stay partial, which is now the documented default.

The wrapper is also where what we know about this backend is written down, with the evidence, so it does not have to be rediscovered. Anything learned later belongs there.

### Enforcement

An eslint `no-restricted-syntax` rule rejects `base44.entities` anywhere outside `src/api/db.js`, pointing at the wrapper. Confirmed it fires: planting `base44.entities.Client.list(` in `Clients.jsx` produces an error at that line; the real tree has none. `src/api/**` was added to the lint config's file list, since it previously covered only components, pages and `Layout.jsx`.

`base44.auth`, `base44.functions` and `base44.integrations` are untouched — 113, 169 and 77 uses respectively.

### Verification

`npm run verify:db` — 27 checks against a stub entity layer, covering that reads pass through unchanged, that compound filters are not mangled, that writes lose exactly the system fields and keep everything else, and that a partial update stays partial with no read-before-write. Mutation-tested: dropping the strip, forcing a whole-record send, and mangling compound filters each fail the checks that name them.

The factory lives in `dbFactory.js` so node can load it without a browser; that required renaming `entityUpdateHelpers.jsx` to `.js`, which it should always have been — it contains no JSX, and all 18 importers use extensionless paths.

Verified: `vite build` clean; `verify:db`, `verify:recurrence`, `verify:residency`, `audit:query-keys`, `audit:query-init` all pass; zero rule violations. Lint errors went 929 → 928: the migration added one (my "still uses base44" check matched a `media.base44.com` URL), which is fixed. Every remaining error is the pre-existing `unused-imports` rule.

