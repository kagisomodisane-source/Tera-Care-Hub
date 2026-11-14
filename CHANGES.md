## Where each invoice stands with QuickBooks (Base44 checkpoint 6af7cf62d9fe9dcd459cceea)

**New**: `src/components/quickbooks/qbInvoiceLinks.js`,
`src/components/quickbooks/QuickBooksInvoiceStatus.jsx`,
`src/components/quickbooks/PulledFromQuickBooks.jsx`,
`scripts/verify-qb-invoice-links.mjs`
**Changed**: `src/pages/Payroll.jsx`, `InvoicePullSettings.jsx`,
`syncInvoicesFromQuickBooks`, `src/pages/ClientDashboard.jsx`, `package.json`

The invoice list could not answer the question an admin actually has in front of
it — "is this the figure the accountant has?" — so every invoice in the Payroll
suite now says where it stands with QuickBooks, and links to both sides.

### On each invoice

`QuickBooksInvoiceStatus` shows **In QuickBooks · #1380** with when it was last
checked, or **Not in QuickBooks** for one that is Wellstride's alone, plus a
link that opens the invoice in QuickBooks and a link to the client's record.

The QuickBooks link goes through the login route with `deeplinkcompanyid`, not
the bare `txnId` form. QuickBooks serves several companies from one host, so a
bare link opens whichever company the browser is signed in to — for anyone with
more than one that is the wrong invoice or an error. The pull now records
`realm_id` on its settings row to make that possible; it is a company
identifier that appears in QuickBooks' own URLs, not a credential.

### The nineteen that could not be placed

They were a count and a flat list. Now each one shows its doc number, amount,
date, the customer as QuickBooks states it, a link into QuickBooks, and — where
it can be worked out — the Wellstride client it appears to belong to, **with the
reason shown**, as a suggestion. Nothing is written. All ten distinct customers
on this account resolve:

| How | Example |
|---|---|
| client name | `Joanne Clitheroe`, `Mimarcare Ltd` |
| postcode of a client location | `4 Fir Grove, Sheringham, NR26 8PQ` |
| postcode plus location name | `1 Forge Close, Pooringland, NR14 7SZ` |
| location name | `Roy McFruin` |
| location named inside the customer | `Bridget Waller 9 Ainsworth Road…` |

Every step is an exact match on a normalised value. There is no fuzzy scoring
and no nearest guess, because what is being linked is somebody's money and a
plausible-but-wrong match is worse than none. Where several clients fit, the
answer is "could be more than one", not a coin toss.

### Three things only the real data would have shown

Synthetic fixtures would have passed a worse implementation. The live records
are messy in ways that matter, and `verify:qb-invoice-links` now encodes them:

- **One postcode, two clients.** NR14 7SZ holds both `1 Forge Close` (Thera) and
  `Donald Threadgold` (MimarCare). Postcode alone cannot resolve it, so the rest
  of the customer string is used to narrow it — and when that fails it stays
  ambiguous.
- **A shorter duplicate winning on length.** 22 Godfrey Road, 52 Norwich Road
  and 16 Latimer Road are each recorded twice, under `Mancap` and under
  `Mencap East Norfolk`. Narrowing by location name handed `22 Godfrey Road,
  NR10 3NH` to Mancap purely because that record's name is shorter and so
  happened to be a substring of the customer. A name contained in another
  candidate's name cannot tell the two apart, so it no longer counts.
- **Zero candidates reported as "more than one".** A location with no
  `parent_client_id` produced "postcode covers more than one client" — wrong,
  and alarming. Nothing to go on and several possibilities are now distinct.

A fourth was my own test being wrong rather than the code: a customer written
verbatim as one record's location name *should* resolve to it, since an exact
whole-string match is the most specific evidence there is. That check now
asserts the real behaviour, and the dangerous case is covered separately.

### Also

- Client links from the dashboard pointed at `ClientProfile?clientId=`, which
  reads `?id=`. They opened the page with no client. Fixed.
- `PulledFromQuickBooks` reuses the app's existing `fetchClients` and
  `fetchClientLocations` under their existing query keys rather than re-reading
  every client under keys of its own. `audit:query-keys` caught the collision.
- **Worth a look:** `Mancap` / `Mencap` / `Mencap East Norfolk` hold the same
  three addresses between them, and `Thera Trust` appears as
  `Thera East Anglia` on some locations. The denormalised name is ignored in
  favour of the Client record, but the duplicate clients are real.

## Invoices follow QuickBooks, one way (Base44 checkpoint 6af79bfecfa9d140e8ee61fc)

**New**: `base44/functions/syncInvoicesFromQuickBooks/entry.ts`,
`src/components/quickbooks/InvoicePullSettings.jsx`,
`scripts/verify-qb-invoice-sync.mjs`, workflow `QuickBooks Invoice Pull Sync`
**Changed**: `src/pages/Payroll.jsx`, `package.json`

QuickBooks is where the money is actually reconciled, so it is the source of
truth for invoice dates, amounts and payments. Every 12 hours (06:37 and 18:37,
Europe/London) Wellstride is brought into line with it. Nothing travels the
other way.

### The guarantee is in the code, not in a convention

The access token this uses can write to QuickBooks — it is the same connector
the push direction uses. So "one way" cannot come from the credentials, and a
comment saying so is worth nothing. It comes from three things:

- `qbGet` is the only place `fetch` is called, and it pins `method: 'GET'` as a
  literal. It takes no verb and no path, so there is no argument through which
  a caller could ask for a write.
- Only `/query` is addressed. QuickBooks writes go to `/invoice`, `/batch`,
  `/payment`; none of those strings appear in the file.
- `npm run verify:qb-invoice-sync` fails the build if any of that stops being
  true — a write verb, a second `fetch` call site, a write path, a call back
  into `syncInvoiceToQuickBooks`, or a locally created record.

The suite asserts mechanisms, never vocabulary, and all 32 checks are
mutation-tested: each violation is injected and the check must go red. Two of
those mutants earned their place by failing honestly first:

- `lastIndexOf('function qbGet')` also matched `qbGetRenamedAway`, so a `fetch`
  hidden in a similarly-named helper would have passed. Now pinned to the real
  signature.
- The POST mutant was neutralised by `stripComments`: it replaced the first
  `method: 'GET'`, which lives in the header comment explaining the rule, and
  stripping then deleted the mutation. The harness now mutates the stripped
  code, so mutations land on code that runs.

### Three bugs the checks found in the first draft

- **`paid` from a silent zero.** `money()` coerces anything unparseable to 0.
  `Balance` and `TotalAmt` arrive from QuickBooks as strings, so a missing
  figure read as 0 — indistinguishable from "balance cleared" — and marked the
  invoice **paid**. `deriveStatus` now parses strictly, requires a positive
  total before `paid`, and returns null when QuickBooks has not said enough, in
  which case the local status is left alone.
- **Matching that silently stopped working.** The draft listed the 1,000 most
  recent invoices and matched in memory. Past a thousand invoices the older ones
  stop being found and come back as `unmatched`, which reads as "raised directly
  in QuickBooks" and sends somebody hunting a problem that does not exist. It
  now fetches exactly the ids the run actually pulled, via `$in` in chunks.
- **A capped query with no cap signal.** One query of 500 dropped its overflow
  without saying so. It now pages, and reports `capped` when it hits its own
  ceiling.

Figures QuickBooks does not state are left off the patch entirely rather than
written as 0 or null, so a thin payload cannot blank a figure that is already
right. Only QuickBooks-owned fields are touched; `internal_notes`,
`generated_by`, `is_archived` and the PDF link are never written, so a pull
cannot undo somebody's work here. Local drafts are skipped — a draft has not
been issued, and QuickBooks cannot tell us it has.

An invoice raised in QuickBooks for a customer this app cannot identify is
**reported, not created**: `Invoice` requires a `client_id`, and guessing one
attaches somebody's money to the wrong service user.

### Verified against the live account

The first run read 19 real invoices from the last 30 days: `capped: false`,
`incomplete: 0`, `errors: 0`, `updated: 0`, `unmatched: 19`.

Nineteen unmatched is the correct result, not a failure, and it is the thing to
know about this feature: **no Wellstride invoice carries a `qb_invoice_id`**, so
there is nothing for the pull to update yet. The link is set when an invoice is
pushed to QuickBooks by `syncInvoiceToQuickBooks`; from then on the pull keeps
it in step. The two numbering schemes do not correspond (`1375`–`1393` in
QuickBooks against `INV-6A05-202607-628` here), so they cannot be matched
automatically, and guessing is the one thing this function must not do.

### Scheduled runs do authenticate

Worth recording, because it was not obvious and the workflow files pass no
secret: scheduled workflow invocations carry a privileged identity.
`reconcileShiftVisits` runs every five minutes through `authorizeBackendJob`,
which requires a privileged session or the shared secret, and its audit records
are being written — so `base44.auth.me()` resolves on a scheduled run. That is
why `authorizeAutomationCall(base44, body, ['admin', 'manager'])` is enough and
no secret needs committing to the workflow definition.

