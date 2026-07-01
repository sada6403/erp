// Run: node scripts/create-superadmin.js
const bcrypt = require('bcryptjs')
const mysql  = require('mysql2/promise')
const crypto = require('crypto')

const NAME     = process.env.SA_NAME     || 'Super Admin'
const EMAIL    = process.env.SA_EMAIL    || 'superadmin@pos.local'
const PASSWORD = process.env.SA_PASSWORD || 'Admin@1234'

async function main() {
  // Parse DATABASE_URL from .env manually
  require('fs').readFileSync(require('path').join(__dirname, '../.env'), 'utf8')
    .split('\n').forEach(line => {
      const [k, ...v] = line.split('=')
      if (k && v.length) process.env[k.trim()] = v.join('=').trim()
    })

  const url = new URL(process.env.DATABASE_URL)
  const conn = await mysql.createConnection({
    host: url.hostname, port: Number(url.port) || 3306,
    user: url.username, password: url.password,
    database: url.pathname.slice(1),
  })

  const hash = await bcrypt.hash(PASSWORD, 12)
  const id   = crypto.randomUUID()

  await conn.execute(
    `INSERT INTO superadmins (id, name, email, password_hash)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), is_active=1`,
    [id, NAME, EMAIL, hash]
  )

  console.log('✓ Superadmin created / updated:')
  console.log('  Email   :', EMAIL)
  console.log('  Password:', PASSWORD)
  console.log('  Login at: http://localhost:5174')

  await conn.end()
}

main().catch(e => { console.error(e); process.exit(1) })
