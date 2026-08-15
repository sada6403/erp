import { describe, it, expect } from 'vitest'
import { resolveImageSrc } from './imageUrl'

describe('resolveImageSrc', () => {
  it('returns an empty string for empty/nullish input', () => {
    expect(resolveImageSrc('')).toBe('')
    expect(resolveImageSrc(null)).toBe('')
    expect(resolveImageSrc(undefined)).toBe('')
  })

  it('passes through an already-usable app-img:// reference unchanged', () => {
    expect(resolveImageSrc('app-img://abc123.png')).toBe('app-img://abc123.png')
  })

  it('passes through http(s)/data/blob/file URLs unchanged', () => {
    expect(resolveImageSrc('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png')
    expect(resolveImageSrc('http://cdn.example.com/x.png')).toBe('http://cdn.example.com/x.png')
    expect(resolveImageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(resolveImageSrc('blob:http://localhost/xyz')).toBe('blob:http://localhost/xyz')
    expect(resolveImageSrc('file:///C:/already/a/url.png')).toBe('file:///C:/already/a/url.png')
  })

  it('converts a bare Windows absolute path into a proper file:// URL', () => {
    expect(resolveImageSrc('C:\\Users\\PC1\\Pictures\\logo.png')).toBe('file:///C:/Users/PC1/Pictures/logo.png')
  })

  it('converts a UNC path into a loadable file:// URL', () => {
    expect(resolveImageSrc('\\\\server\\share\\image.png')).toBe('file:////server/share/image.png')
  })

  it('converts an "uploads/..." relative reference into app-img://', () => {
    expect(resolveImageSrc('uploads/abc123.png')).toBe('app-img://abc123.png')
    expect(resolveImageSrc('uploads\\abc123.png')).toBe('app-img://abc123.png')
  })

  it('converts a bare filename (no path separators) into app-img://', () => {
    expect(resolveImageSrc('abc123.png')).toBe('app-img://abc123.png')
  })
})