### The panel says which way it goes

`InvoicePullSettings`, in Payroll → QuickBooks: the enable switch, the lookback
window, the last run with its counts, and Run now (which passes `manual: true`
so an admin can try the sync before arming it). The card states the direction
permanently, because the expensive misunderstanding here is an admin correcting
an amount in Wellstride and assuming their accountant will see it. They will
not — the next pull overwrites it.

## Pages that would not scroll (Base44 checkpoint 6af51d1655f1e562028c88c3)

**New**: `src/components/layout/appScroller.js`, `scripts/verify-app-scroll.mjs`
**Changed**: `Layout.jsx`, `useMobileChatViewportLock.jsx`, `ClientOnboardingWizard.jsx`

### Nothing was scrolling the thing that scrolls

The app shell is `h-[100dvh]`. The window and the body never scroll. What
scrolls is the active bottom-tab panel — `#tab-panel-<id>`, which is
`overflow-y-auto` — or, on routes outside the four tabs, `<main>`, whose
`overflow-x-hidden` computes `overflow-y` to `auto`.

Every piece of scroll handling in the app was aimed at the window or the body,
so none of it did anything:

- **`window.scrollTo(0, 0)` on route change** was a no-op. A page opened at
  whatever offset the previous one was left at. Tapping into a screen and
  landing halfway down is indistinguishable, on a phone, from the page being
  stuck — and it is the most likely thing staff were describing.
- **The onboarding wizard** scrolled the window on each step, so Next appeared
  to do nothing until you dragged back up yourself.
- **The mobile sidebar** set `document.body.style.overflow = 'hidden'`, which
  held nothing still: the page kept moving under the open menu.
- **The fullscreen chat** saved the body's styles, set
  `position: fixed; overflow: hidden`, and restored what it had saved on close.
  If the sidebar's lock was in force when the chat opened, it saved
  `overflow: hidden` and put that back on the way out — leaving the app frozen
  until something else happened to clear it. That is a reload for most people.

Three owners of one piece of global state, two of them aiming at the wrong
element, and the third restoring the second's mistake.

### One scroller, one counted lock

`appScroller.js` answers both questions in one place. `getAppScroller` returns
the visible tab panel — a hidden one is `display: none` and has no layout, so
`offsetParent` is the cheapest way to ask — else `<main>`.

`lockAppScroll` is reference-counted and returns its own release function. The
first caller captures the original state; only the last release restores it; a
double release is ignored. That is what lets the sidebar, the chat and Radix
dialogs overlap without one of them clearing another's lock.

`scrollAppToTopOnNavigation` deliberately does nothing when a tab panel is in
charge, because a tab panel remembers where it was and puts you back there when
you return to that tab. Scrolling it on navigation would undo the one bit of
scroll handling that was working.

### Checked and found innocent

Worth recording so nobody re-investigates them:

- **The wide tables** (`min-w-[900px]` in TrainingHub, ManagerTrainingHub,
  StaffAvailability, MarChartLiveDialog) are all inside `overflow-x-auto`
  wrappers. They scroll sideways on purpose and do not stretch the page.
- **`PullToRefresh`** is careful: a noise floor, a direction test, and it only
  calls `preventDefault` once it has decided the gesture is a downward pull
  from the top. Its non-passive `touchmove` listener is the price of the
  feature, and only the visible tab's listener ever fires.

### Not fixed, and worth deciding on

**Tab pages are mounted once and never unmounted.** `renderContent` skips a tab
until first visit, then `mountedTabs` keeps it forever, hidden with
`display: none`. After a carer has been round the bar once, Dashboard, Shifts,
Messages and Tasks are all live at the same time — four pages' worth of React
Query subscriptions, refetch intervals and DOM, re-rendering on every
background refetch. That is a real and growing cost on a mid-range phone and
the most likely cause of the *performance* half of the report, as distinct from
the *stuck* half fixed here. Unmounting idle tabs would change how instant tab
switching feels, so it is a judgement call rather than a bug fix.

### Verification

`npm run verify:app-scroll` — 21 checks, in `verify:all`. The lock is exercised
through a stub document: two owners, partial release, double release, and the
original value surviving a full cycle.

Seven mutations, all caught: the lock not counting; release ignoring the count;
double release double-counting; navigation scrolling the tab panel; hidden
panels being chosen as the scroller; Layout reverting to `window.scrollTo`; and
the chat pinning the body again.

The first draft had one false positive, and it was the same trap as last time:
the check for "nothing scrolls the window" flagged `appScroller.js` itself,
because the comment explaining the fix quotes the call it replaced. Comments
are stripped before every "must be gone" test now.

`verify:all` green: 150/150, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46,
41/41, 21/21, billing agreeing, build clean.

---

## Postcode and phone on the shift card (Base44 checkpoint 6af20c64a880a7621d820969)

**Changed**: `src/pages/MyShifts.jsx`

The shift detail card showed Date, Time, Location and Working with. Location read
"32 Grove Road, Norwich" — a street and a town, which is not enough to find a
house in an unfamiliar one — and there was no number to call on arrival.

- **Postcode** joins the address in `getShiftLocationText`, so it reads
  "32 Grove Road, Norwich, NR9 3JP". That helper feeds the shift list as well as
  this dialog, so both now carry it and cannot disagree.
- **Phone** is a new row below Location, the location's number if there is one,
  otherwise the client's. It is a `tel:` link, because the moment a carer wants
  it they are standing outside the house with one hand free.

Both come from the client records the page already holds — `db.Client.list`
through the read gateway — so there is no extra request and nothing new is
exposed: this is the same data the Client Info dialog shows.

Phone is a flagged field, so it renders through `WithheldValue` and the row
appears when the number is withheld as well as when it is set. A manager turning
`staff_view_contact_details` off for a client gets "Withheld by your manager"
rather than a silently missing row, which is what the access-scope check
requires of any screen showing a flagged field — it would have failed the build
otherwise, as it did when the same row was added to `ClientInfoSection`.

Left alone: the phone is not repeated on every card in the list. The address is
the thing you scan a list for; a number is what you want once you have opened
the visit.

### Verification

`verify:all` green: 150/150, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46,
41/41, billing agreeing, build clean, no `no-undef`.

---

## The empty panel where a carer's client details should be (Base44 checkpoint 6af1a038fc89f28851af37ef)

**Changed**: `getClientInfoForShift`, `ClientInfoSection.jsx`, `scripts/verify-access-scope.mjs`

### What staff were looking at

The screenshot shows the shift Client Info dialog for Joanne Clitheroe: her name,
the Private Service User badge, Info and Documents tabs — then a **blank white
card**, then Medical Info. Nothing in between.

It was not a permissions problem and not missing data. Her record is complete:
address, postcode, phone, emergency contact, a full care plan and risk
assessment, medications, allergies, mobility notes. All three `staff_view_*`
flags are `true`. There is no `client_access_policy` row, so both access modes
default to off and `redactClient` never runs.

The cause is `minimiseClient` in `getClientInfoForShift`, which narrows the
client to a fixed list before sending it to a non-privileged user. The list
held the care fields and **no address, no postcode, no phone, no emergency
contact**. The first card on the Info tab draws exactly those four things, each
conditionally, so every row was false and the card rendered with no children —
an empty white panel. Medical Info drew below it because those fields were in
the list.

So two faults, one visible: a projection that dropped what a carer needs to
attend a visit, and a card that renders itself when it has nothing to show.

### Narrowing past what the job needs is not a safety measure

I wrote that projection during the access-control work, and trimming the client
to care-relevant fields was right in principle. Dropping the address was not.
A carer who cannot find the house cannot do the visit, and nothing in
`CLIENT_FIELD_VISIBILITY` restricts `address` or `postcode` — there is no rule
to enforce there, so withholding them enforced nothing.

Phone and emergency contact *are* restricted, by `staff_view_contact_details`,
and they are gated properly: `redactClient` runs at the top of `minimiseClient`,
before the projection picks fields up. The flag decides, which is the point —
not whether somebody remembered to list the field here. Joanne's flag is on, so
her carers see her husband's number, which is what it is for.

`withheld_fields` is passed through now as well, so a field turned off by a
manager can say so instead of showing the same blank as a field nobody filled
in.

### The check caught my own new code

Adding an Emergency Contact row immediately failed an existing check — every
screen showing a flagged field must be able to say it was withheld rather than
render blank. It was right: I had written a plain `{client.emergency_contact}`.
Both that row and the phone row go through `WithheldValue` now, and the row is
drawn when the field is withheld as well as when it is set, because "turned off"
and "never recorded" need different responses from the carer.

### Verification

`verify:access-scope` 150 checks. Four mutations, all caught: dropping `address`
from the projection, dropping `emergency_contact`, projecting before redacting
instead of after, and letting the contact card render unconditionally again.

