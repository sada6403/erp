const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const root = path.join(process.env.APPDATA, 'pos-erp')
const registry = JSON.parse(fs.readFileSync(path.join(root, 'company-workspaces.json'), 'utf8'))
const workspace = !registry.active_workspace_id || registry.active_workspace_id === 'legacy' ? root : path.join(root, 'company-workspaces', registry.active_workspace_id)
const db = new Database(path.join(workspace, 'pos-erp.db'), { readonly: true, fileMustExist: true })
const products = db.prepare("SELECT id, name FROM products WHERE name LIKE 'VEGETABLE RACK%' OR name LIKE 'VERANDHAH CHAIR%' LIMIT 8").all()
const quote = value => '"' + value.replace(/"/g, '""') + '"'
const links = []
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
    if (fk.table !== 'products') continue
    const records = products.map(product => ({ name: product.name, count: db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)} WHERE ${quote(fk.from)}=?`).get(product.id).n })).filter(row => row.count)
    if (records.length) links.push({ table: name, column: fk.from, records })
  }
}
const pending = db.prepare('SELECT status, COUNT(DISTINCT product_id) AS products, COUNT(*) AS rows FROM pending_branch_stocks GROUP BY status').all()
console.log(JSON.stringify({ matchedProducts: products, links, pending }, null, 2))
db.close()
