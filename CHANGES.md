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