`verify:all` green: 150/150, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46,
41/41, billing agreeing, build clean.

**Worth a look on a carer's phone**: open a shift for Joanne and confirm the
Info tab now shows 32 Grove Road, NR9 3JP, her number and David's details above
Medical Info.

---

## Team visits are charged per carer (Base44 checkpoint 6aeff4635805e1363c8313f3)

**Changed**: `ShiftCalendarView.jsx`, `scripts/verify-calendar-costing.mjs`

Joanne Clitheroe is charged **£29 an hour per carer** — confirmed, for all her
visit types. The calendar was charging each visit once.

### The arithmetic, on her real rota for 9–15 November

59 carer rows, 28 visits, 34.50 carer-hours.

| | correct | calendar before |
| --- | --- | --- |
| revenue | **£1,000.50** | £471.25 |
| cost | £443.72 | £443.72 |
| margin | **£556.78 (55.7%)** | £27.53 (5.8%) |

Revenue was short by **£529.25, 52.9%**. The cost side was right throughout —
£12.82/hr for Rosemary, Thoko and Kagiso, £13.50 for Valerie, summed per carer.
Only the charge was halved, which made a client running at 55.7% margin look
like 5.8%.

Worst single case: Monday 9 November, 11:00–12:00, three carers. £87.00 due,
£29.00 shown — a third.

### What changed

`billingCore` carries the assumption out loud: "three carers on one visit is one
charge to the client and three wages to pay". That is a real contract shape, but
it is not Joanne's, and the calendar applied it to everyone by totalling the
grouped team cards.

The grid still groups — two carers attending together is one visit to look at —
but every figure is now totalled from the carer rows underneath: the period
chip, each day subtotal, and the team card's own pill. That is the same basis
`generateMonthlyInvoices` already bills on, so the calendar and the invoice now
agree by construction rather than by coincidence.

This also settles the finding from the previous entry. The invoice charging per
row is **correct**, not double-billing; the calendar was the side that was
wrong. Nothing needs crediting.

Single-carer visits never group, so no other client's figures move. The one
Thera Trust shift carrying `staff_required: 2` does, and is worth a glance
against that contract.

### A 7p correction to my own sums

I quoted £443.65 cost and £556.85 margin in chat. The code gives £443.72 and
£556.78. `resolveShiftCost` rounds each row to the penny and then sums, which is
how the invoice totals; I had summed the unrounded values and rounded once at
the end. Fourteen 45-minute rows at £9.615 each account for the 7p. The code's
figures are the ones that match an invoice.

### Verification

41 checks. The team case now asserts £29 revenue and £16.18 margin on a
two-carer half-hour visit, and asserts that charging the grouped card instead
would give £14.50 — both sides of the bug, so neither can drift back unnoticed.

Four mutations, all caught: the period total, the day subtotals and the card
pill each reverting to the grouped card, and the grid ceasing to group at all.

`verify:all` green: 139/139, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46,
41/41, billing agreeing, build clean.

**Worth checking against a real invoice**: her week of 9–15 November should come
to £1,000.50 across 59 lines.

---

## Joanne Clitheroe's hours were half what they should be (Base44 checkpoint 6aefee2bab3dccb21c05d6ec)

**Changed**: `shiftDisplayCost.js`, `scripts/verify-calendar-costing.mjs`

### What is wrong, and it was mine

Joanne is the only client with `staff_required: 2`, and her visits are stored as
**one Shift row per carer** — two rows sharing the same start and end. The
calendar groups them into a single team card, which is right: one visit is one
charge to the client and two wages to pay.

Four days ago I gave `summariseBilling` a `costResolver` so the calendar's cost
and its uncosted count would come from the same rule. `summariseBilling` totals
whatever the resolver reports as `hours`, and the resolver I passed —
`getShiftDisplayCost` — measured `end_datetime − start_datetime`. That is the
length of the **visit**, not the hours **worked**: two carers for half an hour
is 0.5 by that measure and 1 by every other.

So the period chip began reporting 0.5 where the day cells, which use
`getShiftDurationHours`, still reported 1. For a client whose every visit is
double-staffed that is not an edge case — **every figure Joanne has, halved in
the Week and Month totals while her own day cells stayed correct.**

Measured on her real data, a 19:30–20:00 visit with two carers at £12.82:

| | before | after |
| --- | --- | --- |
| day cell hours | 1 | 1 |
| period chip hours | **0.5** | 1 |
| cost | £12.82 | £12.82 |
| revenue | £14.50 | £14.50 |
| margin | £1.68 | £1.68 |

Only the hours were wrong; the money was right. Hours are what the rate is read
against, though, so a halved hours total makes a correct £29/hr look like £58.

### The fix

`getShiftDisplayCost` now takes its hours from `getShiftDurationHours`, the
function that already answers this question — and the only one that answers it
correctly. It is team-aware, it honours a trustworthy
`scheduled_duration_minutes`, and it handles the shifts stored as `shift_date`
plus `start_time` and `end_time`, which have no datetimes to subtract. My
hand-rolled subtraction silently returned 0 hours for those, which would have
dropped their weekend rate as well.

The lesson is narrow and worth keeping: `summariseBilling` totals the resolver's
`hours`, so a cost resolver is not free to have its own opinion about how long a
shift was. The regression check now asserts the summary's hours equal what a day
cell sums, on a two-carer visit, and a mutation back to end-minus-start fails it.

### Also found, and deliberately not changed: Joanne may be invoiced twice

`generateMonthlyInvoices` iterates **raw Shift rows** and writes one line item
each:

```js
for (const shift of shifts) {
  const billing = resolveShiftBilling(shift, client, ...);
  lineItems.push({ ... amount: billing.amount });
}
```

No team grouping — the calendar groups before billing, the invoice does not,
though the comment above that call claims "Shared with the shift calendar so the
two always agree". Two rows per visit therefore become two charges: **£29.00 for
a 30-minute visit contracted at £29/hour, where £14.50 is due.**

Joanne has roughly four double-staffed visits a day going back months; she is by
far the main exposure, and one Thera Trust shift on 2026-10-27 carries
`staff_required: 2` as well.

Not fixed here, and not as an oversight. It changes what clients are charged,
any invoices already issued would need correcting rather than just the code, and
whether a second carer is separately chargeable is a contract question per
client, not a thing to infer from a data shape. It needs a decision first.

### Verification

`verify:calendar-costing` 36 checks; `verify:all` green: 139/139, 101/101,
42/42, 28/28, 31/31, 23/23, 31/31, 46/46, 36/36, billing agreeing, build clean.

One check had to be retired rather than kept: it pinned the `spanIsReal` guard I
had added, which `getShiftDurationHours` now subsumes. It asserts the property —
hours come from the shared rule — instead of the line that is gone.

---

## Calendar costing, rates and margins (Base44 checkpoint 6aeaaa253fc95728250a249c)

**New**: `scripts/verify-calendar-costing.mjs`
**Changed**: `ShiftCalendarView.jsx`, `shiftDisplayCost.js`, `billingCore.js` (+ backend copy), `package.json`

### The warning contradicted the figure

Since the cost pill was built, the calendar has had **two** cost rules.
`getShiftDisplayCost` pays the night, weekend and daily bands; `summariseBilling`
went on resolving each shift's flat hourly cost for its count of shifts it could
not cost. So a shift paid on a night rate with no hourly rate on file showed a
real cost **and** was counted as uncosted at the same time — the asterisk on
Margin and the "N uncosted" chip appeared precisely where the bands were doing
their job, which is the opposite of useful.

`summariseBilling` now takes the cost rule as an argument. One pass produces the
total and the count under the same rule, and the backend copy is untouched
because the argument defaults to the hourly rule it always used.

The verify script proves the contradiction is gone by asserting both sides of
it: with the bands, a waking-night shift costs £95 and nothing is uncosted;
without them, it costs £0 and one shift is uncosted. That pair is the bug.

### Three passes became one

Each shift was costed three times per render — once by `summariseBilling` for
its count, once by `sumShiftDisplayCost` for the figure, once more for its own
pill — and revenue twice. All of it inside `renderDayCell`, which re-runs on
every render: every toggle click, every drag-hover, every selection change. A
month on screen meant 35-plus summarise calls, each re-resolving the billing of
every shift in its day, for a single switch.

Day subtotals are now one memo keyed on the visible days, the per-shift figures
one memo keyed on the shifts, and `renderDayCell` is a lookup. The checks forbid
`summariseBilling`, `getShiftDisplayCost` and `getShiftRevenue` from appearing
inside it at all, which is the mechanism rather than the vocabulary.

`shiftDisplayCost` also parsed the dates three times over per shift — two Dates
for the hours, a third for the day of the week, on top of the ones
`resolveShiftCost` already built. It parses once now, and reaches `billingCore`
by relative path instead of through the aliased re-export that only forwarded to
it, which is also what makes it loadable outside Vite and so actually testable.

