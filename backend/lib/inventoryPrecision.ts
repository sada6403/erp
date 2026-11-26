import type {QueryClient} from './db'

/** Expand DECIMAL capacity only: same numeric type, no loss of existing integer/decimal digits. */
export async function ensureInventoryPrecision(client:Pick<QueryClient,'query'>){
 const fields:Record<string,Record<string,number>>={
  products:{cost_price:9,selling_price:6},stocks:{quantity:6,damaged_qty:6},stock_movements:{quantity:6},
  purchase_items:{quantity:6,ordered_qty:6,received_qty:6,unit_cost:9,selling_price:6},
  product_batches:{quantity:6,cost_price:9,selling_price:6},
  product_uom:{conversion_factor:6},invoice_items:{quantity:6,unit_price:6},
  sale_batch_allocations:{quantity:6,returned_quantity:6,unit_cost:9,unit_selling_price:6},
  return_batch_allocations:{quantity:6},return_items:{quantity:6},
 }
 const {rows}=await client.query<{TABLE_NAME:string;COLUMN_NAME:string;DATA_TYPE:string;NUMERIC_PRECISION:number;NUMERIC_SCALE:number;IS_NULLABLE:string;COLUMN_DEFAULT:string|null;COLUMN_TYPE?:string;EXTRA?:string}>(
  `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_TYPE,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${Object.keys(fields).map(()=>'?').join(',')})`,Object.keys(fields))
 for(const row of rows){
  const required=fields[row.TABLE_NAME]?.[row.COLUMN_NAME]
  if(!required||row.DATA_TYPE.toLowerCase()!=='decimal'||Number(row.NUMERIC_SCALE)>=required)continue
  if(row.EXTRA)throw new Error(`Inventory precision requires review for generated column ${row.TABLE_NAME}.${row.COLUMN_NAME}`)
  const precision=Math.max(24,Number(row.NUMERIC_PRECISION)-Number(row.NUMERIC_SCALE)+required)
  if(precision>65)throw new Error(`Cannot safely expand inventory precision for ${row.TABLE_NAME}.${row.COLUMN_NAME}`)
  const nullable=row.IS_NULLABLE==='YES'?'NULL':'NOT NULL'
  let defaultValue=''
  if(row.COLUMN_DEFAULT!=null){
   if(!/^-?\d+(\.\d+)?$/.test(String(row.COLUMN_DEFAULT)))throw new Error('Unexpected inventory numeric default; schema review is required')
   defaultValue=` DEFAULT ${row.COLUMN_DEFAULT}`
  }else if(row.IS_NULLABLE==='YES')defaultValue=' DEFAULT NULL'
  const unsigned=/unsigned/i.test(row.COLUMN_TYPE||'')?' UNSIGNED':''
  await client.query(`ALTER TABLE \`${row.TABLE_NAME}\` MODIFY COLUMN \`${row.COLUMN_NAME}\` DECIMAL(${precision},${required})${unsigned} ${nullable}${defaultValue}`)
 }
}
