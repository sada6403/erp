// Phase 1: staging-copy scan only. No application initializer, settings, cloud,
// write queries, repair/apply command, or stock/catalog APIs are imported.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Database = require('better-sqlite3')

function parseArguments(args) {
  const options = { stagingCopy: false, slashAliases: false }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--staging-copy' || key === '--slash-aliases') {
      const field = key === '--staging-copy' ? 'stagingCopy' : 'slashAliases'
      if (options[field]) throw new Error(`Duplicate option ${key}`)
      options[field] = true
    } else if (key === '--db' || key === '--output') {
      if (!args[i + 1] || args[i + 1].startsWith('--') || options[key.slice(2)]) throw new Error(`Missing or duplicate value for ${key}`)
      options[key.slice(2)] = args[++i]
    } else throw new Error(`Unknown option ${key}. This tool has no apply/write mode.`)
  }
  if (!options.stagingCopy || !options.db) throw new Error('Use --staging-copy --db PATH_TO_STAGING_COPY [--output NEW_REPORT.json|.csv] [--slash-aliases]')
  if (options.output && !/\.(json|csv)$/i.test(options.output)) throw new Error('Report output must end in .json or .csv')
  return options
}

function runScan(options, helpers) {
  if (!options.stagingCopy) throw new Error('A staging copy must be explicitly selected')
  const filename = fs.realpathSync(path.resolve(options.db))
  const output = options.output ? path.resolve(options.output) : undefined
  if (output && !/\.(json|csv)$/i.test(output)) throw new Error('Report output must end in .json or .csv')
  if (output && (output.toLowerCase() === filename.toLowerCase() || fs.existsSync(output))) throw new Error('Refusing to overwrite a database or existing report')
  const { scanProductNames, nameScanCsv } = helpers || require('../dist-electron/services/productNameScan.js')
  const db = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    const report = { ...scanProductNames(db, { slashAliases: options.slashAliases }),
      audit: { operation: 'PRODUCT_NAMES_DRY_RUN', operator: os.userInfo().username, source: filename, staging_copy_declared: true, database_mode: 'read-only', schema_changed: false } }
    if (output) fs.writeFileSync(output, output.toLowerCase().endsWith('.csv') ? nameScanCsv(report) : JSON.stringify(report, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' })
    return { report, output }
  } finally { db.close() }
}

if (require.main === module) {
  try {
    const { report, output } = runScan(parseArguments(process.argv.slice(2)))
    console.log(JSON.stringify(output ? { dry_run: true, summary: report.summary, audit: report.audit, report_file: output } : report, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { parseArguments, runScan }
