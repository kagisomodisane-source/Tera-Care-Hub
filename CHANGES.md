
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
