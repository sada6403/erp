import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudApi } from './cloudApi'

afterEach(() => vi.unstubAllGlobals())
describe('Cloud pagination boundaries', () => {
  it('uses timestamp and ID for records sharing a timestamp across pages', async () => {
    const since = '2026-09-26T12:00:00.000Z'
    const first = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), updated_at: since }))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: first, nextCursor: { since, afterId: '4999' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: '5000', updated_at: since }], nextCursor: null })))
    vi.stubGlobal('fetch', fetcher)
    const api = new CloudApi({ baseUrl: 'https://test.invalid', apiKey: 'test' })
    expect(await api.changes('products', '1970-01-01T00:00:00.000Z')).toHaveLength(5001)
    expect(String(fetcher.mock.calls[1][0])).toContain('afterId=4999')
  })
  it('fails explicitly when an old server truncates a full page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: Array(5000).fill({ id: 'row' }) }))))
    await expect(new CloudApi({ baseUrl: 'https://test.invalid', apiKey: 'test' }).changes('products', '1970-01-01T00:00:00.000Z'))
      .rejects.toThrow('upgrade required')
  })
})
