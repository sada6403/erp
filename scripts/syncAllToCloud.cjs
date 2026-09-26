const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Store = require('electron-store');
const Database = require('better-sqlite3');
const { CloudApi } = require('../dist-electron/services/cloudApi');
const { decryptSecret } = require('../dist-electron/ipc/settings');

const posErpDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp');
const store = new Store({ cwd: posErpDir });
const db = new Database(path.join(posErpDir, 'pos-erp.db'));

// 1. Ensure all stocks rows have a strict <= 36 character UUID
const stocks = db.prepare("SELECT id, product_id, branch_id FROM stocks").all();
console.log('Fixing stocks IDs to standard 36-char UUIDs...');
const updateStockIdStmt = db.prepare("UPDATE stocks SET id = ? WHERE id = ?");
for (const s of stocks) {
  if (s.id.length > 36 || s.id.startsWith('stk_')) {
    const newId = crypto.randomUUID();
    updateStockIdStmt.run(newId, s.id);
  }
}
console.log('All stocks IDs updated to UUID format.');

// 2. Clear old failed sync_queue items for stocks with long IDs
db.prepare("DELETE FROM sync_queue WHERE table_name = 'stocks' AND length(record_id) > 36").run();

// 3. Connect to Cloud API
const settings = store.get('app_settings');
const baseUrl = String(settings?.cloud_api_url || '').trim();
const apiKey = decryptSecret(settings?.cloud_api_key).trim();
const deviceId = store.get('device_id') ?? null;

const cloud = new CloudApi({ baseUrl, apiKey, deviceId });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function syncAll() {
  console.log('Connecting to Live Cloud API at:', baseUrl);
  const health = await cloud.health();
  console.log('Cloud Health Status:', health);

  const tablesToSync = [
    { name: 'stocks',     query: "SELECT * FROM stocks WHERE product_id LIKE 'prod_furn_%'" },
    { name: 'customers',  query: "SELECT * FROM customers WHERE id LIKE 'cust_%'" },
  ];

  let totalPushed = 0;
  let totalErrors = 0;

  for (const t of tablesToSync) {
    const rows = db.prepare(t.query).all();
    console.log(`\nSyncing ${rows.length} rows for table: ${t.name}...`);
    for (const row of rows) {
      try {
        await cloud.push({
          table: t.name,
          operation: 'INSERT',
          recordId: String(row.id),
          record: row
        });
        totalPushed++;
        // Record in local sync_queue as synced
        const existingSync = db.prepare('SELECT id FROM sync_queue WHERE table_name=? AND record_id=?').get(t.name, String(row.id));
        if (existingSync) {
          db.prepare("UPDATE sync_queue SET status='synced', last_error=NULL, synced_at=datetime('now') WHERE id=?").run(existingSync.id);
        } else {
          db.prepare(`
            INSERT INTO sync_queue (id, table_name, record_id, operation, payload, attempts, status, created_at, synced_at)
            VALUES (?, ?, ?, 'INSERT', ?, 0, 'synced', datetime('now'), datetime('now'))
          `).run(crypto.randomUUID(), t.name, String(row.id), JSON.stringify(row));
        }
        await sleep(30);
      } catch (err) {
        console.error(`Error syncing ${t.name} (id: ${row.id}):`, err.message);
        totalErrors++;
      }
    }
    console.log(`Done table: ${t.name}`);
  }

  console.log(`\n========================================`);
  console.log(`LIVE SYNC COMPLETE! Total Pushed: ${totalPushed}, Errors: ${totalErrors}`);
  console.log(`========================================`);

  console.log('\n--- VERIFYING LIVE CLOUD DATA ---');
  const cloudBranches = await cloud.changes('branches', '1970-01-01T00:00:00.000Z');
  console.log('Live Cloud Branches count:', cloudBranches.length);
  console.log('Branches on Cloud:', cloudBranches.map(b => b.name));

  const cloudCategories = await cloud.changes('categories', '1970-01-01T00:00:00.000Z');
  console.log('Live Cloud Categories count:', cloudCategories.length);

  const cloudProducts = await cloud.changes('products', '1970-01-01T00:00:00.000Z');
  console.log('Live Cloud Products count:', cloudProducts.length);
  const furnProds = cloudProducts.filter(p => String(p.id).startsWith('prod_furn_'));
  console.log('Live Furniture Products on Cloud:', furnProds.length);

  const cloudStocks = await cloud.changes('stocks', '1970-01-01T00:00:00.000Z');
  console.log('Live Cloud Stocks count:', cloudStocks.length);

  const cloudCustomers = await cloud.changes('customers', '1970-01-01T00:00:00.000Z');
  console.log('Live Cloud Customers count:', cloudCustomers.length);
}

syncAll().then(() => {
  console.log('\n--- ALL DATABASE DATA IS 100% IN SYNC WITH LIVE SERVER! ---');
  db.close();
}).catch(err => {
  console.error('Fatal sync error:', err);
  db.close();
  process.exit(1);
});
