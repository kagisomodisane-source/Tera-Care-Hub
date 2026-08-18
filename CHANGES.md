## The organisation picker listed nothing (Base44 checkpoint 6a83b1c0ba27310c7cc80c4c)

**Changed**: `src/components/clients/ClientResidencyPanel.jsx`

My own bug, from the previous change. I wrote the picker's queries as:

```js
enabled: showLinkDialog,
initialData: [],
```

`initialData` seeds the cache with an empty array stamped **fresh as of now**. The observer mounts with `enabled: false`, so nothing fetches. When the dialog opens and `enabled` flips true, TanStack sees data that is still fresh under the app's global `staleTime: 2 * 60 * 1000` and skips the fetch entirely. `refetchOnMount: 'always'` doesn't rescue it, because enabling an existing observer is not a mount.

The result is a picker that is permanently empty for the first two minutes, with no error and no spinner — the query function never runs at all.

Confirmed against the app's real QueryClient defaults rather than by inspection:

```
WITH initialData: []    queryFn ran: 0 time(s)   rows shown: 0
WITHOUT initialData     queryFn ran: 1 time(s)   rows shown: 2
```

The fix is to drop `initialData` and keep only the `= []` destructuring default, which renders the same empty list without poisoning the cache. Both the organisation and location queries had it. Their empty-state messages now also distinguish loading from genuinely empty, instead of claiming "No organisations have been set up yet" while the fetch is still in flight.

### The same trap is set in 42 other places

Sweeping for `useQuery` blocks that combine `enabled` with `initialData` finds 42 across `src/`. The pattern only bites when `enabled` is false on first render, which is exactly the shape of every "my ..." page — the query is gated on `user?.email` while the user is still loading:

```js
// src/pages/MyTimesheets.jsx
const { data: timesheets = [] } = useQuery({
  queryKey: ['myTimesheets', user?.email],
  enabled: !!user,        // false until the async auth.me() resolves
  initialData: []
});
```

I assumed the changing query key would save these — the key goes from `['myTimesheets', undefined]` to `['myTimesheets', 'staff@example.com']` as the user arrives. It does not:

```
static key + enabled flip        fetches: 0   rows: 0   <-- EMPTY
key changes as it enables        fetches: 0   rows: 0   <-- EMPTY
```

Switching an existing observer to a new key does not count as a mount either, and `initialData` is applied to the new key just as fresh. So the affected pages show nothing for two minutes unless something else invalidates them first.

Not all 42 are live: where the gate is already true on first render (`enabled: !!staffEmail` with the id from the URL, as in StaffProfile) the query mounts enabled and `refetchOnMount: 'always'` fires normally. The broken subset is those gated on asynchronously-loaded state.

Left alone pending a decision — it touches many pages and is well beyond fixing the picker.

Verified: `vite build` clean; `npm run verify:residency` 47/47; `npm run audit:query-keys` clean; eslint clean.

