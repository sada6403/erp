/** Move only this service's retired direct HTTP endpoint to its verified TLS proxy. */
export function canonicalCloudBaseUrl(value: unknown): string {
 const base = String(value || '').trim().replace(/\/+$/, '')
 try {
  const url = new URL(base)
  if (url.protocol === 'http:' && url.hostname === '72.61.115.222' && url.port === '4001'
    && (!url.pathname || url.pathname === '/') && !url.username && !url.password && !url.search && !url.hash) {
   return 'https://posadmin.nfplantation.com'
  }
 } catch { /* Preserve configuration errors for the normal API error handling. */ }
 return base
}
