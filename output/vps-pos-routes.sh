node - <<'NODE'
const fs=require('fs'),path=require('path');for(const name of fs.readdirSync('/etc/nginx/sites-enabled')){const text=fs.readFileSync(path.join('/etc/nginx/sites-enabled',name),'utf8');if(!text.includes('4001'))continue;console.log(JSON.stringify({site:name,serverNames:[...text.matchAll(/server_name\s+([^;]+);/g)].map(x=>x[1]),upstreams:[...text.matchAll(/proxy_pass\s+([^;]+);/g)].map(x=>x[1])}))}
NODE
