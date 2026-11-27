# UK date formats: the mapping to apply to `FORMAT_MAP`

Written while the Base44 connector was down, so that the change is one pass once
the app source is reachable. The table below is the substance of the change; the
file edit is mechanical. Nothing here has been applied yet.

Target: `src/components/utils/dateHelpers.jsx`, the `FORMAT_MAP` consulted by
`safeFormat(date, formatStr, fallback)`.

## Rewrite these

Day-before-month, and 24-hour clock. date-fns tokens.

| US-ordered | UK |
| --- | --- |
| `MM/dd/yyyy` | `dd/MM/yyyy` |
| `M/d/yyyy` | `d/M/yyyy` |
| `MM/dd/yy` | `dd/MM/yy` |
| `M/d/yy` | `d/M/yy` |
| `MM-dd-yyyy` | `dd-MM-yyyy` |
| `MM.dd.yyyy` | `dd.MM.yyyy` |
| `MMM d, yyyy` | `d MMM yyyy` |
| `MMMM d, yyyy` | `d MMMM yyyy` |
| `MMM do, yyyy` | `do MMM yyyy` |
| `MMM d` | `d MMM` |
| `MMMM d` | `d MMMM` |
| `EEE, MMM d` | `EEE d MMM` |
| `EEEE, MMMM d, yyyy` | `EEEE d MMMM yyyy` |
| `h:mm a` | `HH:mm` |
| `h:mma` | `HH:mm` |
| `hh:mm a` | `HH:mm` |
| `h:mm:ss a` | `HH:mm:ss` |
| `MM/dd/yyyy h:mm a` | `dd/MM/yyyy HH:mm` |
| `MMM d, yyyy h:mm a` | `d MMM yyyy HH:mm` |

The month-name rows are the likely gap. The existing map was described as
handling "US-style" formats, which reads as the slash forms — but
`MMM d, yyyy` is just as US-ordered and does not contain a slash, so it would
pass straight through. Confirm against the call-site inventory before assuming
which rows are new.

## Do not rewrite these

Rewriting any of these breaks something that is not a date on a screen:

- `yyyy-MM-dd` — ISO. Used for query keys, API filter values,
  `<input type="date">` values, export filenames and sort keys. Reordering it
  changes identity, not presentation. This is the one that will cause damage if
  the change is applied as a blanket find-and-replace.
- `yyyy-MM-dd'T'HH:mm`, `HH:mm`, `HH:mm:ss` — already 24-hour and already ISO.
- `yyyy`, `yyyy-MM`, `MM`, `dd`, `EEEE`, `MMMM` — single fragments with no
  ordering to get wrong.

So the map must be an allowlist of rewrites, never a pattern that reorders
anything month-first. A test that asserts `yyyy-MM-dd` comes back **unchanged**
is as important as the ones asserting a rewrite happens.

## The map only reaches `safeFormat`

A corrected `FORMAT_MAP` changes the ~15 sites that call `safeFormat`. The other
275 raw `format(new Date(...))` calls across 105 files bypass it completely, so
they keep rendering US order *and* keep the `RangeError` crash that took out the
Visit Notes page. The map fix and that sweep are one job: routing a call site
through `safeFormat` is what makes the map apply to it.

Order of work: inventory first (every distinct format string with its call-site
count and whether it feeds a screen, a filename or an API), then extend the map,
then sweep the raw calls onto `safeFormat`. The inventory is what decides the
ambiguous `yyyy-MM-dd` sites, and it is cheap — one grep.

## Verification

`scripts/verify-date-formats.mjs`, in the established shape: import the map,
assert each row maps as the table says, assert every do-not-rewrite entry is
absent from the map's keys, and assert no map value contains a month token
before a day token.

Mutation tests that must fail the suite:

1. Delete a month-name row from the map — the US order survives.
2. Add `yyyy-MM-dd` to the map — filenames and query keys silently change shape.
3. Make the lookup return its input unchanged — the map becomes decorative.
4. Point a value at a 12-hour pattern — `HH` reverts to `h ... a`.

Check the checks have teeth: a first-draft assertion that merely looks for the
string `dd` in a value passes mutation 1, because `dd/MM/yyyy` elsewhere in the
map still contains it. Assert per-row, on the exact value.

## Adjacent, and not in scope unless asked

Clock times are stored as naive strings in places — `"2026-09-29T08:00"` with no
zone. `new Date()` reads those as the viewer's local time, while a value with a
trailing `Z` is read as UTC and renders an hour out during BST. For clock-in and
clock-out, which feed payroll, that is a correctness question rather than a
presentation one, and changing `FORMAT_MAP` neither fixes nor worsens it. Worth
a separate look.
