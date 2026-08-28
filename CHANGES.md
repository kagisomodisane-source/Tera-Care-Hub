## The rate configurator (Base44 checkpoint 6a918094a90b434a6bb9cfc2)

**Changed**: `src/components/clients/ClientEditDialog.jsx`, `src/components/utils/billingRates.jsx`

Four faults, of which the first two cost money.

### 1. Rates were keyed by a vocabulary billing never looks at

Billing resolves a rate with `service_rates.find(r => r.service_type === shift.visit_type)`. The picker was populated from `SERVICE_TYPES`, which is the `Client.service_types` list — a different vocabulary from `Shift.visit_type`. They overlap in **three** values out of fifteen: `personal_care`, `complex_care`, `live_in_care`.

So eight of the eleven options could never match a shift — `domiciliary_care`, `respite_care`, `nursing_care`, `dementia_care`, `palliative_care`, `supported_living`, `sleep_in` — while there was no way at all to price `domestic` or `community_engagement`, both of which are in live use. A rate set against a dead type silently falls through to `default_hourly_rate`, or to nothing.

Live example: Joanne Clitheroe carries a `domiciliary_care` rate of £29/hr that has never billed anything. Her `personal_care` rate is also £29, so no money was lost there — but only by luck.

The picker now offers `Shift.visit_type` values, plus `overnight_support`, which is not in the schema enum but is used by both live shift data and existing rates.

### 2. "Per Visit" billed per hour

The unit dropdown offers Per Hour, Per Night, Per Shift, **Per Visit**, Per Day. `BILLING_UNIT_TYPES` listed only `hour`, `night`, `shift`, `day`, and `normaliseUnitType` silently falls back to `'hour'` for anything it does not recognise.

A rate saved as "£25 per visit" therefore billed £25 **per hour**:

| Visit length | Before | After |
|---|---|---|
| 1 hour | £25 | £25 |
| 2 hours | £50 | £25 |
| 3 hours | £75 | £25 |
| 8 hours | £200 | £25 |

`visit` is now a real unit meaning one charge per attendance, the same as `shift`. Checked that `hour`, `shift`, `day`, `night` and unrecognised values all behave exactly as before.

No client currently has a per-visit rate saved, so nothing has been mis-invoiced yet — the trap was armed, not sprung.

### 3. Editing a rate mutated the client record

Every row editor did `const next = [...service_rates]; next[i].field = value`. That copies the array but not the objects in it, and `formData` is seeded with the client's own rate objects, so each keystroke wrote straight through to the record React was still rendering from. Cancel discarded nothing.

All four editors now replace the row instead of mutating it.

### 4. Nothing told you a rate was dead

A rate with no service type, a duplicate type — only the first is ever used, since the lookup is a `find` — a type no shift can carry, or a rate of £0 all sit there looking configured. Each row now says which of those applies.

That is what surfaces problem 1 on existing data: anyone opening Joanne Clitheroe's billing tab is now told the `domiciliary_care` row will never be applied.

Verified: rate arithmetic checked before and after for all units; `vite build` clean; `verify:db`, `verify:recurrence`, `audit:query-keys`, `audit:query-init` pass; the one lint error is the pre-existing unused React import.

