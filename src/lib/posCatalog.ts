import type { Product } from '@/types'
import { KeywordSearchIndex, type SearchKeyword, type KeywordSearchContext } from '../../electron/lib/keywordSearch'

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim()
const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 2) }, (_, i) => value.slice(i, i + 3)))

/** Immutable renderer snapshot. No IPC, timers, or network in search(). */
export class PosCatalog {
  private keywords?: KeywordSearchIndex
  private products = new Map<string, Product>()
  readonly keywordsEnabled: boolean
  private matchedQuery = ''
  private matches = new Map<string, { matchedBy?: string }>()
  match(query: string, productId: string) { return query === this.matchedQuery ? this.matches.get(productId) : undefined }
  private exact = new Map<string, Product>()
  private prefixes = new Map<string, number[]>()
  private trigrams = new Map<string, number[]>()
  private rows: { product: Product; text: string; words: string[]; grams: Set<string> }[]

  constructor(products: Product[], aliases?: { keywords: SearchKeyword[]; context: KeywordSearchContext }) {
    this.keywordsEnabled = Boolean(aliases)
    this.products = new Map(products.filter(p => p.is_active).map(p => [p.id, p]))
    if (aliases) this.keywords = new KeywordSearchIndex(products, aliases.keywords, aliases.context)
    this.rows = products.filter(p => p.is_active).map(product => {
      const extra = String((product as { extra_barcodes?: string | null }).extra_barcodes || '').split('|')
      for (const code of [product.sku, product.barcode, ...extra]) {
        if (code) this.exact.set(normalize(code), product)
      }
      const text = normalize(`${product.name} ${product.sku} ${product.barcode || ''}`)
      return { product, text, words: text.split(/\s+/), grams: grams(text) }
    })
    this.rows.forEach((row, index) => {
      const prefixes = new Set<string>()
      for (const word of row.words) for (let n = 1; n <= Math.min(word.length, 32); n++) prefixes.add(word.slice(0, n))
      for (const prefix of prefixes) {
        const list = this.prefixes.get(prefix) || []
        list.push(index)
        this.prefixes.set(prefix, list)
      }
      for (const gram of row.grams) {
        const list = this.trigrams.get(gram) || []
        list.push(index)
        this.trigrams.set(gram, list)
      }
    })
  }

  lookup(code: string) { return this.exact.get(normalize(code)) }

  search(query: string, limit = 30): Product[] {
    if (!this.keywords) return this.legacySearch(query, limit)
    const matches = this.keywords.search(query, limit, this.legacySearch(query, limit))
    this.matchedQuery = query
    this.matches = new Map(matches.map(row => [row.productId, row]))
    return matches.map(row => this.products.get(row.productId)!).filter(Boolean)
  }

  private legacySearch(query: string, limit = 30): Product[] {
    const q = normalize(query)
    if (!q || limit <= 0) return []
    const exact = this.lookup(q)
    if (exact) return [exact]
    const tokens = q.split(/\s+/)
    const candidates = tokens.map(t => this.prefixes.get(t) || []).sort((a, b) => a.length - b.length)[0]
    const prefixResults: Product[] = []
    for (const index of candidates) {
      const row = this.rows[index]
      if (tokens.every(token => row.words.some(word => word.startsWith(token)))) prefixResults.push(row.product)
      if (prefixResults.length >= limit) return prefixResults
    }
    if (prefixResults.length) return prefixResults
    const matches: { product: Product; score: number }[] = []
    for (const row of this.rows) {
      if (tokens.every(token => row.text.includes(token))) {
        matches.push({ product: row.product, score: tokens.every(token => row.words.some(w => w.startsWith(token))) ? 2 : 1 })
      }
    }
    // Fuzzy fallback only when literal matches are absent; short scanner input
    // must never select an unrelated approximate code.
    if (!exact && !matches.length && q.length >= 4) {
      const queryGrams = grams(q)
      const overlaps = new Map<number, number>()
      for (const gram of queryGrams) for (const index of this.trigrams.get(gram) || []) overlaps.set(index, (overlaps.get(index) || 0) + 1)
      for (const [index, overlap] of overlaps) {
        const row = this.rows[index]
        const score = overlap / queryGrams.size
        if (score >= 0.5) matches.push({ product: row.product, score })
      }
    }
    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, limit).map(m => m.product)
  }
}
