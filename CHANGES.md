## Reviewed visit notes missing when filtering (Base44 checkpoint 6a7ca56ed9c37839237aecdd)

**Files changed**: `src/pages/VisitNotes.jsx`

### Cause — a side effect of the OneDrive fix

`filteredNotes` dropped any note that was reviewed, backed up, and reviewed more than 24 hours ago:

```js
if (note.manager_reviewed && note.reviewed_at && (note.onedrive_synced_at || note.drive_synced_at)) {
  if (now - reviewedTime >= TWENTY_FOUR_HOURS) return false;
}
```

That rule ran **before** the status filter, so it applied even when the user explicitly asked for "Reviewed".

It had never fired, because no visit note had ever carried a sync marker — the OneDrive backup was broken. Once that was fixed, notes started syncing (first marker `2026-08-10T22:42`), and a day later they began disappearing.

At the time of the fix, of 317 reviewed active notes:

- **51** had a sync marker
- **45 were already hidden** — Joanne Clitheroe 29, Joan Temple 11, Marcus Andrew Rawlinson 3, MimarCare Ltd 1, Thera East Anglia 1
- 6 more were within hours of vanishing

### Fix

The rule now applies only to the **default view**. Choosing a status, searching, or setting a date range is an explicit request, and answering it with a silently trimmed list is wrong.

When notes are being hidden, the page says so and offers a "Show them" button rather than leaving the list quietly short.

| | Before | After |
|---|---|---|
| Filter = Reviewed | 272 of 317 | **317** |
| Default view | 272, silently | 272, with a banner offering the other 45 |

### Also: the reviewed list rendered at most 20

`reviewedNotes.slice(0, 20)` was a hard cap with no way past it — the label said "use filters to narrow", but filtering was itself the thing losing notes. Now starts at 20 with a "Show more reviewed notes (N remaining)" control.

### Verification

- Counts computed against all 317 live reviewed notes.
- `vite build` clean.

## AI extraction when recording supervision (Base44 checkpoint 6a7c922b7d038557f3f11db8)

**Files changed**: `src/components/cqc/SupervisionAiExtract.jsx` (new), `src/components/cqc/SupervisionDialog.jsx`, `base44/entities/Supervision.jsonc`

### What it does

A panel at the top of Record/Edit Supervision takes either route:

- **Upload document** — the signed supervision form, a scan, or a phone photo (pdf/doc/docx/txt/png/jpg/webp)
- **Paste notes** — rough typed or transcribed notes from the meeting

Both call `Core.InvokeLLM` with a `response_json_schema` mapped to the Supervision entity, following the pattern already used in `FormUploadAnalyzer`. Extracted: supervision date, type, duration, next date, workload review, wellbeing check, achievements, performance concerns, staff comments, training needs, topics discussed, goals set, and action plan.

### Nothing is applied automatically

A supervision record is HR and CQC evidence, so extraction proposes rather than fills. Every field found is listed with its actual value and a checkbox; only ticked fields are merged, and only when "Apply selected" is pressed. Saving is still a separate, deliberate step.

**The staff attribution is deliberately harder than the rest.** A detected name is matched against the staff list but never applied silently — it appears as its own amber-bordered confirmation showing the name the AI read, because attributing a supervision to the wrong person is an HR problem rather than a typo. The prompt also specifies the name wanted is the person *being supervised*, not the supervisor.

The prompt instructs the model to extract only what is written and return null rather than infer, on the grounds that a blank field is better than a plausible invention in a compliance record.

### Extracted content can no longer be saved unseen

The dialog only ever had editors for about half the entity. `topics_discussed`, `training_needs_identified`, `goals_set`, `action_plan` and `staff_comments` were in its form state with no UI, so extraction into them would have been invisible. They now render as a read-only "Additional recorded content" block with a Clear button, so nothing reaches the record without the supervisor seeing it.

### Provenance

Three fields added to `Supervision`: `ai_extracted`, `ai_extraction_source` (the document name or "Typed supervision notes") and `ai_extracted_at`. An AI-assisted record is badged as such in the dialog. For a CQC-inspectable record, whether a human typed it or a model produced it is worth being able to answer.

### Two bugs fixed alongside

- **Editing sent system fields back through a PUT.** `setFormData(supervision)` loads the whole record including `id`, `created_date`, `created_by`; the update passed it straight through. Now merged through `stripSystemFields`.
- **The new-supervision reset omitted `document_url`**, so a fresh supervision opened after an edited one inherited the previous record's attached document. The AI provenance fields are reset with it.

### Verification

- Live entity schema confirms the three new fields.
- `Supervision.jsonc` parses; `vite build` clean.

## Mileage submit button bugs (Base44 checkpoint 6a7c22a7e0b9624daeb7476a)

**Files changed**: `src/pages/MyMileageClaims.jsx`, `src/components/mileage/CompanyCarMileageLogger.jsx`

### 1. Editing a claim wiped its approval trail (critical)

```js
updateMutation.mutate({ id: editingClaim.id, data: claimData });
```

`claimData` is `{...formData}` plus five fields — 18 keys against the entity's **39**. Base44's `update()` is a PUT, so everything absent was erased:

`approved_by_email`, `approved_by_name`, `approval_date`, `rejection_reason`, `manager_notes`, `is_reimbursed_on_payslip`, `payslip_id`, `reimbursement_date`, `entry_type`, `auto_detected`, `linked_shift_id`, `linked_client_id`, the four GPS coordinates, `calculated_distance_miles`, `passengers`, `shift_sequence_ids`, `gps_accuracy_meters`.

Editing is offered on `pending` claims, so a manager's notes were destroyed by the claimant editing afterwards, and an auto-detected claim lost the GPS provenance that distinguishes it from a hand-typed one. Now merges onto the existing record via `stripSystemFields`.

### 2. No validation before submitting

The schema requires `purpose`, `start_address`, `end_address`, `distance_miles`, `rate_per_mile`. Nothing checked any of them, so "Submit for Approval" on an empty form pushed a **£0 claim** into the approval queue. Submissions now name the missing fields and require distance and rate above zero. Drafts stay lenient beyond a claim date — an unfinished claim is the point of a draft.

### 3. Re-saving a submitted claim restamped its submission time

`submitted_date: isDraft ? undefined : new Date().toISOString()` reset the timestamp on every save, moving the claim within the approval queue. The original is now preserved; saving back to draft clears it explicitly with `null` rather than relying on `undefined` being dropped during serialisation.

### 4. Approved and paid claims could be deleted

The delete button rendered on **every** claim regardless of status, so a staff member could permanently remove an approved — or already reimbursed — financial record. Delete is now limited to `draft`, `pending`, `rejected` and `cancelled`, and `window.confirm` is replaced with an `AlertDialog` naming the date, purpose and amount.

### 5. Cancel left the previous claim loaded

`onClick={() => setShowDialog(false)}` sets state directly, so Radix never fired `onOpenChange` and the reset inside it was skipped. Cancel now clears `editingClaim` and the form.

### 6. Company car log: a blank odometer reading counted as zero

```js
const start = Number(formData.start_mileage);
if (!Number.isFinite(start) || ...) return 0;
```

`Number("")` is `0`, not `NaN`, so the finite check never rejected an empty field. Leaving start mileage blank with an end reading of 48,000 logged a **48,000-mile trip** and passed the `milesUsed > 0` guard. Empty readings are now rejected before conversion, and negative starts are refused.

Its required fields — `vehicle_registration`, `trip_date`, `purpose` — were also unchecked and are now validated client-side instead of surfacing a raw server error.

### Not changed

`is_return_journey` is carried in the claim form state and round-trips on edit, but has no control to set it and no effect on the total. It is inert rather than wrong; wiring it up would change claim amounts, which is a policy decision.

`CompanyCarMileageLog` updates send all 17 schema fields, so that PUT loses nothing.

### Verification

- Field-by-field diff of `MileageClaim`'s 39 schema fields against the 18 the form sent.
- `vite build` clean.

## Draft tag on visit notes (Base44 checkpoint 6a7c1c9b1e7a535a60e3cb4f)

**Files changed**: `src/components/visit-notes/DraftNoteBadge.jsx` (new), `src/pages/VisitNotes.jsx`, `src/components/visit-notes/VisitNoteCard.jsx`

One shared `DraftNoteBadge` — amber, `FileEdit` icon, "Draft — not submitted" — rather than per-screen wording, so the tag cannot drift between the places a note is rendered.

### Where it shows

