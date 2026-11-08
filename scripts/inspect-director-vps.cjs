const fs=require('fs')
const root='/var/www/pos-backend/backend'
const mysql=require(root+'/node_modules/mysql2/promise')
const env=Object.fromEntries(fs.readFileSync(root+'/.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at).trim(),l.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]}))
const url=env.DATABASE_URL?new URL(env.DATABASE_URL):null
;(async()=>{
 const db=await mysql.createConnection({host:url?.hostname||env.MYSQL_HOST||'127.0.0.1',port:Number(url?.port||env.MYSQL_PORT||3306),user:url?decodeURIComponent(url.username):env.MYSQL_USER,password:url?decodeURIComponent(url.password):env.MYSQL_PASSWORD,database:url?.pathname.slice(1)||env.MYSQL_DATABASE||'pos_erp_saas'})
 try {
  const [rows]=await db.query("SELECT id,name,slug,business_type,status,db_schema FROM companies WHERE LOWER(name)=LOWER('TK Fresh Choice')")
  if(rows.length!==1||!['active','trial'].includes(rows[0].status)||!/^\w+$/.test(rows[0].db_schema))throw new Error('Target company is not uniquely available')
  console.log('Confirmed the requested company is available for Director setup. No tenant metadata is logged.')
 }finally{await db.end()}
})().catch(()=>{console.error('Could not inspect target company metadata; credentials are not logged');process.exitCode=1})
