export function resolveImageSrc(value?: string | null): string {
  const src = String(value || '').trim()
  if (!src) return ''

  if (/^(https?:|data:|blob:|app-img:|file:)/i.test(src)) {
    return src
  }

  if (/^[a-zA-Z]:[\\/]/.test(src)) {
    return `file:///${encodeURI(src.replace(/\\/g, '/'))}`
  }

  if (src.startsWith('\\\\')) {
    return `file://${encodeURI(src.replace(/\\/g, '/'))}`
  }

  if (src.startsWith('uploads/')) {
    return `app-img://${src.slice('uploads/'.length)}`
  }

  if (src.startsWith('uploads\\')) {
    return `app-img://${src.slice('uploads\\'.length).replace(/\\/g, '/')}`
  }

  if (!src.includes('/') && !src.includes('\\')) {
    return `app-img://${src}`
  }

  return src
}
