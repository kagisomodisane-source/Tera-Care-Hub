## Backend db wrapper, one function migrated as a trial (Base44 checkpoint 6a84f692485c85c9fab9cb8c)

**New**: `base44/functions/shared/dbHelpers/entry.ts`
**Changed**: `base44/functions/markPolicyAsRead/entry.ts`, `scripts/verify-db-wrapper.mjs`, `entityUpdateHelpers.js`

One function, not 156. There is no Deno in the sandbox, so backend changes cannot be run or type-checked here; migrating every function blind would risk taking down medication data, payroll and clock-in at once on a single wrong import. This proves the pattern on something safe first.

### The shared module

`createDb(base44.asServiceRole.entities)` gives the same `db.Entity.method()` surface as the frontend: reads pass through, writes lose server-managed fields, partial updates stay partial. It sits alongside the shared modules that already exist (`authHelpers`, `billingHelpers`, and eight more) and uses the same `'../shared/<name>/entry.ts'` import other functions already rely on.

It cannot import the frontend's copy — the frontend and the functions are separate bundles — so the `SYSTEM_FIELDS` list is duplicated on purpose. `verify:db` now compares the two and fails if they drift, which is the one way two copies quietly become dangerous. Confirmed it fires: removing `is_sample` from the backend list fails the check and prints both lists.

### Why markPolicyAsRead

It is the most-invoked function from the UI, and it exercises a broad slice of the wrapper in one go: `list`, `filter` twice, `create`, and three partial `update`s. It is also cheap to get wrong — the worst case is a policy staying unread. Nothing is deleted and no money or medication is touched.

`base44.auth` is untouched; only entity access moved.

### What could not be verified here

Both files bundle cleanly under esbuild with the shared import resolving, exactly as `authHelpers` does. That proves the syntax and the module path, not the runtime.

Two of the writes returned "Change was committed to git but failed to apply — Revision … failed" from the platform's function deployment step. The files landed on disk correctly and committed, and the later checkpoint went through without complaint, so this looks like a transient deploy hiccup rather than broken code. It is the reason this is a trial rather than a sweep.

### To confirm it works

Open a policy and mark it as read — Training hub, My Assigned Policies, Policy Management or Policy Acknowledgments all call it. It should record the read, appear in the read list, and complete a matching assignment if one exists. If it errors, the function reverts by restoring the checkpoint before this one.

Once confirmed, the remaining 155 functions follow the same mechanical shape: add the import, build `db` from the client, rename `base44.asServiceRole.entities.` to `db.`.

Verified here: `vite build` clean; `verify:db` (29 checks, including the new drift check), `verify:recurrence`, `verify:residency`, `audit:query-keys`, `audit:query-init` all pass; lint unchanged at 928 pre-existing errors.

