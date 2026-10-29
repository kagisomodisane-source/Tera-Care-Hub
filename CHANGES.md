## Saving a new service user (Base44 checkpoint 6ae3497b8749047a47a703c9)

**New**: `scripts/verify-client-create.mjs`
**Changed**: `base44/functions/createClient/entry.ts`, `package.json`

### One missing word in a list

`createClient` refuses any field it does not recognise:

```js
if (Object.keys(input).some((key) => !ALLOWED_FIELDS.has(key) && key !== 'name'))
  return safeErrorResponse('Request contains unsupported fields', 400);
```

`ClientCreateDialog` has a **Funding Notes** textarea, holds `funding_notes` in
its form state, and sends `{ ...formData }`. `funding_notes` was not in
`ALLOWED_FIELDS`.

So `funding_notes: ""` was in every payload whether anyone typed in the box or
not, and **every attempt to add a service user from the Clients page was
rejected before a single value was read**. Not an edge case and not dependent on
the input: the dialog could not succeed. All the page said was "Failed to create
client", and the description it passed through was `Request contains unsupported
fields` — with no field named.

`funding_notes` is a real property of `Client`. It is in the allowlist now.

### The rejection was right; being vague about it was not

Refusing an unknown field is correct here. The alternative — dropping it
quietly, which `ALLOWED_FIELDS` already does on the way to `Client.create` a few
lines later — would save a service user with whatever the operator typed
missing, and nobody would know until someone needed the funding note. That is
worse than a failed save.

What was wrong is that the message named nothing, so a one-word omission
presented as "I can't save service users". The 400 now lists the offending
fields, and the check collects all of them rather than `.some()` tripping on the
first.

### The check found a second one

`email` was in `ALLOWED_FIELDS`. `Client` has `manager_email` and
`billing_email` and no plain `email`, so the function was accepting a field it
had nowhere to put: rejected by the entity, or dropped on the way in, and either
way advertised as saveable when it was not. The single caller never sent it, so
nothing was visibly broken — it was waiting for someone to use it. Removed.

### What actually prevents this recurring

Three lists had to agree by hand and nothing compared them: the fields the form
sends, the fields the backend accepts, and the properties the entity has.
`verify:client-create` holds them against each other — every form field and
every payload override must be accepted by the backend, and every accepted field
must exist on the entity.

Six mutations, all caught: removing `funding_notes` again; **adding a new field
to the form that the backend does not accept**, which is this bug exactly;
putting `email` back; reverting to `.some()` with an unnamed error; dropping the
post-validation filter; and dropping the `super_admin/admin/manager` gate.

### Noted, not changed

Three places create a `Client`. The Clients page goes through `createClient`,
which validates, filters and audits. `ClientOnboardingWizard` and
`ResidentManager` call `db.Client.create` directly, so they get none of that —
no field validation, no `client_created` audit entry. That is worth consolidating,
but routing them through `createClient` would need the allowlist widened to
cover what they send, and widening it blind is how this bug reads in reverse. It
wants doing deliberately rather than as part of a fix to the save button.

### Verification

`verify:all` green: 139/139, 101/101, 42/42, 28/28, 31/31, 23/23, 12/12, billing
agreeing, build clean.

---

## Notifications and PWA push (Base44 checkpoint 6ae17431ef8c2580aeff7a33)

**New**: `scripts/verify-notifications.mjs`
**Changed**: `notificationService`, `savePushSubscription`, `PushInitializer.jsx`, `SmartPushManager.jsx`, `PWAInitializer.jsx`, `public/sw.js`, `package.json`

### What the live data said

34 `PushSubscription` rows. The active ones are current — `updated_date` today,
complete `endpoint` and `p256dh`/`auth` keys — so subscribing works. But the
last successful delivery anywhere was **4 October**, and the subscriptions
created since (17, 22, 23 October) have `last_success_at: null` **and**
`last_error_at: null`.

No success and no error is not a delivery problem. It means nothing was
attempted. The send loop records both outcomes reliably — July and August show
410s turning rows inactive — so the only path that leaves no trace at all is the
one where `webpush` is null:

```js
if (needsPush) {
  if (vapidPublicKey && vapidPrivateKey && vapidSubject) { webpush = ...; }
}
...
if (channels.includes('push') && webpush) {   // false: nothing happens
```

**VAPID is not fully configured on the server**, and when it isn't, push is
skipped with no error, no counter, nothing written to any row, and
`success: true` with `sent.push: 0` returned to the caller. Push can be off for
a month and the only evidence is an absence. That needs checking in the Base44
dashboard — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — and
`getVapidPublicKey` returning 500 would confirm which. I cannot read deployed
secrets from here, so that part is yours.

What the code now does is refuse to be quiet about it: the missing variables are
named in `results.errors`, every notification that wanted push and could not
have it is counted under `skipped.not_configured`, the response carries
`push_configured`, and the log line says so. A row whose stored subscription has
lost its endpoint is counted too, instead of a bare `continue` that made it look
like the person had push.

### A shared device locked everybody out but the first

A push endpoint identifies the **browser**, not the person. `savePushSubscription`
treated it as the person's:

```js
if (existing.some(record => record.user_email !== user.email))
  return Response.json({ error: 'Forbidden' }, { status: 403 });
```

So on a shared tablet the second carer to sign in got a 403 — swallowed by the
client, which still toasted "Push notifications enabled!" — and never received a
push. Meanwhile the first carer kept being sent to a device they had handed over,
so their shift and message alerts rendered on screen for whoever was signed in.
A delivery bug and a confidentiality one in the same four lines.

Ownership now follows whoever is authenticated in that browser, duplicate rows
for the endpoint are retired so the previous owner stops receiving on it, and the
reassignment is audited at medium severity, because it changes who receives
clinical alerts.

The client had the same assumption independently: the "already synced" cache was
keyed on the endpoint alone in `localStorage`, which belongs to the browser, so
the next person matched the previous person's entry and was never registered at
all. The key includes the account now, and with no identity available it syncs
rather than risk skipping.

### Three more

- **"Push notifications enabled!" was a lie.** It fired on permission grant while
  `saveSubscription` caught and logged whatever failed underneath. Permission is
  not registration. The save now throws, the caller reports it, and the success
  toast comes after the await.
- **Service worker updates never reached anyone.** No `skipWaiting`, so a new
  worker waited for every tab to close — which in an installed PWA is close to
  never. Fixes to push handling could ship and sit there. It now calls
  `skipWaiting` on install and `clients.claim` on activate.
- **Offline navigation showed the browser's error page.** `caches.match('/') ||
  caches.match('/index.html')` cannot work: `caches.match` returns a Promise,
  which is always truthy, so the second branch was unreachable and a miss
  resolved to `undefined` — and `respondWith(undefined)` is a network error, not
  a fallback. Also `.slice(0, -1)` dropped one cache from the delete list on
  every activation, so a stale one survived each version.

### One way to subscribe

`SmartPushManager` carried a second, complete subscribe path — `requestPermission`,
`pushManager.subscribe`, `savePushSubscription` — that nothing called, next to
the live one in `PushInitializer`. Two implementations with one dead is how an
afternoon goes on fixing the copy that never runs. It is gone, and a check now
asserts exactly one non-diagnostic file calls `pushManager.subscribe`.

`setupNotificationHandlers` was an empty function that `PWAInitializer` called;
removed, along with the call. `handleNotification` (unused) passed a `tag` where
a notification *type* was expected and keyed its cooldown on it, so with no tag
every notification shared one five-minute bucket and suppressed unrelated ones;
it reads the type now, and says in a comment that it is unwired.

### Verification

`npm run verify:notifications` — 23 checks, in `verify:all`. Suite green:
139/139, 101/101, 42/42, 28/28, 31/31, 23/23, billing agreeing, build clean,
`sw.js` parses.

Thirteen mutations. **Two rounds were needed, and both failures were the same
mistake in opposite directions:** these are source-invariant checks, and the
comment above each fix quotes the code it replaced. So the "must be gone" checks
failed on prose describing the old bug, and the "must be present" check for
`toJSON()` kept passing after the call was deleted, because the comment
explaining why `toJSON` matters still said it. Comments are stripped before
every pattern test now. A check that cannot tell code from a description of code
punishes explaining yourself.

Also recorded because it cost real recovery: the first mutation run backed each
file up as `/tmp/$(basename $f)`, and every Base44 function file is called
`entry.ts`. The backups collided, and the restore overwrote
`notificationService/entry.ts` with a copy of `savePushSubscription/entry.ts`.
Recovered from commit `3b74f37c7` after confirming the damage by line count and
markers rather than by the first three lines, which are legitimately identical in
both files. Backups are keyed on the full path now.

---

## Validating the manager time override (Base44 checkpoint 6ae0830ea6d6dc235b8a954d)

**New**: `src/components/shifts/timeOverrideValidation.js`, `scripts/verify-time-override.mjs`
**Changed**: `ShiftManagement.jsx`, `package.json`

### NaN is why the bad value was stored

Shift `6ab12d20036c1da0170f0b19` carries a clock-out of `"92026-02-09T08:00"`.
`<input type="datetime-local">` lets a year be typed and its year box takes more
than four digits, so this is an ordinary slip. It is not valid ISO 8601, so
`new Date()` rejects it and every comparison on it is NaN.

The mutation *did* guard the duration:

```js
const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));
if (durationMinutes <= 0) throw new Error("Clock out must be after clock in");
```

`Math.round(NaN)` is NaN, and `NaN <= 0` is **false**. The guard passed. So the
check that looks protective is the reason the value got through — and
`duration_minutes` was then written as NaN, which `JSON.stringify` turns into
`null`. The payroll duration was *erased*, not merely wrong. The stored clock-out
went on to crash every page that formatted it, which is the Visit Notes outage.

Four places compared the same two values and all four were blind the same way:
the mutation, the submit handler, the Save button's `disabled`, and the duration
panel. The panel used `>` so it fell to its else branch and displayed
**"Clock out must be after clock in"** — while the button, testing the same NaN
with `<=`, stayed **enabled**. The operator saw an error and could still save.
A single rule now answers for all four.

### The rule

`validateOverrideTimes({ clockIn, clockOut, shiftStart })` parses before it
compares — reversing those two steps is the original bug — and returns the
duration it computed, so nothing downstream recomputes it:

- each value must parse, reported against the field that is wrong, with a
  message that names the year rather than blaming the ordering;
- a value that parses can still be absurd: `+092026-02-09T08:00` is valid ISO
  and lands in the year 92026. So a correction must fall within **7 days** of
  the shift it corrects. A shift with no usable `start_datetime` skips that
  check, because a shift that does not know when it was is not grounds to block
  a fix;
- the duration is tested with `Number.isFinite`, not a comparison a NaN walks
  through.

Dependency-free, so the page and the verify script import the same file and
cannot drift.

The broken shift is still correctable through the dialog: it seeds from
`safeDateParse`, which returns null for the bad value, so the field opens empty
rather than crashing, and a date near the shift passes the new window.

### Verification

`npm run verify:time-override` — 31 checks, wired into `verify:all`. Suite green:
139/139, 101/101, 42/42, 28/28, 31/31, billing agreeing, build clean.

Seven mutations, and **the first draft caught only six**. Swapping
`Number.isFinite(durationMinutes)` for a bare `durationMinutes <= 0` inside the
module changed nothing observable, because the parse checks reject a NaN before
the duration test can ever see one. It is unreachable defence in depth — and it
matters precisely when someone later removes a parse check, which is how the
value was stored the first time. Resting the last line of defence on the first
one is what this whole entry is about, so it is now pinned as a source
invariant. The other six: dropping the parse check; dropping the range check;
the mutation no longer throwing on a failed result; the NaN-blind guard
reappearing in the mutation; the Save button returning to a hand-rolled date
comparison; and validation moving after the update object is built.

---

## The missing calendar toggle was Margin (Base44 checkpoint 6ae079b9e511f272e0964e29)

**Changed**: `ShiftCalendarView.jsx`, `manageAccessRequests`, `shared/billingHelpers/entry.ts` (resynced), `scripts/verify-access-scope.mjs`, `scripts/verify-compliance.mjs`

### The toggle

`summariseBilling` has always returned a `margin`, and its own comment says
`isComplete` exists "so that the margin can be shown without a caveat". Nothing
in the app ever read it. The calendar destructured `revenue`, `cost` and `hours`
from the same object and dropped the fourth figure on the floor.

So the third toggle now exists, beside Hours and Revenue & Costs. It reads
`periodSummary.margin` rather than subtracting the two displayed numbers — a
subtraction of two rounded figures is not the same number — and it colours the
value rose when negative, because a loss-making week is the one thing on this
screen a manager must not scroll past. Day cells get the same line, suffixed `*`
when that day had an unpriced or uncosted shift, since a margin built on a
missing rate is fiction rather than a small error.

The unpriced/uncosted warning chip used to sit inside the Revenue & Costs
branch. It now covers either toggle, so turning on Margin alone cannot show a
confident figure with the caveat hidden.

### Two other things in the same code

**The per-shift badge only ever showed cost.** The toggle is labelled
"Revenue & Costs"; each shift carried a `Cost` badge and nothing else, so every
shift read as pure expense. It now shows both.

**The day cells and the footer above them were two implementations of one sum.**
Day totals ran their own `reduce` over `getShiftRevenue`/`getShiftPayrollCost`;
the footer used `summariseBilling`. They rounded at different points, so a
month's cells did not have to add up to the figure printed above them, and the
day cells had no way to report a shift they could not price — a day of unpriced
work showed a confident £0. Both now come from the summariser.

### The backend was still computing costs the old way

`npm run verify:billing` was already red before any of this. `getStaffHourlyRate`
had been fixed in the frontend original — first *positive* rate wins, so a blank
or `0` `hourly_rate` cannot hide a `pay_rate` — but the backend copy still used
`??`, where `0` is not nullish and therefore wins. Every backend consumer was
costing those staff at **£0**.

That fix landed in commit "Fix calendar revenue and cost calculation logic",
which touched the frontend only. The drift check caught it; `npm run sync:billing`
was the remedy. **Backend cost and margin figures will move** for any staff
member with a blank or zero `hourly_rate` and a real `pay_rate` — upward, to
what they are actually paid.

### Two verify checks were wrong, in opposite directions

`verify:access-scope` reported `reconcileShiftVisits` as an unguarded
service-role function. It is not: the automation functions have since migrated
to `authorizeBackendJob`, a separate function that resolves a privileged user
through `resolveRole` and `accessDenialReason` or compares the automation secret
in constant time — stronger than the `requireSchedulerOrAdmin` the check was
looking for, which allowed an unauthenticated caller by default. The check now
recognises all three guards, and the `authorizeBackendJob` route counts only
when the verdict is *enforced*: invoking it proves nothing, since a function
that asks and ignores the answer is the hole the check exists to find.

`verify:compliance` flagged `authorizeBackendJob` and `manageAccessRequests` for
calling `auth.me()` directly. One was a false positive and one was a real hole:

- `authorizeBackendJob` applies `accessDenialReason` itself. It has to, because
  it must tell "denied" from "no session" to decide whether to fall through to
  the secret path.
- **`manageAccessRequests` applied no leaver check at all.** An offboarded
  account still holding platform admin could approve and deny other people's
  access requests. It now goes through `authedUser`, which adds the leaver
  check, the rate limit and the audit on denial.

The check now asks for the leaver check rather than for one particular helper —
and still fails when `auth.me()` appears without it.

### Verification

`verify:all` green: 139/139, 101/101, 42/42, 28/28, billing rules holding with
both copies in agreement. Build clean.

Four mutations, all caught: dropping the `if (!gate.authorized)` branch while
keeping the invoke; removing the gate call entirely; putting
`manageAccessRequests` back on bare `auth.me()`; stripping
`accessDenialReason` out of `authorizeBackendJob`. Each source file was restored
byte-identical afterwards and the suite re-run to confirm it.

---

## "Something went wrong" on the admin Visit Notes page (NOT CHECKPOINTED — see below)

**Changed**: `src/pages/VisitNotes.jsx`
**Still to do**: `ShiftManagement.jsx` time-override validation, `VisitNoteFormCommunicationLogTab.jsx`, a verify check, and a checkpoint

### What crashed

`date-fns` `format()` throws `RangeError: Invalid time value` on a date it cannot parse. It does not degrade to an empty string. Every guard on the page tested truthiness only:

```jsx
{note.visit_date ? format(new Date(note.visit_date), 'dd-MM-yyyy') : 'No visit date'}
{clockIn && clockOut && <span>Actual: {format(new Date(clockIn), 'HH:mm')} - {format(new Date(clockOut), 'HH:mm')}</span>}
```

A present-but-unparseable value passes that guard and takes down the render, which the error boundary turns into "Something went wrong" for the whole page.

The chain, traced through live data:

1. Shift `6ab12d20036c1da0170f0b19` holds `actual_clock_out` **and** `manager_override_clock_out` of `"92026-02-09T08:00"` — a typo'd year. One shift in 500 checked.
2. Visit note `6abc06f4eeb9384cd4b977da` (Joanne Clitheroe, visit date 2026-09-29, `manager_reviewed: true`) points at that shift.
3. The reviewed-notes card list renders the clock-out through raw `format` → RangeError → boundary.

29 September is when reviews stopped working. Admin-only because `VisitNotes.jsx` *is* the admin review page — carers use `MyVisitNotes.jsx`, which does not render shift clock times.

One bad row in one field took out the page for every administrator, for every service user. That is the actual defect; the typo is just what found it.

### What was fixed

All 20 raw `format(new Date(x), ...)` calls in `VisitNotes.jsx` now go through `safeFormat`, which parses, checks `isValid`, and returns a fallback. The `date-fns` import was dropped so the file has one date entry point. Fallbacks were chosen per site rather than left at the default `'N/A'` — `'undated'` for the two generated export filenames, `'No visit date'` and `'N/A'` for the three visit-date labels. The two calls that already had `isNaN(d.getTime())` guards were converted too; they were correct, but leaving them raw leaves the next editor a pattern to copy.

### What is still wrong

**The write site is unvalidated.** `timeOverrideMutation` in `ShiftManagement.jsx` (~line 517) saves `manager_override_clock_in` / `_clock_out` straight through:

```js
manager_override_clock_out: data.clock_out || null,
```

Nothing rejects `"92026-02-09T08:00"`. `safeFormat` stops the crash; it does not stop the bad value being stored, and these fields feed payroll. Until that mutation validates its input, the same class of row can be written again — and the next reader may be one that sums rather than renders.

**Two things for you, not for me:**

- Shift `6ab12d20036c1da0170f0b19` needs its clock-out corrected by a human. It is a payroll-affecting time and the obvious de-typo (2026-02-09) is seven months away from the note's visit date of 2026-09-29, so there is no safe guess. I have deliberately not touched it.
- **Nothing in this section is checkpointed.** The edits auto-committed in the sandbox, but the connection dropped before `create_checkpoint` ran. A Restore or Revert in the builder will discard them.

**275 raw `format(new Date(...))` sites remain** across 105 other files — 290 app-wide before this change. Every one is the same latent crash: a single unparseable value anywhere in its data takes out that page. Worth sweeping as one job.

### Also checked, and clean

`review_flags` and `review_rating` are both correctly guarded. The memos (`isSettled`, `getNoteStaffName`, `combinedVisitNotes`, `filteredNotes`) handle missing records. `SupersededDraftCleanupCard` is defensive throughout. `no-undef` is **not** enabled in `eslint.config.js`, so an unimported identifier passes both lint and `vite build` and crashes only at runtime — running `eslint --rule '{"no-undef":"error"}'` over `src/` surfaced no real undefined identifiers, but that check should be made permanent.

An earlier hypothesis — that `review_rating: null` was failing the schema's `minimum: 1` — was **disproved** by live data: reviews saved with a null rating right up to 29 September.

---

## Adding a staff member without leaving the app (Base44 checkpoint 6aa74ad6312c354753d11c87)

**New**: `base44/functions/inviteStaffMember/entry.ts`
**Changed**: `Staff.jsx`, `syncStaffFromQuickBooks`, `scripts/verify-compliance.mjs`

### What Add Staff actually did

It called `syncStaffFromQuickBooks` with `action: 'invite'`, which filters to **QuickBooks employees not yet in the app**. Two consequences:

- Somebody not in QuickBooks matched nothing. No invitation was sent, an empty `results` array came back, and the frontend's `results.find(...)?.status === 'failed'` was therefore false — so it reported **"Invitation sent!"** having sent nothing.
- With QuickBooks not connected it threw, and the catch told the administrator to go to *Dashboard → Users → Invite User* and come back afterwards.

Either way the twelve fields the form collects — name, phone, job title, employment type, start date, max hours, hourly rate, leave entitlement — were discarded. The email address was the only thing that travelled.

### Now

`inviteStaffMember` does the whole thing: invite, then write the profile that was typed, so the person appears in the staff list complete rather than as a bare email waiting to be filled in. One action, no dashboard.

It is deliberately unable to grant privilege. The platform role is hardcoded to `'user'` — not a parameter — and `app_role`, `permissions`, `custom_role_id` and `status` are absent from the accepted field list. Making somebody a manager stays a separate decision on Role Management, which matters because the platform role is the ceiling that privilege derives from. `status` stays with `manageUserAccess`, or the audited offboarding path would have a way around itself.

An address that already exists is not re-invited. A live account returns "already on the team"; a revoked one says to reactivate rather than invite, because re-inviting would strand their history.

Adding an account is granting access, so it is audited at `critical` severity — the direction of change an access review looks for.

### Also

`syncStaffFromQuickBooks` now reports addresses it did not invite, instead of returning an empty array that read as success.

### Verification

101 compliance checks. Ten mutations, all caught: anyone being able to add staff, the invite taking a role parameter, `app_role` or `status` becoming settable at invite time, the audit being removed or downgraded to routine, an existing account being silently overwritten, the form reverting to the QuickBooks path or to sending only the email, and the QuickBooks path going back to silent success.

One check was too broad first time — it forbade `syncStaffFromQuickBooks` anywhere in `Staff.jsx`, which would have outlawed the QuickBooks sync panel further down the page. That panel is a different, legitimate feature. The check is now scoped to the Add Staff mutation body. Third time this session that a file-wide assertion has been wrong in that direction.

---

## The daily notes tab vanishing on shift select (Base44 checkpoint 6aa7334a5deb3b2ccc61d04d)

**New**: `src/components/visit-notes/visitNoteTabConfig.js`, `scripts/verify-visit-note-tabs.mjs`
**Changed**: `CreateEditVisitNote.jsx`, `useVisitNoteValidation.jsx`, `getLocationResidents`

### What was happening

The form once had two note tabs — `client_note` for a private client's daily note, and `residents` / `resident_notes` for per-resident notes at an organisation location. They were merged into one `daily_notes` tab that adapts to the visit type itself.

Both readers of `visit_note_config.hidden_tabs` then mapped all three legacy ids onto `daily_notes` **unconditionally**:

```js
["resident_notes", "residents", "client_note"].includes(t) ? "daily_notes" : t
```

Joanne Clitheroe — a private client, and the busiest in the app — has:

```json
"hidden_tabs": ["communication", "follow_up", "resident_notes", "residents"]
```

Somebody once ticked "don't show me the resident tabs" for an individual, which was entirely reasonable: she has no residents. After the merge, that same tick hid her **daily note**.

The tab appeared before a shift was picked because `layoutConfig` was still the default. `loadShiftData` then replaced it with the client's `visit_note_config`, and the tab disappeared. Hence "appears first, then vanishes".

**It was worse than a missing tab.** `VisitNoteTabContent` computes `hideObservations = !canEditAll && (isOrgClient || isPrivateClient)` — and since `isPrivateClient` is defined as `!isOrgClient`, that disjunction is always true. So Observations is hidden from anyone who is not a manager whenever daily notes are in play. With the daily notes tab also hidden, carers had **nowhere at all** to record a narrative note for her. Not cosmetic — a missing care record on the client with the most visits.

### The fix

`visitNoteTabConfig.js` makes the mapping type-aware: a legacy id only hides the merged tab for the kind of visit it originally applied to.

| entry | private client | organisation |
|---|---|---|
| `residents`, `resident_notes` | no effect | hides daily notes |
| `client_note` | hides daily notes | no effect |
| `daily_notes` | hides | hides |

Both readers now share it, and `isOrganisationVisit` is a dependency of `activeTabs` so the list recomputes when a shift changes the visit type. `legacyHiddenTabEntries` reports the entries whose meaning changed, so an admin can revisit them rather than guess.

### Also

`getLocationResidents` had reverted to calling `auth.me()` directly, bypassing the leaver check — the seventh disappearance, and caught by `verify:compliance` on the first run of this session before any of the above. Restored to `authedUser`.

### Verification

`npm run verify:visit-note-tabs` — 28 checks, built from the real client configs, wired into `verify:all` and CI.

Eight mutations, seven caught. The eighth — deleting the explicit `daily_notes` branch — was an **invalid mutation**: it falls through to the pass-through at the end and returns the same value, so no check should have caught it. The line is redundant by design; it is now commented as such so nobody adds a test expecting otherwise, or "simplifies" it thinking it matters.

### A wrong first hypothesis, recorded

Before access was restored I predicted this was `setSelectedLocation(shift.client_location_id || null)` clearing an already-chosen location, based on `client_location_id` being `""` on some shifts and `null` on others. That was wrong. The location code is fine; the cause was configuration semantics drifting under a UI merge. Worth keeping: the reasoning was plausible and the data supported it, and it still took reading `activeTabs` to find the actual cause.

---

## Chase window matched to the archive age (Base44 checkpoint 6a9ade063a5ca3504ca9576a)

**Changed**: `shiftNoteStatus.js` (`NOTE_REQUIRED_WINDOW_DAYS` 14 → 7), `scripts/verify-shift-notes.mjs`

`NOTE_REQUIRED_WINDOW_DAYS` is now 7, matching the age at which `archiveOldVisitNotes` archives a reviewed note. The two windows described different fortnights, which is what let the phantoms exist; they now describe the same week.

The relationship is encoded rather than just the number. `verify:shift-notes` reads the archive age straight out of `archiveOldVisitNotes` and fails if the chase window ever outlasts it — so shortening the archive age, or lengthening the window, is a failing test rather than a silent drift.

### What shortening it costs, and why it is safe

A genuinely unwritten note stops being chased a week sooner. It does not become unwritable, and it does not become invisible:

- the note picker on My Visit Notes passes `windowDays: Infinity`, so an older shift can still be written up;
- the manager-side anomaly detector has no upper bound at all — completed, no note, more than 24 hours — so an old gap still surfaces to somebody.

Both are now asserted, because "shortening the window quietly made old shifts unwritable" is the obvious way this could go wrong later.

### Verification

42 checks. Seven mutations, all caught: the window drifting back to 14, the archive age being shortened without the window, the window not being applied at all, the note picker inheriting the 7-day limit (twice — unset, and set to a finite number), and the manager backstop gaining an upper bound.

One escaped first time. The checks proved the *module* behaved correctly when handed `windowDays: Infinity`, but never that `MyVisitNotes` actually passed it — so deleting the argument went unnoticed. Testing a function's contract is not the same as testing that its caller honours it.

### Sixth disappearance

`shared/externalTransfer/entry.ts` was gone — the directory remained, empty. Nothing had touched it; it surfaced only because `verify:compliance` could not import it. Recovered in full from commit `3e0096059`. Six losses this session now, across checkpoint restores and whatever is dropping individual files.

---

## Phantom "pending visit note" (Base44 checkpoint 6a981d49a952dc016e3d8db9)

**New**: `src/components/visit-notes/shiftNoteStatus.js`, `scripts/verify-shift-notes.mjs`
**Changed**: `offlineDatasets.jsx`, `MyVisitNotes.jsx`, `MyShifts.jsx`, `CompletedShiftsSection.jsx`, `useBadgeCounts.jsx`, `AnomalyDetector.jsx`, `AnomalyDetectorInteractive.jsx`

### What was happening

Carers were being asked to write visit notes for shifts they had already written up.

`archiveOldVisitNotes` sets `status: 'archived'` seven days after a manager reviews a note. The completed-shifts list looks back **fourteen** days. In between, three of the places that answered "does this shift have a note?" were reading a list that had been filtered for *display* first:

| where | filtered out |
|---|---|
| `offlineDatasets.selectMyVisitNotes` → My Visit Notes → "Pending Notes" | `archived`, `resident_note` |
| `useBadgeCounts` (carer badge) | `archived`, `resident_note` |
| `AnomalyDetectorInteractive` (manager alert) | `archived` |

So the moment a manager reviewed a note and a week passed, the shift came back as outstanding — for the carer who wrote it, for their badge, and for the manager. The note existed, had been read, and had been backed up to OneDrive.

The live data made it unambiguous: notes from 24–25 August were `archived`, notes from 26 August onward were `active`, and the completed-shifts list still covered both.

`visit_type: 'resident_note'` is the same bug latent — a location shift written up per resident would have looked noteless permanently. Not currently triggering, since resident notes are not in use yet, but fixed on the same principle.

### The fix

One rule, in `shiftNoteStatus.js`: **a shift has a note if any note references it.** Not "any note we would currently show you". Archiving is a lifecycle state and per-resident notes are how a location shift is recorded; both are evidence the work was written up. Filtering a list for display and deciding whether a duty was discharged are different questions, and conflating them made carers redo work.

Six call sites now share it. `selectMyVisitNotes` keeps its display filtering and gains a sibling, `selectNotesForNoteIndex`, that filters nothing — the pages fetch unfiltered and apply the display filter only where the list is rendered. A lone draft still does not discharge the duty, which is what the clock-in block is for. The badge fetch went from 100 notes to 500, since at current volume 100 covered about twelve days of a fourteen-day window.

### Verification

`npm run verify:shift-notes` — 37 checks, wired into `verify:all` and CI.

Mutation-tested, 14 caught. Two escaped first time round and both were faults in the checks, not the code: the cancelled-shift case had no `end_datetime`, so it passed whatever `NON_WORKED_STATUSES` said, and the "is the index built from a filtered list" scan used `/\(([^)]*)\)/`, which stops at the first close paren and read `buildShiftNoteIndex((notes || []).filter(...))` as clean.

One check was also too *strict*: it flagged `useBadgeCounts` for filtering resident notes out of the manager review queue, which is deliberate — "which notes need reviewing" is a different question. The invariant is now narrow and exact: whatever is passed to `buildShiftNoteIndex` must not be a filtered expression.

### Second disappearance

The report-mode dedupe in `scopedRead` vanished again between two verification runs — the same hunk, the same way, with nothing touching it in between. Everything else in that file survived. Re-applied and confirmed after checkpointing. That is five losses this session; `verify:all` caught this one within a minute.

---

## Making the controls operable (Base44 checkpoint 6a98119797899b7aea979ce9)

**New**: `clientAccessPolicy/`, `src/components/settings/ClientAccessPolicySettings.jsx`
**Changed**: `shared/accountStatus` (`changesForStatus`), `manageUserAccess` (`set_status`), `Staff.jsx`, `Settings.jsx`, `scopedRead` (report dedupe), `scripts/verify-compliance.mjs`

Three gaps found by looking at whether the controls built last time could actually be used.

### The audited offboarding path was optional

`status` was in the Staff page's ordinary field allowlist, and `StaffEditDialog` has a status dropdown. So an administrator could put a leaver back to `active` through the profile editor as a plain entity write — no audit record, no assignments touched, bypassing `manageUserAccess` entirely. An audited path you can walk around is not a control.

`status` is out of the allowlist. A status change now goes through `manageUserAccess` with a new `set_status` action that validates against the schema enum. The archive side effects key off the *resulting status* rather than the action name, so `set_status: archived` ends assignments exactly as the offboard button does — `changesForStatus` is the single mapping both use.

### The switches could not be switched

`scope_mode` and `field_visibility_mode` existed and were read on every request, but nothing could change them short of hand-editing an AppSettings row. That made the off/report/enforce design theoretical, and — worse — made turning enforcement *off* in a hurry impossible. The moment somebody needs that is a carer standing at a front door unable to see a care plan.

`clientAccessPolicy` reads and sets both. Reading is open to any signed-in user, since telling a carer why a field is withheld is reasonable; changing requires an administrator and is audited with before and after, at `critical` severity when the change widens access. `ClientAccessPolicySettings` puts it in Settings → System, with the preview table inline so the numbers are in front of you when you decide.

### Report mode would have buried the audit trail

One row per gateway read. A carer browsing a rota triggers dozens a minute, and those rows share a table with the evidence they are supposed to sit alongside — evidence you cannot find is not evidence. Now one row per person per entity per day, held per isolate and rolled over at midnight. The counts are a property of the rota, not of how often somebody refreshed.

### Verification

87 compliance checks, 139 access-scope, all suites green, 162 functions bundle.

Mutation-tested, 13 caught — but only after tightening. Three checks initially passed their own mutation by matching a string that survived it: renaming `SETTABLE_STATUSES` left the identifier in the usage line; deleting `<ClientAccessPolicySettings />` left the import; and the dedupe check matched two names without checking they were wired together. All three now assert the mechanism, not the vocabulary. That is the third time in this session that a first-draft check has been too weak, always the same way.

### One thing worth flagging

Partway through, the report-mode dedupe edit disappeared from `scopedRead` between two verification runs, with no restore in between. Re-applied and confirmed. Along with the three checkpoint restores, that is four times work has silently vanished from this app; the verification suite is the reason each was caught within minutes rather than at an audit.

---

## Withheld is not blank (Base44 checkpoint 6a9805f11ff22d905b60c887)

**New**: `src/components/clients/WithheldValue.jsx`
**Changed**: `shared/accessScope` (`redactClient` emits `withheld_fields`), 13 screens, `scripts/verify-access-scope.mjs`

### The point

`field_visibility_mode` could not safely be enforced because a withheld field and an empty one looked identical to a carer. Those need opposite responses: one is a decision somebody made, the other is a gap in the care record worth chasing.

`redactClient` now returns `withheld_fields` alongside the nulled values, and `WithheldValue` renders "Withheld by your manager" instead of nothing. The flag rules stay in `accessScope` — the browser reads the outcome rather than re-deriving it, so there is nothing to drift.

### Beyond display

Three of the fixes were not about rendering, and none would have been found by reading the screens:

- **`RiskAssessmentTab`** seeded its editor from `client.care_plan || ""`. With the plan withheld, saving would have written a blank over the real text. It now refuses with an explanation.
- **`ClientProfile`** interpolates the care plan and risk assessment into five AI prompts. A withheld field would have reached the model as "None recorded", inviting it to write a replacement over a plan it could not see.
- **`ClientConfigDiagnostics`** counted a withheld contact as missing configuration, sending somebody chasing a record that already exists.

Three of the original fifteen "unfixed" screens were false positives — `LeaveManagement`, `MyLeaveRequests` and `StaffOnboardingWizard` use `emergency_contact` on leave requests and staff records, not clients. The detector now matches on a client-shaped receiver, and accepts either mechanism: `WithheldValue`, or the flag checks `ClientDocumentsView` and `ClientEditDialog` already had.

### Verification

139 checks. The screen count is now an assertion rather than a printed warning, and it reads 0.

Mutation-tested, 14 caught. Two initially escaped, both in files that use the helper elsewhere and so passed the file-level scan — the AI prompt guard and the diagnostic guard. Targeted checks added for each. A third escaped a regex that did not allow the parenthesis a careless edit introduces (`${(client.care_plan || ...)}`); tightened.

**`field_visibility_mode` is now safe to move to `report`, then `enforce`.** `scope_mode` remains a separate decision — see the numbers in `accessScopePreview`.

### Note on losing work to checkpoint restores

This work was written, committed, and then removed by a checkpoint restore (`5cd37a3ad`, 09-02 01:03) which rolled the tree back past it. That is the third time; the earlier one is described two entries down. Restoring a checkpoint discards everything committed after it, including agent work, without warning. It was recovered in full from `a937b874f` — nothing was lost — and the later visit-note work touched none of the same files, so the two merged cleanly. Worth knowing before the next restore.

---

## The read gateway, restored with enforcement off (Base44 checkpoint 6a9763325213b81e94153958)

**New**: `accessScopePreview/`
**Restored**: `scopedRead/`, `shared/scopeResolver/`, `dbFactory.js` gateway, `db.js`, the six narrowed read rules
**Changed**: `shared/accessScope`, `getClientInfoForShift`, `scripts/verify-access-scope.mjs`

### What actually broke

Staff could not see various service user data. Two separate causes, measured against the live data rather than guessed at.

**The field redaction — my error.** I wrote last time that "defaults match the schema, so what staff see on screen is unchanged". That was true of the two files I had read (`ClientDocumentsView`, `ClientProfile`) and false everywhere else:

| field | screens rendering it | screens checking the flag |
|---|---|---|
| `care_plan` / `risk_assessment` | 10 | 2 |
| `phone` / `emergency_contact` | 16 | 3 |

`redactClient` nulled those fields for every caller, so `RiskAssessmentTab`, `ClientProfileOverview`, `ClientInfoDialog`, `ClientOverviewTab` and `ClientProfileHeader` — none of which had ever heard of the flags — rendered blanks. Four clients have `staff_view_care_plan: false`, including Thera East Anglia, where two of the carers work.

**The scope — working as specified, and still too tight to deploy in one step.** Replaying the rules against the real rota:

```
chimoto.fortunatec       5/14 clients
faithnamuyomba6          4/14
kagiso.modisane          2/14
rosemarychimombegweshe   4/14
thokopendomoyo79         3/14
```

Note the window was never the cause: 180 days, 365 days and no window at all produce identical scopes, because the shifts cluster in the current period. Widening `SCOPE_WINDOW_DAYS` would have fixed nothing.

### The correction: separate the hole from the policy

Closing the front door and narrowing what each carer sees were shipped as one change. They are two decisions and only one of them is urgent.

- **`scope_mode`** and **`field_visibility_mode`** live in AppSettings under `client_access_policy`, both defaulting to `off`, both `off | report | enforce`.
- With both `off`, `scopedRead` reads at the service role and returns exactly what the app returned before it existed — **so the narrowed entity read rules are safe to deploy on their own.** Any signed-in account can no longer `Client.list()` all 57 fields straight from the browser; no carer loses sight of anybody.
- `report` withholds nothing but records what it would have, so a fortnight of audit lines says what enforcing would cost.
- Modes are read per request, not cached: turning enforcement off takes effect immediately, because the moment you need that is a carer at a front door at eight in the morning.

`accessScopePreview` (admin only, read-only) answers the question in advance — per staff member, how many service users they would see and which; per flag, how many clients it would affect and their names.

### Verification

`verify:access-scope` — 132 checks. New ones assert that deploying the gateway narrows nothing by itself: defaults are `off`, an unrecognised mode falls back to `off` rather than enforcing, and `off`/`report` return every record while still counting what enforcing would withhold.

It also now counts the thing that caused the outage:

```
15 screen(s) render a flagged field without checking its flag —
field_visibility_mode must stay "off" until that is 0, or panels go blank.
```

Mutation-tested, all 10 caught, including the two that would have reproduced the outage — enforcement becoming the default, and `off` mode filtering anyway.

---

## SOC 2 controls, and half of the security work restored (Base44 checkpoint 6a975457d85d4eca3edf98d0)

**New**: `shared/accountStatus/`, `shared/auditTrail/`, `shared/retentionPolicy/`, `shared/secretStorage/`, `shared/rateLimit/`, `shared/externalTransfer/`, `manageUserAccess/`, `auditEvent/`, `accessReviewSnapshot/`, `useIdleTimeout.jsx`, `IdleWarningDialog.jsx`, `scripts/verify-compliance.mjs`
**Changed**: `shared/authHelpers`, `shared/dbHelpers`, `shared/automationAuth`, `shared/oneDriveVisitNoteHelpers`, `AuditLogger.jsx`, `Staff.jsx`, `Layout.jsx`, `deleteUserAccount`, `setup2FA`, `verify2FA`, `disable2FA`, `regenerate2FABackupCodes`, `archiveAllAppDataToOneDrive`, 121 functions rewired to `authedUser`, `AuditLog` + `SecurityAuditEvent` read rules

### First: the previous change was rolled back

Commit `01231537f` (2026-09-01 01:09, titled "One billing rule for screen and invoice") was a checkpoint restore that removed the entire security change: `scopedRead`, `accessScope`, `roleResolution.js`, the CI workflow, the scheduler guards on 29 functions, the 2FA hashing, and the six narrowed entity read rules.

On instruction, only the half that cannot change what staff see was restored — the role ceiling, the 29 scheduler guards, hashed backup codes, the 2FA enforcement hook and CI. **The `scopedRead` gateway and the narrowed read rules were deliberately left out** pending a diagnosis of what broke. `verify:access-scope` now prints the gap rather than asserting it closed:

```
OPEN: readable by any signed-in account — CarePlan, Client, ClientDocument,
      ClientLocation, ClientRiskAssessment, Resident
