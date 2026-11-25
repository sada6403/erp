set +e
printf '\nFIREWALL\n'
ufw status verbose
printf '\nSTARTUP UNITS\n'
systemctl list-unit-files 'pm2*' 'actions.runner*' --no-legend --no-pager
printf '\nSAVED PROCESS METADATA\n'
node - <<'NODE'
const fs=require('fs');const p='/root/.pm2/dump.pm2';if(fs.existsSync(p)){const entries=JSON.parse(fs.readFileSync(p,'utf8'));console.log(JSON.stringify(entries.map(x=>({name:x.name,status:x.status,autostart:x.autostart,cwd:x.pm_cwd}))))}else console.log('No saved process dump')
NODE
printf '\nLOCAL HTTP\n'
curl --max-time 5 -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
