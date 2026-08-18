## Recurring and bulk shift bugs (Base44 checkpoint 6a83d2e795a2816dd604d3cb)

**New**: `src/components/shifts/recurrence.js`, `scripts/verify-recurrence.mjs`
**Changed**: `ShiftCreateDialog.jsx`, `RecurrenceSettings.jsx`, `BulkShiftCreatorDialog.jsx`, `ShiftManagement.jsx`, `base44/functions/createBulkShifts/entry.ts`, `base44/functions/bulkReassignShifts/entry.ts`

Every bug below was reproduced against the old code before it was changed, and each has a regression test that fails when the fix is reverted.

### Recurring shifts

There were two different implementations of the date maths — one in `ShiftCreateDialog` that created the shifts, one in `RecurrenceSettings` that drew the preview — so the preview did not show what you would get. Both now call one shared module.

Reproduced against the old code, starting from Wednesday 2 September 2026:

| Asked for | Got |
|---|---|
| Weekly, Mondays only, 4 shifts | **0 shifts** — "No valid dates generated" |
| Biweekly, Mon+Wed, 6 shifts | Wed 2, **Mon 7**, Wed 16, **Mon 21**… — dates from the skipped week |
| Monthly from the 31st, 5 shifts | 31 Jan, 28 Feb, **28 Mar, 28 Apr, 28 May** |
| Nightly 22:00–06:00 over the clock change | one night silently became **22:00–07:00** |

- **Weekly produced nothing at all** whenever the chosen day was not the start day. It stepped forward seven days at a time while only accepting dates whose weekday was in the selected set — and +7 lands on the same weekday forever, so a Monday-only pattern starting on a Wednesday never matched.
- **The preview had the same stepping and no exit** when nothing matched: `count` never incremented and no break condition could fire, so it span forever. Picking such a day froze the tab.
- **Biweekly** measured fortnights as 7-day blocks counted from the start timestamp rather than calendar weeks, so it emitted off-week dates.
- **Monthly** called `addMonths` on the previous occurrence, so February clamped the 31st to the 28th and every later month inherited it.
- **Overnight shifts across a clock change** set each end to start + elapsed milliseconds, so a 22:00–06:00 shift became 22:00–07:00 while `scheduled_duration_minutes` still said eight hours — the stored fields disagreed with each other.

Times are now treated as wall-clock, which is what a rota means: 22:00–06:00 stays 22:00–06:00 through a clock change and that night carries its own real duration (420 minutes, not 480). The preview renders the actual occurrences the dialog will create, so the two cannot drift apart again.

`ShiftCreateDialog` also stopped writing `duration_minutes` — that field is the time actually worked, written by `clockShift` on clock-out.

### Bulk shifts

**Bulk status change and bulk time change could never have worked.** `Shift.update()` is `axios.put`, a full replace, and both sent partial payloads:

```js
base44.entities.Shift.update(id, { status: newStatus })
```

`Shift` requires `client_id`, `start_datetime` and `end_datetime`, so a PUT carrying only `{status}` cannot validate — the update is rejected and nothing changes. `bulkReassignShifts` had the same defect in three places. All now merge onto the record they already fetched.

**Bulk-created shifts landed an hour out during BST.** `createBulkShifts` built `new Date(y, m, d, 9, 0)` on the server and stored `toISOString()`. The function runs in UTC, so a 09:00 shift was pinned to 09:00Z — 10:00 in London during summer — and disagreed with the same shift made in the normal dialog, which builds its dates in the browser. The dates are now resolved client-side, where the offset for that particular date is known, which also handles a week containing the clock change (verified: 23 March 09:00 → 09:00Z, 29 March 09:00 → 08:00Z, both still reading 09:00 on the rota). The old server-side path is kept for older callers.

It also wrote `duration_minutes` on drafts nobody had worked, which would make an untouched draft look like completed work to the timesheet and reporting screens. Removed; only `scheduled_duration_minutes` is set.

The dialog now rejects zero-length and duplicate time slots, states that a slot ending before it starts becomes an overnight shift, and counts the shifts it will actually create rather than assuming days × slots.

### Verification

`npm run verify:recurrence` — 53 checks covering all of the above plus end conditions, caps and malformed input. Mutation-tested: restoring the weekly +7 stepping, the monthly walk-from-previous, the biweekly parity drop, the server-side UTC construction, and the shared-duration bug each make the suite fail on the specific check that names the behaviour.

Verified: `vite build` clean; `verify:recurrence`, `verify:residency` and `audit:query-keys` all pass; eslint clean on the new files (the remaining errors on touched files are pre-existing unused imports, unchanged in count).