```

### Leaver revocation (CC6.2, CC6.3)

`User.status` has existed since the beginning, and the Staff screen has always written `archived` on offboarding. **Nothing ever read it as an access decision.** Five of eleven live accounts were already `archived` or `inactive` with full access — including a manager holding platform admin.

The check went into `requireAuth`, and then into `authedUser`, because only 9 functions use `requireAuth` — the other 121 called `base44.auth.me()` inline, so `requireAuth` alone would have covered 7% of the surface. `authedUser` returns **null** for a revoked account rather than throwing, so every one of those functions enforces it through the `if (!user)` guard it already has: no control flow rewritten, and it fails closed.

`manageUserAccess` gives offboarding a single audited entry point with three states, because "restore" and "reactivate" are different decisions:

| action | status | access |
|---|---|---|
| `offboard` | `archived` | revoked, assignments ended |
| `restore` | `inactive` | still revoked |
| `reinstate` | `active` | granted |

### The audit trail is now evidence (CC7.2)

`AuditLogger` ran in the browser: the record of a role change was produced by the same browser making the change, and `ip_address`/`user_agent` came from a `metadata` argument no caller ever passed, so every row had nulls. It now reports to `auditEvent`, which takes identity from the session, address from the proxy headers and time from the server, and only accepts an allowlist of actions.

`AuditLog` and `SecurityAuditEvent` are `update: false, delete: false`. An audit trail an admin can edit is not evidence.

Coverage was the other half: 10 of 14 functions mutating care data wrote no record. Adding a call to each would have fixed those ten and not the eleventh, so the record is taken in `dbHelpers` instead — every write to `Client`, `CarePlan`, `ClientDocument`, `ClientLocation`, `ClientRiskAssessment`, `Resident`, `User` or `VisitNote`, through any function, present or future. `setAuditContext` attaches the actor where one exists.

### Retention (C1.2)

Fifteen archive/cleanup functions, no periods, no clocks, no reasons. `shared/retentionPolicy` declares both — with `basis` in words so the reason outlives whoever chose it, and `legalHold` for records that survive an erasure request.

This cuts both ways. `deleteUserAccount` was hard-deleting `VisitNote` by `created_by` and `ComplianceDocument` by `staff_email` — care records under an 8-year duty and right-to-work evidence under 6. It now skips those and returns `retained_under_retention_policy` explaining what was kept and until when. **The periods are defaults and need your DPO's sign-off**; the point is that changing one is a reviewable one-line diff.

### The rest

- **Secrets**: the TOTP seed is AES-256-GCM encrypted via `FIELD_ENCRYPTION_KEY`. Without that variable set it stores as `plain:` and says so — failing shut would break enrolment, and a fake `enc:` prefix would be worse than either. `decryptField` reads all three forms, so setting the key later needs no migration.
- **Egress**: `shared/externalTransfer` is the list of hosts this app may send to, with purposes. OneDrive visit-note uploads and the full-archive upload now write a transfer record, so "what care data left last quarter" is a query.
- **Rate limiting**: a 300/minute per-account ceiling at `authedUser`. In-memory, therefore per-isolate — documented in the module as a guard against a runaway client, not a determined attacker, because a control weaker than it looks is worse than none.
- **Idle timeout**: 30 minutes with a 2-minute warning. Shared devices in other people's homes.
- **Access review**: `accessReviewSnapshot` writes an append-only monthly snapshot of every account's effective role, revocation state and 2FA, and flags privileged accounts without 2FA, 90-day dormancy, and `app_role` mismatches.

### Verification

`npm run verify:compliance` — 78 checks. Mutation-tested twice: the first pass **missed four** (`requireAuth.includes("accessDenialReason")` passed because `authedUser` also contained the string; `useIdleTimeout` matched `useIdleTimeoutDISABLED` as a substring). Rewritten to parse the specific function body and to match on tokens; all 20 mutations now caught.

`verify:all` green: 107/107 access-scope, 78/78 compliance, all other suites, 159 backend functions bundle, build clean.

**Needs one live check**: that `update: false` / `delete: false` genuinely denies on this platform — an admin attempting to delete an AuditLog row should fail.

---

## Security: close the read path, stop trusting `app_role` (Base44 checkpoint 6a94fa7438bb1383ce4f18f2)

**New**: `base44/functions/scopedRead/`, `shared/accessScope/`, `shared/scopeResolver/`, `shared/twoFactorHelpers/`, `src/components/utils/roleResolution.js`, `scripts/verify-access-scope.mjs`, `.github/workflows/verify.yml`
**Changed**: `dbFactory.js`, `db.js`, `userHelpers.jsx`, `usePermissions.jsx`, `PermissionConfig.jsx`, `shared/authHelpers/entry.ts`, `getClientInfoForShift`, `setup2FA`, `verify2FA`, `regenerate2FABackupCodes`, 29 scheduled functions, 6 entity read rules

### What the audit found

RLS on this app can only distinguish a platform admin from everyone else. Managers hold platform `admin`, and **no account holds the platform role `staff`** — so in rules like

```json
{"$or":[{"role":"admin"},{"role":"manager"},{"role":"user"},{"role":"staff"}]}
```

the `manager` and `staff` clauses matched nobody, and `{"role":"user"}` was the only clause doing any work. On `Client` that meant any signed-in account could `list()` all 57 fields of every service user — NHS number, address, medications, allergies, behavioural notes, key-safe details. Six entities were like this.

Meanwhile `getClientInfoForShift` was carefully gating the same data behind `requireAuth` → `hasActiveAssignment` → field projection → audit. A good lock on the side door, next to an open front door.

Three more findings:

- **`staff_view_*` was decorative.** Six per-client visibility flags appeared in four frontend files and *zero* times under `base44/`. Unticking "staff can view care plan" hid a panel and restricted nothing.
- **`app_role` was self-assignable privilege.** `getRole()` returned `user?.app_role || user?.role`, and every `isAdmin`/`isManagerOrAdmin` in 128 functions resolved through it. `app_role` is an ordinary field on `User`, and self-service edits go through `auth.updateMe`, which writes arbitrary fields — `setup2FA` depends on exactly that.
- **29 service-role functions had no caller check.** Cron jobs, but also ordinary HTTP endpoints: `resetAnnualLeave`, `deductApprovedLeave`, `archiveAllAppDataToOneDrive`, `notificationService`.

### The read gateway

Deleting `{"role":"user"}` alone would have left carers with no client data at all — there are 81 direct read sites. Instead the `db` wrapper (already the single choke point, already enforced by the `no-restricted-syntax` lint rule) now routes reads of `Client`, `CarePlan`, `ClientDocument`, `ClientRiskAssessment`, `ClientLocation`, `Resident` and `User` through a new `scopedRead` function. Same call signature, same return shape — **no call site changed**.

`scopedRead` reads at the service role, then applies `shared/accessScope`:

- **scope** — the clients on your rota within 180 days either way, plus your active `StaffAssignment` rows, plus the residents and parent organisation of any location you are rostered to. Deliberately wider than `hasActiveAssignment`'s ±24h, which answers a different question;
- **flags** — `staff_view_care_plan` / `_risk_assessment` drop those records; `staff_view_contact_details` blanks phone, email and emergency contact; `accessible_to_staff` drops a document. Defaults match the schema, so *what staff see on screen is unchanged* — what changed is what they can obtain by other means;
- **`User`** — colleagues resolve to a 20-field directory projection. Passport number, DBS number, visa and right-to-work status, home address, date of birth, next of kin, `hourly_rate` and the `two_factor_*` fields are withheld. Your own record comes back whole.

Only then were the six read rules narrowed to admin/manager. `getClientInfoForShift` now applies the same redaction, so it is not a way around the gateway.

### Privilege has a ceiling

`resolveRole` makes the platform `role` a ceiling and `app_role` able only to *narrow* it — super_admin/admin/manager are distinctions *within* platform admin. A carer who sets `app_role: 'super_admin'` on themselves gains nothing. Defined once in `shared/accessScope`, mirrored in `roleResolution.js` for the browser, with the two run over the same 12-case table in CI.

### Everything else

- `requireSchedulerOrAdmin` on all 29 service-role functions: a signed-in non-privileged caller is refused; a privileged one is allowed and attributable; no session at all is the scheduler, allowed by default so adding the guard could not silently kill the cron jobs. Setting `SCHEDULER_SECRET` additionally requires a matching header on that path.
- 2FA backup codes are stored SHA-256 hashed with a `sha256:` prefix. `findBackupCodeIndex` still accepts a plaintext entry so codes printed before this change keep working, and rewrites the survivors as hashes on first use.
- `requireTwoFactorIfEnforced` finally *reads* the `2fa_enforcement` setting that `admin2FAManagement` has always written. It refuses only roles an administrator has explicitly switched on, and applies at the data gateway rather than at login, so someone caught by it can still reach the enrolment page.

### Verification

`npm run verify:access-scope` — 120 checks: role resolution parity between the two bundles, scope membership, the rota window, redaction against every flag, the directory allowlist, backup-code hashing, and source invariants (read rules stay narrow, every service-role function keeps its guard, no `app_role ||` fallback survives anywhere).

Mutation-tested — all nine caught: trusting `app_role` again; reopening `Client`'s read rule; dropping a scheduler guard; making redaction a no-op; adding `passport_number` to the directory; storing codes in plaintext; unrouting an entity from the gateway; unbounding the rota window; skipping the scope check.

`.github/workflows/verify.yml` runs all six suites, bundles all 157 backend functions, and builds. Lint is reported but not gating: ~930 pre-existing unused-import errors, nearly all `--fix`-able.

**Not done, and needs a browser with a staff session**: confirm a non-privileged account still sees the clients it should. The scope rules are verified in isolation, not against live data.

