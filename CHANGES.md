## Revenue and cost: one rule instead of two (Base44 checkpoint 6a918a2a428071419084b50b)

**New**: `src/components/utils/billingCore.js`, `scripts/verify-billing.mjs`, `scripts/sync-billing-core.mjs`
**Changed**: `billingRates.jsx`, `shared/billingHelpers/entry.ts`, `ShiftCalendarView.jsx`

### Why it was inaccurate

There were two implementations of the billing rules, and they had drifted:

| | Frontend — calendar, payroll | Backend — invoices, rate audit |
|---|---|---|
| `BILLING_UNIT_TYPES` | includes `'visit'` | omits it |
| `getUnitQuantity('visit')` | 1 charge | one per 24-hour block |
| Date parsing | date-fns `parseISO` | bare `new Date` |

The calendar and payroll read one copy; `generateMonthlyInvoices` reads the other. **What appeared on screen and what was invoiced were computed by different rules.** The per-visit fix from the previous change only reached the calendar — invoices would still have mis-billed it.

This is the same failure as the recurring shifts: one rule, two implementations, silent divergence.

### The redesign

`billingCore.js` is now the only place the rules exist. It is deliberately dependency-free — no date-fns, nothing runtime-specific — so the same text runs in both the browser bundle and Deno. A verbatim copy sits in `shared/billingHelpers/entry.ts` between explicit markers, because the two bundles cannot import each other.

`npm run sync:billing` regenerates the copy from the original; `--check` fails if it is stale, and `verify:billing` runs that check. Drift is now a failing test rather than a silent billing discrepancy. Confirmed: changing one line in the backend copy alone fails the suite.

Date parsing is written out rather than delegated, so the two agree on `"2026-08-19 06:00"` and on date-only strings — previously they did not.

### Unpriced work is no longer invisible

`resolveShiftBilling` already returned `source: 'none'` when nothing was configured, but every caller added `.amount` to a running total, so an unpriced shift was indistinguishable from a cheap one. A margin computed that way is fiction.

Two new functions make that explicit:

- `resolveShiftCost` mirrors `resolveShiftBilling` for the cost side, and separates *unassigned* (nobody rostered, costs nothing yet) from *no rate on file* (a gap in the staff record). Those were previously both £0.
- `summariseBilling` returns revenue, cost, margin and hours **plus** `unpricedCount`, `uncostedCount`, the offending shifts, the rate-disagreement warnings, and `isComplete`.

The calendar now takes its three figures from one `summariseBilling` pass, so hours, revenue and cost cannot disagree about which shifts they counted, and shows a badge when the period contains shifts it could not price or cost. The totals no longer look precise while quietly omitting work.

### Verification

`npm run verify:billing` — 40 checks built from real rate configurations in this app: Joanne Clitheroe's £29/hr personal care, MimarCare's £128.60 per-day live-in, Joan Temple's overnight rate, and the `domiciliary_care` rate that matches no shift. Covers unit precedence, the contract-beats-stamped-rate rule, corrupt clock durations, overnight shifts, teams charged once but paid per head, and invoice line wording.

Mutation-tested. Removing `'visit'`, pricing a team per head, silently swallowing unpriced shifts, and drifting the backend copy each fail the checks that name them.

Verified: `vite build` clean; the three billing-consuming backend functions bundle; all six check scripts pass; the one lint error is the pre-existing unused React import.

### Still open

Rates saved against service types no shift can carry — Joanne Clitheroe's `domiciliary_care` — remain unbilled. They are now flagged in the rate editor and counted by `unpricedCount`, but nothing has been migrated, because whether `domiciliary_care` means `personal_care` or `domestic` is a billing decision.

