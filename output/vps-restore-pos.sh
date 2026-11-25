set -euo pipefail
node - <<'NODE'
const fs=require('fs'),path=require('path');const dir='/root/pos-recovery-backups/'+new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync(dir,{recursive:true,mode:0o700});for(const file of ['/root/.pm2/dump.pm2','/etc/ufw/user.rules','/etc/ufw/user6.rules','/etc/default/ufw','/etc/ufw/ufw.conf'])if(fs.existsSync(file)){const dest=path.join(dir,file.replace(/\//g,'_'));fs.copyFileSync(file,dest);fs.chmodSync(dest,0o600)}console.log('Private firewall and PM2 backups created')
NODE
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow out 53/udp
ufw allow out 53/tcp
ufw allow out 80/tcp
ufw allow out 443/tcp
ufw allow out 123/udp
node - <<'NODE'
const fs=require('fs'),cp=require('child_process');
try{
const saved=JSON.parse(fs.readFileSync('/root/.pm2/dump.pm2','utf8'));
const current=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const approved=new Set(['pos-backend','pos-superadmin','pos-staging']);
const wanted=saved.filter(x=>approved.has(x.name)&&x.status==='online');
if(!wanted.some(x=>x.name==='pos-backend')||!wanted.some(x=>x.name==='pos-superadmin'))throw new Error('Expected saved production POS processes missing');
const apps=[];
for(const x of wanted){const existing=current.find(p=>p.name===x.name);if(existing?.pm2_env?.status==='online')continue;if(existing){const r=cp.spawnSync('pm2',['restart',x.name],{stdio:'inherit'});if(r.status!==0)throw new Error('Could not restart approved POS process');continue}const env={...(x.env||{})};for(const key of ['PORT','NODE_ENV','POS_DISABLE_AUTO_MIGRATIONS','MANAGEMENT_PUBLIC_ORIGIN','PM2_SERVE_PATH','PM2_SERVE_PORT','PM2_SERVE_SPA','PM2_SERVE_HOMEPAGE'])if(env[key]===undefined&&x[key]!==undefined)env[key]=x[key];apps.push({name:x.name,script:x.pm_exec_path,args:x.args,cwd:x.pm_cwd,interpreter:x.exec_interpreter,exec_mode:x.exec_mode,instances:x.instances||1,env,autostart:true,autorestart:x.autorestart!==false})}
if(apps.length){const file='/root/.pm2/pos-recovery-config.json';fs.writeFileSync(file,JSON.stringify({apps}),{mode:0o600});fs.chmodSync(file,0o600);try{const result=cp.spawnSync('pm2',['start',file],{stdio:'inherit'});if(result.status!==0)throw new Error('POS process restoration failed')}finally{fs.unlinkSync(file)}}
console.log('Approved POS processes restored; unrelated stopped apps were not started')
}catch(error){console.error(error.message);process.exitCode=1}
NODE
pm2 save
systemctl enable pm2-root.service
systemctl start actions.runner.sada6403-erp.pos-vps.service
printf '\nSERVICE STATE\n'
systemctl is-active nginx actions.runner.sada6403-erp.pos-vps.service
printf '\nLOCAL POS HEALTH\n'
for attempt in 1 2 3 4 5; do
  code=$(curl --max-time 5 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/api/health || true)
  if [[ "$code" == 401 || "$code" == 200 ]]; then printf 'Backend HTTP %s\n' "$code"; break; fi
  sleep 2
done
