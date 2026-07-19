import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser } from '@/types'

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  pinLogin: (pin: string, branchId?: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  init: () => Promise<void>
  setEnabledModules: (modules: string[]) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,

      // Called from AppLayout's periodic /api/brand poll so a superadmin
      // toggling a module takes effect for any page reading this store,
      // not just the sidebar nav that originally fetched it.
      setEnabledModules: (modules) => {
        const user = get().user
        if (!user) return
        set({ user: { ...user, enabledModules: modules } })
      },

      init: async () => {
        set({ isLoading: true })
        try {
          const res = await window.api.auth.whoami()
          set({ user: (res.data as AuthUser | null) ?? null })
        } finally {
          set({ isLoading: false })
        }
      },

      login: async (email, password) => {
        const res = await window.api.auth.login({ email, password })
        if (res.success && res.data) {
          set({ user: (res.data as { user: AuthUser }).user })
          return { success: true }
        }
        return { success: false, error: res.error }
      },

      pinLogin: async (pin, branchId) => {
        const res = await window.api.auth.pinLogin({ pin, branch_id: branchId })
        if (res.success && res.data) {
          set({ user: (res.data as { user: AuthUser }).user })
          return { success: true }
        }
        return { success: false, error: res.error }
      },

      logout: async () => {
        await window.api.auth.logout()
        set({ user: null })
      }
    }),
    { name: 'pos-auth', partialize: (s) => ({ user: s.user }) }
  )
)
