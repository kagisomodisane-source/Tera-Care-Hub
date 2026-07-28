
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
