export interface ImportField {key:string;label:string;required?:boolean;aliases?:string[];kind:'text'|'number'|'date'|'code'}
export type ImportType='products'|'opening_stock'|'stock_in'|'prices'|'keywords'|'categories'|'suppliers'|'brands'
const f=(key:string,label:string,required=false,aliases:string[]=[]):ImportField=>({key,label,required,aliases,kind:['cost_price','selling_price','quantity','tax_rate','min_stock_level'].includes(key)?'number':['expiry_date','purchase_date'].includes(key)?'date':['sku','barcode','quick_code'].includes(key)?'code':'text'})
const sku=f('sku','SKU',true,['item code','product code'])
const price=f('selling_price','Selling price',false,['sale price','retail price'])
export const IMPORT_TYPES:{id:ImportType;label:string;permission:string;admin:boolean;fields:ImportField[]}[]=[
 {id:'products',label:'Master products',permission:'import.products',admin:true,fields:[sku,f('name','Product name',true,['item name','description']),f('barcode','Barcode'),f('category','Category'),f('supplier','Supplier'),f('brand','Brand'),f('unit','Unit'),f('cost_price','Cost price'),price,f('tax_rate','Tax %'),f('min_stock_level','Minimum stock'),f('keywords','Search keywords'),f('quick_code','Quick code')]},
 {id:'opening_stock',label:'Opening stock (add quantities)',permission:'import.stock',admin:false,fields:[sku,f('quantity','Quantity',true,['qty','stock']),f('cost_price','Cost price',true,['unit cost']),f('batch_no','Batch number'),f('expiry_date','Expiry date'),f('purchase_date','Stock date')]},
 {id:'stock_in',label:'Stock-in / supplier receipt',permission:'import.stock',admin:false,fields:[sku,f('quantity','Quantity',true,['qty']),f('cost_price','Cost price',true,['unit cost']),price,f('supplier','Supplier',true),f('invoice_no','Supplier invoice number',true),f('purchase_date','Purchase date',true),f('batch_no','Batch number'),f('expiry_date','Expiry date')]},
 {id:'prices',label:'Price update',permission:'import.products',admin:true,fields:[sku,f('cost_price','Cost price'),price]},
 {id:'keywords',label:'Search keywords',permission:'import.products',admin:true,fields:[sku,f('keyword','Keyword',true),f('scope','Scope (global / branch / terminal / user)'),f('keyword_type','Keyword type')]},
 {id:'categories',label:'Categories',permission:'import.products',admin:true,fields:[f('name','Category name',true),f('description','Description')]},
 {id:'suppliers',label:'Suppliers',permission:'import.products',admin:true,fields:[f('name','Supplier name',true),f('phone','Phone'),f('email','Email'),f('address','Address'),f('contact','Contact person')]},
 // Brands are stored on products in this system; do not create a parallel brand master.
 {id:'brands',label:'Product brands',permission:'import.products',admin:true,fields:[sku,f('brand','Brand',true)]},
]
export function importType(id:string){const type=IMPORT_TYPES.find(row=>row.id===id);if(!type)throw new Error('Unsupported import type');return type}
export interface ImportOptions {
 duplicate:'skip'|'update'|'error';unknown:'create'|'skip'|'error';decimal:'.'|',';
 dateFormat:'YYYY-MM-DD'|'DD/MM/YYYY'|'MM/DD/YYYY';hasHeader:boolean;splitNames:boolean;
 slashMode:'keep'|'first-part';keywordDelimiter:string;defaults:Record<string,string>;
 encoding?:string;delimiter?:string;allOrNothing:boolean
}
export const DEFAULT_IMPORT_OPTIONS:ImportOptions={duplicate:'error',unknown:'error',decimal:'.',dateFormat:'YYYY-MM-DD',hasHeader:true,splitNames:false,slashMode:'keep',keywordDelimiter:'|',defaults:{},allOrNothing:false}
export function normalizeImportOptions(input:Partial<ImportOptions>={}):ImportOptions {
 const options={...DEFAULT_IMPORT_OPTIONS,...input,defaults:{...(input.defaults||{})}}
 if(!['skip','update','error'].includes(options.duplicate)||!['create','skip','error'].includes(options.unknown)||!['.',','].includes(options.decimal)||!['YYYY-MM-DD','DD/MM/YYYY','MM/DD/YYYY'].includes(options.dateFormat)||!['keep','first-part'].includes(options.slashMode))throw new Error('Invalid import options')
 if(typeof options.keywordDelimiter!=='string'||options.keywordDelimiter.length!==1)throw new Error('Use a single keyword delimiter')
 for(const key of ['hasHeader','splitNames','allOrNothing'] as const)if(typeof options[key]!=='boolean')throw new Error('Invalid import toggle')
 if(options.delimiter&&![';',',','\t','|'].includes(options.delimiter))throw new Error('Invalid file delimiter')
 return options
}
export function validateImportMapping(type:string,mapping:Record<string,number>,width:number,defaults:Record<string,string>) {
 const fields=importType(type).fields;const used=new Set<number>()
 for(const [key,column] of Object.entries(mapping)) {
  if(!fields.some(field=>field.key===key)||!Number.isInteger(column)||column< -1||column>=width)throw new Error('Invalid column mapping')
  if(column>=0&&used.has(column))throw new Error('One source column is mapped twice; choose a separate column or Ignore')
  if(column>=0)used.add(column)
 }
 for(const field of fields)if(field.required&&!(mapping[field.key]>=0)&&!String(defaults[field.key]||'').trim())throw new Error(`Map required field: ${field.label}`)
}
export function suggestImportMapping(type:string,headers:string[]) {
 const norm=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'')
 const used=new Set<number>();const result:Record<string,number>={}
 for(const field of importType(type).fields){const names=[field.key,field.label,...field.aliases||[]].map(norm);let column=headers.findIndex((header,index)=>!used.has(index)&&names.includes(norm(header)));if(column<0)column=headers.findIndex((header,index)=>!used.has(index)&&norm(header).length>3&&names.some(name=>name.includes(norm(header))||norm(header).includes(name)));result[field.key]=column;if(column>=0)used.add(column)}
 return result
}
export function importNumber(value:unknown,decimal:'.'|',') {
 const text=String(value??'').trim();if(!text)return undefined
 const pattern=decimal==='.'?/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/:/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/
 if(!pattern.test(text))throw new Error(`Invalid number: ${text}`)
 const number=Number(decimal==='.'?text.replace(/,/g,''):text.replace(/\./g,'').replace(',','.'))
 if(!Number.isFinite(number)||number<0||number>1e12)throw new Error('Number must be between zero and 1,000,000,000,000')
 return number
}
export function importDate(value:unknown,format:ImportOptions['dateFormat']) {
 const text=String(value??'').trim();if(!text)return undefined
 const parts=text.split(format==='YYYY-MM-DD'?'-':'/').map(Number)
 const [y,m,d]=format==='YYYY-MM-DD'?parts:format==='DD/MM/YYYY'?[parts[2],parts[1],parts[0]]:[parts[2],parts[0],parts[1]]
 const date=new Date(Date.UTC(y,m-1,d))
 if(parts.length!==3||!/^\d{4}$/.test(String(y))||y<1900||y>2200||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw new Error(`Invalid date (${format}): ${text}`)
 return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
export function importCsv(rows:unknown[][]) {
 const cell=(value:unknown)=>{let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
