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
