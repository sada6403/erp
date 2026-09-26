const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
const db = new Database(dbPath);

console.log('--- USERS COLUMNS ---');
console.log(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));

console.log('--- USERS ROWS ---');
console.log(db.prepare('SELECT id, name, email, branch_id, role_id FROM users').all());
