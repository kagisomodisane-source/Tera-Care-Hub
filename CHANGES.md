## Calendar revenue counted days outside the month (Base44 checkpoint 6a917e922da7197aeb07cd1d)

**Changed**: `src/components/shifts/ShiftCalendarView.jsx`

### The month total was never a month

`calendarDays` is the drawing grid, and in month view it runs from the Monday before the 1st to the Sunday after the last day:

```js
const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
const end   = endOfWeek(endOfMonth(currentDate),   { weekStartsOn: 1 });
```

All three summary figures reduced over that grid while the label said "Monthly". Those leading and trailing cells hold real shifts from the neighbouring months, and they were being billed into the total:

| Month | Grid | In month | Also counted | Overstated by |
|---|---|---|---|---|
| August 2026 | 27 Jul – 6 Sep | 31 | 11 | **+35%** |
| September 2026 | 31 Aug – 4 Oct | 30 | 5 | +17% |
| February 2026 | 26 Jan – 1 Mar | 28 | 7 | +25% |
| November 2026 | 26 Oct – 6 Dec | 30 | 12 | **+40%** |

Between a third and two fifths too high in a bad month, and it moved with the calendar rather than staying constant, which is what makes it hard to spot as a systematic error.

The same grid drove the hours and payroll-cost figures, so those were wrong by the same days.

### The fix

A `summaryDays` list holds the days the label actually refers to — the grid in day and week view, where the two already agree, and only the in-month days in month view. The three totals reduce over that.

The grid still renders the adjacent-month cells; nothing changes visually. Only the totals stopped counting them.

The variables were also named `weekRevenue`, `weekTotalHours` and `weekPayrollCost` while serving all three view modes, which is how a month total ended up quietly summing a week-aligned grid. They are now `periodRevenue`, `periodTotalHours` and `periodPayrollCost`.

### What was not wrong

The billing itself is sound, and was checked before changing anything. `resolveShiftBilling` prices a combined team shift once from its first member — one client, one window, one rate — while `getShiftPayrollCost` deliberately sums across the team, which is the correct asymmetry. Team shifts are grouped before any total is taken, so there is no double counting. Cancelled shifts were already excluded.

Verified: month-grid arithmetic checked against date-fns for four months spanning both 35-day and 42-day grids; `vite build` clean; `verify:db`, `verify:recurrence`, `audit:query-keys`, `audit:query-init` pass; the one lint error in the file is the pre-existing unused React import.

