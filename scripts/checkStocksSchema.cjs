const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const posErpDir = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp');
const db = new Database(path.join(posErpDir, 'pos-erp.db'));

console.log('Columns of stocks in SQLite:');
console.table(db.prepare('PRAGMA table_info(stocks)').all());

console.log('Indexes on stocks in SQLite:');
console.table(db.prepare('PRAGMA index_list(stocks)').all());

const fkList = db.prepare('PRAGMA foreign_key_list(stocks)').all();
console.log('Foreign keys on stocks:');
console.table(fkList);
