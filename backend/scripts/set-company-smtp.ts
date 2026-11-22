// STAGING helper: stores a company's SMTP settings (password encrypted like the Super Admin PATCH does) in companies.branding_json.
// Reads ONE JSON line from stdin: {"host","port","user","pass","from_name","from_email"}. Never prints the password or the address.
//   <json> | node --env-file=.env <bundled>.cjs <company_slug>
import { pool } from '../lib/db'
import { encryptSecret } from '../lib/secretCrypto'

async function main() {
  const slug = process.argv[2]
  if (!slug) throw new Error('usage: <company_slug> with JSON on stdin')
  let raw = ''
  for await (const c of process.stdin) raw += c
  const s = JSON.parse(raw.trim())
  if (!s.host || !s.user || !s.pass) throw new Error('host, user and pass are required')
  const { rows } = await pool.query<{ id: string; branding_json: string | null }>(`SELECT id, branding_json FROM companies WHERE slug = ? LIMIT 1`, [slug])
  if (!rows.length) throw new Error('company not found')
  let branding: Record<string, unknown> = {}
  try { if (rows[0].branding_json) branding = JSON.parse(String(rows[0].branding_json)) } catch { /* start clean */ }
  branding.smtp = {
    host: String(s.host), port: Number(s.port ?? 587), secure: Number(s.port) === 465, user: String(s.user),
    pass: encryptSecret(String(s.pass)), from_name: String(s.from_name ?? ''), from_email: String(s.from_email ?? s.user),
  }
  await pool.query(`UPDATE companies SET branding_json = ? WHERE id = ?`, [JSON.stringify(branding), rows[0].id])
  console.log('SMTP saved for company', slug, '(host', String(s.host) + ', port', Number(s.port ?? 587) + ')')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e instanceof Error ? e.message.replace(/[\w.+-]+@[\w.-]+/g, '[email]') : 'error'); process.exit(1) })
