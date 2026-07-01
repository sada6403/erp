import { NextRequest, NextResponse } from 'next/server'

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

// Clean up expired windows every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, win] of store.entries()) {
    if (win.resetAt < now) store.delete(key)
  }
}, 5 * 60 * 1000)

export interface RateLimitConfig {
  limit: number       // max requests
  windowMs: number    // window in ms
  keyPrefix?: string  // namespace (e.g. 'sync', 'auth')
}

export function rateLimit(config: RateLimitConfig) {
  const { limit, windowMs, keyPrefix = 'rl' } = config

  return function check(req: NextRequest): NextResponse | null {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const apiKey = req.headers.get('x-api-key') || ''
    const identity = apiKey ? `key:${apiKey}` : `ip:${ip}`
    const key = `${keyPrefix}:${identity}`

    const now = Date.now()
    let win = store.get(key)

    if (!win || win.resetAt <= now) {
      win = { count: 1, resetAt: now + windowMs }
      store.set(key, win)
      return null // allow
    }

    win.count++
    if (win.count > limit) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000)
      return NextResponse.json(
        { error: 'Too many requests', retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(win.resetAt / 1000)),
          },
        }
      )
    }

    return null // allow
  }
}

// Pre-configured limiters for common routes
export const authLimiter     = rateLimit({ limit: 10,  windowMs: 15 * 60 * 1000, keyPrefix: 'auth' })
export const syncLimiter     = rateLimit({ limit: 120, windowMs: 60 * 1000,       keyPrefix: 'sync' })
export const defaultLimiter  = rateLimit({ limit: 200, windowMs: 60 * 1000,       keyPrefix: 'api'  })
