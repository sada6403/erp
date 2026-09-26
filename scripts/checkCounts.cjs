const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const Store = require('electron-store');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
const db = new Database(dbPath);

console.log('--- ROLES ---');
console.log(db.prepare('SELECT id, name, permissions FROM roles').all());

console.log('\n--- STORE AUTH_USER ---');
const store = new Store();
console.log(store.get('auth_user'));

console.log('\n--- STORE APP_SETTINGS ---');
console.log(store.get('app_settings'));

console.log('\n--- SYNC QUEUE STATUS ---');
console.log(db.prepare('SELECT COUNT(*) as pending FROM sync_queue WHERE status = ?').get('PENDING'));
console.log(db.prepare('SELECT id, table_name, operation, status, retries, last_error, created_at FROM sync_queue ORDER BY created_at DESC LIMIT 5').all());
