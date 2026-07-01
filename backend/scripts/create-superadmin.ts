/**
 * Run once to create the first superadmin account:
 *   npx ts-node -e "require('./scripts/create-superadmin')"
 * or:
 *   node -r ts-node/register scripts/create-superadmin.ts
 */
import bcrypt from 'bcryptjs'
import { pool } from '../lib/db'

const NAME     = process.env.SA_NAME     || 'Super Admin'
const EMAIL    = process.env.SA_EMAIL    || 'superadmin@example.com'
const PASSWORD = process.env.SA_PASSWORD || 'ChangeMe123!'

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12)
  const { rows } = await pool.query(
    `INSERT INTO superadmins (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash=$3, is_active=true
     RETURNING id, name, email`,
    [NAME, EMAIL, hash]
  )
  console.log('Superadmin upserted:', rows[0])
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
