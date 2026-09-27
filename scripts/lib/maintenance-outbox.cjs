const { randomUUID } = require('crypto');

// Keep maintenance data changes and their outbox events in the same transaction.
// If a script fails before finish(), SQLite rolls the transaction back on close.
exports.beginMaintenance = function beginMaintenance(db, tables) {
  for (const table of tables) if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error('Invalid maintenance table');
  db.exec('BEGIN IMMEDIATE');
  const snapshot = table => new Map(db.prepare(`SELECT * FROM ${table}`).all().map(row => [String(row.id), row]));
  const before = new Map(tables.map(table => [table, snapshot(table)]));
  return function finish() {
    let queued = 0;
    try {
      for (const table of tables) {
        const after = snapshot(table);
        for (const id of new Set([...before.get(table).keys(), ...after.keys()])) {
          const old = before.get(table).get(id), current = after.get(id);
          if (JSON.stringify(old) === JSON.stringify(current)) continue;
          let operation = current ? (old ? 'UPDATE' : 'INSERT') : 'DELETE';
          let payload = current || old;
          const existing = db.prepare(`SELECT * FROM sync_queue WHERE table_name=? AND record_id=?
            AND status IN ('pending','processing','failed') ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(table, id);
          if (existing) {
            payload = { ...JSON.parse(existing.payload), ...payload };
            if (existing.operation === 'INSERT' && operation !== 'DELETE') operation = 'INSERT';
          }
          if (table === 'stocks' && db.prepare("SELECT 1 FROM sqlite_master WHERE name='sync_stock_baselines'").get()) {
            const base = db.prepare('SELECT quantity,damaged_qty FROM sync_stock_baselines WHERE record_id=?').get(id);
            if (base) payload = { ...payload, _base_stock: base };
          }
          if (existing && existing.status !== 'processing') {
            db.prepare("UPDATE sync_queue SET operation=?,payload=?,status='pending',attempts=0,last_error=NULL WHERE id=?")
              .run(operation, JSON.stringify(payload), existing.id);
          } else {
            db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES (?,?,?,?,?)')
              .run(randomUUID(), table, id, operation, JSON.stringify(payload));
          }
          queued++;
        }
      }
      db.exec('COMMIT');
      console.log(`Maintenance saved with ${queued} durable sync events. Cloud delivery is pending app synchronization.`);
      return queued;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
};
