import {describe,it,expect} from 'vitest'
import {importNumber,importDate,validateImportMapping,suggestImportMapping,importCsv} from './importRegistry'
import {readImportFile,DEFAULT_IMPORT_LIMITS} from '../services/importFile'
import * as XLSX from 'xlsx'
describe('import parser and mapping contracts',()=>{
 it('rejects missing and duplicated column mappings',()=>{expect(()=>validateImportMapping('products',{sku:0,name:0},2,{})).toThrow('mapped twice');expect(()=>validateImportMapping('products',{sku:0},2,{})).toThrow('Product name');expect(suggestImportMapping('products',['Item Code','Product Name'])).toMatchObject({sku:0,name:1})})
 it('parses explicit decimal and date formats strictly',()=>{expect(importNumber('1.234,50',',')).toBe(1234.5);expect(importNumber('1,234.50','.')).toBe(1234.5);expect(()=>importNumber('1,23','.')).toThrow();expect(()=>importNumber('-1','.')).toThrow();expect(importDate('24/11/2026','DD/MM/YYYY')).toBe('2026-11-24');expect(()=>importDate('2026-02-30','YYYY-MM-DD')).toThrow()})
 it('preserves UTF-8 native aliases, quoted delimiters and leading-zero codes',()=>{const parsed=readImportFile(Buffer.from('sku,name,keywords\n001,"Milk, Powder",அரிசி'),'sample.csv',DEFAULT_IMPORT_LIMITS);expect(Object.values(parsed.sheets)[0][1]).toEqual(['001','Milk, Powder','அரிசி'])})
 it('supports TSV, XLSX sheet selection and displayed codes',()=>{
  const tsv=readImportFile(Buffer.from('sku\tname\n001\tMilk'),'sample.tsv',DEFAULT_IMPORT_LIMITS);expect(Object.values(tsv.sheets)[0][1][0]).toBe('001')
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['sku','name'],['001','Tea']]),'Products');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['sku','selling_price'],['001','30']]),'Prices')
  expect(Object.keys(readImportFile(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'sample.xlsx',DEFAULT_IMPORT_LIMITS).sheets)).toEqual(['Products','Prices'])
  expect(readImportFile(XLSX.write(book,{type:'buffer',bookType:'biff8'}),'sample.xls',DEFAULT_IMPORT_LIMITS).sheets.Products[1][0]).toBe('001')
 })
 it('enforces file/row limits and makes Excel-safe UTF-8 error CSV',()=>{expect(()=>readImportFile(Buffer.from('abcd'),'sample.csv',{...DEFAULT_IMPORT_LIMITS,maxBytes:3})).toThrow('size limit');expect(()=>readImportFile(Buffer.from('name\na\nb\nc'),'sample.csv',{...DEFAULT_IMPORT_LIMITS,maxRows:1})).toThrow('rows');expect(importCsv([['=SUM(A1)','அரிசி']])).toBe('\ufeff"\'=SUM(A1)","அரிசி"\r\n')})
})
