## The backend on the db wrapper (Base44 checkpoints 6a850bd7b369d1d0fd18dad1, 6a850df8acec4e79ade8af76)

**Changed**: 142 functions + 5 shared modules, `base44/functions/shared/dbHelpers/entry.ts`

Every backend entity call now goes through the wrapper. No `asServiceRole.entities` or `.entities[` remains anywhere in `base44/functions`.

### The rename carries the client with it

The obvious approach — insert `const db = ...` after the client is built, then rename — needs to know where the client was declared. That falls apart quickly here: four shared modules receive `base44` as a function parameter, `chatWebSocket` builds two clients, and `backupVisitNoteToOneDrive` assigns rather than declares. With no Deno available to catch a mistake, scope analysis across 142 untestable files was the wrong bet.

So the call site carries the client instead:

```
base44.asServiceRole.entities.Shift  ->  serviceDb(base44).Shift
base44.entities.Shift                ->  userDb(base44).Shift
```

That is correct wherever the client is in scope, including inside helpers, with no analysis at all. Wrappers are memoised per client in a WeakMap, so repeating the call costs nothing.

### Naming the scope was the point

`base44.asServiceRole.entities.X` and `base44.entities.X` differ by one easily-missed word while meaning "any row in the system" versus "rows this user may see". `serviceDb(...)` and `userDb(...)` do not blur together when skim-read. The split came out at **555 service-role and 20 user-scoped** calls, the 20 landing in exactly the seven files that were user-scoped before — which is the check that matters, since silently converting a service-role read to a user-scoped one would hide rows rather than fail loudly.

### Three things the migration got wrong first

**Shared modules got the wrong import path.** They live a level deeper, so `'../shared/dbHelpers/entry.ts'` resolved to `shared/shared/dbHelpers`. Seven functions failed to bundle, all tracing back to two shared modules. Fixed to `'../dbHelpers/entry.ts'` for anything under `shared/`.

**An aliased client was mislabelled.** `contentScheduler` does `const client = base44.asServiceRole` and then `client.entities.…`. With no literal `.asServiceRole` at the call site, the rename made it `userDb(client)`. It still resolved to service-role entities, so behaviour never changed — but the call sites now claimed a scope they did not have, which is precisely the confusion the naming exists to prevent. It is the only file in the codebase that aliases the client, and it is now `serviceDb(base44)`.

**A blanket `db.` replace mangled a comment**, turning `src/api/db.js` into `src/api/serviceDb(base44).js`. Caught on inspection and restored.

None of these would have been found by reading the diff summary. They came out of bundling every file.

### Verification

All 142 functions bundle under esbuild in a single pass with every shared import resolving. That proves syntax and module resolution, not runtime — the same limit as the trial migration, which is why the trial went first and why the work was split into a lower-risk batch of 125 and a high-stakes batch of 20 (clock-in, payroll, timesheets, invoicing, medication, account deletion) with a checkpoint between them.

`markdownPdfHelpers` fails to bundle on `./markdownPdfParser.js`. It has no reference to the wrapper and predates this work; Deno resolves that import where esbuild does not.

Frontend unaffected: `vite build` clean, all five check scripts pass, lint unchanged at 928 pre-existing errors.

