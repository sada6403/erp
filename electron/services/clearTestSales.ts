import type Database from 'better-sqlite3'

const quote=(value:string)=>'"'+value.replace(/"/g,'""')+'"'
/** For a newly copied sandbox baseline ONLY. Current stock/master balances stay
 * as its opening values. No cancellation, cloud deletes or live DB writes. */
export function clearCopiedTestSales(db:Database.Database){
  const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string;sql:string}[]
  if(!tables.some(table=>table.name==='invoices'))return
  db.pragma('foreign_keys=ON')
  db.transaction(()=>{
    db.pragma('defer_foreign_keys=ON')
    db.exec('CREATE TEMP TABLE test_sales_targets(table_name TEXT,row_id INTEGER,PRIMARY KEY(table_name,row_id))')
    db.exec("INSERT INTO test_sales_targets SELECT 'invoices',rowid FROM invoices")
    let changes=1
    while(changes){
      changes=0
      for(const table of tables){
        if(/WITHOUT\s+ROWID/i.test(table.sql))continue
        const columns=db.prepare(`PRAGMA table_info(${quote(table.name)})`).all() as {name:string}[]
        const fks=db.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all() as {id:number;seq:number;table:string;from:string;to:string}[]
        // Older migrations used invoice_id without a declared FK.
        if(columns.some(column=>column.name==='invoice_id')&&!fks.some(fk=>fk.from==='invoice_id'))fks.push({id:-1,seq:0,table:'invoices',from:'invoice_id',to:'id'})
        const groups=new Map<number,typeof fks>()
        for(const fk of fks)groups.set(fk.id,[...(groups.get(fk.id)||[]),fk])
        for(const group of groups.values()){
          const parent=group[0].table
          if(!tables.some(t=>t.name===parent&&!/WITHOUT\s+ROWID/i.test(t.sql)))continue
          if(group.some(fk=>!fk.to))continue
          const join=group.map(fk=>`c.${quote(fk.from)}=p.${quote(fk.to)}`).join(' AND ')
          changes+=db.prepare(`INSERT OR IGNORE INTO test_sales_targets SELECT ?,c.rowid FROM ${quote(table.name)} c
            JOIN ${quote(parent)} p ON ${join} JOIN test_sales_targets t ON t.table_name=? AND t.row_id=p.rowid`).run(table.name,parent).changes
        }
      }
    }
    for(const table of tables){
      if(/WITHOUT\s+ROWID/i.test(table.sql))continue
      db.prepare(`DELETE FROM ${quote(table.name)} WHERE rowid IN (SELECT row_id FROM test_sales_targets WHERE table_name=?)`).run(table.name)
    }
    // Queues belong to the copied source terminal; no historical events may escape.
    for(const name of ['sync_queue','branch_billing_outbox','held_carts'])if(tables.some(t=>t.name===name))db.exec(`DELETE FROM ${quote(name)}`)
    db.exec('DROP TABLE test_sales_targets')
    if((db.pragma('foreign_key_check') as unknown[]).length)throw new Error('Test cleanup could not preserve database references')
  })()
}
