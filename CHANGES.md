## The initialData trap, cleared app-wide (Base44 checkpoint 6a83dc1665c0568053f1e660)

**Changed**: 28 files, 42 queries. **New**: `scripts/audit-query-initial-data.mjs`

This is the bug that made the organisation picker list nothing, applied to every other place it was set. `initialData` writes its value into the cache stamped fresh as of now. A query that mounts with `enabled: false` fetches nothing; when the gate opens, React Query sees data still fresh under the app's global `staleTime` of two minutes and skips the fetch. The queryFn never runs — no error, no spinner, just an empty list.

Neither escape hatch applies. `refetchOnMount: 'always'` doesn't fire because enabling an existing observer is not a mount, and the query key changing at the same moment doesn't help either — verified directly against the app's real QueryClient defaults:

```
static key + enabled flip        fetches: 0   rows: 0
key changes as it enables        fetches: 0   rows: 0
```

That second line matters, because `enabled: !!user` paired with `queryKey: [..., user?.email]` is the shape of nearly every "my …" page in this app — My Timesheets, My Payslips, My Leave Requests, My Forms, My Mileage Claims, My Compliance, Shift Swaps, Policy Management — plus every dialog gated on `open`.

### What changed

All 42 `enabled` + `initialData` pairs had the `initialData` removed. Where a site had no destructuring default, one was added so `data` is never `undefined` — 14 needed that, e.g.:

```js
-  const { data: complianceDocuments } = useQuery({
+  const { data: complianceDocuments = [] } = useQuery({
     ...
-    initialData: [],
     enabled: !!staffEmail
```

The destructuring default renders exactly the same empty value without poisoning the cache. Object-valued cases (`{ residents: [], location: null }`, the swaps bundle) already had matching defaults and kept them.

I did not try to fix only the sites I judged broken. My first pass classified them by whether the gate could start false, and it was wrong in both directions — `isAdmin` looks synchronous but derives from an async `user`, while a `clientId` prop is available on first render. The transformation is safe either way: where the gate was already true at mount the behaviour is unchanged apart from `isLoading` briefly being honest, and several sites carried their own `staleTime: 0`, which had been sparing them. So it was applied uniformly rather than selectively on a guess.

### Guard

`npm run audit:query-init` fails when any query pairs the two again, naming the file, line and key. Confirmed it fires: reintroducing the pair in MyTimesheets exits 1 and reports `src/pages/MyTimesheets.jsx:86 ['myTimesheets', user?.email]`; removing it returns clean.

Verified: `vite build` clean; `audit:query-init`, `audit:query-keys`, `verify:recurrence` and `verify:residency` all pass; no new lint errors across the 28 files.