### A broken date read as a weekday

`new Date(shift.start_datetime).getDay()` on an unparseable date gives NaN, and
`NaN === 0 || NaN === 6` is false — so a shift whose dates are broken quietly
lost its weekend rate instead of being flagged. The hours went the same way via
`Math.max(0, NaN) || 0`. Both are explicit now.

Worth recording: **that pair cannot be caught by a behavioural test.**
`Math.max(0, NaN) || 0` is also `0`, and NaN was already not a weekend, so
removing the guards changes no observable answer today. They matter the moment
anyone uses `hrs` or `dow` for something else. Pinned as source invariants and
labelled as unreachable-by-design, rather than covered by a test that cannot see
them.

### One control instead of three

Hours stays on its own, because it answers a different question. Revenue, cost
and margin now share a single **Money** switch — a margin with no sight of the
two figures it came from invites the wrong conclusion, and revenue without the
margin was the old blind spot, so reading them apart was never the point.

- **Period**: one pill reading `Month · £3,420 in · £2,180 out · £1,240`, margin
  highlighted and coloured by sign, with the incomplete caveat attached to the
  figure it qualifies instead of sitting in a chip of its own. Four chips used to
  wrap onto three lines on a phone and left the margin furthest from the numbers
  that produced it.
- **Day cell**: revenue and cost on one line, margin beneath with its asterisk
  when that day holds something unpriced. Three stacked label-and-figure rows
  used most of a month cell.
- **Per shift**: one pill, `{band} {cost}` — the band label was deliberate work
  and stays — turning rose when that shift loses money, with revenue, cost and
  margin in full on the pill itself.

### Verification

`npm run verify:calendar-costing` — 30 checks, in `verify:all`. Suite green:
139/139, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46, 30/30, billing
agreeing, build clean.

Nine mutations, and **the first draft caught seven**. Two instructive misses:
the check for the cost rule being passed matched anywhere in the file, so it
still passed when the rule was removed from the period summary because the day
summaries carried one of their own — scoped to each memo now. And the broken-date
case was behaviour-equivalent, as above.

---

## Rate boxes that would not take pence (Base44 checkpoint 6ae5463b6369d0eead306ac7)

**New**: `src/components/utils/numericInput.js`, `src/components/ui/NumberInput.jsx`, `scripts/verify-rate-inputs.mjs`
**Changed**: `ClientEditDialog.jsx`, `StaffEditDialog.jsx`, `Staff.jsx`, `ShiftCreateDialog.jsx`, `ShiftEditDialog.jsx`, `MyMileageClaims.jsx`, `Client` entity

### The decimal point was deleted as it was typed

Every money box in the app was written like this:

```jsx
value={formData.default_hourly_rate || ''}
onChange={(e) => setFormData({ ...formData, default_hourly_rate: parseFloat(e.target.value) || null })}
```

Type `2`, `3`, then `.` — `parseFloat("23.")` is `23`, `23` goes into state, and
the `value` prop renders `"23"`. **The point is removed at the moment it is
typed.** £23.50 cannot be entered at all; only whole pounds go in. That is the
whole of "unable to adjust billing and rate", and it needed no particular client
or permission to reproduce.

`|| null` and `|| 0` carried a second bug: `0` is falsy, so a rate of zero was
silently replaced by the fallback. A rate could not be set to zero, and in the
`|| 0` sites a cleared box became £0 rather than nothing.

Fourteen fields behaved this way: client default hourly and weekly live-in
rates, each per-service contracted rate row, staff hourly, night and weekend
rates, the Add Staff hourly rate, the shift unit and hourly rate overrides, and
mileage distance and rate per mile. GPS latitude and longitude in the same
dialog had it too, which matters for geofencing.

### The fix

The box keeps the text; the form gets the number. `numericInput.js` holds the
rule, dependency-free, and `NumberInput` is the control:

- `parseNumericText("23.")` is `23`, so the number is right while the text still
  shows the point;
- `shouldAdoptExternal("23.", 23)` is `false`, so the re-render caused by typing
  cannot rewrite what was typed — but a genuinely different value, a different
  client loaded into the same dialog, still replaces it;
- `"0"` reports `0`, and each field says what a blank box means for it rather
  than inheriting whichever falsy fallback was nearest.

### And a rate with nowhere to go

`default_weekly_live_in_rate` had a labelled box in the billing tab and **no
property on the `Client` entity**. Base44 drops unknown properties silently, so
every weekly live-in rate ever typed was discarded on save — confirmed by
querying live records for the field and getting it back absent from every one.
This is the third instance of that exact shape in two days, after `email` on
`Client` and `funding_notes` in the create allowlist. The property exists now.

### Verification

`npm run verify:rate-inputs` — 46 checks, in `verify:all`. The decimal case is
tested by walking the keystrokes of `23.50` one at a time and asserting the box
is never rewritten by the value it just reported.

Eight mutations, all caught: zero collapsing to the empty value; adopting
external values always, which is the original bug; adopting never, which would
leave a stale rate on screen for the next client; the component rendering the
number instead of the text; the component parsing for itself again; the client
hourly rate and the staff night rate each reverting to parse-on-keystroke; and
the weekly live-in rate losing its entity property.

`verify:all` green: 139/139, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, 46/46,
billing agreeing, build clean, no `no-undef`.

### Left alone, deliberately

About thirty-five other `parseFloat`/`parseInt`-on-keystroke inputs remain, in
form builders, workflow designers and capacity fields. They are whole numbers,
where a decimal point is not wanted and the defect does not bite. They share the
"cannot be set to zero, cannot be cleared" half of the bug, which is worth a
sweep but is not what was reported.

---

## One way to add a service user (Base44 checkpoint 6ae34c5634d740699391ba23)

**New**: `src/components/clients/createClientRecord.js`
**Changed**: `createClient`, `Client` entity, `ClientCreateDialog.jsx`, `ClientOnboardingWizard.jsx`, `ResidentManager.jsx`, `scripts/verify-client-create.mjs`

All three paths now go through `createClient`, so all three get the field
validation, the allowlist and the `client_created` audit entry. Two of them had
none of that.

### Why they were bypassing it, and what had to change first

Neither caller could have used the function as it stood. That was the actual
work; the rewiring was four lines.

**It demanded a date of birth and an NHS number for every private client.** A
profile started from a location's resident list has neither — all that is known
is a name and the building. Live data agrees the rule was never real: active
private clients exist today with both fields empty.

**It returned a four-field summary.** `linkClientAsResident` reads `address`,
`postcode`, `latitude`, `longitude`, `key_safe_details` and `residency` off the
new client, so a summary would have left it linking a resident with undefined
everything. It returns the created record whole now — to a privileged caller who
just supplied the data and may read Clients anyway.

### The near-miss worth recording

The tidy way to exempt the resident-list stub was to create it with
`status: 'onboarding'`, which reads as honest: the record *is* thin. I did that
first.

It was wrong, and checking rather than assuming is what caught it. An onboarding
client is filtered out of `CarePlanManagement`, the `StaffAssignments` picker,
`ExternalAccess`, `StaffOnboardingWizard` and the dashboard counts. The resident
would have existed and been impossible to roster or care-plan — a worse bug than
the inconsistency being removed, and one that would have looked like a
permissions problem to whoever hit it. The person is an active service user; it
is the record that is incomplete, and those are different things.

So the stub stays `active` and declares the gap with `allow_incomplete: true` —
a control field, stripped before the write, and named in the audit reason. Two
exemptions now, for two genuinely different situations: onboarding status, which
is the wizard saying the record is mid-process, and `allow_incomplete`, which is
a caller saying it knows what is missing. Everything else still has to supply
both. A date of birth that *is* supplied must still be a real date under either
exemption — the exemption is for an absent value, not a malformed one.

### email

The wizard has always had an Email input. `Client` had no `email` property, and
Base44 drops unknown properties silently, so every address typed there has gone
nowhere — confirmed by querying live records for the field and getting it back
absent from every one. It was in the backend allowlist with nothing behind it,
which is why removing it looked right an hour earlier. The property exists now
and the field is stored.

### What holds it together

`createClientRecord` is the single entry point: one import, one call, and it
treats a 2xx carrying no record as a failure rather than success.
`verify:client-create` grew from 12 checks to 31 — every caller must use the
helper, nothing may call `Client.create` directly, only the helper may invoke
the function, and the fields of all three callers must be accepted by the
backend and exist on the entity.

Thirteen mutations across two rounds, all caught: each caller reverting to
`db.Client.create`; the helper accepting an empty 2xx; the response narrowing
again; the exemption being removed, and separately widened to everything; the
stub reverting to onboarding; the stub dropping its flag; a malformed date of
birth slipping through the exemption; `allow_incomplete` being written onto the
record; and the exemption going unaudited.

### Verification

`verify:all` green: 139/139, 101/101, 42/42, 28/28, 31/31, 23/23, 31/31, billing
agreeing, build clean, no `no-undef`.

