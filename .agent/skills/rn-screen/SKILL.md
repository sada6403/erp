---
name: rn-screen
description: Build or change a React Native (Expo Router) screen in mobile/ following the approved demo UI, theme tokens, role rules, i18n and offline states. Use for any mobile UI work.
---

# React Native screen

## Where things go
- Route file: `mobile/app/(<group>)/<name>.tsx` — thin: reads params, calls a feature hook, renders a
  screen component.
- Feature code: `mobile/src/features/<area>/` — `use<Thing>.ts` (TanStack Query hooks), components.
- Shared UI: `mobile/src/components/` (Card, Chip, Badge, StatCard, BottomSheet, OfflineBanner,
  BuyLaterSheet, EmptyState, Skeleton). Reuse; never make look-alike duplicates.

## Rules
1. Match the approved demo layout (Guest / Customer / Smart Buy / Agent screens). Do not redesign.
2. Colours, spacing, radii and type sizes come from `useTheme()` tokens. No hex values in components.
   Styles: `StyleSheet.create` via a `makeStyles(theme)` helper so both themes work.
3. Data: TanStack Query hooks only (`useQuery` / `useMutation`) calling functions in `src/api/`
   typed with `@contracts` types. No `fetch`/axios calls inside components.
4. Every data screen has: skeleton (first load), content, empty, error, and `<OfflineBanner/>` when
   showing cached/stale data (skill `offline-cache`).
5. Lists use `FlashList` with `estimatedItemSize`; images use `expo-image` with
   `cachePolicy="disk"` and a placeholder.
6. Text: `t('key')` from i18next; add keys to `en.json`, `ta.json`, `si.json`. Money via
   `formatRs(amount)` → `Rs 145,000`; dates `dd MMM yyyy`; phone `07X XXX XXXX`.
7. Role guard: route groups `(agent)`, `(smartbuy)` redirect in their `_layout.tsx` when the session
   lacks the role. The server enforces it too.
8. Sensitive screens (wallet, draw video, NIC capture) call `usePreventScreenCapture()`.
9. Forms: react-hook-form + zod schema; show field errors inline; disable submit while pending.
10. Accessibility: touch targets ≥ 48 dp, `accessibilityLabel` on icon-only buttons, never colour alone.
11. Performance: memoize list items, no inline heavy work in render, keep JS bundle imports narrow.

## Done when
`npx tsc --noEmit` and `npm test` pass; screen checked on the emulator in both themes, for each role
it belongs to, and in airplane mode (data screens); screenshots attached to the report.
