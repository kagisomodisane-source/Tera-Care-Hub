# Shift Duration Anomaly Cleanup — Reversal Log

**Date:** 2026-08-11
**App:** Wellstride (`69040627bd655b21c40f3ecd`)
**Scope:** `Shift.duration_minutes` only. No other field, entity, or code touched by the data change.
**Records changed:** 66

## What was done

`duration_minutes` (the clocked/actual duration) was **cleared** — `$unset`, leaving the field absent — on 66 shift records whose value could not be true. Nothing was backfilled.

**Why cleared rather than corrected:** every one of these shifts has a valid `start_datetime`/`end_datetime` window, so a "plausible" value could have been written in. That was deliberately not done. `duration_minutes` means *time staff actually worked*; setting it equal to the scheduled window asserts that staff worked exactly as planned, which is evidence this system does not have. In a care compliance record, absent is honest and invented is not.

**Financial impact: none.** Billing resolves hours from `scheduled_duration_minutes` first (see `shared/billingHelpers`), so these values were already excluded from invoicing. Verified by replaying all 392 completed July 2026 shifts through `resolveShiftBilling` before and after — per-client and total revenue identical to the penny (£19,091.70).

## Rollback

| | Base44 checkpoint |
|---|---|
| **Before cleanup** | `6a7a570bd732b9c2793fb6d7` |

Checkpoints restore code, not entity records. To restore these values, re-apply the per-record values below.

---

## Group 1 — corrupt negative duration (1 record)

| Shift id | Client | Date | Visit type | Old `duration_minutes` |
|---|---|---|---|---|
| `6a49139f9cdb87a9a2fa1a0e` | MimarCare Ltd | 2026-07-09 | personal_care | **-1065224054** |

Roughly minus 2,026 years. This single record would have produced a **-£301,808,427.30** invoice line under the pre-fix invoicing code, which read `duration_minutes` first.

## Group 2 — zero duration on completed shifts (63 records)

All had `duration_minutes: 0`. A shift marked `completed` with zero minutes worked is definitionally broken. To revert, set `duration_minutes: 0` on:

```
6a5b8a084d46e29eaf167cdc  6a549dffda9f3c0c3a4c28a7  6a3b6534f03fdec8edc2e1f1
6a37cf4d1ee6c147439a0fb9  6a2dd68926be20e930e8cade  69f5c8da270323c86fa18bea
69f5c8da270323c86fa18bd7  69bff045d4a8c205eebeae5f  69639cdbca738a905fb834d3
69639ca53b02a3c08d379af1  696225c2458fa74bd4546482  696021c594b42f7c3a17fe37
69602105022bd019368e9b47  695ff65e1e6c7454beb06b0e  6957ca8b2b7769d5f989a685
6957c67c6eeb45c733eefabd  6957c37d41014efc435a29b4  6953a68e1af86f7a300cd668
694e914fb54793b5edff95e4  694e911eaaca841abe07287f  694e9064f6263d172a951811
694e9033667321458b2b844e  694e9033231bbf1b21bcde42  694e8d40d43ebf3ccc2e9376
6948e1b32cc9a62bc47b9449  6946809b949b1d337b97a9dd  6946809a787320b1e2f92912
69467e56c25aa6aaf8db6209  69467dd119bddf0f79dd77a2  69467d4b897a3622fc67c9f3
69467d4ba6fb6d2f537de1ac  69467d159bb5f3b302c2b51c  69467c311fee6dda36e8085a
69467bddbfcf90f80ddab8d0  69467b3bf9ccc37762cd8992  69467afe7523a40290dc37c6
693f128a16fd97fbadeecc41  693f0c9d68f63c1ee6f8c17b  693f0ab7838a138b71d42117
693f07a7691d7f8e4774ff63  69381ec44b3c2629c27bb07c  69381e5f4300d44fec90290b
69345b94708bd2d32573f6d7  69344fa9370fa95e898ee751  69344c270c74adbd999b67b9
69344b5522cd8fb990d94dfc  69344ae4c8549869e5c51548  693448f88a0f178d1bd808b4
6934474d79fd44d510d8d94a  69301efe60fd6697b9bcede0  6927f869610dab175bb14e6f
6923168bf9a02037327119d2  692315b4d4a03e8eb7275df9  6923140fddfb8c8070b0ca2b
6923124479b7bbc5b2785b71  6921c9ed6603ba24caf93221  69206df5ad0cc02fa72148bb
691afb1edc644477e7f78d8d  69188d8fa88f55c316115367  69188d8ffa3f6f4dd2d7385b
69188d8fffe6b4ae38889abe  69188d8f76ae89d53684bbd3  691885fbe1d3e7e57bc9c2d4
```

Spread across Joanne Clitheroe, Thera East Anglia, Mencap/Mancap, Joan Temple, from 2025-11-15 to 2026-07-26.

## Group 3 — implausible durations (2 records)

| Shift id | Client | Date | Visit type | Old value | Scheduled window |
|---|---|---|---|---|---|
| `6a568ff3ae0f213863a6a4d4` | Joanne Clitheroe | 2026-07-14 | health_wellbeing_monitoring | **1620** min (27 h) | 19:59–22:59 (180 min) |
| `6a4a6803f8ad96b2c3dd54cf` | MimarCare Ltd | 2026-07-13 | personal_care | **2287** min (38.1 h) | 06:00–20:00 (840 min) |

Neither is a live-in visit, so neither can plausibly be a single continuous visit of that length. Both look like a missed clock-out closed by a later event.

**These two are the only judgement calls in this cleanup** — the other 64 are unambiguously broken. Worth confirming with Rosemary Chimombegweshe and Faith Namuyomba respectively if the actual hours matter for anything. Neither fed the cost display (which uses scheduled), so no pay figure changed.

---

## Deliberately NOT changed

**1 cancelled shift with `duration_minutes: 0`** — `6a3a1950947c1c991da1ee02` (Joanne Clitheroe, 2026-07-04, personal_care). Zero minutes worked on a cancelled visit is a legitimate value, not an anomaly.

**Shifts where the clocked time simply overran the plan.** 179 of Joanne Clitheroe's July shifts recorded longer than scheduled — 30-minute calls running 60–75 minutes. These are almost certainly real: staff stayed longer. Overwriting them would destroy genuine timesheet evidence. They remain flagged by `auditClientBillingRates` as `duration_anomalies` for review, and they are the reason invoicing bills scheduled rather than clocked time by default.

## Code change made alongside

`base44/functions/auditClientBillingRates/entry.ts` — `Number(null)` evaluates to `0`, so the corrupt-value test treated a *missing* duration as a corrupt zero. Left unfixed, the audit would have re-reported all 66 just-cleared shifts as anomalies. It now distinguishes absent from zero.