**Worth a live check**: create a profile from a location's resident list and
confirm it appears in the staff assignment picker, and complete the onboarding
wizard with an email address and confirm it is stored.

---

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


## The client portal trusted fields the representative could write

`ClientPortal.jsx` decided everything from the signed-in user's own record:

```js
const repType  = user?.representative_type || (user?.is_cqc_inspector ? "cqc_inspector" : "family");
const clientId = user?.linked_client_id;
if (!user?.is_client_representative && !user?.is_cqc_inspector) { /* refuse */ }
if (user?.portal_access_enabled === false) { /* suspended */ }
```

All five are ordinary `User` properties, and `base44.auth.updateMe` writes arbitrary fields on the caller's own record — the same hole `resolveRole` was written to close for `app_role`, on a surface where the reader is outside the organisation. A representative could enter the portal uninvited, promote themselves from `family` to `cqc_inspector` (which also lifts the approved-notes-only filter), re-point `linked_client_id` at any service user, or un-suspend themselves after a manager revoked access.

The trust root is now the `RepresentativeInvitation` record. Its RLS is create/update/delete admin-or-manager, and a representative may read only rows whose `email` matches their own — and that email is platform identity, not an app field, so it is the one link in the chain they cannot rewrite. `resolvePortalAccess` matches on email itself rather than relying on the read rule, so a widened rule cannot widen access on its own. Self-writable fields are still read where they *narrow*: `user.portal_access_enabled === false` still suspends, because the worst a subject can do with that is lock themselves out.

The same rule now has a name in two places: platform identity and admin-written records may grant; anything the subject can write may only take away.

### The portal asked for every service user and threw all but one away

```js
const all = await db.Client.list();
return all.find((c) => c.id === clientId) || null;
```

`Client` is a gateway entity, so that is a `scopedRead` call — and with the policy at its defaults (below) it returns every client in the service, unredacted, to the representative's browser. The UI rendered one; the response carried all of them. Now `db.Client.get(clientId)`.

Two more of the same shape: `portal_access_enabled` was checked *after* all five queries had fired, so a suspended account still fetched the records and had a notice drawn over the top of them; and `approved_for_client_view` was applied with `.filter()` after fetching 50 notes, so notes a manager had not released arrived anyway. Every query is now gated on the grant, and the approved-notes decision is in the query criteria — with the browser-side filter kept as well, because compound-filter behaviour through the SDK path is unsettled.

Also seven raw `format(new Date(...))` calls, the crash that took out Visit Notes, on a page where one malformed `date_of_birth` white-screens the lot. All on `safeFormat` now. `"MMM d, yyyy 'at' HH:mm"` was missing from `FORMAT_MAP`, so it rendered month-first; added.

### Verification

`npm run verify:portal-access` — 31 checks: the grant and every denial over a table of invitations, each self-writable field proved unable to grant or widen, unknown representative types falling back to the narrowest tab set, and source invariants on the page (one client not all, every query gated, the notes filter in the criteria, no `date-fns`).

Mutation-tested — all eleven caught: restoring `Client.list()`; ungating a query; dropping `approved_for_client_view`; granting from `linked_client_id`; letting the User flag un-suspend; accepting any invitation status; widening the unknown-type fallback; skipping the type allowlist; restoring `date-fns`; deleting the `FORMAT_MAP` entry; skipping the email match.

One check was a tautology on first writing — it compared the resolved type against the same constant that produced it, so moving the fallback to `family` passed. It asserts the literal now. That is the second time in this project a check has agreed with whatever the code said rather than with the rule.

### Still open: the gateway is deployed but switched off

`readAccessPolicy` reads `AppSettings` where `setting_key = 'client_access_policy'`. **There is no such row** — 22 settings rows exist, none of them that one — so `scopeMode` and `fieldVisibilityMode` both default to `off`, and `scopedRead` takes its own documented short circuit:

```js
if (policy.scopeMode === 'off' && policy.fieldVisibilityMode === 'off') {
  // read as the service role and return, exactly as the app behaved before
}
```

So, today, for any signed-in account including the one client representative:

- `db.Client.list()` returns every client, and because `redactClient` runs only inside `applyScope`, `withheld_fields` is never set — which means `staff_view_care_plan` and `staff_view_risk_assessment` have no effect anywhere, and the `WithheldValue` UI that depends on them is decorative;
- `db.User.list()` returns full personnel records, not the 20-field directory: `passport_number`, `dbs_number`, visa and right-to-work status, home address, date of birth, next of kin, `hourly_rate`. The projection is written, tested and not running.

That is a configuration row, not a code change, and it is **not** a safe thing to flip unattended. `scopeMode: 'enforce'` scopes clients to the rota, and `accessScope` has no `client_representative` branch — it would cut the live representative off from their own service user. `fieldVisibilityMode: 'enforce'` applies `staff_view_care_plan`, whose schema default is `false`, so carers could lose care plans mid-shift.

`report` mode is the safe first step and exists for exactly this: `applyScope` filters and redacts nothing in that mode, only counting what enforcing *would* withhold, once per person per entity per day. A fortnight of those lines says what enforcing costs before anyone commits to it. Needs a decision, not a patch.

## Report mode is on — but the switch had to be connected first

Asked to create the `client_access_policy` row, I found the row was not the only thing missing. `readAccessPolicy` read the two modes from the row's **root**:

```js
const scope  = settingsRow?.scope_mode;
const fields = settingsRow?.field_visibility_mode;
```

Neither `scope_mode` nor `field_visibility_mode` was a declared property on `AppSettings`, and Base44 drops undeclared properties on write — the fourth time that has bitten this app. So a row created the obvious way came back without them, `readAccessPolicy` saw `undefined`, and the policy resolved to `off`. **The gateway was not switched off; it was unconnected.** No row of any shape could have turned it on, and writing one would have produced something that looked configured and did nothing — the worst outcome, because it ends the investigation.

Two things were wrong at once, and they wanted opposite fixes:

- `AppSettings` keeps a setting's data in `setting_value`, an object. That is what the schema says the column is for and what the `2fa_enforcement` read in `scopedRead` does: `row?.setting_value?.enforce_2fa_for_roles || row?.enforce_2fa_for_roles`. `readAccessPolicy` now follows the same convention — `setting_value` first, root as fallback — so a row written either way works.
- But that corrected function **is not live**. `scopedRead` imports `accessScope` from a pinned, content-hashed published asset (`35583f2bd_accessScope.js`), and `functions/shared/*` has been failing to deploy for the whole of this work. Fetching that URL with `-L` (a bare `curl` returns a 302 and 0 bytes, which is why earlier attempts were inconclusive) returns 14,458 bytes of the **old** function: `setting_value` appears zero times. So every edit made to any `shared/*` module is currently inert in production. That is now a confirmed fact rather than an open question.

Which pointed at the way through. The deployed reader looks at the root; the root fields merely weren't declared. So both modes are now declared on `AppSettings` with an `off`/`report`/`enforce` enum, and the row carries them **at the root and inside `setting_value`** — the root for the code that is actually running, `setting_value` for the convention and for the corrected reader once it deploys. Verified against the stored row, read back fresh rather than trusting the create response:

```
deployed  readAccessPolicy(row) = {"scopeMode":"report","fieldVisibilityMode":"report"}
corrected readAccessPolicy(row) = {"scopeMode":"report","fieldVisibilityMode":"report"}
corrected on no row             = {"scopeMode":"off","fieldVisibilityMode":"off"}
```

Report mode changes nothing anyone sees. `applyScope` filters and redacts only under `enforce`; under `report` it returns every record and just counts what enforcing would have withheld, once per person per entity per day. Confirmed: `scopeMode=report` returns 2/2 records while still reporting `outOfScope=1`; `enforce` returns 1/2. The one real consequence is that non-privileged reads no longer take the `off`/`off` short circuit, so they now do a bounded `listAll` and may write one audit row a day. Admins and managers return earlier and are untouched.

### The checks agreed with the code instead of the rule

The existing suite tested `readAccessPolicy` twice: an absent row, and a row with invalid values. Both expect `off` — which is also what a function reading the wrong field returns for *every* input, including a correct row. That is precisely why this shipped: **a suite that only ever asserts the default cannot tell a working switch from a dead one.**

`verify:access-scope` is now 158 checks, with four that assert a row meant to turn something **on**, and two source invariants that the modes stay declared on `AppSettings` with `report` a legal value — because undeclaring either one silently reverts the live policy to `off` with no error anywhere.

Mutation-tested — all four caught, including the bug exactly as it shipped, which the old suite passed: restoring the root-only read; undeclaring `scope_mode`; narrowing the enum so `report` is illegal; making `readAccessPolicy` always return `off`.

### What to do with it

