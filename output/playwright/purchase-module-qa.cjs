const path=require('node:path'),fs=require('node:fs'),{randomUUID}=require('node:crypto')
const {app,BrowserWindow,ipcMain,dialog,session}=require('electron')
const root=path.resolve(__dirname,'../..'),sandbox=path.join(__dirname,'purchase-module-data-'+Date.now())
fs.mkdirSync(sandbox,{recursive:true});app.setPath('userData',sandbox)
process.env.POS_TEST_MODE='1'
app.commandLine.appendSwitch('remote-debugging-port','9349');app.commandLine.appendSwitch('disable-gpu')
for(const name of ['http','https']){const transport=require(name);transport.request=()=>{throw new Error('External Node networking disabled in QA')};transport.get=transport.request}
global.fetch=async()=>{throw new Error('External fetch disabled in QA')}
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!/^https?:\/\/(127\.0\.0\.1|localhost):5189\//.test(details.url)&&!details.url.startsWith('data:')&&!details.url.startsWith('file:')&&!details.url.startsWith('devtools:')}))
 const database=require('../../dist-electron/database.js');await database.initDatabase();const db=database.getDb()
 const {createCompanyStore}=require('../../dist-electron/services/companyWorkspace.js'),store=createCompanyStore()
 const branch=db.prepare('SELECT * FROM branches ORDER BY created_at LIMIT 1').get(),admin=db.prepare('SELECT * FROM users LIMIT 1').get()
 const user={id:admin.id,name:'QA Admin',branch_id:branch.id,branch:{id:branch.id,name:'Main Branch',code:'MAIN'},role:{name:'Company Admin',permissions:{all:true,inventory:true,pos:true}},business_type:'supermarket'}
 const settings={business_type:'supermarket',supermarket_stock_enabled:true,bulk_import_v2_enabled:true,keywords_enabled:false,cloud_api_url:'',cloud_api_key:'',branch_id:branch.id}
 store.set('auth_user',user);store.set('app_settings',settings)
 require('../../dist-electron/services/syncService.js').getSyncService().runSoon=()=>{}
 const supplierId=randomUUID(),productId=randomUUID()
 db.prepare('INSERT INTO suppliers(id,name,is_active) VALUES(?,?,1)').run(supplierId,'QA Grocery Supplier')
 db.prepare('INSERT INTO products(id,name,sku,barcode,unit,cost_price,selling_price,min_stock_level,is_active) VALUES(?,?,?,?,?,?,?,?,1)').run(productId,'QA Rice','QA-RICE','0001234567890','kg',100,140,5)
 const pdf=path.join(sandbox,'qa-supplier-bill.pdf');fs.writeFileSync(pdf,'%PDF-1.4\nQA supplier bill\n%%EOF')
 const csv=path.join(sandbox,'qa-stock.csv');fs.writeFileSync(csv,'sku,unit,quantity,free_quantity,discount_amount,cost_price,selling_price,mrp,supplier,invoice_no,purchase_date,batch_no\nQA-RICE,kg,2,1,20,100,150,180,QA Grocery Supplier,QA-IMPORT-1,2026-11-26,QA-IMPORT\n')
 const bills=require('../../dist-electron/services/purchaseBills.js'),billDir=path.join(sandbox,'purchase-invoices')
 const token=bills.stagePurchaseBills([pdf],billDir,user.id).token,seedId=randomUUID()
 require('../../dist-electron/services/purchaseEntry.js').createStockPurchase(db,{id:seedId,poNumber:'QA-OPENING',branchId:branch.id,userId:user.id,supplierId,purchaseType:'direct',purchaseDate:'2026-11-01',invoiceNumber:'QA-OPENING',items:[{product_id:productId,quantity:10,unit_cost:100,selling_price:140,mrp:160,batch_number:'QA-OLD'}]},id=>bills.persistStagedBills(db,id,token,user.id))
 bills.completeStagedBills(token)
 await require('../../dist-electron/services/importMigration.js').migrateImports(db,path.join(sandbox,'backups'),fs.readFileSync(path.join(root,'database/migrations/imports.up.sql'),'utf8'))
 dialog.showOpenDialog=async(...args)=>{const options=args[args.length-1];return {canceled:false,filePaths:[/Bulk Import/.test(options.title||'')?csv:pdf]}}
 dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(sandbox,'qa-export.csv')})
 require('../../dist-electron/ipc/purchases.js').registerPurchaseHandlers(ipcMain)
 require('../../dist-electron/ipc/products.js').registerProductHandlers(ipcMain)
 require('../../dist-electron/ipc/batches.js').registerBatchHandlers()
 require('../../dist-electron/ipc/imports.js').registerImportHandlers(ipcMain)
 ipcMain.handle('admin:suppliers:list',()=>({success:true,data:db.prepare('SELECT * FROM suppliers').all()}))
 ipcMain.handle('settings:get',()=>({success:true,data:settings}));ipcMain.handle('auth:whoami',()=>({success:true,data:user}))
 ipcMain.handle('qa:state',()=>({stocks:db.prepare('SELECT p.name,s.quantity FROM stocks s JOIN products p ON p.id=s.product_id').all(),purchases:db.prepare('SELECT id,po_number,status,total_amount,outstanding_amount,returned_amount FROM purchase_orders ORDER BY rowid').all(),batches:db.prepare('SELECT id,batch_number,quantity,cost_price,selling_price,mrp,supplier_returned_quantity FROM product_batches ORDER BY rowid').all(),suppliers:db.prepare('SELECT name,due_balance,credit_balance FROM suppliers').all(),returns:db.prepare('SELECT total_amount FROM purchase_returns').all(),audit_count:db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,queue_count:db.prepare('SELECT COUNT(*) n FROM sync_queue').get().n}))
 ipcMain.handle('qa:quit',()=>{setTimeout(()=>app.quit(),100);return true})
 const win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.join(__dirname,'purchase-module-qa-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}})
 await win.loadURL('http://localhost:5189/output/playwright/purchase-module-qa.html')
 console.log('QA_READY: isolated database and real purchase/product/import IPC handlers; CDP port 9349')
}).catch(error=>{console.error(error);app.exit(1)})
