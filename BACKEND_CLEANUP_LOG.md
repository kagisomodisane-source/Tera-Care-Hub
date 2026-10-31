# Backend Dead Code Cleanup — Reversal Log

**Date:** 2026-08-04
**App:** Wellstride (`69040627bd655b21c40f3ecd`)
**Scope:** `base44/functions/` only. No frontend files, no entity schemas, no data.

## Rollback points

| | Base44 checkpoint | Git commit |
|---|---|---|
| **Before cleanup** | `6a7047eb173bd8bf8a9dec07` | `f64aa9dcd8cb68e0b04499be3a12e2d893fbab2f` |
| **After cleanup** | `6a71903ea07483f6d7f28128` | `88fe8bde713861c890de6962ec7351e8c9b3a409` |

**Full rollback:** restore Base44 checkpoint `6a7047eb173bd8bf8a9dec07`. That reverses every item below in one step.

**Partial rollback:** each item below includes the exact removed code — paste it back into the named file. Items are independent; reverting one does not require reverting any other.

## Verification performed

- All **149** backend functions parsed with esbuild after the changes (0 failures).
- Every removed symbol was confirmed to have exactly **one** occurrence in its file (the definition itself) before removal — i.e. it was referenced nowhere.
- `formatDate` in `generateTrainingCertificate` was **deliberately kept** (3 occurrences — it is used); only the identically-named unused copy in `generateFormPdf` was removed.

## What was NOT touched, and why

- **50 functions have no code reference anywhere.** These are scheduled (cron), webhook, and entity-event functions — e.g. `resetAnnualLeave`, `trainingComplianceDailyCheck`, `archiveCompletedTasks`, `notifyNewChatMessage`, `validateShiftIntegrity`. Their triggers live in Base44 configuration, not in code, so "unreferenced" does **not** mean unused. **None were deleted.**
- **`notifyDocumentUpdates`** has a local `buildDocumentUpdateNotifications` that duplicates `shared/documentNotificationHelpers`, but it *is* called (twice) and the signatures differ. Deduping needs behavioural verification, so it was left alone.
- Two previously-reported redundancy findings (`generateCarePlanPdf`, `generateRiskAssessmentPdf` inlining `buildSimpleMarkdownPDF`/`uploadMarkdownPDF`) are **stale** — those functions have since been rewritten to use jsPDF directly and no longer contain the duplicated helpers. No action needed.

---

# Removed items (12)

## 1. `base44/functions/contentScheduler/entry.ts` — unused import

```ts
import { format } from 'npm:date-fns@3.6.0';
```

Re-insert as line 2. (`format(` appeared 0 times in the file.)

## 2. `base44/functions/generateFormPdf/entry.ts` — `LOGO_URL`

```ts
const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69040627bd655b21c40f3ecd/f218a2b1a_3279BDDD-C924-488D-AB23-07EDEFDF9175.png";
```

## 3. `base44/functions/generateFormPdf/entry.ts` — `blobToBase64`

```ts
async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

## 4. `base44/functions/generateFormPdf/entry.ts` — `formatDate`

```ts
function formatDate(dateString, format = 'short') {
  if (!dateString) return '';
  const date = new Date(dateString);
  
  if (format === 'long') {
    return date.toLocaleDateString('en-GB', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  }
  
  const day = date.getDate();
  const month = date.toLocaleString('en-GB', { month: 'short' });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}
```

## 5. `base44/functions/generateInvoicePdf/entry.ts` — `formatDateTime`

```ts
function formatDateTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
```

Sat immediately above `class PDFDocument`.

## 6. `base44/functions/generateTrainingCertificate/entry.ts` — `LOGO_URL`

```ts
const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69040627bd655b21c40f3ecd/f218a2b1a_3279BDDD-C924-488D-AB23-07EDEFDF9175.png";
```

## 7. `base44/functions/generateTrainingCertificate/entry.ts` — `blobToBase64`

```ts
async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

## 8. `base44/functions/generateTrainingCertificate/entry.ts` — `formatDateTime`

```ts
function formatDateTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-GB', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
```

## 9. `base44/functions/getShiftColleagues/entry.ts` — `MAX_MY_SHIFTS`

```ts
const MAX_MY_SHIFTS = 1000;
```

Re-insert between `MAX_REQUESTED_SHIFTS` and `MAX_RELATED_SHIFTS` (both of which are used and were left in place).

## 10. `base44/functions/sendMondayMotivation/entry.ts` — inline helper deduped

**Removed:**

```ts
const sendNotificationsWithPreferences = async (base44, notifications) => {
  if (!notifications?.length) return;
  await base44.asServiceRole.functions.invoke('notificationService', { notifications });
};
```

**Replaced with:**

```ts
import { sendNotificationsWithPreferences } from '../shared/notificationHelpers/entry.ts';
```

⚠️ **This is the only item with a behaviour delta.** The shared version additionally filters out notifications missing `recipient_email` (logging a warning) and returns `{ success, sent, skipped }`. The call site does `await sendNotificationsWithPreferences(...)` without using the return value, so the only practical change is the added validation. To revert, delete the import and paste the inline const back at line 2.

## 11. `base44/functions/sendUrgentFormNotification/entry.ts` — inline helper deduped

Identical change to item 10 — same removed code, same replacement import, same caveat.

## 12. `base44/functions/pdfProbe/` — whole function deleted

A development scratch endpoint. It generated a PDF containing the literal text `Hello probe` and uploaded it as service role, with **no authentication check** — meaning any caller could make it write files to storage. It was referenced nowhere and pinned to different SDK/jsPDF versions (`0.8.40` / `jspdf@4.0.0`) than the rest of the backend.

To restore, recreate `base44/functions/pdfProbe/entry.ts` with:

```ts
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  const steps = [];
  try {
    const base44 = createClientFromRequest(req);
    steps.push('client');
    const doc = new jsPDF();
    steps.push('constructed');
    doc.text('Hello probe', 20, 20);
    steps.push('text');
    const bytes = doc.output('arraybuffer');
    steps.push('arraybuffer:' + bytes.byteLength);
    const file = new File([bytes], 'probe.pdf', { type: 'application/pdf' });
    steps.push('file');
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    steps.push('uploaded');
    return Response.json({ steps, file_url });
  } catch (error) {
    return Response.json({ steps, error: error.message }, { status: 500 });
  }
});
```

---

## Totals

| Category | Items | Lines removed |
|---|---|---|
| Unused imports | 1 | 1 |
| Unused constants | 3 | 3 |
| Unused functions | 5 | 49 |
| Deduped inline helpers | 2 | 8 |
| Deleted dev artifact | 1 | 23 |
| **Total** | **12** | **~84** |