Read the counts after a fortnight, then decide. Enforcing is still a care-safety decision, not a patch: `scope_mode: 'enforce'` scopes clients to the rota and `accessScope` has no `client_representative` branch, so it would cut the representative off from their own service user; `field_visibility_mode: 'enforce'` applies `staff_view_care_plan`, whose schema default is `false`, so carers could lose care plans mid-shift. The representative branch is the piece of work that has to come before enforcement.

## Why a backend fix can sit in `main` for weeks without reaching production

I said last time that every edit to `base44/functions/shared/*` was inert in
production. **That was too broad, and the real picture is more useful.** Eleven
of the fifteen modules match the code production runs. Three do not, and
`externalTransfer` is imported by nothing at all.

### The mechanism

`GET /api/apps/<app>/agent-profile` reports `backend_runtime: "legacy"`,
`unsupported_reason: "legacy_runtime_not_compiled"`. Nothing is bundled, so a
function cannot import a sibling by relative path. All 122 real functions
therefore import their dependencies by absolute published URL, with a nine-hex
id in the path. Those files are served `cache-control: public,
max-age=31536000, immutable` — **never overwritten**; a new version gets a new
id, and the id is hardcoded in every importer. Two generations of the same
module are visible in the app right now: the published `automationAuth` imports
`0d74e64e5_authHelpers.js` while source references `94bd56b50_authHelpers.js`.

So a shared module has two copies, and when they diverge nothing complains. The
source is right, the suite is green, the build is clean, and production runs the
old code.

An early read of this looked like wholesale staleness because I compared file
sizes. It isn't: the publish step rewrites relative specifiers into those URLs,
and a URL is far longer than `'../dbHelpers/entry.ts'`, so a module in perfect
sync reads as hundreds of bytes different. Normalising import specifiers away
before comparing is what turned a vague worry into a three-item list.

### What is actually behind, and what it costs

- **`automationAuth`** — the published copy still does
  `[user.app_role, user.role].some(r => allowedRoles.includes(r))`. That trusts
  `app_role`, an ordinary User field `auth.updateMe` lets the subject write —
  the exact hole `resolveRole` exists to close, live in the three automation
  functions. Source uses `hasRole`, where the platform `role` is the ceiling.
- **`billingHelpers`** — the published `resolveStaffRate` uses `??` chaining, so
  an `hourly_rate` of `0` hides a real `pay_rate` and the shift is costed at
  nothing. It feeds `generateMonthlyInvoices`.
- **`accessScope`** — behind only by `readAccessPolicy` preferring
  `setting_value`. **Harmless**, and deliberately so: the `client_access_policy`
  row carries its modes at the row root too, which is what the published copy
  reads. Report mode is running because of that decision.

I also have to correct something I said when enabling report mode: that
`accessScope` has no `client_representative` branch and `enforce` would cut the
representative off. **`scopeResolver` has that branch, and it is live** — built
on the same reasoning I reached independently for the portal, reading the link
from `RepresentativeInvitation` rather than `User.linked_client_id`, with the
comment explaining that `auth.updateMe` takes arbitrary fields. Enforcement is
less dangerous than I implied; the `staff_view_care_plan` default remains the
real hazard.

### Three blockers, two of them now fixed

1. **No listener.** The platform deploys every `functions/<name>/entry.ts` and
   holds the deployment until something listens; a library exits 0 and the
   deploy is recorded as failed, which is what put all fifteen "on hold" and
   made every file write return their failures. `import.meta.main` is false even
   when the module *is* the deployment, so the obvious guard does nothing. A
   `setTimeout(..., 0)` that tries `Deno.serve` inside a `try` works in both
   directions: an importing function calls `Deno.serve` synchronously at its top
   level, so it binds first and the deferred attempt throws `AddrInUse` and is
   swallowed; deployed alone, nothing else serves and the check passes.
2. **Relative imports.** With the listener fixed the error moved on to
   `unresolved import(s): ../auditTrail/entry.ts`. Rewriting to the URL form
   does fix the deploy — and **broke the test suite**, because Node's ESM loader
   refuses an `https:` specifier (`ERR_UNSUPPORTED_ESM_URL_SCHEME`) and
   `verify:compliance` imports these modules directly. The relative imports were
   never an oversight; they are what makes a shared module testable, which is
   also why `accessScope` is written with no imports at all. On this runtime a
   shared module can be **deployable or testable, not both**. Reverted:
   testable wins, since blocker 3 means deploying ships nothing anyway.
   `accessScope` and `billingHelpers` import nothing, so the shim alone is
   enough and both now deploy cleanly.
3. **Minting the asset — still blocked.** A successful library deploy does not
   republish its asset, and importers still pin the old immutable id. Ruled out
   by trying: `upload_app_asset` refuses `.js`; the assets API is the media
   library and holds only images; `redeploy-function` works for a flat name but
   rejects `shared/x` and `shared%2Fx`, so nested functions are unreachable
   through it.

### The part that matters most

The bug was never the staleness, it was that staleness was **invisible**. So:

```
npm run audit:published
```

fetches each referenced published copy, normalises import specifiers away,
compares the rest byte for byte, and exits non-zero naming the module, the asset
id its importers pin, and the first differing lines. It needs network, so it is
deliberately **not** in `verify:all`, which must run offline. A green
`verify:all` says the source is right; only this says production agrees.

`docs/SHARED_MODULE_DEPLOYS.md` has the full account, every route tried and
ruled out, and the three ways forward: retry Save & Redeploy in the Base44
editor now that blocker 1 is gone (untested from here, and the path that minted
the current ids); ask Base44 to migrate the app off the legacy runtime, which
deletes this whole class of bug; or inline the shared code into each importer,
which needs no asset and has precedent in `npm run sync:billing`.

Along the way: `src/components/utils/billingCore.js` had no trailing newline, so
the extracted region was one line shorter than the copy's and `verify:billing`
reported a phantom drift. Fixed. And a scare worth recording — a HEAD request to
these assets returns 404 while GET returns 200, so an integrity sweep built on
`curl -I` reported two widely-imported modules as missing. Nothing was wrong; a
real Deno import of `accessScope` succeeds. Check with GET.

## The client portal's permissions are configuration now

What a representative sees was a hardcoded table in `portalAccess.js`, keyed on
representative type. It is now three layers, each written only by an admin or a
manager, with later layers winning **per key**:

1. `BUILT_IN_DEFAULTS` in `portalAccess.js` — what the portal did before any of
   this was configurable;
2. the `client_portal_defaults` AppSettings row — per-type defaults, edited on
   the External Access page's new **Portal Settings** tab;
3. `RepresentativeInvitation.portal_permissions` — one named person's override,
   set with **Customise Portal** on their card.

Four things are settable at each level: which sections open, which Overview
details show, whether notes a manager has not released are included, and how
many notes to load.

Per-key merging is the part that makes it usable: an override holding only
`{ unapproved_visit_notes: true }` gives that one person unreleased notes and
leaves everything else following the type, so a later change to the type still
reaches them. The editor's Inherit switches operate on the stored object rather
than the resolved one, so what the switches say is what the merge does.

### Where the settings live, and why

On the invitation, not the User record. `RepresentativeInvitation` is
create/update/delete admin-or-manager, and a representative may read only rows
whose `email` matches their own — platform identity, the one link in the chain
they cannot rewrite. Putting permissions on the User record would hand the
subject their own permissions, which is the whole reason the portal stopped
trusting User fields in the first place. There is a check that a
`portal_permissions` planted on a User record grants nothing.

An admin override may **widen** as well as narrow. That is not a hole: the
narrowing-only rule applies to fields the *subject* writes, and being able to
show one family member the risk assessment without showing all of them is the
point of the feature.

### Enforced where it counts

While this was being built, the portal was rewritten by another agent into
components reading through a new `getClientPortalData` function — a real
improvement, and it adopted the invitation-as-trust-root rule and extended these
checks with a server/browser parity test. That parity check then failed, exactly
as intended, because its tab table and mine had diverged: the server had a
`documents` tab the browser's model did not.

More importantly, that function resolved tabs from its own hardcoded table, so
the settings would have been **decorative** — the browser would hide a section
the server was still sending. So the merge is ported into the function too:
it reads the defaults row, applies the invitation's override, derives the tabs,
the unreleased-notes decision and the note limit from the result, and filters
the optional Overview fields out of the client projection. A field switched off
is now absent from the response rather than hidden in the browser, so it cannot
be read out of the network tab.

Three further things the existing checks caught in the new portal code, all
fixed: `getClientPortalData` read identity with `auth.me()` instead of
`authedUser`, so an offboarded account could still use it; `PortalCarePlan` and
`PortalRiskAssessment` rendered `Client.care_plan` and `Client.risk_assessment`,
flagged fields that would have shown as blanks rather than as withheld — and
which the function never sends, so those branches were dead; and `ClientPortal`
scrolled the window rather than the real scroller.

