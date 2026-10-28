---
name: offline-cache
description: Make a React Native screen work from the persisted cache when the phone or server is offline, and guard server-only actions with the buy-later sheet. Use for any data screen or server action in mobile/.
---

# Offline cache (React Native)

Goal: products and personal data always show, even offline. Actions that change money, stock or
approvals never run offline.

## Setup (once, in `mobile/src/query/`)
```ts
// queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'offlineFirst', staleTime: 60_000, gcTime: 7 * 24 * 3600_000, retry: 2 },
    mutations: { networkMode: 'online' },
  },
})
// persister: createSyncStoragePersister({ storage: mmkvStorageAdapter })
// <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 days, buster: APP_VERSION }}>
// onlineManager.setEventListener(setOnline => NetInfo.addEventListener(s => setOnline(!!s.isConnected && s.isInternetReachable !== false)))
// focusManager wired to AppState 'active'
```
Only persist queries whose key starts with `catalog`, `me`, `smartbuy`, `wallet`, `agent`
(`dehydrateOptions.shouldDehydrateQuery`). Never persist tokens or the checkout quote.

## Read path
1. Query keys in `src/query/keys.ts` (e.g. `['catalog','products',{categoryId}]`).
2. Catalog: first run downloads the full snapshot; later calls send `updated_since` and merge
   deltas into the cached snapshot (`queryClient.setQueryData`), removing `deletedIds`.
3. Screens show cached data immediately; a failed refresh never clears data. It only sets the stale flag.
4. `useWatermark()` polls `/watermark` every 10 s while a list screen is focused and invalidates
   only the changed areas.
5. Images: `expo-image` disk cache; `Image.prefetch()` thumbnails for the first 2 pages of each category.

## Server status
`useServerStatus()` → `/status` (`ordering_enabled`, `maintenance_message`), cached in MMKV, refreshed
on app foreground. Treat timeouts/5xx as unreachable. `<OfflineBanner/>` shows
"Offline — showing saved products · updated 2 h ago" or the maintenance message.

## Write guard
Server-only actions: place order, checkout quote, wallet pay, join request, password change, email verify.
```ts
const guard = useServerActionGuard()
onPress={() => guard(() => placeOrder.mutate(input))}
// guard: if offline or !orderingEnabled → open <BuyLaterSheet/> (cart kept) and return
```
BuyLaterSheet: "Ippo order panna mudiyaathu. Connection vantha udane notify pannuvom." + **Notify me**
→ store a flag in MMKV; the NetInfo listener fires a local `expo-notifications` notification when back
online (or on next app open). Orders are never queued offline.

## Outbox (only these)
Agent delivery status/completion (OTP verified offline against `delivery_otp_hash`) and wishlist
toggles. Zustand store persisted to MMKV: `{ id: uuid, type, payload, attempts }`. Flushed in order
when online; the `id` is sent as `Idempotency-Key`; the server re-verifies.

## Done when
In airplane mode: home, categories, product detail, cart, my orders, statement, wallet history and
agent deliveries render from cache; buy/wallet/join show the sheet; turning the network on refreshes
without restarting the app.