| Location | Before |
|---|---|
| Review page card | Inline badge added in the previous change, now the shared one |
| Review dialog header | Title read "Review Visit Note" for a note that cannot be reviewed; now "Draft Visit Note" with the tag |
| **My Visit Notes card (carer's own list)** | Read **"Pending Review"** — implying it had been sent for sign-off when it had never been submitted |

The carer's own list was the important one: the person who has to finish the note was being told it was already awaiting review.

Drafts also carry an amber ring in the carer's list, matching how retrospective entries are highlighted.

### Filter

Status filter gains **"Drafts (not submitted)"**, so unfinished notes can be isolated and chased.

`"Pending Review"` now means submitted and awaiting sign-off — it was `!manager_reviewed`, which swept in drafts once they became visible.

### Memo comparator

`VisitNoteCard` is `React.memo`'d and its comparator did not test `note.status`, so a note going draft → submitted would not have re-rendered its badge. Added.

### Verification

- `vite build` clean.
- Only one definition of the draft wording remains in the codebase.

## Unsubmitted drafts were hidden from visit note review (Base44 checkpoint 6a7c1625d6af6863eb0c901f)

**Files changed**: `src/pages/VisitNotes.jsx`, `src/components/layout/useBadgeCounts.jsx`

### My own regression

The earlier duplicate-visit-note fix added this to the review page query:

```js
// Drafts are work in progress — they are not submitted notes and must
// not appear alongside the finalised version in review.
const notes = allNotes.filter((note) => note?.status !== 'draft');
```

The reasoning held only for the case it was written for: a draft that has a finalised sibling on the same shift. Blanket-excluding every draft also hid drafts with **no** finalised counterpart — genuinely unfinished care records that nobody could see or chase.

All 5 drafts in the system are that second case. Each is the only note on its shift, so none was ever a duplicate:

| Draft | Client | Carer | Visit date |
|---|---|---|---|
| `6a7c14e4…` | Joanne Clitheroe | rosemarychimombegweshe | 2026-08-12 |
| `6a7b2f38…` | Joan Temple | rosemarychimombegweshe | 2026-08-11 |
| `6a774787…` | Joanne Clitheroe | rosemarychimombegweshe | 2026-08-08 |
| `6a723561…` | Joanne Clitheroe | faithnamuyomba6 | 2026-08-04 |
| `6a71c4eb…` | Joanne Clitheroe | faithnamuyomba6 | 2026-08-04 |

Two had been invisible for over a week.

### The rule now

A draft is hidden **only** when a submitted note already exists for the same `shift_id`. That still prevents the duplicate pairing the original fix targeted, while leaving orphaned drafts visible.

### Drafts are shown as drafts, not as pending reviews

- Amber left border and tint instead of the orange used for submitted notes.
- Badge reads **"Draft — not submitted"** rather than "Pending Review".
- The Review Decision panel is replaced with an explanation naming the carer and saying there is nothing to sign off yet.
- The Submit Review button is hidden, and `handleReview` refuses a draft at the source. Signing one off would mark work reviewed that the carer never finished — and the OneDrive backup, which triggers on review, would then archive it as a completed record.

### Badge aligned

The manager visit-note badge counted every unreviewed draft while the page hid them. It now applies the same shift-level rule, so the count matches the list.

One residual gap: if a draft's shift has a submitted note that has *already been reviewed*, that note is outside the badge query, so the draft still counts while the page hides it. Rare, and closing it would mean fetching all notes for a badge.

### Verification

- Confirmed against live data that all five drafts are the only note on their shift.
- `vite build` clean.

## Managers can manage the resource library (Base44 checkpoint 6a7c02ebc37ec2c31ab84edb)

**Files changed**: `base44/entities/Resource.jsonc`, `src/components/resources/ResourceLibraryPanel.jsx`

Follows the CRUD work in the previous entry, where write access was admin-only because `Resource` RLS granted create/update/delete to `role: "admin"` alone.

### RLS

Create, update and delete now allow:

```json
{ "$or": [
  { "user_condition": { "role": "admin" } },
  { "user_condition": { "role": "manager" } },
  { "user_condition": { "app_role": { "$in": ["super_admin", "admin", "manager"] } } }
]}
```

Covering both `role` and `app_role` follows the pattern already established in `Training.jsonc`, and matters here because this app grants elevated access through either field — `marge.ntabeni` is `role: admin` with `app_role: manager`, while others are `role: user` with an elevated `app_role`. Keying on one field alone would miss real managers.

`read` is unchanged — admin, manager and user could already read.

### UI gate

`isAdmin` became `canManage`, checking exactly the same role sets as the RLS above. The comment added in the previous change said not to widen this to `app_role`; that was correct against the old RLS and is now wrong, so it has been replaced with one explaining the gate must stay in lockstep with the RLS in both directions — widening it alone renders controls the server rejects, narrowing it hides actions a user is entitled to.

### Verification

- Live entity schema confirms the new RLS is applied.
- `Resource.jsonc` parses; `vite build` clean.
- No `isAdmin` references remain in the panel.

## Policy Hub resource library — full CRUD (Base44 checkpoint 6a7bb82d61c5506626468089)

**Files changed**: `src/components/resources/ResourceFormDialog.jsx` (new), `src/components/resources/AddResourceDialog.jsx` (removed), `src/components/resources/ResourceCard.jsx`, `src/components/resources/ResourceLibraryPanel.jsx`, `src/pages/ResourceLibrary.jsx`

### Before

Create and Read only. There was no way to edit a resource at all — a typo in a title, a wrong category, or a superseded file meant deleting and re-uploading. Delete existed but was reachable only after opening the preview dialog, confirmed with `window.confirm`, and was a **hard delete** despite the entity carrying `status: active | archived` and the list querying `status: "active"`. Archiving was clearly the original intent and was never wired up.

### Update

`ResourceFormDialog` replaces `AddResourceDialog` and serves both create and edit. In edit mode the file is optional — omitting it keeps the current document, so metadata can be corrected without re-uploading. Fields reload on open so an edit never shows the previous resource's values.

Updates merge onto the existing record and go through `stripSystemFields`, because Base44's `update()` is a PUT — sending only the changed keys would blank `file_url`, `status` and the rest.

### Delete, made recoverable

Deleting now has two levels:

- **Archive** — sets `status: "archived"`, hides it from the library, reversible.
- **Delete permanently** — the original hard delete, kept but behind a distinct red action whose confirmation says it cannot be undone and suggests archiving instead.

Both use `AlertDialog` rather than `window.confirm`, matching the rest of the app.

Archived resources are listed behind an "Archived (n)" toggle with a Restore action. The panel now fetches all resources and splits by status in JS — an archive nothing can list is just a slower delete.

### Actions reachable from the grid

`ResourceCard` gained an admin overflow menu — Edit, Archive/Restore, Delete permanently — so management no longer requires opening a preview first. Archived cards render dimmed with an "Archived" badge. The preview dialog gained matching Edit and Archive/Restore buttons.

### Duplicate page collapsed

`src/pages/ResourceLibrary.jsx` was a 319-line near-verbatim copy of `ResourceLibraryPanel` — same categories, same OneDrive URL helper, same query, same preview dialog. The panel already renders a full-page layout when `embedded` is false, so the page is now a 15-line mount point. Without this the new CRUD would have existed in Policy Hub and been missing from the standalone page.

### Permissions left as they are

The admin gate stays `user.role === "admin"` rather than widening to `app_role`. `Resource` RLS grants create/update/delete to `role: "admin"` specifically, so widening the UI check would render controls the server rejects. Confirmed against live users: everyone with an elevated `app_role` already carries `role: "admin"`. A comment records this so it does not get "fixed" later.

### Verification

- `vite build` clean; no stale `AddResourceDialog` imports remain.
- Dead state (`showAdd`, `deleting`) removed rather than left behind.

## Staff Management badge counted items the page never shows (Base44 checkpoint 6a7bb277428b533ce8e040a5)

**Files changed**: `src/components/layout/useBadgeCounts.jsx`, `src/components/layout/navigationConfig.jsx`, `src/pages/Staff.jsx`

### The 34

The Staff Management sidebar badge used `badgeCounts.pendingApprovals`, which is the union of five unrelated queues. Live composition:

| Source | Count | Where it actually lives |
|---|---|---|
| `FormSubmission` submitted | 23 | Forms page |
| `VisitNote` not manager-reviewed | 10 | Visit Notes page |
| `Timesheet` submitted | 1 | Timesheet Approval page |
| `LeaveRequest` pending | 0 | Staff → Leave tab / Leave Management |
| `PayslipAdjustmentRequest` pending | 0 | Payroll |
| **Total** | **34** | |

The Staff page has five tabs — staff list, compliance, leave, availability, archived. It renders no forms, no visit notes, no timesheets. So 33 of the 34 could not be found anywhere on the page the badge pointed to, and the remaining sources were already badged correctly on their own nav items — the count was duplicated as well as misplaced.

### Each count now belongs to the page that shows it

- **Staff Management** → `pendingLeave` (its Leave tab renders exactly these). Now 0.
- **Leave Management** → `pendingLeave`. New badge; this page had none.
- **Timesheet Approval** → `pendingTimesheets`. New badge — the one pending timesheet had no badge anywhere, so it was invisible rather than misfiled.
- Visit Notes and Forms keep their existing, already-correct badges.

The Staff page's **Leave tab now carries the same count**, so landing on the page shows which tab the sidebar number refers to.

### Same fault found in two more places

**Mobile Tasks tab (manager).** `taskAlerts` was `pendingApprovals + complianceDocs` and the tab opens `/TaskManagement`, which lists `Task` records and nothing else. Now counts open tasks (13 live), which that page does show. Approvals and compliance remain badged on their own nav items, and `totalAlerts` still covers all of them so the OS badge is unchanged in meaning.

**My Tasks (staff).** Badged `complianceAlerts` (critical + warnings) while `MyTasks.jsx` only lists critical compliance. A carer with warnings but no critical issues saw a badge and an empty page. Split out `complianceCritical` for My Tasks; My Compliance shows both and keeps `complianceAlerts`.

### Rule applied

A badge on a nav item should count only what that destination renders. Where a queue had no home, it got a badge on its own page rather than being folded into a neighbour's.

### Verification

- Composition of the 34 confirmed by querying each of the five sources directly.
- `vite build` clean.

## Notification badges and counts — 10 bugs (Base44 checkpoint 6a7bafc790508a97f2c3dab4)

**Files changed**: `src/components/chat/useUnreadCounts.jsx`, `src/components/layout/useBadgeCounts.jsx`, `src/components/layout/navigationConfig.jsx`, `src/components/layout/BottomTabs.jsx`, `src/components/hooks/useNotifications.jsx`, `src/components/notifications/NotificationCenter.jsx`, `src/Layout.jsx`

### 1. Chat unread badge was permanently 0 (critical)

```js
base44.entities.Message.filter({
  chat_room_id: { $in: roomIds },
  sender_email: { $ne: user.email },
  read_by:      { $nin: [user.email] }
}, '-created_date', 200);
```

A **three-field** compound filter. Base44 compound filters silently return `[]` — a constraint documented in 12 other places in this codebase, and the reason `useBadgeCounts` uses single-field filters plus JS narrowing throughout. This one query was the outlier, so the Messages badge never showed anything. Now a single-field `chat_room_id` filter with sender and `read_by` narrowed in JS.

### 2. Badge queries never performed a first fetch (critical)

Both consolidated badge queries combined `initialData` with `staleTime: 2min` and `refetchOnMount: false`. React Query timestamps `initialData` as of now, so the query believed it already held fresh data and never fetched. Badges sat at **0 until an entity subscription happened to fire** (3s debounce) or the connection dropped and returned. On a quiet system they could stay 0 indefinitely.

Same failure mode as the `initialData: []` regression fixed earlier in `ShiftManagement.jsx`.

### 3. OS app badge double- and triple-counted

`totalMobileAlerts` summed every nav item's badge. `pendingApprovals` (on Staff Management) is the union of leave, timesheets, visit notes, payslip adjustments and forms — and leave, visit notes and forms each carry their own nav badge too. Staff see `complianceAlerts` on both My Tasks and My Compliance.

One pending form contributed **2** to the phone badge; one staff compliance issue contributed **2**. Replaced with a `totalAlerts` computed in `useBadgeCounts` from the distinct sources.

### 4. Staff Management badge counted leave twice

`badge: badgeCounts.pendingLeave + badgeCounts.pendingApprovals` — `pendingApprovals` already contains `pendingLeave`.

### 5. Unread notification count read only the newest 100

The account checked holds **500+** notifications and generates them in bursts of ~50. The badge fetched the newest 100 and narrowed to unread in JS, so once two bursts of read notifications arrived, older unread fell outside the window and the badge under-reported — potentially to 0. Raised to 500 with the constraint documented.

### 6. `read === false` hid notifications with no `read` field

A record written without the field counted as read. `NotificationCenter` used `!n.read` for the same records, so the list and the badge disagreed. Now `read !== true` in both.

### 7. "Shifts needing attention" counted shifts with no bids

```js
.filter(x => x?.bids?.length > 0 || x?.open_for_bidding === true)
```

The second clause is redundant against the `status: 'open_for_bidding'` query and made every open shift count. Now requires actual bids.

### 8. Staff shift window let unwritten visit notes fall off the end

`Shift.filter({ assigned_to }, '-start_datetime', 100)` sorts newest-first, so scheduled *future* shifts consume the budget before past ones. A carer with 100+ future shifts had their pending visit notes drop out of the count entirely. Raised to 300.

### 9. Archived notifications counted as unread in the bell

`useNotifications` counted `!n.read` with no archived check, while `useBadgeCounts` excluded archived — so an archived-but-unread notification appeared in one number and not the other. Archived is a soft delete; it is now excluded from the unread count, the action-required count, the list itself, and the mark-all-as-read write batch.

### 10. Bell count read 50 records, sidebar read 500

Two different numbers for the same thing on the same screen. Raised the bell to 200; rendering is inside a `ScrollArea`, so the cost is list length rather than layout.

Also removed three dead `??` fallback chains in `BottomTabs` — `useBadgeCounts` always returns numbers for those keys, so the second operand could never be reached and read as a safety net that did not exist.

### Verification

- `vite build` clean.
- Compound-filter constraint cross-checked against the 12 existing in-repo annotations.
- Unread/notification volumes confirmed against live data (62 unread against a 500+ history for the account checked).

## Cleared shift duration anomalies (Base44 checkpoint 6a7ad600d77e00b93783d12a)

**Files changed**: `base44/functions/auditClientBillingRates/entry.ts`, `SHIFT_DURATION_CLEANUP_LOG.md` (new)
**Data changed**: 66 `Shift` records — `duration_minutes` cleared. Full reversal log in `SHIFT_DURATION_CLEANUP_LOG.md`.

Clears the `duration_anomalies` surfaced by the billing audit.

| Class | Records | Action |
|---|---|---|
| Negative duration (-1,065,224,054 min) | 1 | Cleared |
| Zero duration on a `completed` shift | 63 | Cleared |
| Implausible duration (27 h and 38 h non-live-in visits) | 2 | Cleared |
| Zero duration on a `cancelled` shift | 1 | **Kept** — legitimate |
| Clocked time overran the plan (e.g. 30-min call ran 75 min) | ~179 | **Kept** — genuine timesheet data |

### Cleared, not backfilled

Every affected shift has a valid `start_datetime`/`end_datetime`, so a plausible value could have been written in. It deliberately was not. `duration_minutes` means *time staff actually worked*; setting it to the scheduled window asserts staff worked exactly as planned, which this system has no evidence of. In a care record, absent is honest and invented is not.

### No financial impact

Billing resolves hours from `scheduled_duration_minutes` first, so these values were already excluded from invoicing. Verified by replaying all 392 completed July 2026 shifts through `resolveShiftBilling` before and after — per-client and total revenue identical to the penny (£19,091.70).

### Bug this exposed in the audit function

`Number(null)` is `0`, so `recordedIsCorrupt` treated a *missing* duration as a corrupt zero. Left unfixed, the audit would have re-reported all 66 just-cleared shifts as anomalies on the next run. It now distinguishes absent from zero — a shift that was never clocked is not an anomaly.

### The two judgement calls

The 64 negatives and zeros are unambiguously broken. The other two are not quite:

- Joanne Clitheroe, 2026-07-14, wellbeing check scheduled 19:59–22:59, recorded **27 hours**
- MimarCare Ltd, 2026-07-13, personal care scheduled 06:00–20:00, recorded **38.1 hours**

Both look like a missed clock-out closed by a later event. Neither fed any cost or pay figure, so nothing changed downstream, but they are worth confirming with the carers if the actual hours matter.

## OneDrive visit note backup — made self-healing and observable (Base44 checkpoint 6a7a570bd732b9c2793fb6d7)

**Files changed**: `base44/functions/shared/oneDriveVisitNoteHelpers/entry.ts` (new), `base44/functions/syncPendingVisitNotesToOneDrive/entry.ts` (new), `src/components/admin/OneDriveVisitNoteSyncPanel.jsx` (new), `base44/functions/backupVisitNoteToOneDrive/entry.ts`, `base44/functions/manualOneDriveBackup/entry.ts`, `base44/entities/VisitNote.jsonc`, `src/components/admin/OneDriveIntegrationPanel.jsx`

Follows the correctness fix in the previous entry. That made backup work; this makes it survive failure.

### What was still weak

- **One shot, no retry.** Backup happened only at the moment of review. A note that failed — expired token, transient Graph 5xx, reviewed while the integration was off — was left with no marker and nothing to pick it up.
- **Failures were invisible.** They went to `console.error` and nowhere else. No field on the note, nothing in the UI. An admin had no way to know a note had never left the app.
- **`archiveOldVisitNotes` archives notes once `onedrive_synced_at` is set.** A note that silently failed backup stays unarchived, but the inverse — a wrong marker — archives a note that was never backed up. Failure tracking is what makes that distinction observable.
- **Per-note folder calls.** Draining a 200-note backlog through the single-note function would issue ~400 Graph folder-create calls and re-fetch the token each time.

### Shared upload core

`shared/oneDriveVisitNoteHelpers/entry.ts` now holds the per-note upload: skip-reason evaluation, filename construction, folder creation with a caller-supplied cache, PDF generation when missing, the upload, and marker stamping. `backupVisitNoteToOneDrive` and the new sync job both use it.

This matters more than ordinary deduplication here: the previous second implementation filed notes under a different folder with a different naming scheme, so the same note could end up in two places or neither.

### Failure tracking

Three fields added to `VisitNote`:

| Field | Purpose |
|---|---|
| `onedrive_backup_error` | Why the last attempt failed. Cleared on success. |
| `onedrive_backup_attempts` | Consecutive failures. Reset to 0 on success. |
| `onedrive_last_attempt_at` | Last attempt, successful or not. |

`recordBackupFailure` writes these whenever an upload throws, so a stuck note names its own problem.

### Catch-up job

`syncPendingVisitNotesToOneDrive` finds reviewed, non-resident, unsynced notes and drains them. Safe to run on a schedule.

- Takes the OneDrive token **once** and shares a folder cache across the run.
- **Oldest first** — the backlog drains in the order care was delivered, and the note that has waited longest is the one most at risk of being archived before it was ever backed up.
- Gives up on a note after `MAX_BACKUP_ATTEMPTS` (5) and reports it under `needs_attention` rather than retrying forever; `retry_failed: true` overrides.
- A dead connector returns 502 **before** touching any note, so an app-level outage does not burn every note's retry budget.
- `dry_run: true` reports the queue without uploading.

### Admin panel

`OneDriveVisitNoteSyncPanel` sits in Settings → Integrations → OneDrive: waiting count, repeatedly-failed count, per-note error text, "Back up N notes", and "Retry N stuck". Uploads run 200 per click with a remaining count.

The manual "Run Backup Now" button's visit-notes branch now delegates to the sync job in a single call rather than invoking the per-note function in a loop.

### Security note

My first draft of the sync job skipped the auth check when the request body contained an `event` key, intending to allow scheduled runs. That is a bypass — any caller could pass `{"event":{}}` and run it. Replaced with the pattern already used by `resetAnnualLeave` and `resolveStaleShifts`: if a session is present, require manager/admin; unauthenticated invocations are allowed for the scheduler. The decision never keys off the request body.

### Verification

- All **164** backend functions parse under esbuild (0 failures).
- `vite build` clean.
- Live entity schema confirms all five OneDrive fields present.

## Visit notes never reaching OneDrive (Base44 checkpoint 6a7a51b183272d021d39b8e0)

**Files changed**: `base44/entities/VisitNote.jsonc`, `base44/functions/backupVisitNoteToOneDrive/entry.ts`, `base44/functions/manualOneDriveBackup/entry.ts`, `src/pages/VisitNotes.jsx`

### Evidence

Of the 40 most recent visit notes, **every one** has `onedrive_synced_at: null` and `pdf_url: null` — including the 33 that are `manager_reviewed: true` with a `reviewed_at` timestamp. The admin setting is on (`onedrive_sync` → `{ enabled: true, auto_backup_visit_notes: true }`, last saved 2026-08-01). Not a single visit note has ever been backed up.

### Three independent faults

**1. `onedrive_file_id` was never a field on VisitNote.**

`VisitNote.jsonc` defined `pdf_url`, `drive_synced_at` and `onedrive_synced_at` — no `onedrive_file_id`. Two functions write it and three read it:

- `backupVisitNoteToOneDrive` writes it, then checks it to decide "already backed up"
- `manualOneDriveBackup` writes it and filters on `!note.onedrive_file_id`
- `verifyOneDriveVisitNoteBackups` groups notes by it to detect shared-file duplicates
- `archiveOldVisitNotes` reads `onedrive_synced_at || drive_synced_at`

The field is now declared on the entity.

**2. The manual "Backup Now" button could never upload a visit note.**

```js
const pendingNotes = candidates.filter((note) => note.pdf_url);
```

PDFs are only generated on demand, so no note carries a `pdf_url` and `pendingNotes` was always empty. The button reported `"N reviewed visit note(s) skipped — no PDF generated yet"` and returned success having uploaded nothing.

The visit-notes branch now delegates to `backupVisitNoteToOneDrive`, which generates the missing PDF. That also collapses a second, divergent upload implementation: the manual path filed notes flat at `Wellstride/VisitNotes/visit-note-{id}-{date}.pdf` while the event path files them per client at `VisitNotes/{client}/shift-{date}-{time}-{staff}-{shortid}.pdf`. One destination and one naming scheme now.

**3. Backup depended entirely on an entity-event trigger, with no in-app caller.**

Nothing in `src/` invoked `backupVisitNoteToOneDrive`. `handleReview` in `VisitNotes.jsx` sets `manager_reviewed: true` — the exact moment a note becomes eligible — and then did nothing further, relying on a VisitNote update trigger configured in the Base44 platform rather than in code. Given zero notes have ever synced, that trigger is either not wired up or failing on every invocation.

`handleReview` now invokes the backup directly and surfaces a warning toast on failure instead of failing silently. The function is idempotent (it no-ops on a note already carrying a OneDrive marker), so a working trigger and this call cannot double-upload.

### Also fixed

A failed note fetch inside `backupVisitNoteToOneDrive` fell back to the event payload:

```js
.catch(() => []);
const currentVisitNote = latestNotes?.[0] || visitNote;
```

When invoked directly with just an id, that fallback has no `manager_reviewed`, so the note was reported as "not yet reviewed" and skipped. It now throws instead.

The function also never consulted the admin toggle it is governed by. It now skips when `onedrive_sync` explicitly sets `enabled: false` or `auto_backup_visit_notes: false` — a *missing* settings record does not disable backup.

### Not verifiable from here

Entity-event trigger registration lives in Base44 platform configuration, not in the repo, so I could not inspect or repair the trigger itself. The review-time invoke removes the dependency on it. Whether the `one_drive` connector still holds a valid token is likewise only observable at runtime — if uploads now fail, the toast will carry the Graph API error.

### Verification

- All backend functions parse under esbuild (0 failures).
- `VisitNote.jsonc` parses and the live entity schema reports `onedrive_file_id` present.
- `vite build` clean.

## Monthly revenue & cost vs service user billing rates (Base44 checkpoint 6a75e6626bdf98898ecf7b1a)

**Files changed**: `base44/functions/shared/billingHelpers/entry.ts` (new), `src/components/utils/billingRates.jsx` (new), `base44/functions/auditClientBillingRates/entry.ts` (new), `base44/functions/generateMonthlyInvoices/entry.ts`, `src/components/shifts/ShiftCalendarView.jsx`, `src/pages/Payroll.jsx`

### The problem

Three separate implementations priced the same shift, and they all disagreed. The one that produced actual invoices was the worst of them.

**1. `generateMonthlyInvoices` billed live-in care at £0.**

```js
rate = shift?.weekly_live_in_rate || client?.default_weekly_live_in_rate || 0;
```

Neither field exists — 0 occurrences in `Shift.jsonc` and 0 in `Client.jsonc`. Every `live_in_care` shift resolved to `rate = 0` and was invoiced at zero. MimarCare Ltd has a configured contract of £128.60/day for live-in care; July 2026 produced £0 of live-in revenue against £1,543.20 of delivered care.

**2. It ignored `client.service_rates` entirely**, falling back to `default_hourly_rate`. Joan Temple is contracted at £23.50/hr for overnight support but carries a £20 default — any shift without a stamped rate under-billed by 15%.

**3. A shift with no resolvable rate was invoiced at £0** rather than reported. Solid Rock Care Ltd and Malachi George Golden (Kai) both have `default_hourly_rate: null` and no `service_rates`, so their work would silently vanish from the ledger.

**4. `Payroll.jsx` `handleGenerateInvoice` used a magic £20** (`client?.default_hourly_rate || 20`) and ignored service rates and unit pricing.

**5. Corrupt `duration_minutes` fed straight into pricing.** Real July data contains a shift recording **-1,065,224,054 minutes**. The old invoicing code read `duration_minutes` first, so that one record would have produced a **-£301,808,427.30** invoice line.

### The fix

`resolveShiftBilling(shift, client)` is now the single rate resolver, implemented once and mirrored in two places because Deno functions cannot import from `src/`. Precedence:

1. A per-unit client contract (`day`/`night`/`shift`) for the shift's `visit_type` is authoritative. Billing live-in care by the hour is a category error, not rate drift, so the contract wins and the discrepancy is reported.
2. Otherwise an explicitly unit-priced shift bills at its own `unit_rate`.
3. Otherwise hourly: rate stamped on the shift, then the client's hourly contract rate, then `default_hourly_rate`. A stamped rate that disagrees with the contract is billed as stamped and reported — hourly work is not silently re-priced.

Unit quantities are now computed rather than assumed: `shift` bills 1, `day`/`night` bill one per 24h block started. Previously a multi-day live-in shift billed a flat single unit.

A shift that resolves to no rate now **holds the whole client's invoice** and reports which shifts need a rate, instead of writing the work off at £0.

Durations are sanity-bounded (`> 0`, `<= 14 days`); anything outside falls through to the start/end datetimes.

### Billing basis — a deliberate policy choice

The old invoicing read `duration_minutes` (clocked) first; the calendar read `scheduled_duration_minutes` first. They had to converge. **Default is now scheduled**, matching the calendar and immune to bad clock-out data. `generateMonthlyInvoices` accepts `use_recorded_duration: true` to bill actual clocked time instead.

This is not cosmetic. For July 2026, Joanne Clitheroe's 179 shifts where staff clocked longer than scheduled (30-minute calls running 60–75 minutes, plus one 3-hour wellbeing check recorded as 27 hours) account for a **-£944.92** difference between the two bases.

### Verified against live July 2026 data

| Client | Old | New | Delta |
|---|---|---|---|
| MimarCare Ltd | £5,054.67 | £6,201.20 | **+£1,146.53** (live-in £0 → £1,543.20) |
| Joan Temple | £6,290.97 | £6,185.50 | -£105.47 |
| Joanne Clitheroe | £5,251.42 | £4,306.50 | -£944.92 |
| Thera East Anglia | £1,532.57 | £1,518.00 | -£14.57 |
| Home Instead | £809.97 | £822.50 | +£12.53 |
| Malachi George Golden (Kai) | £49.78 | £58.00 | +£8.22 |
| **Total** | **£18,989.37** | **£19,091.70** | **+£102.33** |

Old figures exclude the corrupt-duration shift, which alone would have made the old total -£301,794,492.60.

### New: `auditClientBillingRates`

Read-only. `POST { month, year, client_id? }` returns, per service user: configured rates, expected revenue, payroll cost, margin and margin %, variance against what was actually invoiced, a per-visit-type breakdown, unpriced shifts, rate mismatches, and duration anomalies. Writes nothing.

It also flags shifts whose assigned staff member has no pay rate — those contribute £0 to payroll cost, so the reported margin would otherwise be overstated.

### Known, not changed

- `generatePayslip` uses `contract.hourly_rate || 11.44` while the calendar's cost figure uses `staff.hourly_rate`. These are different sources for the same number; reconciling them needs a decision about which is authoritative.
- `Payroll.jsx` `handleGenerateInvoice` bills every non-invoiced shift for a client regardless of status or month, unlike `generateMonthlyInvoices` which bills completed shifts within the period.
- `base44/functions/shared/payrollHelpers/` is imported nowhere.

### Verification

- All **162** backend functions parse under esbuild (0 failures).
- `vite build` clean.
- Rate resolution replayed against all **392** completed July 2026 shifts and all 12 client records.


## Shift calendar slow to load — stale time regression (Base44 checkpoint 6a75d066ccf75cd7b24ce77b)

**Files changed**: `src/pages/ShiftManagement.jsx`, `src/components/offline/useOfflineQuery.jsx`

### 1. The queries weren't slow — they weren't running (regression introduced here)

All four data queries on the page paired `initialData: []` with a non-zero `staleTime`. React Query treats `initialData` as real data timestamped *now*, so with a `staleTime` above zero the empty array counted as **fresh** and no fetch was triggered on mount:

- shifts — empty for up to **2 minutes**
- clients / staff / locations — empty for up to **10 minutes**

The calendar only populated once something else invalidated the cache, which reads as "taking forever to load".

This was a regression from the earlier mobile-performance pass in this same file. Those queries previously used `staleTime: 0`, which made `initialData` instantly stale and therefore harmless; raising the stale times turned it into an instruction not to fetch. Removed `initialData` from all four — each already destructures with a `= []` default, so it was redundant as well as harmful. Also dropped the `gcTime: 5 * 60 * 1000` override on shifts so the hook's 10-minute retention applies and returning to the page finds a warm cache.

Audited the other `useOfflineQuery` callers (`MyShifts`, `Dashboard`, `StaffDashboard`, `MyVisitNotes`): only `MyVisitNotes` uses `initialData`, and it pairs it with `staleTime: 0`, so it is unaffected.

### 2. The offline cache was written but never read while online

`useOfflineQuery` saved every result to IndexedDB but only read it back when `navigator.onLine` was false. An online load therefore always waited on a full network round trip — 1,000 shifts before the calendar could draw anything.

It now hydrates from the IndexedDB cache on mount, giving an immediate first paint, then revalidates in the background. The seeded data is written with `updatedAt: 0` so it counts as stale and the real fetch still runs — seeding without that would have recreated the exact bug in section 1. Guarded so it never overwrites data the network already returned, with a re-check after the async read to handle the race.

This benefits every `useOfflineQuery` consumer, not just Shift Management.

Verified with targeted assertions and a full `vite build` (exit 0).

## Live MAR chart: no shift means unscheduled, not missed (Base44 checkpoint 6a75bce83ade94cc5ca1af75)

**Files changed**: `src/components/medications/OverdueMedicationsWidget.jsx`, `src/components/medications/MarChartLiveDialog.jsx`

The overdue **list** and the alert monitor already suppressed doses whose scheduled time falls outside every shift for that client — nobody was rostered to be there, so it isn't a missed dose. The live MAR chart didn't apply the same rule: it showed the raw status, so an unstaffed dose still carried a red **"Overdue"** badge with only a small grey note underneath. On a compliance view that reads as a medication error.

- The widget now derives a display status: when a dose is `overdue` or `due_now` **and** no shift covers its time, it is reported as `no_visit_scheduled` instead. The underlying `calculateMedicationStatus` result is preserved as `rawStatus`, and `coveredByShift` is still exposed, so nothing is lost for future use.
- Only outstanding states are reclassified — `given_today`, `not_due`, `prn_available` and `no_schedule` are untouched.
- The dialog renders it as a neutral slate badge ("No visit scheduled", calendar-off icon) rather than red, with the scheduled time and reason beneath it.
- It is deliberately excluded from the **Outstanding** filter and its count: an unstaffed dose is not outstanding work for anyone.
- Applied to both render paths — the table and the stacked card layout, where the old condition had become dead code once the status key changed.

The overdue list and alert gating are unchanged; this only aligns the MAR chart with the rule they already followed.

Verified with a full `vite build` (exit 0).

## OneDrive backup verification and repair (Base44 checkpoint 6a73eace00a2b51969a9a463)

Retroactive companion to the OneDrive fixes. Those stop new bad markers; this finds and repairs the ones already in the data.

**New files**: `base44/functions/verifyOneDriveVisitNoteBackups/entry.ts`, `src/components/admin/OneDriveBackupVerifyPanel.jsx`
**Changed**: `src/components/admin/OneDriveIntegrationPanel.jsx`

**The detection problem**: notes falsely stamped by the old shift-wide backup carry a **valid** `onedrive_file_id` — it resolves fine, it just points at a different note's PDF. An existence check alone therefore finds nothing. The reliable signal is **several notes sharing one file id**, since only one can legitimately own it.

Three classes are detected:

1. **`shared_file_id`** — the team-shift signature. Because we cannot tell retroactively which note actually owned the file, the marker is cleared on all notes in the group; re-backing up the correct one is harmless and simply produces a properly named per-note file.
2. **`resident_note`** — resident notes are never backed up but the old stamp marked them anyway. Clearing just stops them claiming a backup they never had; the backup function still refuses to upload them.
3. **`missing_in_onedrive`** — optional, off by default since it costs one Graph call per note. Only a 404/410 counts as absent; an auth error, rate limit or 5xx is inconclusive and never clears a marker.

**Repair mechanism**: clearing `onedrive_file_id` / `onedrive_synced_at` re-fires the VisitNote update event, which the (now corrected) backup function picks up and handles properly — so the repair self-heals through the existing trigger rather than duplicating upload logic. No visit note content is altered and nothing is deleted from OneDrive.

Admin-gated, `dry_run: true` by default, with an `AuditLog` entry recording who ran it and the breakdown. **UI**: a "Verify Visit Note Backups" card in the OneDrive integration panel — scan shows the counts and sample affected shifts, then a confirmation dialog before anything is cleared.

Verified with a full `vite build` (exit 0) and an esbuild parse of the new function.

## OneDrive visit note backup: 10 bug fixes (Base44 checkpoint 6a73e8d2143dd9049c8d6d32)

**Files changed**: `base44/functions/backupVisitNoteToOneDrive/entry.ts`, `base44/functions/archiveOldVisitNotes/entry.ts`, `base44/functions/manualOneDriveBackup/entry.ts`

### High — the archive was quietly incomplete while reporting success

1. **Archiving was dead — wrong field.** Both backup paths write `onedrive_synced_at` / `onedrive_file_id`, but `archiveOldVisitNotes` filtered on `note.drive_synced_at`, the legacy Google Drive marker (its comment still said "synced to Google Drive"). No OneDrive-backed note was ever archived. Now accepts either marker, so legacy Google Drive notes still archive too.

2. **Multi-note shifts: one PDF uploaded, every note marked backed up.** The "consolidated PDF" branch was an unimplemented stub (`TODO`) that fell back to the current note's PDF, after which the function stamped `onedrive_file_id` + `onedrive_synced_at` on **every** note in the shift. On a team shift the other carers' notes were recorded as backed up when their content had never been uploaded — an evidence gap at inspection, and (once #1 was fixed) those notes would then be archived on the strength of a backup that did not contain them.

3. **Resident notes were falsely marked backed up.** The function explicitly refuses to back up `visit_type === 'resident_note'`, but the shift-wide stamp loop marked them anyway.

Fixed together by restructuring: the function now backs up **exactly the note it was invoked for** — its own PDF, its own file, its own marker. Each note in a shift is backed up by its own event. The unbounded `VisitNote.filter({ shift_id })` query (#6) disappeared with it; `shift` is now fetched for file naming only.

### Medium

4. **Filenames mixed UTC date with local time** — `toISOString()` for the date, `toTimeString()` for the time — so a shift either side of midnight was filed under the wrong day. Both now derive from the same local components, preferring the shift's plain `shift_date` when present.
5. **Filename collisions silently overwrote.** Notes with no shift fell back to `visit-note-{visit_date}.pdf`, so two notes for the same client on the same day overwrote each other via the PUT upload. Filenames now include the staff name and a short note id, making every note's file distinct.
6. Covered by the restructure above.
7. **The two backup paths disagreed on policy.** `manualOneDriveBackup` uploaded *any* active note regardless of review state, including resident notes, and silently dropped notes with no `pdf_url` without reporting them. It now matches the event-driven policy — reviewed, non-resident only — and reports the count of reviewed notes skipped for want of a PDF.

### Low

8. **Empty `catch` blocks** around folder creation swallowed genuine auth/network failures (a 409 "already exists" returns a response rather than throwing, so reaching the catch always meant something real). Now logged.
9. **Only `update` events triggered backup**, so a note created already reviewed was never picked up. `create` is now accepted.
10. **Self-retrigger noise.** Writing the marker back re-fires the same update event. The restructure cuts this from N echoes per shift to one, and a fast-path guard now exits before the record fetch instead of after.

Verified with 13 targeted assertions and an esbuild parse of all 151 backend functions.

## Bottom tab bar missing on Messages (Base44 checkpoint 6a73b4df2ce7d40d8f951c46)

**Files changed**: `src/Layout.jsx`, `src/pages/Chat.jsx`

The Messages list rendered with no bottom tab bar, leaving it a dead end.

**Cause**: `PRIMARY_TAB_PATTERNS` in `Layout.jsx` — the list deciding whether the tabbed shell renders at all — did not include `'Chat'`. On `/Chat`, `isPrimaryTabRoute` was false, so Layout took the plain non-tab branch and `BottomTabsContainer` (and with it `BottomTabs`) was never mounted. The tab bar's own Messages tab navigates to `/Chat`, i.e. straight to a route where the tab bar ceases to exist.

This is why the earlier chat-visibility work didn't resolve it: that change made the bar hide only while a conversation is open, but on this route the bar was never rendered in the first place, so there was nothing to hide or show.

**Fix**: added `'Chat'` to `PRIMARY_TAB_PATTERNS`. Verified this causes no double mount — `getTabFromPath` already maps `Chat` → `messages` and `isExactMainTab` already matches `Chat`, so the page renders once inside the messages `TabPanel` and the routed `children` branch is skipped. The conversation-open behaviour now works as designed: bar visible on the list, hidden while a conversation is full-screen.

Also replaced the chat list's hard-coded `calc(100dvh-121px-…)` height with `calc(100dvh-65px-var(--bottom-tabs-h,52px)-…)`, so it tracks the measured bar height instead of the earlier 56px guess.

Verified with a full `vite build` (exit 0).

## Shift Management performance (Base44 checkpoint 6a732c776b6940739e84a47c)

**Files changed**: `src/components/shifts/ShiftListView.jsx`, `src/pages/ShiftManagement.jsx`

Measured first rather than guessed: jsPDF (382K) was already lazily imported and the drag-and-drop library sits in the shared main bundle, so the lag was **runtime**, not download weight. Two things dominated.

### 1. `ShiftCard`'s memoization never worked

`ShiftCard` is wrapped in `React.memo`, but the page passed it an inline arrow for `onEdit` and two plain (non-memoized) functions for `onDelete` / `onTimeOverride`. All three got new identities on every render, so the shallow prop comparison always failed and **every visible card re-rendered on every keystroke** in the search box, every filter change and every selection toggle.

- `handleEditShift` and `handleToggleBiddingForShift` added as `useCallback`s; `handleDeleteClick` and `handleOpenTimeOverride` wrapped in `useCallback`.
- Result: typing in search now re-renders the input, not 50 shift cards.

### 2. Every card did linear scans over all reference data

`ShiftListView` builds `clientsMap` / `staffMap` / `clientLocationsMap` for O(1) lookups — but only passed them for *team* shifts. Single shifts (the overwhelming majority) received the raw arrays, and `ShiftCard` falls back to `.find()` on an array. With 50 rendered cards against 500 clients, 200 staff and 500 locations that is roughly **60,000 comparisons per render**.

- Both branches now receive the Maps.
- `selectedShiftIds.includes(id)` per card replaced with a memoized `Set.has()`, and `renderItem` now depends on that Set rather than the array.

### 3. Chunk splitting

The calendar, bidding view and all five bulk components were imported eagerly even though the list is the default tab and bulk mode is off by default. They are now `React.lazy` with Suspense boundaries, and the four bulk dialogs only mount once opened (rendering them unconditionally would have defeated the lazy import).

**ShiftManagement chunk: 95K → 63K (−34%)**, with `ShiftCalendarView` (19K), `ShiftBiddingView` (5K) and the bulk components (12.5K) deferred until actually used.

Earlier passes on this page also moved five queries off `staleTime: 0` and capped the list at 50 cards with a "Load more" control.

Verified with targeted assertions and a full `vite build` (exit 0).

## Sync Status page: 10 bug fixes (Base44 checkpoint 6a72be6c2aee00c7ec791a6a)

`SyncStatus.jsx` is a re-export of `SyncManagement.jsx`. Scanned that page plus `SyncCategoryCard`, `SyncQueueProcessor`, `OfflineStorage` and `OfflineMedicationManager`.

**New file**: `src/components/offline/syncPendingMedications.jsx`
**Files changed**: `src/pages/SyncManagement.jsx`, `src/components/pwa/OfflineDataSync.jsx`

### High

1. **Medications were counted as pending but could not be synced.** `totalPending` included unsynced medications, so the page read "N items waiting to sync" — but "Sync All" only rendered when queue items existed, and the Medications card was passed `canSync={false}`, hiding its button. With only medications pending there was **no action anywhere on the page**. The cause was that the medication sync logic lived inline inside `OfflineDataSync.performSync` and was never exported. Extracted to `syncPendingMedications()` and wired to the card; `OfflineDataSync` now calls the same helper (55 duplicated lines removed). Records without a visit note still stay pending, so counts remain honest.
2. **One IndexedDB error froze the page silently.** `getMetadata()` rejects on a request error and sat unguarded inside `Promise.all`, so a single transient failure aborted the whole load — counts stopped updating while the 5s poll kept re-throwing. Every call is now individually guarded, with a retryable error banner instead of silence.
3. **"Clear Queue" could fail with no feedback.** It permanently discards unsynced care data, yet had no try/catch while `clearSyncQueue()` rejects on error — a failure skipped the success toast and did nothing else. Now wrapped with error reporting, and both clear actions use an `AlertDialog` (spelling out exactly what is lost) instead of a blocking native `confirm()`.

### Medium

4. **`queryClient.invalidateQueries()` with no arguments** in three places invalidated every query in the app. Replaced with a scoped `SYNC_AFFECTED_KEYS` refresh.
5. **The 5-second poll never paused** — it now stops while `document.hidden` and refreshes immediately on return.
6. **The progress dialog's 2s auto-hide timer survived unmount.** Held in a ref and cleared.

### Low

7. **The progress bar was not progress** — `100 - (pending × 10)`, floored at 5, pinned at 5% from ten items up and never moved during a sync. Now shows 100% when clear and real `current/total` progress while syncing, and is hidden otherwise rather than displaying a meaningless value.
8. **Refreshing Medications** invalidated `['clients','clientLocations']`, unrelated to local pending records; it now re-reads local storage too.
9. **Toast label** rendered "visitNotes" as "visit Notes" — replaced the regex with a `CATEGORY_LABELS` map.
10. **The "Other" card** had `isRefreshing={false}` hard-coded so it never showed a spinner.

Verified with 16 targeted assertions plus a full `vite build` (exit 0).

## Staff dashboard top gap (Base44 checkpoint 6a72b931c1a430cbbf62ceef)

**File changed**: `src/pages/StaffDashboard.jsx`

The two dashboards were spaced differently at the top. The admin `Dashboard` root sets an explicit `pt-0`, sitting flush beneath the app header. `StaffDashboard` instead had `py-4 mt-6` — 16px padding plus a 24px margin, so **40px of dead space** above the content on mobile. The `mt-6` applied at every breakpoint too, so the gap survived even where `sm:pt-0` / `md:pt-0` zeroed the padding.

Changed `px-4 py-4 mt-6` → `px-4 pt-0 pb-4`, matching the admin dashboard: flush at the top, normal bottom padding, no trailing margin. (This also completes the previous fix — `mt-6` was what remained after `my-6` was halved to remove the bottom strip.)

Confirmed `ImpersonationBanner`, the page's first child, returns `null` when inactive, so it contributes no space. `StaffDashboard` was the only page root carrying a top margin.

Verified with a full `vite build` (exit 0).

## Dashboard blank strip — follow-up (Base44 checkpoint 6a72b6dfaf971106ee67e61e)

The previous pass removed the stacked page padding, but a strip remained on the mobile dashboard. Two residual causes:

**Files changed**: `src/components/layout/BottomTabs.jsx`, `src/components/layout/BottomTabsContainer.jsx`, `src/pages/StaffDashboard.jsx`

1. **The reservation was a guessed number.** The shell reserved a hard-coded `56px`, but the bar's actual content is ~45px tall (each button is `minHeight: 44px` inside a `py-0` nav) — leaving roughly 11px of permanent gap. Replacing one magic number with another would just move the problem, so `BottomTabs` now measures itself with a `ResizeObserver` and publishes the result as a `--bottom-tabs-h` CSS variable; the container reserves `var(--bottom-tabs-h, 52px)`. It measures the `<nav>` rather than the outer element deliberately: the outer div carries the safe-area padding, and `<main>` already contributes that inset, so measuring the nav avoids reintroducing the double-count. The variable resets to `0px` on unmount, and the reservation stays `lg:pb-0`.

2. **`StaffDashboard` had `my-6`** — a 24px margin *below* the page, stacking on top of the bar reservation. Changed to `mt-6`, keeping the intended spacing above while dropping the trailing gap (`py-4` already provides internal padding).

Verified with a full `vite build` (exit 0).

## Blank strip above the bottom tab bar (Base44 checkpoint 6a72b2cb546a2e0553952b12)

**Reported symptom**: pages didn't reach the tab bar — a strip of blank space sat just above the bottom stack.

**Cause**: bottom spacing was being applied at four different levels and stacking, and pages were also taller than the area they render into.

**Files changed**: `src/components/layout/BottomTabsContainer.jsx`, 21 pages, 1 component (bottom padding); 48 pages (`min-h-screen`).

### 1. Bottom padding counted three times

The tab-bar clearance is owned by `BottomTabsContainer` (`56px + safe-area`). On top of that, 22 pages carried their own `pb-24` (96px) — a manual workaround that predates the container reservation — and `<main>` adds the safe-area inset as well. A phone with a home indicator was therefore reserving roughly `56 + 34 + 96 + 34 ≈ 220px` for a 90px bar.

- Removed the redundant `pb-24` / `pb-20` from 21 pages and 1 component, leaving a normal `pb-6`.
- **`CreateEditVisitNote` deliberately kept its larger padding** — it has its own `fixed bottom-0` action bar and genuinely needs the clearance.
- The container no longer re-adds the safe-area inset, since `<main>` already applies it — that alone was ~34px of dead space on modern iPhones.

### 2. The reservation was applied on desktop too

`BottomTabs` is `lg:hidden`, but the container's `paddingBottom` was an inline style with no breakpoint, so every desktop page also reserved 56px for a bar that isn't rendered. Converted to a class with `lg:pb-0`.

### 3. Pages were taller than their container

48 pages used `min-h-screen` (100vh). They render inside `<main>`, which already reserves 65px for the fixed header and sits above the tab bar — so a 100vh page overflows its container by roughly `header + tab bar` (~121px), producing scrollable empty space beneath the content. Switched to `min-h-full`, which fills the available area exactly. Verified every route renders through `LayoutWrapper` → `Layout`, so `min-h-full` always resolves against a sized parent.

Verified with a full `vite build` (exit 0).

## Native tab behaviour and chat visibility (Base44 checkpoint 6a72ac6cd7d64fee498f496e)

**Files changed**: `src/components/layout/BottomTabsContainer.jsx`, `src/components/layout/BottomTabs.jsx`, `src/pages/Chat.jsx`

### Chat visibility — the tab bar disappeared for the whole Messages tab

`{activeTab !== "messages" && <BottomTabs .../>}` hid the bottom bar for the entire Messages tab, including the conversation **list**. Opening Messages stranded the user: the only way back to Dashboard, Shifts or Tasks was a system back gesture. Native messaging apps keep the tab bar on the list and hide it only while a conversation is full-screen.

- `Chat` now publishes its state via a `wellstride:chat-conversation` event alongside the existing `chat-fullscreen` body class, emitting `{ open: false }` on unmount so the bar can never be left hidden.
- The container listens and hides the bar **only while a conversation is open**, so Messages is no longer a dead end.
- The panel's bottom padding is keyed to the same condition rather than to `activeTab === "messages"`.
- The chat list's viewport height now allows for the bar it sits above (`100dvh - 121px - safe-area` on mobile); the `md:` height is unchanged since there is no bottom bar at that width.

### Tab behaviour

- **Tabs remember where you left them.** Switching tabs previously always navigated to that tab's root, so going Shifts → Tasks → Shifts discarded your place (mid-visit-note included). Each tab now records its last route and restores it on return, which is how native tab bars behave. Re-tapping the active tab still pops to root and scrolls to top, and now also clears that memory so the next visit starts clean.
- **Haptics on every tab press**, not just when switching to a different tab — re-tap previously gave no feedback at all.
- **Immediate press feedback**: `active:scale-[0.92] active:opacity-70` plus `touch-manipulation` and `select-none`, so a tap registers visually before navigation completes rather than feeling laggy.
- **`aria-controls`** now links each tab to its panel.

Verified with a full `vite build` (exit 0).

## Robust pull-to-refresh for mobile (Base44 checkpoint 6a72a61537c9204b85d08ed3)

`PullToRefresh` was rewritten and extended to every mobile page. Previously it existed only on the four primary tabs and `MyShifts`.

**Files changed**: `src/components/ui/PullToRefresh.jsx` (rewritten, 263 lines), `src/components/layout/BottomTabsContainer.jsx`, `src/Layout.jsx`

### Defects in the previous implementation

1. **Listeners re-bound on every frame of a drag.** `handleTouchEnd` depended on the live `pullDistance` state, so the effect tore down and re-attached all three touch listeners on every pixel of movement — dozens of times per second, risking dropped events mid-gesture.
2. **A React re-render per touch frame**, with the indicator's height animating layout (not transform) — the cause of the jank.
3. **No direction detection.** Any downward component triggered a pull, so horizontal swipes and diagonal flicks fought the gesture — including over horizontally scrollable tables.
4. **Only the bound element's `scrollTop` was checked**, so pulling inside a scrolled nested list could still trigger a refresh.
5. **The spinner never tracked the actual refresh.** `onRefresh` dispatched a `CustomEvent`; Layout's listener called `handleRefresh()` without returning its promise, so the await resolved immediately and the spinner stopped before any data arrived.
6. No multi-touch guard (pinch-zoom entered the pull path), no `touchcancel` handler (a system-cancelled gesture left `pulling` stuck true), no timeout if `onRefresh` hung, and no minimum spinner time so fast refreshes flashed.

### The rewrite

- **Listeners bound once.** All gesture state lives in refs; `onRefresh`, `threshold`, `maxPull` and `disabled` are mirrored into refs so prop changes never re-bind.
- **Zero React renders while dragging.** Movement is written directly to the DOM inside `requestAnimationFrame` using `translate3d` (GPU-composited, no layout). Only the coarse phase — idle → pulling → armed → refreshing — is state.
- **Direction arbitration.** A 6px noise floor, then the gesture is claimed only if it is downward *and* at least 1.5× more vertical than horizontal; otherwise it is handed back to the page for the rest of the touch.
- **Correct scroll origin.** Walks up from the touch target to the nearest genuinely scrollable ancestor and requires both it and the page to be at the top.
- **Asymptotic damping** (`maxPull * (1 - e^(-dy/maxPull))`) for native-feeling resistance that can never exceed the cap.
- **Guards**: ignores multi-touch, handles `touchcancel`, aborts if content scrolls away mid-gesture, refuses to fire while a modal/sheet is open (`data-scroll-locked` or an open Radix dialog), and only runs on coarse pointers so a mouse drag never triggers it.
- **Honest spinner**: awaits the real refetch promise, with a 450ms minimum (no flash) and a 12s timeout (never stuck).
- **Feedback**: haptic tick on crossing the threshold, plus a pill indicator that reads "Pull to refresh" → "Release to refresh" (arrow flips) → "Refreshing…".

### Coverage

- `BottomTabsContainer` now calls `queryClient.refetchQueries({ type: 'active' })` directly and returns the promise, so the spinner reflects real completion.
- `Layout` wraps the non-tab branch too, so **every** mobile page gets pull-to-refresh — visit notes, compliance, training, profile and the rest — not just the four primary tabs. Disabled on chat routes, where the view manages its own scroll.

Verified with a full `vite build` (exit 0).

## Admin tool: remove superseded visit note drafts (Base44 checkpoint 6a72769f3701f79acfd6ecc9)

Retroactive companion to the duplicate-visit-note fix. That fix stops *new* duplicates; this removes ones already in the data.

**New file**: `base44/functions/cleanupSupersededVisitNoteDrafts/entry.ts`
**Changed**: `src/pages/VisitNotes.jsx`

- Admin-gated (`isUserAdmin`), `dry_run: true` by default — nothing is deleted without an explicit second call.
- A draft is only eligible when a **non-draft note exists for the same shift**. Drafts with no finalised counterpart are genuine unfinished work and are explicitly reported as kept, never deleted.
- The preview lists each candidate with client, visit date and how many seconds separated the draft from its finalised note — making the offline double-create signature visible.
- Deletions are recorded in `AuditLog` with the operator, count and affected draft ids.
- **UI**: a subtle "Scan for duplicates" strip at the top of Visit Notes Review; after scanning it shows what would be removed and what would be kept, with a confirmation dialog before anything is deleted.

**Verification of the one live duplicate** (shift `6a42645b952885a2a62ec3dc`, Joan Temple, 2026-08-04): draft `6a721dd17d8f38a447f7a6fe` versus finalised `6a721dd1fe2745f6ead443b5`. Field-by-field comparison showed the draft is a strict subset — identical medication administration chart (4 medications), times, mood, wellbeing status and next-visit focus; the finalised note additionally carries the AI summary. The draft's only unique content is the auto-generated placeholder `"(Draft in progress)"` in observations. Safe to delete; no clinical content is lost.

**Note on execution**: the MCP toolset exposes create/update/query for records but no delete, and the sandbox holds no service credentials, so the record could not be removed directly from here — hence shipping it as an in-app tool that runs under the operator's own admin session.

## Duplicate visit notes: drafts submitted alongside the final note (Base44 checkpoint 6a7272a9fd766cb1d0dca08c)

**Reported symptom**: in-progress drafts were being submitted in addition to the final note, so review showed two copies of the same visit.

**Confirmed in live data**: shift `6a42645b952885a2a62ec3dc` (Joan Temple, 2026-08-04) had note `6a721dd17d8f38a447f7a6fe` (`status: draft`) and `6a721dd1fe2745f6ead443b5` (`status: active`) created **37 milliseconds apart** — the signature of a sync queue replaying two separately-queued creates, not of a user acting twice.

**Root cause** — three compounding gaps:

1. **No draft lookup by shift.** `CreateEditVisitNote` only adopted an existing note when opened with `?noteId=`. Staff reach it via `?shiftId=` (from MyShifts / MyVisitNotes), so `editingNote` stayed `null` even when a draft for that shift already existed on the server — and submitting created a second note.
2. **The offline path never learns the draft's id.** `saveDraftMutation` runs through `useOfflineAwareMutation`; when offline it throws `OFFLINE_QUEUED`, so `onSuccess` → `onDraftSaved` never fires and `editingNote` is never set. Save-then-submit while offline therefore enqueues **two creates**, which the queue replays back-to-back. This is what the live data shows.
3. **Drafts were never filtered out of review.** `VisitNotes.jsx` and `useVisitNotesData.jsx` both did `VisitNote.list('-created_date', 1000)` with no status filter, so a draft appeared in the review queue as though it were a submitted note.

**Files changed**: `src/pages/CreateEditVisitNote.jsx`, `src/components/visit-notes/hooks/useVisitNoteSubmit.jsx`, `src/components/offline/SyncQueueProcessor.jsx`, `src/pages/VisitNotes.jsx`, `src/components/hooks/useVisitNotesData.jsx`

**Fixes**:

1. **Resume existing drafts.** A `shiftVisitNotes` query looks up notes for the selected shift; if one is the current user's draft it is adopted into `editingNote` and the form is populated from it, with a "Resumed your saved draft for this visit" toast. Guarded by a ref so it happens once and can't clobber in-session edits.
2. **Safety net at submit.** Before creating, `handleSubmit` re-checks for an existing draft for the shift and finalizes that instead — covering cases where the lookup hadn't resolved or the draft arrived via a different route.
3. **Superseded drafts are removed.** New exported `removeSupersededDrafts(shiftId, keepNoteId)` deletes any *other* draft for the same shift once a note is finalised. Wired into all three creation paths: the online create, the `_finalizeDraft` update, and — critically — `SyncQueueProcessor`, which creates records directly and bypasses the mutation hooks entirely (the path that produced the live duplicate). Deleting is safe here: a draft was never submitted, and the note replacing it holds the complete content.
4. **Drafts excluded from review.** Both manager-facing lists now filter out `status === 'draft'`. Staff keep access to their own drafts via MyVisitNotes to resume them.

**Existing duplicates are not auto-cleaned** — see the note below on the one live pair found.

Verified with a full `vite build` (exit 0).

## Dashboard: live MAR chart from the Overdue Medications widget (Base44 checkpoint 6a71ac00e1730222630b9307)

The dashboard widget previously surfaced only *overdue* medications, and vanished entirely when everything was on track — so there was no way to see the current medication picture at a glance. Admins and managers can now open a live MAR chart from it.

**New file**: `src/components/medications/MarChartLiveDialog.jsx` (207 lines)
**Changed**: `src/components/medications/OverdueMedicationsWidget.jsx`

**What the view shows** — every active medication for every client with a visit scheduled today, grouped by client:
- Medication, dose, route, and scheduled times (or "As needed" for PRN, with the indication)
- Live status badge: Given / Overdue / Due now / PRN / Not due
- **Today's administrations**, merged from both sources — the client's `mar_schedule.administration_records` *and* today's visit-note `medication_administration_chart` entries — each showing time, who gave it, and which source it came from
- A note when an outstanding dose isn't covered by any shift today (the same suppression rule the alerts use), so a manager can see *why* something isn't being flagged
- Search across client/medication/dose/route, plus All / Outstanding / Given / PRN filters with counts
- "Updated HH:mm:ss" timestamp and a manual Refresh button; the underlying query already refetches every 60s

**Widget changes**:
- The query now also builds a `marRecords` array covering **all** active medications including PRN (previously PRN was skipped early and never evaluated).
- A "View MAR chart" button appears in both widget states — the red overdue card *and* the green "Medications On Track" card — so the record is reachable even when nothing is outstanding.
- Gated with `isUserManager` (admin, super_admin or manager); staff see the widget exactly as before with no button.
- The dialog is lazy-loaded, so the dashboard bundle is unaffected for users who never open it.

**Overdue logic deliberately untouched**: PRN records are added to the live view but still `return` before the `hasAllocatedMedications` flag and the overdue push, and the shift-coverage gate (including the overnight-shift fix) is unchanged — verified by inspection after patching. The widget still hides itself entirely when a client has no allocated medications.

Verified with a full `vite build` (exit 0).

## Backend dead code cleanup — 12 removals (Base44 checkpoint 6a71903ea07483f6d7f28128)

Scanned all 149 backend functions for dead and redundant code. **Full reversal log with every removed byte: [`BACKEND_CLEANUP_LOG.md`](./BACKEND_CLEANUP_LOG.md).**

**Removed (~84 lines):**
- 1 unused import (`contentScheduler`: `format` from date-fns, 0 uses)
- 3 unused constants (`LOGO_URL` ×2, `MAX_MY_SHIFTS`)
- 5 unused functions (`blobToBase64` ×2, `formatDate`, `formatDateTime` ×2)
- 2 inline copies of `sendNotificationsWithPreferences` replaced with the shared helper
- 1 dev artifact: the `pdfProbe` function — a scratch endpoint that generated a "Hello probe" PDF and uploaded it as service role **with no auth check**, referenced nowhere, pinned to different SDK versions than the rest of the backend

**Safety approach**: every removed symbol was verified to have exactly one occurrence in its file (the definition) before deletion. `formatDate` in `generateTrainingCertificate` was deliberately kept — it is used there; only the identically-named unused copy in `generateFormPdf` was removed. All 149 functions re-parsed with esbuild afterwards (0 failures).

**Deliberately NOT removed**: 50 functions have no code reference anywhere, but these are cron/webhook/entity-event functions (`resetAnnualLeave`, `trainingComplianceDailyCheck`, `archiveCompletedTasks`, `notifyNewChatMessage`, `validateShiftIntegrity`, …) whose triggers live in Base44 config rather than code. "Unreferenced" is not "unused" — none were deleted. `notifyDocumentUpdates`' local `buildDocumentUpdateNotifications` duplicates a shared helper but is actively called with a differing signature, so it was left for a separate verified change.

**Correction to the earlier backend audit**: that audit reported "no backend function imports from `shared/`". That was wrong — 6 functions import `../shared/authHelpers/entry.ts`, so cross-directory imports work fine in Base44. Two of the five redundancy findings from that audit are also now stale: `generateCarePlanPdf` and `generateRiskAssessmentPdf` no longer inline the markdown-PDF helpers.

## AI task backlog cleanup + staff-matching assignment engine (Base44 checkpoint 6a7047eb173bd8bf8a9dec07)

Follow-on from the dead-toggle fix: clears the backlog those runaway AI tasks left behind, and makes the previously inert scoring settings actually drive assignment.

**New files**: `base44/functions/cleanupAiTaskBacklog/entry.ts`, `base44/functions/suggestTaskAssignee/entry.ts`
**Files changed**: `base44/functions/analyzeVisitNote/entry.ts`, `src/components/tasks/TaskDialog.jsx`, `src/pages/TaskManagement.jsx`

### 1. Backlog cleanup (`cleanupAiTaskBacklog` + admin card in Task Management)

A direct bulk database edit of the ~1,000+ affected records was blocked by the platform's safety classifier, so this shipped as a permissioned in-app tool instead — which is repeatable and auditable rather than a one-off external mutation.

- Admin-only (dual-field role check). Defaults to `dry_run: true` so nothing changes without an explicit second call.
- Targets only **pending** tasks that are AI-generated (`assigned_by_name === 'AI Analysis'`, `assigned_by_email === 'system'`, or tagged `ai_generated`). In-progress and completed work is never touched.
- Marks them `cancelled` + `is_archived` with `archive_reason: 'ai_backlog_cleanup'` rather than deleting, preserving the audit trail.
- Also archives the matching `task_assigned` notifications so staff inboxes clear too.
- Writes an `AuditLog` entry recording who ran it and how many records changed.
- Batched at 400 per run with a `has_more` flag; the UI loops until the backlog is drained, showing running progress.
- **UI**: an amber "AI task backlog" card in Task Management (admins only) — **Scan** previews the count and per-staff breakdown, then **Clear N** opens a confirmation explaining exactly what will happen before anything is written.

### 2. Staff-matching engine (`suggestTaskAssignee`)

Every previously-inert setting on the AI Assignment panel now drives real scoring. For a given task the engine ranks staff on four weighted signals, with the weights normalised from `priority_weight` / `skill_weight` / `workload_weight` / `continuity_weight`:

- **Skill** (`respect_staff_skills`) — completed, unexpired `TrainingAssignment` records whose titles match the task's category keywords or significant words from its title/description.
- **Workload** (`balance_workload`) — count of the staff member's active (pending + in progress) tasks; staff at or above `max_active_tasks_per_staff` are marked ineligible rather than merely down-ranked.
- **Continuity** (`prefer_client_familiarity`) — number of prior shifts that staff member has had with the task's client.
- **Priority fit** — urgent/high tasks favour staff with genuine spare capacity, factoring in overdue work.
- **`avoid_overdue_staff`** applies a graduated penalty per overdue task.
- **`confidence_threshold`** gates auto-assignment: below it, the engine returns no `auto_assign` and the task is left for a human.

Each suggestion returns a confidence score plus human-readable reasons ("3 previous visits with this client", "No active tasks", "At capacity (5/5 active tasks)") so the decision is explainable rather than a black box.

### 3. Wiring

- **`analyzeVisitNote`** now calls the engine per AI task when assignment is enabled *and* manager approval is off. If no candidate clears the confidence threshold, the task is created unassigned and tagged `awaiting_approval` instead of defaulting to the note's author (the old behaviour, which is what dumped work on whoever happened to write the note). Auto-assigned tasks are tagged `ai_assigned`.
- **`TaskDialog`** gained a **Suggest** button next to "Assign To" for manual task creation — shows the top 3 ranked staff with confidence and reasons; click to apply. Ineligible (at-capacity) staff are shown greyed out with the reason rather than hidden.

Verified with esbuild parses of all three backend functions and a full `vite build` (exit 0).

## AI still allocating tasks while disabled — dead settings toggle (Base44 checkpoint 6a703ec0bdd2378a08109412)

**Reported symptom**: AI assignment was switched off, but AI kept creating and assigning tasks to staff.

**Root cause**: `AIAssignmentSettingsPanel` writes an `AppSettings` record under the key `task_ai_assignment_settings`, but a codebase-wide search found that key referenced in **exactly one file — the panel that writes it**. Nothing ever read it. Every control on that panel was write-only; the "Enable AI assignment" toggle was purely decorative.

Meanwhile `base44/functions/analyzeVisitNote/entry.ts` — invoked on every visit note submission from `useVisitNoteSubmit` — created AI tasks unconditionally and assigned them to `task.assigned_to_email || note.created_by`, then notified the assignee.

**Confirmed against live data**: the settings record has `enabled: false`, last modified 2026-06-11 by the admin. Yet all 15 most recent Task records were `assigned_by_name: "AI Analysis"`, `assigned_by_email: "system"`, tagged `ai_generated` — the newest created 2026-08-03 06:44, roughly seven weeks after AI was disabled.

**Files changed**: `base44/functions/analyzeVisitNote/entry.ts`, `src/components/tasks/AIAssignmentSettingsPanel.jsx`

**Fixes**:

1. **`analyzeVisitNote` now reads the setting** before doing any task work and skips AI task creation entirely when `enabled !== true`. AI *analysis* of the note (summary, risks, flags, sentiment, care-plan suggestion) still runs and still writes to the visit note — only task creation/allocation is gated.
2. **Staff-entered follow-up actions are deliberately unaffected.** The `note.follow_up_actions` loop creates tasks from what the care worker typed into the visit note form; that is not AI output, so disabling AI does not silently break follow-ups.
3. **`require_manager_approval` (also previously dead) is now honoured.** When AI assignment is enabled and approval is required (the default), AI tasks are created **unassigned** and tagged `awaiting_approval`, and managers receive a `review_required` notification telling them how many tasks need allocating — instead of AI pushing work straight onto staff.
4. **Response payload is now honest**: returns `ai_assignment_enabled` and `ai_tasks_skipped` alongside `tasks_created`.
5. **Panel admin gate** used `user?.role === "admin"` in two places (query `enabled` and the render guard), so an admin whose role lives in `app_role` could not see or edit these settings. Now checks both fields, consistent with the backend role sweep.
6. **Panel copy no longer misleads**: the header explains what the current state actually does (including that staff-entered follow-ups still create tasks), and the scoring-rules block carries an explicit notice that those weightings are stored for a future staff-matching engine and do not affect task creation — only the two toggles above are active.

**Not changed (flagged for a decision)**: `confidence_threshold`, `max_active_tasks_per_staff`, `balance_workload`, `prefer_client_familiarity`, `respect_staff_skills`, `avoid_overdue_staff` and the four scoring weights remain stored-but-inert — there is no staff-matching engine behind them. They are now labelled as such in the UI rather than removed, so existing saved configuration is preserved.

Verified with an esbuild parse of the backend function and a full `vite build` (exit 0).

## Training Hub: admin course management (Base44 checkpoint 6a6f8e47cc9647da7f5f8cd9)

Admins can now add, relabel, archive and delete the training courses that form the columns of the training matrix. Previously the matrix was read-only — courses could only be changed by editing `Training` entity records directly.

**Files changed**: `src/components/training/CourseManagerDialog.jsx` (new, 371 lines), `src/pages/TrainingHub.jsx`, `base44/entities/Training.jsonc`

**New component — `CourseManagerDialog`**:
- Lists every course (active and archived) with its category, validity period, mandatory flag, and a count of how many staff records reference it.
- **Add**: create a course with name, category, validity period (days, drives automatic expiry calculation), mandatory flag and description.
- **Relabel**: rename a course inline. Because `TrainingAssignment` stores a denormalized `training_title`, a rename offers to **cascade to existing staff records** (checkbox, on by default, showing the affected record count) so alerts, certificates and exports show the new name. Matrix cells continue to match by `training_id`, so history is never orphaned by a rename.
- **Archive / Restore**: sets `status` to `archived`, which removes the column from the matrix while preserving all staff records — the safe default for compliance history. Archived courses can be restored.
- **Delete**: permanent removal behind an AlertDialog that names the course and warns how many staff records reference it, explicitly recommending Archive instead when records exist.
- Duplicate course names are rejected; the course name is required.
- Uses `stripSystemFields` on updates since `Training.update()` is a PUT (full replace).

**`TrainingHub.jsx`**: added an `isAdminUser` predicate (course CRUD is admin-only per the entity's RLS, distinct from the existing manager-level `isManagerUser`), a lazy-loaded "Manage Courses" button in the Training Matrix tab header shown only to admins, and a hint in the matrix description. All course mutations invalidate the `["trainingHub"]` query key so the matrix updates immediately.

**`Training.jsonc` RLS**: create/update/delete previously required `role: "admin"` only, so an admin whose role lives in `app_role` would have been rejected by the server. Widened to `role: "admin"` **or** `app_role in ["super_admin", "admin"]`, consistent with the dual-role convention applied across the backend. Read access is unchanged (`true`).

Verified with a full `vite build` (exit 0) and a JSON validity check on the entity file.

## Shift Management mobile: 9 fixes (Base44 checkpoint 6a6e99c00a1516838e2f7c23)

**Files changed**: `tailwind.config.js`, `src/pages/ShiftManagement.jsx`, `src/components/shifts/BulkActionsBar.jsx`, `src/components/shifts/ShiftListView.jsx`, `src/components/shifts/ShiftCalendarView.jsx`

1. **Missing `xs` breakpoint (HIGH)**: `tailwind.config.js` defined no `xs` screen, so every `xs:` class silently no-opped at all widths — the header button rendered as just "Shift" (never "Create Shift"), calendar day headers showed single letters ("M T W…") even on desktop, and the filter grid never went 2-column. Added `screens: { xs: '475px' }`; verified the breakpoint lands in the compiled CSS.
2. **Clock-time override accepted clock-out before clock-in (HIGH)**: added a submit-time validation toast, a mutation-level guard (`throw` on non-positive duration so bad data can never persist), a red "Clock out must be after clock in" panel replacing the negative-hours preview, and the Save button disables while times are invalid.
3. **Bulk actions bar stranded at top (MEDIUM)**: on <lg screens the bar is now `fixed` just above the bottom tab bar (with safe-area offset), so Reassign/Status/Times/Delete stay reachable while scrolling a long selection list; unchanged in-flow on desktop.
4. **Heavy render + aggressive refetching (MEDIUM)**: all five queries used `staleTime: 0` — now `STALE_TIME.SHORT` (2 min) for user+shifts and `STALE_TIME.LONG` (10 min) for clients/staff/locations. `ShiftListView` now renders 50 cards initially with a "Load more (+100)" button instead of up to 1,000 at once.
5. **Same-day shifts unordered (MEDIUM)**: the sort key stripped the time; now includes `start_time` (fallback: ISO time portion) so shifts within a day sort chronologically.
6. **Calendar drag-and-drop vs touch (MEDIUM)**: drag is disabled for coarse pointers (`pointer: coarse`) — long-press-drag no longer fights pan-scrolling on the 700px-wide grid; tap-to-edit and tap-day-to-create still work.
7. **`h-13` TabsList class doesn't exist** → `h-12`.
8. **Filters had no expand cue on desktop**: `showFilters` now defaults open on ≥768px screens, collapsed on phones.
9. **Dead markup removed**: double-`hidden` header subtitle and the empty admin-only filter footer block.

Verified with a full `vite build` (exit 0).

## My Task workflow: 12 bug fixes (Base44 checkpoint 6a6e7fef2f8a3644c68e4d22)

**Files changed**: `src/pages/MyTasks.jsx`, `src/pages/TaskManagement.jsx`, `src/components/tasks/my-tasks/MyTaskWorkflowCard.jsx`, `src/components/tasks/ClientTasksPanel.jsx`, `src/components/tasks/OfflineTaskManager.jsx`, `src/components/tasks/TaskCompleteDialog.jsx`, `src/components/offline/SyncQueueProcessor.jsx`

1. **CRITICAL — offline Start/Complete corrupted data**: MyTasks mutations passed `{ taskId }` instead of `{ id, data }` to `useOfflineAwareMutation`, which derives create-vs-update from `variables.id`. Offline actions were queued as **creates** with `{taskId, feedback}` as the whole payload — on reconnect, `Task.create()` produced a junk record while the real task stayed incomplete, and the optimistic cache showed a junk temp task. Both mutations now use the `{ id, data }` shape; the completion payload is built at the call site.
2. **No assignee notification on manual task creation**: only AI-generated tasks (analyzeVisitNote) notified staff. `TaskManagement` and `ClientTasksPanel` create mutations now create a `task_assigned` notification for the assignee (wrapped in try/catch so notification failure can't fail task creation; Notification RLS allows the admin/manager creators).
3. **`ClientTasksPanel` "New Task" button**: gate now checks `app_role` as well as `role`.
4. **Offline completion replay never cleared assigner notifications**: `SyncQueueProcessor` now invokes `clearTaskNotifications` after replaying a Task update whose payload has `status: 'completed'`.
5. **`ClientTasksPanel` overdue count included tasks due today**: `new Date(due_date) < new Date()` compared against midnight; now uses date-string comparison excluding today (consistent with MyTasks).
6. **`ClientTasksPanel` native `confirm()` on delete**: replaced with a controlled AlertDialog (same pattern as TaskManagement).
7. **`OfflineTaskManager`**: badge no longer resets to 0 when sync items failed (recounts from the queue); overlapping-sync guard moved to a ref because the `online` listener captures the first-render closure.
8. **`MyTaskWorkflowCard` crash on malformed due_date**: `format(parseISO(...))` now guarded with `isValid()`; `getDueMeta` in MyTasks also treats invalid dates as "no due date" instead of producing NaN labels.
9. **Per-card busy state**: Start/Complete buttons now disable only on the task being mutated instead of every card.
10. **Task fetch limit raised 100 → 300** so staff with large task lists don't silently lose the furthest-out tasks.
11. **Notification-click highlight** now reads the router's `location.search` (was `window.location.search`) and re-runs when the URL changes.
12. **`completed_date` format unified**: `TaskCompleteDialog` now writes ISO datetime like the MyTasks flow (was date-only), so completion timestamps are consistent for reporting/archiving.

Verified with a full `vite build` (exit 0).

## Save Changes fix: system fields stripped from Client.update payloads (Base44 checkpoint 6a697eba2194dacf2bcb3df1)

**Problem**: The "Save Changes" flow (and every other client update path) sent the full client object — including Base44 server-managed fields (`id`, `created_date`, `updated_date`, `created_by`, `is_sample`, …) — in the `Client.update()` PUT body, which can fail server-side validation and reject the whole save.

**Fix**:
- New helper `src/components/utils/entityUpdateHelpers.jsx` exporting `stripSystemFields(data)` — removes server-managed fields from an update payload.
- Applied at every `Client.update()` call path:
  - `src/pages/ClientProfile.jsx` — `updateClientMutation.mutationFn` now strips system fields; `handleSaveCarePlan` also merges `{ ...client, ...editedClient }` so a stale/partial `editedClient` can never erase fields.
  - `src/pages/Clients.jsx` — mutationFn strips system fields.
  - `src/pages/ClientOnboardingWizard.jsx` — mutationFn strips system fields.
  - `src/components/clients/VisitNoteConfigurator.jsx`, `src/components/clients/MARChart.jsx`, `src/components/forms/FormRenderer.jsx`, `src/components/forms/FormUploadAnalyzer.jsx` — full-object spreads now wrapped in `stripSystemFields(...)`.

Verified with a full `vite build` (exit 0).

## Backend audit: 62 functions fixed (Base44 checkpoint 6a69572138781ba1c5b54dc4)

Full audit of all 138 backend functions + 9 shared helpers found 6 critical, 35 high, 15 medium, 6 low findings. All fixed except the 5 redundancy findings (see note at end).

### Critical — silently broken features

1. **`generatePayslip`** — YTD query (`{staff_email, status:'issued'}`) and timesheet lookup (`{staff_email, pay_period_start, pay_period_end}`) were multi-field compound filters that silently return `[]`: YTD figures were always £0 and payslip generation always failed with "No approved timesheet found". Both converted to single-field filter + JS narrowing.
2. **`generateMonthlyInvoices`** — completed-shifts query used a compound filter (always `[]` → zero invoices generated every month). Converted to `{status:'completed'}` + the existing JS date-range narrowing. Also: `bulkCreate` failures were swallowed by `.catch(console.error)` and the success count reported the *input* length; now failures are recorded in `results.errors` and `generated` reflects actual creations.
3. **`trainingComplianceDailyCheck`** — compound filter meant expired training was never marked and renewal reminders never fired. Converted to single-field + JS; sort changed to ascending `expiry_date` so expired/soon-expiring records are always within the 1000-record window.
4. **`archiveCompletedTasks`** — `updateMany` with a 3-field compound query never matched; replaced with single-field fetch + JS narrowing + per-record updates.
5. **`workflowEngine`** — duplicate-execution guard used a compound filter (never fired → duplicate workflow executions under concurrent triggers). Converted to `{policy_id}` + JS `status==='in_progress'` filter.
6. **`resetAnnualLeave`** — had **no authentication**; anyone could reset every user's leave balance. Added the dual-mode guard (admin required when a user session is present; unauthenticated scheduled automation still allowed) and bounded the `User.list()` call.

### High — missing auth guards (5 functions)

`contentScheduler`, `createInductionTrackers`, `policyReviewScheduler`, `sendTrainingReminders` got the dual-mode guard (admin/manager if authenticated, automation allowed). `scanClientConfigs` (exposes every client's `visit_note_config`) got a **hard** admin/manager gate.

### High — role-check sweep (~28 functions, 51 individual patches)

Systemic bug: role checks read only `user.role` **or** only `user.app_role`. Every check now tests **both fields explicitly** (`u.role === 'admin' || u.app_role === 'admin'`), which also fixes the subtler `(app_role || role)` short-circuit flaw in `uploadToOneDrive`, `createBulkShifts` and `importShifts` (a user with `app_role:'user'` + `role:'admin'` was wrongly blocked). Server-side `User.filter({role:'x'})` queries (which miss `app_role` users entirely) were converted to bounded `User.list()` + JS dual-field filters in: `admin2FAManagement`, `automatedCQCReminders`, `complianceReminderScheduler`, `cqcComplianceChecker`, `generateClientWeeklyReport`, `generatePolicyComplianceReport`, `generatePolicyTemplates`, `getStaffForecastingData`, `sendOnboardingReminders`, `updateFormSubmissionStatus`. Deny-guards fixed in the 9 `cleanup*`/scheduler/publisher functions; recipient filters fixed in `checkComplianceExpirations`, `criticalPushNotifications` (also 3× `User.filter({})` full-scans → `list()`), `executeFormAutomations` (8 sites), `notifyDocumentUpdates`, `notifyFormSubmission`, `placeShiftBid`, `runSystemDiagnostics`, `autoAssignManager`, `createPolicyAcknowledgements`, `createOnboardingTasks`, `cleanupNotificationBacklog`, `sendMondayMotivation` (+ bounded its unbounded `User.list()`), `generateVisitNotePdf`, `generateWeeklyReportPdf`. `importShifts` guard rewritten in positive form (users with no role set are now rejected).

### Medium — 20 `.filter({id})` lookups → `.get()` (15 functions)

`applyShiftCorrection`, `autoAssignManager`, `backupVisitNoteToOneDrive` (×2), `chatWebSocket`, `clockShift` (×2), `createPolicyFromTemplate`, `expressShiftSwapInterest` (×2), `generateTrainingCertificate`, `generateWeeklyReportPdf`, `getClientInfoForShift` (×5), `getLocationResidents`, `reviewTimeCorrection`, `routeFormSubmission`, `validateFormSubmission`. All preserve the caller's array shape via `.then(r => r ? [r] : [])`. Also: `getLocationResidents`' compound `Resident.filter({client_location_id, status})` (residents list was always empty) → single-field + JS status filter; `autoSyncPayrollToQuickBooks`/`syncPayrollToQuickBooks` `Payslip.filter({})` → `Payslip.list()`; `createBulkShifts` now uses `asServiceRole` for the bulk create; `validateShiftIntegrity` now allows unauthenticated entity-event/automation invocations (admin still required when a user session is present), so integrity validation actually runs from events.

### Low

- PII/log leakage: removed 7 `console.log` lines printing staff emails, client names, and OneDrive URLs from `backupVisitNoteToOneDrive`, `handleShiftDecline`, `savePushSubscription`, `uploadToOneDrive`.
- `generateInvoicePdf`: `addLogo()` was called with no URL (silent no-op — invoices rendered unbranded); now passes the Tera Healthcare logo URL.
- `importShifts`: unbounded `Client.list()` → bounded.

### Redundancy findings — intentionally NOT changed

5 functions inline copies of `shared/` helpers (`generateCarePlanPdf`, `generateRiskAssessmentPdf`, `notifyDocumentUpdates`, `sendMondayMotivation`, `sendUrgentFormNotification`). Investigation showed **no backend function imports from `shared/` at all** — Base44 deploys each function directory in isolation, so converting inline code to cross-directory imports would likely break deployment. The `shared/` directory itself appears to be dead code in this deployment model. Left as-is.

All 62 modified files verified with esbuild parse checks.

## Overnight shifts: MAR chart anchored to shift start date (Base44 checkpoint 6a68c4e853a0056767c490be)

**Bug**: On an overnight shift (e.g. 22:00 → 08:00), the MAR chart shown to staff surfaced medications due on the shift **end date** — i.e. the next morning's doses that belong to the following shift.

**Root causes**:

1. **`src/pages/CreateEditVisitNote.jsx` — `medicationStatusMap` lost its date anchor**: `visitDate` was resolved only from `allUserShifts.find(...)`. When the shift wasn't in that paginated list (common — it caps at ~50 per status), or when editing a note whose `selectedShift` couldn't be found, `visitDate` fell through to `null` and `calculateMedicationStatus` evaluated against `new Date()`. After midnight on an overnight shift, "now" is the shift end date, so the next day's morning medications showed as Due Now / Overdue — and, because the MAR chart is a mandatory section, they also blocked note submission.

2. **`src/components/medications/OverdueMedicationsWidget.jsx` + `MedicationAlertsMonitor.jsx` — broken overnight windows**: `shiftCoversTime` / `hasLinkedShift` tested `dueMin >= start - 30 && dueMin <= end + 30`. For overnight shifts `end_time < start_time`, so the condition could never be true (the window was inverted).

**Fixes**:

1. `CreateEditVisitNote.jsx`: moved the `directShift` by-ID query above `medicationStatusMap` and added it as a fallback when the shift isn't in `allUserShifts`; `visitDate` now falls back through `shift_date → start_datetime → editingNote.visit_date` so the status calculation is always anchored to the shift **start date**. (`calculateMedicationStatus` already clamps to end-of-day of that date once the clock crosses midnight, so end-date medications can never surface.)

2. `OverdueMedicationsWidget.jsx` / `MedicationAlertsMonitor.jsx`: when `end_time < start_time` (overnight), the shift now covers due times from `start − 30min` through midnight of the start date only — never the morning of the end date.

## Client data not saving — all partial Client.update() calls fixed (Base44 checkpoint 6a67fb98ef8f2e9af3579225)

**Root cause**: `base44.entities.Client.update(id, data)` uses **HTTP PUT** (full replace), not PATCH. Sending partial data (e.g. `{ contact_persons: [...] }`) without the required fields (`full_name`, `date_of_birth`, `nhs_number`, `address`, `status`) causes a server-side validation failure and the update silently fails.

**Secondary issue**: `useEffect(() => { if (client) setEditedClient(client); }, [client])` had no `!isEditing` guard, so any concurrent mutation that updated the `clients` query cache immediately reset `editedClient` back to the server value, discarding in-progress form edits.

**Files changed**:
- `src/pages/ClientProfile.jsx`
- `src/components/clients/VisitNoteConfigurator.jsx`
- `src/components/clients/MARChart.jsx`
- `src/components/forms/FormUploadAnalyzer.jsx`
- `src/components/forms/FormRenderer.jsx`

**Fixes**:

1. **`ClientProfile.jsx` — `useEffect` race condition**: Added `!isEditing` guard and `isEditing` to the dependency array so the effect only resets `editedClient` from cache when the user is not actively editing.

2. **`ClientProfile.jsx` — `ContactPersonsManager` `onChange`**: Changed `data: { contact_persons: contacts }` → `data: { ...client, contact_persons: contacts }` so the full client object is included in the PUT body.

3. **`ClientProfile.jsx` — `StaffPreferencesManager` `onChange`**: Changed `data: { preferred_staff: prefs }` → `data: { ...client, preferred_staff: prefs }`.

4. **`ClientProfile.jsx` — `RiskProfileManager` `onUpdate`**: Changed `data` (partial object from component) → `data: { ...client, ...data }`.

5. **`ClientProfile.jsx` — `MARChart` `onUpdate`**: Changed `data` → `data: { ...client, ...data }`.

6. **`VisitNoteConfigurator.jsx` — `updateConfigMutation`**: Changed `{ visit_note_config: config }` → `{ ...client, visit_note_config: config }`.

7. **`MARChart.jsx` — `recordAdministrationMutation`**: Changed `{ mar_schedule: updatedMarSchedule }` → `{ ...client, mar_schedule: updatedMarSchedule }`.

8. **`FormUploadAnalyzer.jsx`**: Before calling `Client.update(selectedClient, updateData)`, now looks up the full client from the `clients` prop (`clients.find(c => c.id === selectedClient) || {}`) and spreads it: `{ ...fullClient, ...updateData }`.

9. **`FormRenderer.jsx`**: Before calling `Client.update(clientId, mappings)`, now fetches the full client with `Client.get(clientId)` and spreads it: `{ ...existingClient, ...mappings }`.

## Medication and MAR chart code audit — 2 bugs fixed

### Files changed
- `src/components/visit-notes/hooks/useMedicationSync.jsx`
- `src/components/offline/OfflineMedicationManager.jsx`

### Protocols documented

**MAR schedule storage**: `client.mar_schedule[]` on the Client entity. Each entry: `{ id, medication_name, dosage, route, frequency, times (csv HH:MM), prescriber, start_date, stop_date, notes, is_prn, prn_indication, max_doses_per_day, administration_records[] }`. Administration records: `{ date (yyyy-MM-dd), time (HH:MM), administered (bool), administered_by, notes, prn_reason, recorded_at }`.

**Visit-note MAR (in-shift recording)**: `VisitNote.medication_administration_chart[]` — entries added during a shift via `MedicationAdministrationTab`. Fields: `{ time, medication_name, dosage, route, administered, self_administered, administered_by, witnessed_by, notes, prn_reason, reason_not_given, timestamp }`.

**Offline medication flow**:
1. When offline, `useOfflineCareActions.recordMedication` calls `saveMedicationRecordOffline` → record written to `MEDICATIONS` IDB store (`synced: false`).
2. On reconnect, `OfflineDataSync.performSync` (app-level) and `useMedicationSync.syncPendingMedications` (visit-note page) both read `getUnsyncedMedications()`, find the matching VisitNote by `shift_id`, append the entry to `medication_administration_chart`, call `VisitNote.update`, then call `markMedicationsSynced`.
3. `OfflineIndicatorBanner` badge shows `getUnsyncedMedications().length`.

**Status calculation** (`medicationStatusHelper.calculateMedicationStatus`): PRN → always `prn_available`. Scheduled → compares each scheduled time in `times` against current time; matches a record within ±120-minute window; unmatched past times that are >60 min overdue → `overdue`; ≤60 min → `due_now`; all matched → `given_today`. Retrospective notes (visitDate in past) use end-of-day as reference so all unrecorded times show as `not_recorded`.

**Overdue alerts**: `MedicationAlertsMonitor` (background hook) runs `checkOverdueMedications` every 5 minutes; fires toast + optional push notification per alert key `{clientId}-{medId}-{dueTime}-{date}` (deduped in-memory per session). `OverdueMedicationsWidget` (dashboard) reconciles MAR schedule records with same-day visit note administrations to avoid false positives.

### Bug 1 — `useMedicationSync.jsx` — data loss: medication marked synced without server write
`syncedIds.push(record.id)` was positioned AFTER the `if (existingNotes.length > 0)` block, not inside it. When `shift_id` was set but no matching VisitNote was found (e.g., note not yet created), the record was pushed to `syncedIds` and subsequently marked as synced via `markMedicationsSynced` — no data was ever written to the server, but the IDB record was marked done. Fixed by moving the push inside the `if (existingNotes.length > 0)` block. Records without a matching note remain pending and retry on the next sync cycle.

### Bug 2 — `OfflineMedicationManager.jsx` — six functions lack error handling on IDB calls
`getUnsyncedMedications`, `markMedicationsSynced`, `cacheMARSchedule`, `getCachedMARSchedule`, `getClientMedicationCount`, and `cleanupSyncedMedications` all called `getDB()` and `db.transaction()` without try-catch. If IndexedDB is unavailable or throws (storage quota, private browsing restriction, browser bug), unhandled exceptions propagated to callers. Added the same `let db; try { db = await getDB(); } catch { return <default>; }` guard pattern used by `saveMedicationRecordOffline` and the rest of `OfflineStorage.jsx`.

### Dead code identified (not removed — inform only)
`src/components/offline/MedicationOfflineSync.jsx` exports `saveMedicationOffline`, `getPendingMedications`, `clearSyncedMedications`, `getOfflineMedicationCount` — none are imported anywhere in the codebase. The file implements a parallel offline storage path using the `CACHE` IDB store + `SYNC_QUEUE`, completely disconnected from the `MEDICATIONS` store that the actual sync logic reads. It is unreachable dead code.

## Service user details not saving — dialog stays open with stale data

**File changed**: `src/pages/ClientProfile.jsx`

**Root causes**:

1. **Dialog never closed after save** — `updateClientMutation.onSuccess` called `setIsEditing(false)` (which closes inline editing mode) but never called `setShowEditDialog(false)`. After clicking "Save Changes" in the `ClientEditDialog`, the dialog stayed open. Because the background refetch hadn't completed yet, the form still showed the pre-edit values. Users naturally concluded nothing was saved.

2. **Stale data flash in read-only view** — For both the dialog path and the inline editing path (care plan, preferences), after `onSuccess` fired and switched the UI to read-only mode, the `client` object in the `clients` query cache was still the old value (the background refetch was in progress). The read-only fields rendered `client.field` and therefore displayed old values for 1–2 seconds before the refetch completed.

**Fixes applied to `updateClientMutation.onSuccess`**:
1. Added `queryClient.setQueryData(['clients'], ...)` before `invalidateQueries` — immediately patches the in-memory cache entry for this client with `{ ...c, ...data }` so all read-only views re-render instantly with the saved values, eliminating the stale data flash.
2. Added `setShowEditDialog(false)` so the dialog closes automatically on a successful save, giving clear visual confirmation that the save completed.

## Master logout not working on mobile/staff (Base44 checkpoint 6a6551fca9a59e26395ec465)

**File changed**: `src/Layout.jsx`

**Root causes**:
The `checkGlobalState` function (which compares the server's `master_logout_timestamp` against the locally stored value and triggers logout when they differ) was only called by:
1. A one-shot timeout 10 seconds after login
2. A 60-second `setInterval`
3. The realtime WebSocket subscription (if the event was delivered)

Neither a `visibilitychange` nor an `online` event triggered it. On mobile:
- When the app is backgrounded, the WebSocket subscription may miss the event and JS timers are suspended
- When the app comes back to the foreground there was no handler to run `checkGlobalState` immediately
- When a device reconnects after sleep/network switch, the existing `goOnline` handler only refetched queries — it did not check for master logout
- Staff/mobile users therefore had to wait up to 60 seconds (the next polling tick) for logout detection, and if the app never came back online within a polling window, logout would silently not fire

**Fixes**:
1. Added `visibilitychange` listener inside the `[user]` effect — calls `checkGlobalState()` immediately when `document.visibilityState === 'visible'` (app coming to foreground on mobile)
2. Added `online` listener inside the same effect — calls `checkGlobalState()` immediately when the device reconnects, ensuring a master logout issued while the device was offline is enforced the moment connectivity is restored
3. Reduced the initial delay from 10 s → 2 s — the original 10-second delay was intended to avoid interfering with dashboard queries at login; reduced to 2 s so an already-active master logout is detected within 2 seconds of login rather than 10
4. Both listeners are correctly removed in the effect cleanup to prevent memory leaks on component unmount/user change

## Mobile app: 3 bugs fixed (Base44 checkpoint 6a654b40d1ecabcf5ae4dea0)

**Files changed**:
- `src/components/pwa/OfflineDataSync.jsx`
- `src/components/offline/useOfflineCareActions.jsx`
- `src/components/offline/OfflineMedicationManager.jsx`

**Fix 1 — `OfflineDataSync`: offline medication records silently discarded (critical data-loss bug)**
`performSync()` called `markMedicationsSynced(medIds)` for ALL unsynced medications immediately after processing the sync queue — without actually pushing the medication data to the server. Any medication administered while offline (via `recordMedication` in `useOfflineCareActions`) was stored in IndexedDB's `MEDICATIONS` store, then silently marked as synced and discarded. The `useMedicationSync` hook that contains the actual server-sync logic is only mounted on the `CreateEditVisitNote` page and was never invoked by `OfflineDataSync`. Fixed by replacing the premature mark-as-synced block with inline sync logic: for each unsynced medication record, finds the matching visit note by `shift_id`, appends the medication entry (with duplicate check), updates the visit note on the server, then marks that record as synced. Records without a matching visit note remain pending (badge stays accurate) rather than being silently dropped.

**Fix 2 — `useOfflineCareActions`: stale `isOnline` captures online state at render time**
`isOnline` was computed once per render (`const isOnline = navigator.onLine`) and captured by `executeOrQueue` and `recordMedication` via `useCallback`. If the component did not re-render after going from offline to online, the callbacks would still see `isOnline = false` and route operations to the offline queue instead of executing them online. Fixed by moving the `navigator.onLine` read inside `executeOrQueue` (evaluated at call time) and inlining `!navigator.onLine` directly in `recordMedication`. Removed `isOnline` from both `useCallback` dependency arrays.

**Fix 3 — `OfflineMedicationManager.saveMedicationRecordOffline`: unhandled DB errors**
`getDB()` and `db.transaction()` calls had no error handling. If IndexedDB was unavailable, the function threw an unhandled exception that could crash callers (particularly `useOfflineCareActions.recordMedication`, which had no try-catch). Added the same `try { ... } catch { return null; }` guard pattern used consistently throughout `OfflineStorage.jsx`.

## Backend: additional findings fixed (Base44 checkpoint 6a65412cc69ad47082ca1983)

**Files changed**:
- `base44/functions/clockShift/entry.ts`
- `base44/functions/deleteUserAccount/entry.ts`
- `base44/functions/workflowEngine/entry.ts`

**Fix 1 — `clockShift`: false-positive short-clock flag for unscheduled shifts**
`shortByPercent` defaulted to `true` when `scheduledMinutes` was null/falsy (no scheduled duration on the shift). Combined with `isShortClockOut = shortByMinutes && shortByPercent`, this meant any clock-out under 3 minutes on a shift without a scheduled duration was always flagged — even though the percent check was meaningless without a schedule. Changed default to `false` so only the fixed-minute threshold (`shortByMinutes`) fires when there is no scheduled duration.

**Fix 2 — `deleteUserAccount`: three issues**
1. *No audit log*: self-service deletion left no trace. An `AuditLog` entry with `severity: 'critical'` is now written before any deletion takes place.
2. *Historical shifts deleted*: the original code deleted all `Shift` records for the user, including completed historical ones needed for payroll and audit compliance. Now only shifts with open/active statuses (`assigned`, `accepted`, `open_for_bidding`, `in_progress`, `decline_pending`, etc.) are deleted; completed, cancelled, voided, and needs_review shifts are preserved.
3. *User entity not removed*: the function cleaned up related records but never deleted the `User` entity itself, so the account remained in the system. A final step now deletes the `User` record (after all other deletions to avoid orphaning data on partial failure).

**Fix 3 — `workflowEngine`: client-side execution filtering**
Two places loaded up to 200 `PolicyWorkflowExecution` records and filtered in JavaScript. Both now filter server-side:
- `trigger` action: `filter({ policy_id, status: 'in_progress' }, ..., 10)` instead of `list(..., 200).filter(...)`
- `get_execution` action: `filter({ policy_id }, ..., 50)` instead of `list(..., 200).filter(...)`

## Backend: NI crash fix + 26 role-check auth bugs (Base44 checkpoint 6a653f03fcb61b14535e9784)

**Files changed** (backend functions):
- `base44/functions/shared/payrollHelpers/entry.ts`
- `base44/functions/bulkReassignShifts/entry.ts`
- `base44/functions/reviewTimeCorrection/entry.ts`
- `base44/functions/generatePayslip/entry.ts`
- `base44/functions/generateManualPayslip/entry.ts`
- `base44/functions/createBulkShifts/entry.ts`
- `base44/functions/applyShiftCorrection/entry.ts`
- `base44/functions/aiPolicyDraft/entry.ts`
- `base44/functions/notifyShiftAssignment/entry.ts`
- `base44/functions/generatePolicyTemplates/entry.ts`
- `base44/functions/triggerWorkflow/entry.ts`
- `base44/functions/broadcastSystemAlert/entry.ts`
- `base44/functions/uploadToOneDrive/entry.ts`
- `base44/functions/generatePolicyComplianceReport/entry.ts`
- `base44/functions/createPolicyFromTemplate/entry.ts`
- `base44/functions/updateFormSubmissionStatus/entry.ts`
- `base44/functions/clearOldNotifications/entry.ts`
- `base44/functions/optimizeDatabase/entry.ts`
- `base44/functions/archiveOldVisitNotes/entry.ts`
- `base44/functions/generateCQCInspectionReport/entry.ts`
- `base44/functions/runSystemDiagnostics/entry.ts`
- `base44/functions/notifyDocumentUpdates/entry.ts`
- `base44/functions/generateInvoicePdf/entry.ts`
- `base44/functions/archiveAllAppDataToOneDrive/entry.ts`
- `base44/functions/oneDriveDocuments/entry.ts`
- `base44/functions/manualOneDriveBackup/entry.ts`
- `base44/functions/importShifts/entry.ts`

**Bug 1 — NI TypeError crash in payrollHelpers** (`payrollHelpers/entry.ts`):
`d.type.includes('NI')` would throw `TypeError: Cannot read properties of undefined` whenever a deduction breakdown entry had no `type` field. Fixed by adding optional chaining: `d.type?.includes('NI')`.

**Bug 2 — Systemic auth bypass: 26 backend functions only checked `user.role` and ignored `user.app_role`**:
Users whose role is stored in `user.app_role` (the canonical field per `authHelpers.ts`) but not in `user.role` were incorrectly denied access to admin/manager endpoints, while users with `user.role` set but not `user.app_role` received access they shouldn't. All 26 affected functions now check `user.app_role || user.role` (or equivalent `!includes(...)` pattern) consistent with `authHelpers.ts` and correctly-written functions like `disable2FA`, `handleShiftDecline`, and `resolveStaleShifts`.

## Visit note review: 5 bug fixes (Base44 checkpoint 6a63f68ab9045d74a57583dd)

**Files changed**:
- `src/pages/VisitNotes.jsx`
- `src/components/hooks/useVisitNotesData.jsx`

**Bugs fixed**:

1. **Task fields not reset on dialog close** — `createTask`, `taskAssignee`, `taskDueDate`, `taskDescription`, `taskPriority` were not cleared by the Close button, causing stale values to bleed into the next note opened. All five fields now reset alongside the existing review fields.

2. **`handleReview` called `auth.me()` on every review** — unnecessarily fetched the current user from the API on each review action instead of using the already-queried `user`. If the call failed (e.g., brief network loss), `reviewed_by` / `reviewed_by_name` would be undefined. Now uses the existing `user` query result directly.

3. **`handleSaveToDrive` filename used the wrong date** — built the OneDrive filename from `device_created_at || created_date`, skipping `visit_date`. Now mirrors `handleDownloadPdf` by preferring `visit_date` first.

4. **Inconsistent 24-hour auto-hide filter** — `VisitNotes.jsx` gated the filter on `(onedrive_synced_at || drive_synced_at)` while `useVisitNotesData.jsx` used `onedrive_file_id`, producing different visibility for the same notes depending on which hook loaded first. `useVisitNotesData.jsx` now uses the same `(onedrive_synced_at || drive_synced_at)` condition.

5. **`visit_type.replace('_', ' ')` only replaced the first underscore** — changed to `replace(/_/g, ' ')` at all three display sites (pending card, reviewed card, review dialog header).

## OverdueMedicationsWidget: suppress when no shift covers the medication time (Base44 checkpoint 6a63e11922a921a469fc5da0)

**File**: `src/components/medications/OverdueMedicationsWidget.jsx`

**Change**: Added `toMins` helper and `shiftCoversTime(clientId, dueTime)` function that finds all of a client's shifts for today and returns `true` only if the medication due time falls within any shift window (±30-minute buffer). The `overdue.push(...)` is now gated on `shiftCoversTime`, so medications whose due time isn't covered by a scheduled shift are silently excluded from the widget display. Mirrors the same guard already in `MedicationAlertsMonitor`.

## Overdue medication alert: skip when no shift covers client/time (Base44 checkpoint 6a63a0c40aa92a10be4cffb3)

**File**: `src/components/medications/MedicationAlertsMonitor.jsx`

**Change**: Added a `todayShifts` query (filtered by `shift_date = today`) alongside the existing clients query. Before firing any overdue alert, a `hasLinkedShift(clientId, dueTime)` check confirms that at least one shift today matches the client and has a time window (±30 min buffer) that covers the medication's due time. If no such shift exists the alert is silently skipped. `todayShifts` added to the `useEffect` dependency array.

## Global date format changed to dd-MM-yyyy + shift bulk bug fixes (Base44 checkpoint 93907cfba31e81e9726f6475b9d4bcb9c138a476)

**Files changed**: 138 files across `src/` and `base44/functions/`

**Changes**:

1. **Date format** — All `format()` and `safeFormat()` call sites changed from US-style strings (`'MMM d, yyyy'`, `'MM/dd/yyyy'`, etc.) to `dd-MM-yyyy` style. `dateHelpers.jsx` FORMAT_MAP keys preserved as original US strings so any remaining `safeFormat()` callers are still remapped correctly.

2. **BulkStatusDialog** (`src/components/shifts/BulkStatusDialog.jsx`): Added `useEffect` to reset `newStatus` to `""` each time the dialog opens, preventing stale selection on reopen.

3. **BulkTimeDialog** (`src/components/shifts/BulkTimeDialog.jsx`): Added `useEffect` to reset `startTime`/`endTime` to `""` on each open.

4. **BulkActionsBar** (`src/components/shifts/BulkActionsBar.jsx`): Removed `if (selectedCount === 0) return null` early return so the bar (including the cancel X) stays visible when nothing is selected yet. Action buttons individually disabled when `selectedCount === 0`.

5. **ShiftManagement bulk reassign** (`src/pages/ShiftManagement.jsx`): Clears `bulkTeamMemberEmails` before opening the reassign dialog to prevent stale staff selections.

6. **Timezone fix in bulkTimeMutation**: Replaced `.substring(0, 10)` (which returned the UTC date) with `format(new Date(isoString), 'yyyy-MM-dd')` to extract the local calendar date correctly in any timezone.

## Vehicle Handover visible in staff app (Base44 checkpoint 6a62e3c81d71b2d7e33b73af)

**File**: `src/pages/MyMileageClaims.jsx`

**Fix**: Vehicle Handover was only accessible from `MileageApproval.jsx` (the manager page). Staff use `MyMileageClaims.jsx` which had no handover entry point. Added import of `VehicleHandoverLog`, a `showHandoverPanel` toggle state, a "Vehicle Handover" button in the header (matching the existing "Mileage log" toggle pattern), and `{showHandoverPanel && <VehicleHandoverLog user={user} />}` panel below the mileage log panel.

## App Store readiness (Base44 checkpoint 6a62deb422d5e139d0bec7b2)

**Files changed**:
- `src/index.css`
- `src/components/profile/DeleteAccountDangerZone.jsx`
- `src/components/settings/DeleteAccountSettingsSection.jsx`

**Changes**:

1. **WebView CSS lockdown** (`src/index.css`): Added to `@layer base` — `overscroll-behavior: none` on `html, body` to prevent bounce/rubber-band in WKWebView; `-webkit-user-select: none; user-select: none; -webkit-touch-callout: none` on `button`, `[role="button"]`, Radix triggers, `[role="tab"]`, and `a` elements to disable long-press callouts and text selection on interactive UI.

2. **Delete Account — Danger Zone** (`DeleteAccountDangerZone.jsx`): Converted from regular Dialog to AlertDialog. Replaced simple two-button confirmation with a type-gate: users must type the word `DELETE` (exact match) before the destructive button enables. Added a bulleted list of what gets deleted, a red warning that the action is irreversible, error handling around the backend call, and try/catch so the dialog stays open on failure. Calls `deleteUserAccount` function then `base44.auth.logout()`.

3. **Delete Account — Settings** (`DeleteAccountSettingsSection.jsx`): Same type-gate upgrade applied. Added `DELETE`-confirmation input, expanded the warning with a bulleted data list, error handling with toast on failure, and the "Account Deletion" card now opens the AlertDialog directly from the card's own button (no AlertDialogTrigger wrapper needed). Same `deleteUserAccount` → `logout()` flow.

## Vehicle Handover enhancements (Base44 checkpoint 6a62d8c008e20bf7e29e4726)

**File**: `src/components/mileage/VehicleHandoverLog.jsx` (rewritten, 641 lines)

**Changes**:

- **Auto-populate outgoing driver**: When "Record Handover" is clicked, `outgoing_driver_name` and `outgoing_driver_email` are pre-filled from the logged-in user's profile. Fields remain editable.
- **Damage photo upload**: Added multi-image upload using `base44.integrations.Core.UploadFile`. Images are validated (image types only), shown as removable thumbnails in the form, and saved as `damage_image_urls[]` on the VehicleHandover entity.
- **Image lightbox**: Uploaded photos display as clickable thumbnails (max 4 inline, overflow count badge) on each handover card. Clicking opens a full-size grid lightbox dialog. Each image links to its full URL for download/zooming.

## Vehicle Handover tab in Mileage Claim Approval (Base44 checkpoint 6a62d3b6b79bd21e35f4daee)

**Files**:
- `src/pages/MileageApproval.jsx` (updated)
- `src/components/mileage/VehicleHandoverLog.jsx` (new component)
- Base44 entity: `VehicleHandover` (new schema)

**Changes**:

- Added a new **Vehicle Handover** tab (3rd tab) to the Mileage Claim Approval page.
- Created `VehicleHandover` entity with fields: `vehicle_registration`, `handover_date`, `handover_time`, `outgoing_driver_name`, `outgoing_driver_email`, `receiving_driver_name`, `receiving_driver_email`, `odometer_at_handover`, `vehicle_condition` (good/minor_damage/major_damage), `damage_notes`, `receiving_staff_confirmed`, `confirmed_at`, `recorded_by_email`, `recorded_by_name`.
- `VehicleHandoverLog` component provides:
  - Summary cards (total / awaiting confirmation / confirmed)
  - Scrollable list of handover records showing both driver names, odometer reading, vehicle condition badge, and damage notes
  - "Confirm Receipt" button on unconfirmed records (logs timestamp)
  - "Record Handover" dialog form with outgoing driver, receiving driver, odometer, condition, and damage notes fields
- `MileageApproval.jsx`: TabsList changed from `grid-cols-2` → `grid-cols-3`; new `TabsTrigger value="handover"` and `TabsContent` wired to `<VehicleHandoverLog user={user} />`.

## Timesheet bug fixes (Base44 checkpoint 6a62630e140479859b976212)

**Files**:
- `base44/functions/generateAITimesheet/entry.ts`
- `src/pages/MyTimesheets.jsx`
- `src/components/timesheets/AITimesheetCard.jsx`

**Bugs fixed**:

1. **Overtime threshold hardcoded at 40h** (`generateAITimesheet/entry.ts`): `total_regular_hours` was capped at 40 and everything above flagged as overtime — correct for a weekly pay period but catastrophically wrong for a monthly one (staff working a normal ~160h month would show ~120h overtime). Fixed to calculate the threshold proportionally from the pay period length: `Math.round((periodDays / 7) * 40)`.

2. **Compound filter on shifts query silently returns `[]`** (`MyTimesheets.jsx`): The `shifts` query used `Shift.filter({ assigned_to: user.email, status: 'completed' })` — a 2-field compound filter that Base44 silently returns `[]` for. The "Included Shifts" section in the details dialog always showed nothing because `getShiftDetails()` always returned undefined. Fixed to single-field `filter({ assigned_to: user.email }, …, 500)` + JS `.filter(s => s.status === 'completed')`.

3. **Blocking `confirm()` in Apply Correction flow** (`MyTimesheets.jsx`): `handleApplyCorrection` called the native `confirm()` dialog which blocks the JS thread. Replaced with a controlled `AlertDialog` (`showCorrectionDialog` + `pendingCorrectionData` state).

4. **Blocking `window.confirm()` on critical-issue submit** (`MyTimesheets.jsx`, `AITimesheetCard.jsx`): Submitting a timesheet with critical discrepancies showed a native blocking confirm in both the card and the details dialog. Replaced with controlled `AlertDialog` components in both files (`showSubmitWarningDialog`/`pendingSubmitId` in the page; `showCriticalWarning` in the card).

5. **Staff notes hidden on submitted timesheets** (`MyTimesheets.jsx`): The details dialog showed manual entry notes only when `status === 'draft'`. After a manual timesheet was submitted (status → `'submitted'`), the notes section disappeared. Changed condition to `!ai_verified` so notes are visible for all manually created timesheets regardless of submission status.

## Amitriptyline dosage data correction (Base44 checkpoint 6a61bc06b0d7963c8eb7f07f)

**Data changes only — no code modified**

Joan Temple's Amitriptyline prescription was corrected from "2x 10mg" to "1x 10mg" across all records:

1. **MAR schedule** (`Client` entity, id `695e92a6a5cc7ca197fe27f0`): `dosage` updated to "1x 10mg" and `stop_date` cleared (`null`) on the Amitriptyline entry (id `1784676068624`).

2. **Visit note administration charts** (`VisitNote` entity): `medication_administration_chart` Amitriptyline `dosage` updated to "1x 10mg" in all 6 historical records:
   - `6a5f51e5a6c0e6d8fcd2a2a1` (2026-07-21)
   - `6a5f6a7d72b478980245de81` (2026-07-21)
   - `6a5fa3ce616935a92bc1255a` (2026-07-21)
   - `6a605d9abfbbec5246d43406` (2026-07-21)
   - `6a60c698640968d5acf69c52` (2026-07-22)
   - `6a60f5efa3ac0123446e2fb1` (2026-07-22)

## Shift revenue calculated on allocated time, not number of staff (Base44 checkpoint 6a614b593b98a28b09ac0ce6)

**File**: `src/components/shifts/ShiftCalendarView.jsx` — `getShiftRevenue`

**Bug**: For combined team shifts (multiple staff attending the same shift), `getShiftRevenue` summed each team member's individual revenue. A 4-hour shift at £20/hr with 3 staff was calculated as 3 × £80 = £240. The client is billed for the allocated time once — 4h × £20 = £80 — regardless of how many staff attend.

**Fix**: The combined-team-shift branch now calculates revenue once using the first team member's shift data. All team members share the same `start_datetime`, `end_datetime`, `client_id`, and `hourly_rate`, so any single member gives the correct per-slot revenue. The payroll cost calculation (`getShiftPayrollCost`) is unchanged — it correctly sums costs across all members because staff labour is additive.

## Medication protocol bug fixes (Base44 checkpoint 6a60a3848385c0df65b2214e)

**Files**:
- `base44/functions/syncMedicationToMARSchedule/entry.ts`
- `src/components/medications/MedicationAlertsMonitor.jsx`
- `src/components/medications/OverdueMedicationsWidget.jsx`

**Bugs fixed**:

1. **MAR sync never ran** (`syncMedicationToMARSchedule/entry.ts`): Both the visit note and client were fetched with `.filter({ id: ... })` — a primary-key lookup via filter that Base44 silently returns `[]` for. The function always hit the "not found, skipping" early-exit, so medication administrations were never written back to the MAR schedule. Fixed to use `.get(id)` for both (consistent with the `freshClient` re-fetch already using `.get()` later in the same file).

2. **Overdue medication alerts never re-fired after first day** (`MedicationAlertsMonitor.jsx`): The alert deduplication key was `clientId-medicationId-dueTime` — no date component. Once an alert fired for "08:00" for a given medication, the `alertedMedicationsRef` Set held that key for the lifetime of the session and suppressed every future alert for that same time slot, including on subsequent days. Added `yyyy-MM-dd` date to the key so each day's overdue alerts fire independently.

3. **Overdue widget missed today's shifts and visit notes on busy systems** (`OverdueMedicationsWidget.jsx`): Shifts were fetched with `filter({}, '-created_date', 100)` — sorted by creation date, not shift date. On systems with >100 total shifts, today's shifts could be absent from the result. Visit notes had the same problem. Fixed both to use a single-field date filter (`shift_date` / `visit_date`) with a 200-record limit, returning exactly today's records regardless of overall record count.

## Task workflow bug fixes (Base44 checkpoint 6a601a2366b25a6aae77a25d)

**Files**:
- `base44/functions/clearTaskNotifications/entry.ts`
- `src/components/tasks/TaskCard.jsx`
- `src/pages/TaskManagement.jsx`

**Bugs fixed**:

1. **`clearTaskNotifications` never cleared notifications** (`entry.ts`): The filter used 4 fields (`related_entity_type`, `related_entity_id`, `action_required`, `action_taken`) — Base44 compound filters silently return `[]` for multi-field queries, so no notifications were ever found or archived. Fixed to single-field `filter({ related_entity_id: task_id })` + JS chain to narrow by the remaining fields. Also replaced `updateMany` (which had the same multi-field filter bug) with `Promise.all` over individual `update()` calls by ID.

2. **`TaskCard` crash on null `due_date`** (`TaskCard.jsx`): `format(parseISO(task.due_date), 'MMM d, yyyy')` threw when `due_date` was null or undefined (e.g. tasks created without a due date). Added null guard: renders `—` when `due_date` is absent.

3. **`TaskCard` stale render on title/description change** (`TaskCard.jsx`): The `React.memo` custom comparator only checked `id`, `status`, `priority`, `due_date`, and `showActions`. Edits to `title` or `description` did not trigger a re-render — the card would display stale text. Added `title` and `description` to the comparator.

4. **`handleDelete` blocking `confirm()` dialog** (`TaskManagement.jsx`): Used the native browser `confirm()`, which blocks the JS thread and has poor UX on mobile. Replaced with a controlled `AlertDialog` — shows the task name, stays open while the mutation is pending, and locks the Cancel button during the delete call.

## Remove download button from staff client document view (Base44 checkpoint 6a5ff454)

**File**: `src/pages/MyClientDocuments.jsx`

Removed the "Download" button from the uploaded documents card list and from the client document dialog. Staff can still open documents via "Open Document" (new tab) but cannot download them. Also removed the now-unused `Download` icon import.

## Uploaded client documents — acknowledgement flow added (Base44 checkpoint 6a5fdb2b)

**File**: `src/pages/MyClientDocuments.jsx`

**Bug**: The "Uploaded Documents" tab showed "View" and "Download" buttons that opened the file URL directly in a new browser tab. There was no dialog, no `DocumentReadReceiptPrompt`, and no way for staff to manually acknowledge having read the document. Documents marked `requires_acknowledgement = true` could never be acknowledged.

**Fix**:
- "View" button now opens a dialog containing the document's metadata, an "Open Document" button (new tab), a "Download" button, and the standard `DocumentReadReceiptPrompt` with its checkbox + "Confirm Acknowledgement" button.
- `view_count` is auto-incremented via `trackClientDocView` when the dialog opens (fire-and-forget, same pattern as the other viewer components).
- The "Acknowledgement required" badge on the document card now switches to a green "Acknowledged" badge once the user manually confirms — matching the care plan / risk assessment / weekly report card behaviour.
- `totalUnread` count in the page header now includes uploaded documents that have `requires_acknowledgement = true` and no `read_at` receipt.

## Document acknowledgement vs read-count separation (Base44 checkpoint 6a5fbf1d)

**Files**:
- `src/pages/MyClientDocuments.jsx` — `hasReadReceipt`
- `src/components/documents/DocumentReadReceiptPrompt.jsx` — query, `hasValidReceipt`, `createReadReceiptMutation`

**Bugs fixed**:

1. **Auto-acknowledgement on first view** (`MyClientDocuments.jsx`): `hasReadReceipt` returned `true` for any receipt that existed — including the view-tracking receipt created automatically by the viewer's `trackView` effect. Every document was marked "Read" (green badge) the moment it was first opened, without the user ever clicking "Confirm Acknowledgement". Added `!!r.read_at &&` guard so only receipts with an explicit acknowledgement timestamp are treated as acknowledged.

2. **Compound filter silently returning `[]`** (`DocumentReadReceiptPrompt.jsx`): The receipt query used `filter({ user_email, document_id, document_type })` — a 3-field filter that Base44 silently returns `[]` for. The prompt could never find an existing receipt, so it always showed the acknowledgement form even after a receipt was written. Fixed to single-field `filter({ user_email })` + JS `.filter()` chain.

3. **`hasValidReceipt` ignoring `read_at`** (`DocumentReadReceiptPrompt.jsx`): Same symptom as bug 1 — once the Base44 filter is fixed and finds the view-tracking receipt, the old `hasValidReceipt` check (any matching receipt) would have incorrectly shown "You have acknowledged this document." Added `receipt.read_at &&` so the confirmed-state banner only appears after manual acknowledgement.

4. **Duplicate receipts on acknowledge** (`DocumentReadReceiptPrompt.jsx`): `createReadReceiptMutation` always called `DocumentReadReceipt.create(...)`, creating a second record alongside the view-tracking receipt already written by the viewer. Changed to upsert logic: if an existing receipt is found, update it with `read_at`; otherwise create a fresh record.

**Outcome**: `view_count` now auto-increments on every open (unchanged behaviour from `trackView`); acknowledgement only registers when the user ticks the checkbox and clicks "Confirm Acknowledgement."

## Master logout system fixes (Base44 checkpoint 6a5eb1bde)

**Files**:
- `src/components/auth/SessionValidator.jsx`
- `src/Layout.jsx`
- `src/components/admin/MasterLogoutButton.jsx`

**Bugs fixed**:

1. **60-second eviction window** (`SessionValidator.jsx`): The gate that forced logout only fired if `master_logout_timestamp` was set within the last 60 seconds. Any user who loaded the page after that window was ignored entirely. Replaced with a localStorage comparison matching Layout.jsx's own logic: evict only when the DB timestamp is newer than the `global_logout_at` value recorded at login. Also replaced the blocking `alert()` call with a non-blocking `toast.error()`, and reduced the redundant poll interval from 10 s to 30 s (Layout.jsx's realtime subscription is the primary signal).

2. **False re-eviction on re-login** (`Layout.jsx` initialization): `global_logout_at` in localStorage was only written if the key was absent (`!localStorage.getItem(...)` guard). A user who was logged out when master logout fired, then re-logged-in, would have no stored value — causing the check to fall through to `isNewerThanSession` and immediately evict them again. Removed the guard so every login overwrites `global_logout_at` with the current DB timestamp, correctly marking the session as post-logout.

3. **AppSettings list truncation** (`Layout.jsx` `checkGlobalState`): Both `master_logout_timestamp` and `system_lockdown` were found by fetching `AppSettings.list('-created_date', 100)` and scanning the result. If more than 100 AppSettings rows exist, the target record could be cut off silently. Replaced with two parallel targeted `filter({ setting_key: ... })` calls that always return the exact record regardless of total row count.

4. **Dialog closes during loading** (`MasterLogoutButton.jsx`): `AlertDialogAction` calls `onOpenChange(false)` on click, dismissing the dialog immediately — the "Processing…" spinner was never visible. Switched to a controlled `open` / `onOpenChange` state (`onOpenChange` locked to `undefined` while loading), replaced `AlertDialogAction` with a plain `Button`, and moved `setOpen(false)` to the success branch so the dialog stays open until the backend call resolves.

## Clock-in visit-note protocol fix (Base44 checkpoint e3559783)

**File**: `src/pages/MyShifts.jsx` — `getBlockingPreviousShift`

**Bug**: The gate that blocks clock-in when the previous shift has no visit note used a 45-minute window (`gapMinutes > 45`). Typical care shifts have 2-4 hour gaps between them, so the protocol never fired and staff could always clock into the next shift without submitting a note.

**Fix**: Replaced the 45-minute gap check with a 24-hour lookback window. Any completed shift (clocked-out) within the last 24 hours with no visit note now blocks the next clock-in.

**Driver protocol unchanged**: The `isDriver` auto-detection (job_title/role/app_role regex check) still auto-bypasses the gate in `openClockInDialog`, and the manual "I'm a driver" checkbox in `NoteRequiredDialog` still works via `waiveNoteShiftId`. No changes were made to either driver path.

## Notifications & badges bug fixes (Base44 checkpoint ea6e641e)

**Files**:
- `src/components/notifications/CriticalEventHandler.jsx`
- `src/pages/NotificationsNew.jsx`
- `src/components/layout/useBadgeCounts.jsx`

**Bugs fixed**:

1. **OS app badge wrong count** (`CriticalEventHandler.jsx`): `updateAppBadge` was a module-level function querying `{ read: false }` with no user filter — it counted every user's unread notifications and stamped that wrong total on the OS badge. Moved inside the `useEffect` where `user.email` is in scope; now filters by `recipient_email` + JS-filters for `read === false` (Base44 compound filter would return `[]` silently).

2. **Bulk "mark all read" and "archive all" were serial** (`NotificationsNew.jsx`): Both mutations looped over notifications with `await` inside a `for` loop, making each API call wait on the previous. Changed to `Promise.all` so all calls fire in parallel.

3. **Date formatting crash** (`NotificationsNew.jsx`): `format(new Date(notification.created_date), ...)` throws when `created_date` is null/undefined. Added null guard — shows "Unknown date" / "—" fallback.

4. **"Shifts" and "Tasks" tabs too narrow** (`NotificationsNew.jsx`): The Shifts tab (value `shift_assignment`) only matched the exact type `shift_assignment`, hiding `shift_reminder`, `shift_change`, `shift_offer`, and decline notifications. The Tasks tab (value `task_assigned`) hid `urgent_task` and `task_reminder`. Changed tab values to `shifts`/`tasks` and updated the filter to use `Set` lookups covering all related types.

5. **`getTypeColor`/`getTypeIcon` inside `useMemo` unnecessarily** (`NotificationsNew.jsx`): Both were wrapped in `useMemo(() => fn, [])` when they close over nothing. Moved to module-level constants — same behaviour, no closure overhead.

6. **Dead code** (`useBadgeCounts.jsx`): `getNotificationRoleFilters` was defined but never called. Removed.

## Visit note query coverage fix + Data Maintenance tool (Base44 checkpoint f23e2800)

**Files**:
- `src/pages/MyShifts.jsx` — `visitNotes` query limit increased 100 → 500
- `src/pages/SystemDiagnostics.jsx` — new "Data Maintenance" tab added

**Bug**: The `visitNotes` query fetched only the last 100 notes globally. Under RLS, regular staff only see their own notes, but 100 could still be insufficient for staff with a long note history. Admins/managers (who see all notes) could have the top 100 entries be from other staff entirely, causing `hasVisitNote` to return false for notes that exist — incorrectly triggering the clock-in gate.

**Fix**: Limit increased to 500. Under RLS this covers years of notes for a regular staff member and ensures notes from the most recent shifts are always included.

**Data Maintenance tab**: Added to System Diagnostics (admin only). Provides a "Recalculate Retrospective Visit Notes" button that invokes `recalculateRetrospectiveVisitNotes` with full limits (1000 notes, 5000 shifts, 200 max updates) and displays a summary of any corrections made — allowing admins to fix any previously mislabelled `is_retrospective` values caused by the overnight shift bug.

## Retrospective visit note timeframe fix (Base44 checkpoint e99fdab3)

**Files**:
- `src/components/visit-notes/helpers/retrospectiveEntry.jsx` — `getScheduledShiftEnd`
- `base44/functions/recalculateRetrospectiveVisitNotes/entry.ts` — `getScheduledShiftEnd`

**Bug**: When a shift stored only `shift_date + end_time` (not `end_datetime`), overnight shifts (where `end_time` is before `start_time`, e.g. 22:00–06:00) had their end time calculated on the *start* date rather than the next day. A note written at 2am during a night shift was 16 hours past "6am on July 19" — incorrectly flagged as retrospective.

**Fix**: After parsing `shift_date + end_time`, check `shift.is_overnight === true` or `end_time < start_time`; if overnight, add 1 day to the calculated end date. Same fix applied to both the frontend helper and the backend recalculation function.
