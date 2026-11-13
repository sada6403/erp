// Authorized TK Fresh Choice deployment. Keeps tenant/configuration data on this VPS.
const fs=require('fs')
const path=require('path')
const crypto=require('crypto')
const {spawn}=require('child_process')
const {pipeline}=require('stream/promises')
const root='/var/www/pos-backend',stateDir='/var/lib/pos-director',backupRoot='/var/backups/pos-director'
let stage='initial validation'
if(process.platform!=='linux'||process.getuid?.()!==0||fs.realpathSync(process.cwd())!==root)throw new Error('Run only through the authorized VPS deployment service')
const mysql=require(root+'/backend/node_modules/mysql2/promise')
const configFile=root+'/backend/.env',nginxFile=fs.realpathSync('/etc/nginx/sites-enabled/updates'),indexFile='/var/www/updates/index.html'
const env=Object.fromEntries(fs.readFileSync(configFile,'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at).trim(),l.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]}))
const url=env.DATABASE_URL?new URL(env.DATABASE_URL):null
const cfg={host:url?.hostname||env.MYSQL_HOST||'127.0.0.1',port:Number(url?.port||env.MYSQL_PORT||3306),user:url?decodeURIComponent(url.username):env.MYSQL_USER,password:url?decodeURIComponent(url.password):env.MYSQL_PASSWORD,database:url?.pathname.slice(1)||env.MYSQL_DATABASE||'pos_erp_saas'}
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex')
function privateDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700)}
function backupFile(source,destination){fs.copyFileSync(source,destination);fs.chmodSync(destination,0o600)}
async function cli(binary,args,input,output,socketAdmin=false,capture=false){
 const child=spawn(binary,args,{env:{...process.env,MYSQL_PWD:socketAdmin?'':cfg.password},stdio:['pipe','pipe','pipe']})
 let diagnostic=''
 child.stderr.on('data',chunk=>{if(diagnostic.length<8192)diagnostic+=String(chunk)})
 const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error('Database utility could not start')));child.once('close',code=>{
  if(code===0)return resolve()
  const error=new Error('Database utility failed')
  const numeric=diagnostic.match(/ERROR\s+(\d+)/i)
  const command=['LOCK TABLES','CREATE','ALTER','DROP','TRIGGER','INSERT','SELECT','REFERENCES'].find(verb=>diagnostic.toUpperCase().includes(verb+' COMMAND DENIED'))
  error.publicCode=(numeric?'MYSQL_'+numeric[1]:'DATABASE_CLI_FAILURE')+(command?'_'+command.replace(/ /g,'_'):'')
  reject(error)
 })})
 const streams=[]
 if(input)streams.push(pipeline(fs.createReadStream(input),child.stdin));else child.stdin.end()
 let captured=''
 if(output)streams.push(pipeline(child.stdout,fs.createWriteStream(output,{flags:'wx',mode:0o600})))
 else if(capture)child.stdout.on('data',chunk=>{captured+=String(chunk)})
 else child.stdout.resume()
 await Promise.all([done,...streams])
 return captured
}
const args=()=>[`--host=${cfg.host}`,`--port=${cfg.port}`,`--user=${cfg.user}`]
async function migration(db){
 const sql=fs.readFileSync(root+'/backend/database/migrate-007-management.sql','utf8')
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement)
 try{await db.query("ALTER TABLE invoices ADD COLUMN agent_id CHAR(36) NULL")}catch{}
 try{await db.query("ALTER TABLE invoices ADD INDEX idx_invoices_agent (agent_id)")}catch{}
}
async function prepare(){
 stage='private backup preparation'
 privateDir(backupRoot);privateDir(stateDir)
 const dir=path.join(backupRoot,'setup-'+stamp());privateDir(dir)
 const db=await mysql.createConnection(cfg)
 let restoreSchema
 try{
  const [companies]=await db.query("SELECT db_schema,status FROM companies WHERE LOWER(name)=LOWER(?)",['TK Fresh Choice'])
  if(companies.length!==1||!['active','trial'].includes(companies[0].status))throw new Error('Requested company is not uniquely active')
  const tenant=companies[0].db_schema
  if(!/^[a-zA-Z0-9_]+$/.test(tenant)||tenant===cfg.database)throw new Error('Invalid tenant schema')
  backupFile(configFile,path.join(dir,'backend.env'))
  backupFile(nginxFile,path.join(dir,'updates.nginx'))
  backupFile(indexFile,path.join(dir,'index.html'))
  for(const [schema,name]of [[cfg.database,'registry.sql'],[tenant,'tenant.sql']]){
   const destination=path.join(dir,name)
   await cli('mysqldump',[...args(),'--single-transaction','--skip-add-locks','--skip-add-drop-table','--routines','--triggers','--no-tablespaces',schema],null,destination)
   if(fs.statSync(destination).size<100)throw new Error('Backup is empty; refusing migration')
  }
  console.log('Private database/configuration backups completed.')
  stage='VPS-local restore verification'
  // Local socket administration is confined to restore/validation/cleanup of generated test schemas.
  // Never grant DROP or other broader privileges to the runtime application account.
  await cli('mysql',['--protocol=socket','--user=root','-e','SELECT 1'],null,null,true)
  // Early failed restore attempts can leave empty, generated test namespaces.
  const candidates=await cli('mysql',['--protocol=socket','--user=root','--batch','--skip-column-names','-e',"SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'pos_director_restore_test_%'"],null,null,true,true)
  for(const name of candidates.trim().split('\n')){
   if(!/^pos_director_restore_test_[a-f0-9]{12}$/.test(name))continue
   const tables=await cli('mysql',['--protocol=socket','--user=root','--batch','--skip-column-names','-e',`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${name}'`],null,null,true,true)
   if(Number(tables.trim())===0)await cli('mysql',['--protocol=socket','--user=root','-e',`DROP DATABASE \`${name}\``],null,null,true)
  }
  // Restore proof is performed on the VPS in a temporary database, never exported.
  restoreSchema='pos_director_restore_test_'+crypto.randomBytes(6).toString('hex')
  await db.query(`CREATE DATABASE \`${restoreSchema}\``)
  // Restoration is a maintenance operation, confined to this generated test database.
  await cli('mysql',['--protocol=socket','--user=root',restoreSchema],path.join(dir,'tenant.sql'),null,true)
  stage='restored test-schema validation'
  await cli('mysql',['--protocol=socket','--user=root',restoreSchema],root+'/backend/database/migrate-007-management.sql',null,true)
  const original=await mysql.createConnection({...cfg,database:tenant})
  try{for(const table of ['invoices','customers']){
   const [[source]]=await original.query(`SELECT COUNT(*) n FROM \`${table}\``)
   const copy=await cli('mysql',['--protocol=socket','--user=root','--batch','--skip-column-names',restoreSchema,'-e',`SELECT COUNT(*) FROM \`${table}\``],null,null,true,true)
   if(String(source.n)!==copy.trim())throw new Error('Restore verification failed; refusing production migration')
  }}finally{await original.end()}
  await cli('mysql',['--protocol=socket','--user=root','-e',`DROP DATABASE \`${restoreSchema}\``],null,null,true);restoreSchema=null
  stage='confirmed tenant additive migration'
  const target=await mysql.createConnection({...cfg,database:tenant})
  try{
   await migration(target)
   await target.query("INSERT INTO management_settings (id,value) VALUES ('enabled','true') ON DUPLICATE KEY UPDATE value='true'")
  }finally{await target.end()}
  let config=fs.readFileSync(configFile,'utf8')
  config=config.replace(/^MANAGEMENT_PUBLIC_ORIGIN=.*\r?\n?/gm,'').trimEnd()+'\nMANAGEMENT_PUBLIC_ORIGIN=https://updates.nfplantation.com\n'
  fs.writeFileSync(configFile+'.director-next',config,{mode:0o600});fs.renameSync(configFile+'.director-next',configFile)
  fs.writeFileSync(path.join(stateDir,'prepared-v1.json'),JSON.stringify({backupDirectory:dir,preparedAt:new Date().toISOString()}),{mode:0o600})
  console.log('Director setup backup, restore verification and target-only additive migration completed. Private backups remain on the VPS.')
 }finally{
  if(restoreSchema&&/^pos_director_restore_test_[a-f0-9]{12}$/.test(restoreSchema))await cli('mysql',['--protocol=socket','--user=root','-e',`DROP DATABASE \`${restoreSchema}\``],null,null,true).catch(()=>{})
  await db.end()
 }
}
async function command(binary,args){
 const child=spawn(binary,args,{stdio:'ignore'})
 await new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error('Server utility unavailable')));child.once('close',code=>code===0?resolve():reject(new Error('Server configuration validation/reload failed')))})
}
async function publish(){
 stage='same-domain publication and routing verification'
 if(!fs.existsSync(path.join(stateDir,'prepared-v1.json')))throw new Error('Backup-first preparation is required')
 const dir=path.join(backupRoot,'publication-'+stamp());privateDir(dir)
 backupFile(nginxFile,path.join(dir,'updates.nginx'));backupFile(indexFile,path.join(dir,'index.html'))
 for(const name of ['robots.txt','sitemap.xml']){const dest=path.join('/var/www/updates',name);if(fs.existsSync(dest)){backupFile(dest,path.join(dir,name))}}
 let config=fs.readFileSync(nginxFile,'utf8')
 const include='include /var/www/pos-backend/deploy/nginx/director-updates.locations.conf;'
 if(!config.includes(include)){
  if(!/root\s+\/var\/www\/updates\s*;/.test(config))throw new Error('Expected updates server root not found')
  config=config.replace(/root\s+\/var\/www\/updates\s*;/,match=>match+'\n    '+include)
 }
 try{
  fs.writeFileSync(nginxFile+'.director-next',config,{mode:0o644});fs.renameSync(nginxFile+'.director-next',nginxFile)
  await command('nginx',['-t']);await command('systemctl',['reload','nginx'])
  const local=await fetch('http://127.0.0.1:4001/director',{signal:AbortSignal.timeout(20000)})
  if(!local.ok)throw new Error('Director backend is not ready')
  fs.copyFileSync(root+'/deploy/updates/index.html',indexFile+'.director-next');fs.chmodSync(indexFile+'.director-next',0o644);fs.renameSync(indexFile+'.director-next',indexFile)
  for(const name of ['robots.txt','sitemap.xml']){const src=path.join(root,'deploy/updates',name);const dest=path.join('/var/www/updates',name);if(fs.existsSync(src)){fs.copyFileSync(src,dest+'.director-next');fs.chmodSync(dest+'.director-next',0o644);fs.renameSync(dest+'.director-next',dest)}}
  const api=await fetch('https://updates.nfplantation.com/api/management/me',{signal:AbortSignal.timeout(20000)})
  const result=await api.json()
  if(api.status!==401||result.success!==false)throw new Error('Public Director API routing verification failed')
  fs.writeFileSync(path.join(stateDir,'installed-v1'),new Date().toISOString(),{mode:0o600})
  console.log('Same-domain Director login published; existing installer and update metadata preserved.')
 }catch(error){
  fs.copyFileSync(path.join(dir,'updates.nginx'),nginxFile)
  fs.copyFileSync(path.join(dir,'index.html'),indexFile)
  for(const name of ['robots.txt','sitemap.xml']){const bak=path.join(dir,name);const dest=path.join('/var/www/updates',name);if(fs.existsSync(bak)){fs.copyFileSync(bak,dest)}}
  await command('nginx',['-t']).then(()=>command('systemctl',['reload','nginx'])).catch(()=>{})
  throw error
 }
}
;(async()=>{if(process.argv[2]==='prepare')await prepare();else if(process.argv[2]==='publish')await publish();else throw new Error('Specify prepare or publish')})().catch(error=>{
 const category=error.publicCode||(/^[A-Z_]+$/.test(error.code||'')?error.code:'VERIFICATION_FAILURE')
 console.error(`Director deployment stopped at ${stage} (${category}). Existing backups remain private on the VPS; no credentials or tenant metadata are logged.`);process.exitCode=1
})
