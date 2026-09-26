const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
const db = new Database(dbPath);
const tables = ['branches', 'categories', 'suppliers', 'products', 'stocks', 'customers', 'purchase_orders'];

for (const t of tables) {
  try {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    console.log(`${t}: ${count} rows`);
  } catch (err) {
    console.log(`${t}: Error - ${err.message}`);
  }
}

console.log('\n--- Sample Suppliers ---');
console.log(db.prepare('SELECT id, name, business_name, mobile_number, email, city FROM suppliers LIMIT 3').all());

console.log('\n--- Sample Products ---');
console.log(db.prepare('SELECT id, name, sku, cost_price, selling_price, brand FROM products LIMIT 3').all());
