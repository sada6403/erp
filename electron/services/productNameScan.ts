import type Database from 'better-sqlite3'
import { splitMasterName, validateMasterName } from '../lib/masterNames'
import { hasMojibake } from '../lib/textEncoding'

export function scanProductNames(db: Database.Database, options: { slashAliases?: boolean; generatedAt?: string } = {}) {
  if (!db.readonly) throw new Error('Name scan requires a read-only database connection')
  const fields = new Set((db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map(field => field.name))
  if (!['id', 'sku', 'name'].every(field => fields.has(field))) throw new Error('The selected staging database has no supported products table')
  return db.transaction(() => {
    const summary = { scannedProducts: 0, activeProducts: 0, reviewRows: 0, changedProposals: 0, invalidProposals: 0,
      tamilNames: 0, sinhalaNames: 0, mojibakeSuspects: 0, replacementCharacterNames: 0, invalidOriginalNames: 0 }
    const rows: { id: string; sku: string; active: boolean; original_name: string; proposed_name: string;
      proposed_keywords: string[]; original_issues: string[]; proposed_issues: string[]; warnings: string[]; requires_manual_name: boolean }[] = []
    const statement = db.prepare(`SELECT id,sku,name,${fields.has('is_active') ? 'is_active' : '1 AS is_active'} FROM products ORDER BY id`)
    for (const record of statement.iterate() as Iterable<{ id: string; sku: string; name: string; is_active: number }>) {
      const original = String(record.name ?? '')
      summary.scannedProducts++
      if (record.is_active) summary.activeProducts++
      if (/[\u0b80-\u0bff]/u.test(original)) summary.tamilNames++
      if (/[\u0d80-\u0dff]/u.test(original)) summary.sinhalaNames++
      if (hasMojibake(original)) summary.mojibakeSuspects++
      if (original.includes('\ufffd')) summary.replacementCharacterNames++
      const validation = validateMasterName(original)
      if (!validation.valid) summary.invalidOriginalNames++
      const proposal = splitMasterName(original, { format: 'database', repairMojibake: true, slashMode: options.slashAliases ? 'first-part' : 'keep' })
      if (!proposal.needsReview && validation.valid) continue
      summary.reviewRows++
      if (proposal.masterName !== original) summary.changedProposals++
      if (!proposal.validation.valid) summary.invalidProposals++
      rows.push({ id: String(record.id), sku: String(record.sku), active: Boolean(record.is_active), original_name: original,
        proposed_name: proposal.masterName, proposed_keywords: proposal.keywords.map(keyword => keyword.keyword),
        original_issues: validation.issues.map(issue => issue.code), proposed_issues: proposal.validation.issues.map(issue => issue.code),
        warnings: proposal.warnings.map(warning => warning.message), requires_manual_name: !proposal.validation.valid })
    }
    return { dry_run: true as const, generated_at: options.generatedAt || new Date().toISOString(),
      policy: { latin_script_only: true, automatic_translation: false, slash_aliases: Boolean(options.slashAliases), writes_performed: false }, summary, rows }
  }).deferred()
}

export function nameScanCsv(report: ReturnType<typeof scanProductNames>): string {
  const columns = ['id','sku','active','original_name','proposed_name','proposed_keywords','original_issues','proposed_issues','warnings','requires_manual_name'] as const
  const escape = (value: unknown) => {
    let text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
    // Review reports may contain hostile source text. Preserve exact raw values
    // in JSON; protect spreadsheet cells in the human-readable CSV export.
    if (/^[\s]*[=+\-@]/u.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\ufeff' + [columns.join(','), ...report.rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n') + '\r\n'
}
