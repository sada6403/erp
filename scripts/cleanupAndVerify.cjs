const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
const db = new Database(dbPath);

// Deactivate any remaining non-furniture products created previously
db.prepare("UPDATE products SET is_active=0 WHERE id LIKE 'prod_%' AND id NOT LIKE 'prod_furn_%'").run();

// Clean remaining plantation customers
db.prepare("DELETE FROM customers WHERE id IN ('cust_nature_basket_organics', 'cust_subramaniam_orchard')").run();

console.log('--- ALL ACTIVE FURNITURE PRODUCTS ---');
const products = db.prepare(`
  SELECT p.id, p.name, p.sku, p.selling_price, c.name as category_name,
         COALESCE(s.quantity, 0) as stock
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = 'b1111111-1111-4111-8111-111111111111'
  WHERE p.is_active = 1 AND p.id LIKE 'prod_furn_%'
  ORDER BY c.name, p.name
`).all();

console.log(`Total Furniture Products: ${products.length}`);
products.forEach((p, idx) => {
  console.log(`${idx + 1}. [${p.category_name}] ${p.name} | SKU: ${p.sku} | Price: LKR ${p.selling_price.toLocaleString()} | Stock: ${p.stock}`);
});
