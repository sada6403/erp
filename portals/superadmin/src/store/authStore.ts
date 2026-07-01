import { create } from 'zustand'
import { setTokens, clearTokens, loadTokens } from '../lib/api'

interface User { id: string; name: string; email: string; portal: 'superadmin' }

interface AuthState {
  user:     User | null
  loading:  boolean
  setUser:  (u: User, access: string, refresh: string) => void
  logout:   () => void
  hydrate:  () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user:    null,
  loading: true,

  setUser: (u, access, refresh) => {
    setTokens(access, refresh)
    set({ user: u, loading: false })
  },

  logout: () => {
    clearTokens()
    set({ user: null, loading: false })
  },

  hydrate: () => {
    loadTokens()
    const raw = localStorage.getItem('sa_user')
    if (raw) {
      try { set({ user: JSON.parse(raw), loading: false }) }
      catch { set({ loading: false }) }
    } else {
      set({ loading: false })
    }
  },
}))
