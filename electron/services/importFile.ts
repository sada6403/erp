import * as XLSX from 'xlsx'
import {decodeDelimitedText,type TextEncoding} from '../lib/textEncoding'
export interface ImportLimits {maxBytes:number;maxRows:number;retentionDays:number;rollbackHours:number;chunkSize:number}
export const DEFAULT_IMPORT_LIMITS:ImportLimits={maxBytes:10*1024*1024,maxRows:10_000,retentionDays:30,rollbackHours:48,chunkSize:100}
function checkWorkbookArchive(bytes:Buffer,limits:ImportLimits) {
 if(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50)return
 let end=-1
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break}
 if(end<0)throw new Error('Invalid workbook archive')
 const entries=bytes.readUInt16LE(end+10);let cursor=bytes.readUInt32LE(end+16),total=0
 if(entries>2000||cursor===0xffffffff)throw new Error('Workbook archive is too large or uses unsupported ZIP64')
 for(let i=0;i<entries;i++) {
  if(cursor+46>bytes.length||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid workbook archive directory')
  const size=bytes.readUInt32LE(cursor+24);if(size===0xffffffff)throw new Error('ZIP64 workbooks are not supported')
  total+=size;if(total>Math.min(limits.maxBytes*20,128*1024*1024))throw new Error('Expanded workbook exceeds the import memory limit')
  cursor+=46+bytes.readUInt16LE(cursor+28)+bytes.readUInt16LE(cursor+30)+bytes.readUInt16LE(cursor+32)
 }
}
export function importLimits(input:Partial<ImportLimits>={}):ImportLimits {
 const result={...DEFAULT_IMPORT_LIMITS,...input}
 const bounds:Record<keyof ImportLimits,[number,number]>={maxBytes:[1024,100*1024*1024],maxRows:[1,100_000],retentionDays:[1,365],rollbackHours:[1,720],chunkSize:[1,500]}
 for(const key of Object.keys(bounds) as (keyof ImportLimits)[])if(!Number.isSafeInteger(result[key])||result[key]<bounds[key][0]||result[key]>bounds[key][1])throw new Error(`Invalid import limit: ${key}`)
 return result
}
export function readImportFile(bytes:Buffer,filename:string,limits:ImportLimits,encoding?:string,delimiter?:string) {
 if(!bytes.length||bytes.length>limits.maxBytes)throw new Error('File exceeds configured size limit or is empty')
 const ext=filename.split('.').pop()?.toLowerCase()
 if(!['xlsx','xls','csv','tsv'].includes(ext||''))throw new Error('Choose XLSX, XLS, CSV or TSV')
 let book:XLSX.WorkBook,label='Workbook (decoded cells)',warnings:string[]=[]
 if(ext==='csv'||ext==='tsv') {
  if(encoding&&!['utf-8','utf-8-bom','utf-16le','utf-16be','windows-1252','iso-8859-1'].includes(encoding))throw new Error('Unsupported encoding override')
  const decoded=decodeDelimitedText(bytes,{encoding:encoding as TextEncoding|undefined,maxBytes:limits.maxBytes,repairMojibake:true})
  label=decoded.label;warnings=decoded.warnings.map(row=>row.message)
  book=XLSX.read(decoded.text,{type:'string',raw:true,FS:delimiter||(ext==='tsv'?'\t':undefined),sheetRows:limits.maxRows+2})
 } else {checkWorkbookArchive(bytes,limits);book=XLSX.read(bytes,{type:'buffer',sheetRows:limits.maxRows+2,cellText:true,cellDates:false})}
 if(book.SheetNames.length>100)throw new Error('Workbook has too many sheets')
 const sheets:Record<string,string[][]>={}
 for(const name of book.SheetNames) {
  const grid=XLSX.utils.sheet_to_json<string[]>(book.Sheets[name],{header:1,defval:'',raw:false,blankrows:true}).map(row=>row.map(value=>String(value??'')))
  if(grid.length>limits.maxRows+1)throw new Error(`Sheet ${name} exceeds ${limits.maxRows} rows`)
  if(grid.some(row=>row.length>500))throw new Error('At most 500 source columns are supported')
  sheets[name]=grid
 }
 if(!Object.values(sheets).some(grid=>grid.some(row=>row.some(value=>value.trim()))))throw new Error('No rows found in file')
 return {sheets,label,warnings,format:ext==='csv'||ext==='tsv'?'delimited' as const:'xlsx' as const}
}