Also gone: the `ACCESS_LEVELS` prose table, which existed twice — in
`ExternalAccess` and in `ClientRepresentativeManager` — and had drifted in both
copies. One promised CQC inspectors "Compliance Docs"; the other added "Risk
Profile" and "Contact Details". None of the three is a portal section. The
wording now comes from `describePermissions` over the real permissions, so it
cannot say something the portal does not do. Both pages also now take a
representative's type from the invitation rather than from
`user.representative_type`, which the subject can write — it only drove an admin
display, but it meant a manager was shown whatever a representative had last
claimed about themselves.

### Verification

`npm run verify:portal-access` — 51 checks, up from 31. The new ones cover the
three layers merging per key, widening and narrowing, empty overrides,
unknown tab and field ids being dropped, the note limit being clamped rather
than trusted, every-section-off denying instead of rendering an empty shell,
`readPortalDefaults` reading `setting_value` rather than the row root, and six
source invariants that the *function* still resolves from the settings.

Mutation-tested — eleven, all caught: the server back to its hardcoded tab
table; the server deciding unreleased notes from the type; the server sending
every Overview field; the server ignoring the configured note limit; an override
replacing keys it did not name; unknown ids carried through; the limit
unclamped; all-tabs-off rendering empty; `readPortalDefaults` reading the root
only; a User-side `portal_permissions` being trusted; and stored tab order
leaking to the screen.

Two checks needed strengthening before they bit. One asserted
`perms.visit_note_limit` appeared *anywhere* in the function, and a mutation
hardcoding the query back to 500 survived it because the name still appeared in
the response payload — it now reads the query's actual limit argument. The other
was `verify:compliance`'s leaver check, which failed on a **comment** of mine
quoting `auth.me()`; it strips comments now, which is the third time that trap
has been fixed in this project and the first time the fix was applied to the
check rather than the wording.

### One thing I got wrong and corrected

I seeded the defaults row before learning about the `documents` tab, so the
stored row omitted it for every type — which would have *removed* Documents from
every representative the moment the row started being read. Caught by resolving
the live records through the model and comparing against the baseline. The row
now matches the built-in baseline exactly, so creating it changes nothing on
screen, which is what a seeded default should do.

## Inviting a representative no longer invites them as staff

Inviting a family member called `base44.users.inviteUser` immediately. That is
the platform's own staff invitation: it provisions an app account and sends
Base44's generic "you have been invited to Tera Care Hub" email. So a daughter
invited to read her mother's care plan was emailed as though she were joining
the staff team — and when she signed in she landed in the staff app, the rota
and the dashboards, because nothing marked her as external until an admin later
pressed **Link Account**.

The flow is now the one an external reader should get:

1. **Invite** — the request is recorded and *they* get an email about the
   client portal, written for them: who invited them, which service user, what
   the portal is, what they will be able to see, and that access is not live
   yet because a manager reviews every request. **No app account is created**,
   so nothing can mistake them for a colleague.
2. **Approve** — an admin or manager presses **Approve Access** on the pending
   invitation. Only then is an account provisioned, and they are emailed the
   direct portal link.
3. **Sign in** — Layout sees their invitation and sends them to the portal.

Provisioning at approval rather than at invitation is the part that matters: an
account that does not exist cannot be mistaken for a colleague's.

### Ordering, deliberately reversed

Invite records first, then emails — the reverse of the old code, whose comment
said "Send the email first so a failed send doesn't leave an orphaned
invitation." With a tailored email the trade runs the other way. If the email
fails, the admin sees a pending invitation and can resend: visible and
recoverable. If the email went first and the record failed, somebody would be
told they have portal access that nothing in the app knows about, and nobody
would ever see it. Approval provisions first, marks accepted second, emails
last, so a failure to provision never leaves a row claiming access that was
never granted.

### Three things that followed

**Layout decides from the invitation.** It routed on
`user.is_client_representative`, which was only written at link time — which is
exactly why an invited-but-unapproved person saw the staff app. It now asks
whether they hold a `RepresentativeInvitation` of any status; RLS limits that
read to their own email, so for a member of staff it returns nothing. A pending
or suspended person belongs at the portal too, where they are told where they
stand instead of being shown a dashboard. The redirect also covers every path
rather than the five that were hardcoded, because a direct link or a stale tab
put them in the staff app just as surely as signing in did.

**The Active Access list comes from accepted invitations.** It was
`allUsers.filter(u => u.is_client_representative || u.is_cqc_inspector)`, which
meant somebody approved but not yet signed in had no User record and so did not
appear at all — their access existed and was invisible on the page that manages
it. The invitation is the grant, so the invitation is the list; the User record
is joined on where it exists, for the name.

**Suspending writes to the invitation.** The switch wrote
`User.portal_access_enabled`. The portal treats the invitation as authoritative
and the User flag only as something that can *narrow*, so suspending on the
User record alone could be undone by the subject — `auth.updateMe` writes their
own fields — and it did nothing at all for somebody who had never signed in.

`ClientRepresentativeManager` had its own copy of the old invite, which called
`inviteUser` and recorded no invitation at all, so the person it emailed never
appeared anywhere for an admin to approve. It goes through the same module now.

### Verification

`verify:portal-access` — 62 checks, up from 51. The new ones drive the module
over a fake database: that inviting provisions nothing, that the record
survives a failed send, that duplicates are refused, that approving provisions
and marks accepted and emails the link, that an account which already exists is
not a failure, that a failure to provision leaves the invitation pending, and
that the two emails say what they should. Plus source invariants that no page
calls `inviteUser` outside the approval path, that Layout's decision reads the
invitations, and that its redirect is not back to a fixed path list.

Mutation-tested — seven, all caught: provisioning at invite time again; marking
accepted before provisioning; emailing before recording; dropping the duplicate
guard; an invite email that claims access is ready; Layout back on the User
flag; and Layout back to the five hardcoded paths.

Two checks had to be fixed before they bit, both the same failure of my own.
`check` was synchronous, so every async check returned a promise — truthy, and
therefore recorded as passing without the assertion inside ever being awaited.
It collects and awaits them now. And the Layout check matched
`RepresentativeInvitation` anywhere in the file, which a gutted query survived
because the string also appears in the queryKey; it reads the decision body
now. That is twice in two days that a check has agreed with the vocabulary
rather than the mechanism.

## Admin approval: audited first, then strengthened

Asked to confirm approval is still required, I audited every path that could
grant portal access rather than assuming the new flow was airtight.

**It was.** The portal grants on `invitation.status === 'accepted'`, and:

- `RepresentativeInvitation` RLS makes **create and update admin-or-manager**.
  The check is on `user_condition.role`, the *platform* role, which the
  platform grants and a user cannot set on themselves — unlike `app_role`. So a
  representative cannot accept their own invitation.
- Only **one** place in the whole codebase sets `status: 'accepted'` on an
  invitation: `approveRepresentative`.
- **No backend function writes invitations at all.** The three that touch the
  entity (`scopeResolver`, `generateVisitNotePdf`, `getClientPortalData`) only
  read it. A service-role write would bypass RLS entirely and would have been
  a way to approve without being an admin; there isn't one.
- The portal's preview path in `getClientPortalData` is gated on
  `user.role === 'admin'` — the platform role again, not a self-writable field.

What was missing was not enforcement but **accountability and deliberateness**.

### Who approved it

The invitation recorded `accepted_date` and nothing else, so "who let this
family member see this person's records" had no answer. Approval now requires
an approver and records `approved_by_email`, `approved_by_name` and
`approved_at`, and refuses outright if the approver cannot be established —
before any account is provisioned, so a failed check cannot leave a half-made
grant.

That requirement is not itself a security control — RLS is — and the comment in
the code says so, to stop a later reader mistaking a UI-supplied value for a
gate. It is the accountability record.

Every access decision also writes an `AuditLog` entry: approving, revoking,
suspending and restoring, each naming the approver, the representative, the
service user and the invitation. The write is best effort and happens *after*
the grant: a failed log must never leave someone who was approved without
access, which is why the approver is stamped on the invitation as well — the
answer survives even if the log write is lost.

### Approving is now a decision, not a click

It was a single button on a list row. It now opens a confirmation stating
exactly what is being granted: who they are, which service user's records,
which sections they will be able to read (from the live permissions, including
any per-person override), that a sign-in will be created, that they will be
emailed the link, and that the approver's name is recorded. Granting a stranger
sight of someone's care records should take a moment's thought.

### Pinned

`verify:portal-access` — 71 checks, up from 62. The new ones assert the RLS
rules themselves: that create and update stay platform-role checks limited to
admin and manager, that no write rule matches a caller field (which is how
self-approval would appear), that the read rule still matches the caller's
email, that the approver fields stay *declared* (Base44 drops undeclared
properties, so undeclaring one silently loses the audit trail), that approval
refuses an unknown approver without provisioning, that it stamps and audits,
that a failed audit does not undo the grant, that `accepted` is set in exactly
one place, and that no backend function writes invitations.

