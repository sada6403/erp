/* eslint-disable no-console */
// STAGING / TEST COMPANY ONLY. Creates (or removes) 3 plain "TEST" banners so the App Control banner flow can be exercised.
//   node --env-file=.env scripts/run-ts.cjs scripts/seed-test-banners.ts --company "<test company name>" [--remove]
// (or: npm run seed:test-banners -- --company "<name>")
// - Refuses unless the company name contains "test" (case-insensitive). Never run it against a real company.
// - Writes 3 company-colour PNGs (1200x525, the text "TEST" only, no prices, no claims) into UPLOAD_DIR (default ./uploads)
//   and upserts banners with fixed ids test-banner-1..3 (idempotent). --remove deletes those 3 rows.
// - The rows are cloud rows in the test company's database; they must never be created for a Play-facing company.
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { pool, tenantPool } from '../lib/db'
import { ensureTenantCompatibility } from '../lib/auth'

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const name = arg('--company')
  if (!name) { console.error('Usage: --company "<test company name>" [--remove]'); process.exit(1) }
  if (!/test/i.test(name)) { console.error(`Refusing: company name "${name}" does not contain "test".`); process.exit(1) }
  const { rows } = await pool.query(`SELECT id, db_schema, name, brand_color FROM companies WHERE name = ? LIMIT 2`, [name])
  if (rows.length !== 1) { console.error(`Expected exactly one company named "${name}", found ${rows.length}.`); process.exit(1) }
  const c = rows[0] as { db_schema: string; name: string; brand_color: string | null }
  await ensureTenantCompatibility(c.db_schema)
  const tp = tenantPool(c.db_schema)
  const ids = [1, 2, 3].map(n => `test-banner-${n}`)

  if (process.argv.includes('--remove')) {
    await tp.query(`DELETE FROM app_banners WHERE id IN (?)`, [ids])
    console.log(`Removed TEST banners from "${c.name}".`)
    process.exit(0)
  }

  const base = /^#[0-9a-f]{6}$/i.test(c.brand_color ?? '') ? String(c.brand_color) : '#2e7d32'
  const shade = (hex: string, f: number) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('')
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  await mkdir(uploadDir, { recursive: true })
  // link types exercise the app's navigation only; nothing is promised in the artwork
  const defs: Array<{ link_type: string; f: number }> = [{ link_type: 'none', f: 1 }, { link_type: 'flash', f: 0.8 }, { link_type: 'smartbuy', f: 0.65 }]
  for (let i = 0; i < 3; i++) {
    const file = `test-banner-${i + 1}.png`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="525"><rect width="1200" height="525" fill="${shade(base, defs[i].f)}"/><text x="600" y="305" font-size="160" font-weight="700" text-anchor="middle" fill="#ffffff" font-family="sans-serif">TEST</text></svg>`
    await writeFile(path.join(uploadDir, file), await sharp(Buffer.from(svg)).png().toBuffer())
    await tp.query(
      `INSERT INTO app_banners (id, title, subtitle, image_url, link_type, link_target, audience, sort_order, is_active)
       VALUES (?, '', NULL, ?, ?, NULL, 'all', ?, 1)
       ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), link_type = VALUES(link_type), sort_order = VALUES(sort_order), is_active = 1`,
      [ids[i], `/api/files/${file}`, defs[i].link_type, 900 + i])
  }
  console.log(`Seeded 3 TEST banners in "${c.name}" (images in ${uploadDir}). Remove with --remove.`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
