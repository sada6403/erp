import { Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { getLandingRoute } from '@/lib/sessionRouting'

/**
 * Blocks direct-URL access to a page whose module has been disabled by the
 * superadmin, instead of relying only on the sidebar hiding its nav link.
 * `enabledModules` undefined/null (not yet fetched) fails open, matching the
 * same default already used for nav-hiding in AppLayout.
 */
export default function RequireModule({ module, children }: { module: string; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const enabledModules = user?.enabledModules
  const blocked = Array.isArray(enabledModules) && !enabledModules.includes(module)
  const toasted = useRef(false)

  useEffect(() => {
    if (blocked && !toasted.current) {
      toasted.current = true
      toast.error('This feature is not available on your current plan')
    }
  }, [blocked])

  if (blocked) return <Navigate to={getLandingRoute(user)} replace />
  return <>{children}</>
}