Mutation-tested — seven, all caught: opening the update rule to any signed-in
user; making the rule match the caller's own email, which is self-approval;
undeclaring `approved_by_email`; dropping the approver requirement; not
stamping the approver; not writing the audit entry; and a second code path that
accepts an invitation.

Two existing checks failed when the contract changed, which is the suite doing
its job — they called `approveRepresentative` without an approver, and now say
so instead of passing.

## End-to-end test of the invite and approval flow — and the bug it found

Ran the real module functions against the real database with a test identity
(`portal-flow-test@example.com`, a reserved domain that delivers nowhere),
stubbing only the two outward-facing calls — the email send and
`base44.users.inviteUser` — so nothing was mailed and no account was created.
Both test records were deleted afterwards.

### What passed

- **Invite provisions nothing.** The payload is recorded as `pending` with the
  email lowercased, and no app account is created. The email reads as a portal
  invitation and says access is not live until a manager approves.
- **Every field survives the write.** The live row came back with all of them
  intact, including `approved_by_email`, `approved_by_name` and `approved_at`
  after approval — the silent-drop failure that has bitten this app four times
  did not happen.
- **Pending grants nothing.** Browser and server both refuse with
  `invitation_not_accepted`.
- **Someone else's invitation grants nothing** — `no_invitation`.
- **A fully forged User record grants nothing.** With
  `is_client_representative`, `is_cqc_inspector`, `representative_type`,
  `linked_client_id`, `portal_access_enabled` and even a `portal_permissions`
  object planted on the User, access was still refused and `clientId` was null.
- **Approved resolves identically in both places.** Browser and server agreed
  on the client, the six tabs, the unreleased-notes decision and the note limit
  — for type defaults, for a per-person override (`overview` only, unreleased
  notes on, limit 3), for suspension, and for revocation.
- **Against the live records**, both real representatives resolve correctly,
  and `info@`'s revoked Joanne row neither grants nor blocks their accepted
  MCCS row.

### What failed, and why the unit checks could not have caught it

**Every audit write would have failed, silently.** The live entity rejected the
entry 422: `AuditLog` requires `user_role`, which the payload omitted, and its
`event_type` is an enum with no `access_control` member. Because the audit
write is deliberately best effort — a failed log must not leave an approved
person without access — it would have swallowed the rejection. Approval would
have worked and the trail I had just described as making it answerable would
have been empty.

The checks passed because they drive approval against a **fake database that
accepts anything**. That is the gap: a double with no schema cannot reject what
the real entity will.

`event_type` is now `role_change`, which is what the enum offers for a change
to what somebody may do, and `user_role` is supplied from the approver.

Three checks now validate the payload `recordApprovalAudit` builds against
`AuditLog`'s own schema file: that it supplies every required field, that every
enum field holds a permitted value, and that it writes nothing undeclared
(which Base44 would drop). Re-introducing the exact bug fails two of them by
name; adding an undeclared field fails the third. The corrected payload was
then written to the live entity successfully, metadata intact.

### Still not tested

Email delivery and `base44.users.inviteUser` were stubbed, so the one thing
that remains unproven is whether an approved person can complete sign-in from
the provisioned account. That needs a real mailbox. Everything up to and
including the grant, and everything the portal does with it, is now exercised
against the live database.

Also worth knowing: the two invitations already accepted in the app have
`approved_by_email` null, because they were approved before the approver fields
existed. Not a fault — just history that cannot be reconstructed.

## Representative cards, and a real way to take access away

### The layout

The card put a fixed-width column of buttons beside the details with
`justify-between`. On a phone that column took most of the width, so three
things went wrong at once: the email ran underneath the buttons, the "Can see"
badges had so little room that each landed on its own line, and the avatar
indented every line below it so nothing shared a left margin.

Now there is one left edge. A header row carries the avatar, name, email and
status badges; the service user and relationship sit below it as a small
definition list aligned to the card's own edge rather than the avatar's; the
permissions block is full width, so the badges wrap across it as they were
meant to. The actions moved to their own row under a divider, two by two, and
return to a column beside the card at `sm` where there is room.

### Revoke and delete

There was only a suspend toggle and, for pending invitations, revoke. Now both
withdrawal paths exist as distinct decisions, because they have different
consequences:

- **Revoke** — ends access and keeps the record. Reversible by approving again.
- **Delete** — erases the record, for an erasure request. Not reversible, and
  gated on typing DELETE.

Both take an optional reason, which goes to the audit log and deliberately not
into the email: the reason is for the care team, not for whoever can read that
inbox.

**The ordering is the substance, and it is not the obvious one.**

1. **Audit first**, to a different entity, so the decision survives the record
   it describes being deleted.
2. **Close the sign-in**, by setting `User.status`. This is what actually ends
   a live session: `accessDenialReason` in `shared/accountStatus` refuses any
   account whose status is `inactive` or `archived`, and `authedUser` applies
   that on all 121 functions that share it. Revoke uses `inactive`, delete uses
   `archived`.
3. **Withdraw the grant** on the invitation, so a failure between here and the
   delete leaves access closed rather than open.
4. **Delete the record**, and email last, because a failed send must not leave
   access open.

Closing the sign-in before deleting is not tidiness. Portal access comes from
the invitation, and Layout decides who is an external reader the same way.
Delete the invitation while the login still works and the next sign-in finds
an app with no idea they are external — it would show them the **staff shell**.
So delete refuses outright if it cannot close the account, rather than leaving
a working login with nothing behind it.

### Verification

`verify:portal-access` — 84 checks, up from 74. The new ones drive both paths
over a database double that records the *order* of operations: that revoking
keeps the record and delete removes it, that the audit entry precedes any
change in both, that deleting closes the sign-in before removing the record,
that it refuses when it cannot, that a failed delete still leaves access
withdrawn, that neither runs without someone recorded as responsible, that a
representative with no account can still be removed, that the email does not
say why, and that the page gates deletion on typing the word.

Mutation-tested — six, all caught: deleting before closing the sign-in;
auditing after the change; refusing to refuse when the account cannot be
closed; dropping the responsible-party requirement; revoke deleting the record;
and closing the account with a status that does not block sign-in.

That last one survived at first. The check compared the written status to
`REMOVED_USER_STATUS` — the same constant that produced it — so changing the
constant to `on_leave` passed while letting the person straight back in. It now
parses `REVOKED_STATUSES` out of `shared/accountStatus` and asserts membership
of that. Third time this session a check has agreed with the vocabulary instead
of the mechanism; the shape of the mistake is always the same, comparing a
result against the thing that produced it.

## The download menu was off the side of the screen

The visit-note download sheet rendered half off the right edge, its options cut
to "Download to de…" and "Open in new ta…".

It was not a width problem, and the `max-w-[calc(100vw-16px)]` already on it
could never have helped. `dropdown-menu.jsx` renders a bottom sheet on mobile
with `position: fixed; bottom/left/right: 0`, which reads as "pin me to the
viewport" — but Radix wraps dropdown content in
`[data-radix-popper-content-wrapper]`, positioned at the trigger with a
`transform: translate(x, y)`. **A transformed ancestor becomes the containing
block for its fixed-position descendants**, so those zeroes resolved against a
wrapper parked over the download button near the right-hand edge, not against
the screen.

Measured in a real browser at 390px wide, reproducing the wrapper and the
sheet: the sheet was laid out at **x=286, width 192, right edge 478** — 88px
past the edge of the screen, which is precisely the two truncated labels. With
the fix: **x=0, width 390, flush to the bottom**.

The wrapper is created by Radix and accepts neither `className` nor `style`
from the call site, so it has to be reached by selector. `index.css` now
neutralises it, scoped with `:has()` to wrappers that actually contain one of
our sheets so ordinary desktop dropdowns are untouched:

```css
[data-radix-popper-content-wrapper]:has(> .mobile-action-sheet) {
  position: fixed !important; inset: 0 !important;
  transform: none !important; min-width: 0 !important;
  pointer-events: none !important;
}
```

`pointer-events` matters: stretching the wrapper over the whole viewport would
otherwise cover the dimmed backdrop and stop taps closing the sheet, so the
wrapper passes them through and the sheet takes them back. There is an
`@supports not selector(:has(*))` fallback that centres the sheet instead —
still wholly on screen, just not flush to the bottom.

This fixes every mobile dropdown in the app, not only this one, since they all
go through the same component.

### Verification

Checked in a browser rather than by reasoning: `fixed.png` in the scratchpad,
and the before/after measurements above. `verify:app-scroll` is now 25 checks,
with four pinning the mechanism — that the sheet keeps the class the stylesheet
targets, that the rule still removes the transform, that the backdrop stays
tappable, and that the no-`:has()` fallback survives.

Mutation-tested — four, all caught. One survived at first: deleting the class
from the code still passed, because the class name also appears in the comment
explaining the rule. The check strips comments now. That is the fourth time
this session, and this one was written minutes after I documented the same
trap — the lesson evidently needs to live in the checks, not in my memory.
