## Handover alerts had no summary to show (Base44 checkpoint 6a852f6211dd465525137105)

**Changed**: `base44/functions/getHandoverAlerts/entry.ts`, `src/components/dashboard/HandoverAlerts.jsx`

### Not a regression from today, as far as the evidence goes

Reported as "no longer showing summaries", and today's work touched both the backend function and a great deal else, so that was checked first. My change to `getHandoverAlerts` was a single-line rename with identical arguments, and the function has only two commits in its history — the other predates this work by a fortnight.

The data does not support a recent break either:

- `ai_summary` is populated on **every** active visit note, right through to the most recent one.
- `concerns` is empty on most notes and always has been — back through 12 August, it is filled only when there is genuinely something to escalate.
- `observations` is frequently blank or still holds the literal string "(Draft in progress)".

So nothing stopped being generated. I could not reproduce a point where this worked and then didn't, and I am not going to claim a regression I cannot substantiate.

### What is actually wrong

`getHandoverAlerts` builds its response from an explicit field whitelist, and `ai_summary` was never in it. The alert card's only free-text line was `note.concerns`, which is blank on most notes.

The result is a card carrying a severity badge, a client name and flag icons — but nothing saying what happened on the visit. The app writes a good one-line account of every visit and then drops it on the floor one layer before it reaches the screen. On a card whose whole purpose is telling the next carer what they are walking into, that is the part that matters.

### The fix

`ai_summary` is returned by the function and rendered in both places: as the card's summary line, and as a "Summary" section at the top of the detail dialog. `concerns` stays exactly where it was, still italicised behind a red rule, because when it is present it is an escalation rather than a description — the two say different things and the card now shows both.

Note the backend write again reported "Revision ... failed" while landing on disk and committing correctly, as it has all session. Worth confirming the summary line appears.

Verified: `getHandoverAlerts` bundles; `vite build` clean; `verify:db`, `audit:query-keys`, `audit:query-init` pass.

