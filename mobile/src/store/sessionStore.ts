import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AppRole } from '@contracts/common';
import type { AuthUser } from '@contracts/auth';
import { zustandStorage } from '@/lib/storage';

/** Which navigation set (bottom nav) is showing. Guests use 'customer'. */
export type NavRole = AppRole | 'manager';

interface SessionState {
  /** Non-sensitive profile only. Tokens live in expo-secure-store. */
  user: AuthUser | null;
  activeRole: NavRole;
  /** A manager who chose the field-officer tabs (agent view) instead of the management layout. Reset at login. */
  fieldView: boolean;
  setFieldView: (v: boolean) => void;
  /** Route to open after login (set when a guest tries to check out). */
  pendingRoute: string | null;
  /** Push permission explainer already shown. */
  pushExplained: boolean;
  /** Branch chosen at checkout; shown under the app title. */
  branchName: string | null;
  setBranchName: (n: string | null) => void;
  setUser: (u: AuthUser) => void;
  patchUser: (patch: Partial<AuthUser>) => void;
  setActiveRole: (r: NavRole) => void;
  setPendingRoute: (r: string | null) => void;
  setPushExplained: (v: boolean) => void;
  clear: () => void;
}

/** Highest-privilege role first: agents land on deliveries, then Smart Buy, else the shop. */
export function defaultRoleFor(user: AuthUser | null): NavRole {
  if (!user) return 'customer';
  if (user.roles.includes('agent')) return 'agent';
  if (user.roles.includes('smartbuy')) return 'smartbuy';
  return 'customer';
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      activeRole: 'customer',
      fieldView: false,
      setFieldView: (fieldView) => set({ fieldView }),
      pendingRoute: null,
      pushExplained: false,
      branchName: null,
      setBranchName: (branchName) => set({ branchName }),
      setUser: (user) => set({ user, activeRole: defaultRoleFor(user), fieldView: false }),
      patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      setActiveRole: (activeRole) => set({ activeRole }),
      setPendingRoute: (pendingRoute) => set({ pendingRoute }),
      setPushExplained: (pushExplained) => set({ pushExplained }),
      clear: () => set({ user: null, activeRole: 'customer', fieldView: false, pendingRoute: null }),
    }),
    {
      name: 'np-session',
      storage: createJSONStorage(() => zustandStorage),
      partialize: (s) => ({ user: s.user, activeRole: s.activeRole, fieldView: s.fieldView, pushExplained: s.pushExplained, branchName: s.branchName }),
    },
  ),
);

export const selectIsLoggedIn = (s: SessionState) => s.user != null;
export const selectHasRole = (role: AppRole) => (s: SessionState) => s.user?.roles.includes(role) ?? false;
