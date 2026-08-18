## Linking a service user as a resident of an organisation (Base44 checkpoint 6a83aafddc184d8fb0434288)

**New**: `src/components/clients/residencyMapping.js`, `residencyTransfer.js`, `ClientResidencyPanel.jsx`, `scripts/verify-residency-mapping.mjs`
**Changed**: `ResidentManager.jsx`, `LocationManager.jsx`, `ClientCard.jsx`, `ClientProfile.jsx`, `package.json`, Client entity schema

### What was there before

Three records describe the same person: the **Client** (the service user), the **ClientLocation** (the site), and the **Resident** (the rich care profile held at the site). The only thing joining them was a bare `client_id` dropped into `ClientLocation.residents[]`.

`Resident.linked_client_id` existed in the schema and **nothing in the codebase read or wrote it**. So linking someone as a resident changed nothing about them: their Client record still carried their old home address, geofenced clock-in still checked the old coordinates, their care information stayed behind, and there was no way to undo it because nothing had been recorded.

### Linking now moves the person

`linkClientAsResident()` performs a real transfer:

- Creates the **Resident profile at the location**, populated from the service user — care plan, risk assessment, conditions, allergies, medications (with their administration protocol), dietary, communication, mobility, cultural, behavioural and advance-care details, plus emergency contacts.
- Points the Client's **service-delivery fields at the site** — address, postcode, latitude, longitude, access details — so staff are routed correctly and geofenced clock-in checks the right place.
- Adds them to the location's `residents[]`, which the visit-note and shift screens read.
- **Snapshots the values the site takes over** before overwriting them, and appends to an audit trail in `client.residency.history`.

The two entities disagree about shape — the Client keeps free text (`"Type 2 diabetes; early vascular dementia"`), the Resident keeps structured arrays. Fields with a clean equivalent are mapped; the five with no honest slot (care instructions, likes/dislikes, routine, medical history, funding notes) go into the resident's notes under a clear heading rather than being forced into a field that means something else. Personal details — phone, emergency contact — are deliberately **not** transferred: living at a site does not change who to call.

### Reversal keeps what was gathered

`revertToStandalone()` restores the snapshotted address and coordinates exactly, then carries the residency back with the person: care-plan and risk-assessment updates, conditions and medications added at the location, and contacts recorded there. Where the client's own value and the residency's differ, **both are kept** and the residency's is labelled with where it came from — nothing is silently overwritten in either direction. The Resident profile is **discharged, not deleted**, so the history survives and a re-link picks the same record back up. An optional "keep the location's address" covers someone staying put while served under their own arrangement.

### Verified, not asserted

The mapping is pure and import-free, so `npm run verify:residency` exercises the full standalone → resident → standalone round trip in plain node — 47 checks covering every transferred field, the merge-back, the address round trip and edge cases.

A green suite that cannot go red is worthless, so I mutation-tested it. Four deliberate breaks — merge dropping the client's existing value, unstructured fields never transferring, re-linking overwriting a care plan updated at the location, and contacts added at the location being dropped — each fail with the check naming the broken behaviour.

### A data-loss bug found on the way

Entity `update()` is `axios.put` — a **full replace** — and both location writes sent partial payloads. `LocationManager`'s edit form carries 15 of the location's ~35 fields, and `ResidentManager` sent only `{residents, current_residents}`. So editing a location would drop its resident list, contacts, WiFi, operating hours and safety notes, and blank the required `parent_client_id`. Since residents live on that record, the residency link could not survive an ordinary location edit. Both call sites now spread the existing record.

Also fixed: "Enable Care Planning" on a name-only resident created a Client with a comment reading *"link to parent organisation if schema allows, but loose coupling is fine"* and no link at all. It now routes through the same transfer.

### UI

A residency panel on the client profile shows whether someone is standalone or a resident, with links to the organisation, location and resident profile, and the history. Both directions state plainly what moves and what is retained before you commit. The location's resident manager performs the real move when a service user is selected, and removing a genuine resident offers the reversal instead of silently dropping the row. Client cards carry a resident badge naming the location.

**Schema**: one `residency` object added to Client (status, org/location ids and names, resident record id, room, support level, key worker, start date, snapshot, history). Verified as additions only — all 57 existing fields and the RLS rules intact. Resident needed no change; its existing `linked_client_id`, `status: discharged` and `admission_date` carry the link.

Verified: `vite build` clean; `npm run verify:residency` 47/47; `npm run audit:query-keys` clean; eslint clean on all new and changed files.

