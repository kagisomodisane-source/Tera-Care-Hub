## The notification backlog, badges and orphans (Base44 checkpoint 6a852aa6d8b7fd2e60b1cbbc)

**Changed**: `sendOnboardingReminders`, `cleanupNotificationBacklog`, `cleanupOrphanedShifts`, `shared/notificationHelpers`, `useBadgeCounts.jsx`

Archiving was never the problem. Zero notifications older than the 14-day cutoff are unarchived, so the sweep is keeping up. The backlog is inflow.

### Notifications: duplicates multiplied by manager fan-out

285 unread `review_required` notifications, from **13 distinct underlying situations**.

`sendOnboardingReminders` created a fresh notification on every run for conditions that persist — tasks still overdue tomorrow — with no check for an existing unread one. That produced 33 separate "Overdue Onboarding Tasks" notifications in eight days. `cleanupNotificationBacklog`, the function meant to clear the backlog, then escalated every high-priority item to every manager: 33 sources × 3 managers = **101 escalations from one recurring condition**. The same shape gave 55 for "New Shift Assigned" and 44 for "Critical Visit Note".

The escalations are created `action_required: true`, so the 14-day informational sweep skips them and they only archive after 30 days. Inflow beat cleanup roughly three to one.

`createNotificationIfAbsent` in the shared helpers now skips creation when the recipient already has an unread notification of the same type and title. Both `sendOnboardingReminders` sites and the escalation loop use it. Once the recipient reads or archives it, a later run may raise it again — a still-overdue task should resurface after being acknowledged and ignored, so this suppresses repetition rather than the alert itself.

It dedupes on (recipient, type, title) because these reminders carry no `related_entity_id` and the title is what repeats. The lookup filters on one field and narrows in JS, so it behaves the same whichever way the SDK handles multi-field queries — still unsettled.

### Orphans: the sweep only ever saw one page

```js
const shifts = await serviceDb(base44).Shift.list();   // no limit
```

No limit means one server-default page. There are more than a thousand shifts — confirmed by paging to offset 1000 — so the job inspected a fraction and never found orphans outside it. Its sibling `cleanupDeletedShiftReferences` already passes `10000`, so someone hit this once and fixed it in only one place. Shifts, clients and users are now paged until the source is exhausted.

### Badges: counted over a window

`useBadgeCounts` narrowed `read` in JS over the newest 500 notifications per user, which under-counts as soon as an account holds more than that: unread ones get pushed out of the window by newer read ones and the badge quietly drops. The previous comment already predicted this. It now pages until a short page comes back.

That is correct whichever way compound filters behave. If that question is ever settled in favour of them, this collapses to a single `filter({ recipient_email, read: false, archived: false })`, and the comment says so.

### Effect

Nothing is deleted, and the existing 466 unread notifications stay. What changes is the rate: a persisting condition now produces one notification per recipient until it is dealt with, instead of one per scheduled run multiplied by the number of managers. The standing backlog drains through the existing 30-day sweep.

Verified: all 142 backend functions bundle, including the four changed; `vite build` clean; `verify:db`, `verify:recurrence`, `verify:residency`, `audit:query-keys`, `audit:query-init` all pass; lint unchanged at 928 pre-existing errors.

