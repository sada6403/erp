set -euo pipefail
node - <<'NODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const stage="/tmp/pos-desktop-2.10.3-b608a5e",expected={"Enterprise POS ERP Setup 2.10.3.exe": "9909b2a2591892078c1519cb57a2461f9b28c12b1760f23e0bbb5cac58506cfd", "Enterprise POS ERP Setup 2.10.3.exe.blockmap": "35a4e5434cf1aee67eedd2728cab2ebe519cbafd3085cab56a9a81a3805be250", "latest.yml": "d784814f7facad110dbf4fb74653078ee3cb71f5aa1cda725360370c894b475e"},publisherHash="0d2f6acf084e87b83579adcff8ff6a9140b42ef353719aa88a7b7764afe0ed5f";
for(const [name,hash] of Object.entries(expected)){const bytes=fs.readFileSync(path.join(stage,name));if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Staged artifact checksum mismatch')}
if(crypto.createHash('sha256').update(fs.readFileSync('/var/www/pos-backend/scripts/publish-vps-release.sh')).digest('hex')!==publisherHash)throw new Error('Installed publisher differs from reviewed publisher');
const meta=fs.readFileSync(path.join(stage,'latest.yml'),'utf8');const sha=meta.match(/^sha512:\s*(\S+)/m)?.[1];const target=[2,10,3];
const backup='/root/pos-recovery-backups/release-2.10.3-'+new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync(backup,{recursive:true,mode:0o700});
for(const [index,dir] of ['/var/www/updates','/var/www/html/updates'].entries()){const file=path.join(dir,'latest.yml');const current=fs.readFileSync(file,'utf8');const version=current.match(/^version:\s*(\S+)/m)?.[1];if(!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Unexpected live version format');const parts=version.split('.').map(Number);let cmp=0;for(let i=0;i<3&&!cmp;i++)cmp=Math.sign(parts[i]-target[i]);if(cmp>0)throw new Error('Refusing to downgrade a newer live release');if(cmp===0&&current.match(/^sha512:\s*(\S+)/m)?.[1]!==sha)throw new Error('Version already exists with another checksum');fs.copyFileSync(file,path.join(backup,'latest-'+index+'.yml'));fs.chmodSync(path.join(backup,'latest-'+index+'.yml'),0o600)}
console.log('Staged artifacts verified; rollback metadata backed up; existing installers retained')
NODE
UPDATES_DIR=/var/www/updates UPDATES_MIRROR_DIR=/var/www/html/updates bash /var/www/pos-backend/scripts/publish-vps-release.sh /tmp/pos-desktop-2.10.3-b608a5e 2.10.3
