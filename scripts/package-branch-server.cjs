const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..')
const version=JSON.parse(fs.readFileSync(path.join(root,'branch-hub/package.json'),'utf8')).version
const target=path.join(root,'release',`branch-server-${version}`)
const files=[['branch-hub/package.json','package.json'],['branch-hub/package-lock.json','package-lock.json'],
  ...['store','server','cli','postgres','holdNumber'].map(name=>[`branch-hub/lib/${name}.js`,`lib/${name}.js`]),
  ['scripts/create-branch-hub-config.cjs','scripts/create-branch-hub-config.cjs'],
  ['scripts/set-branch-hub-url.cjs','scripts/set-branch-hub-url.cjs'],
  ['docs/BRANCH_POSTGRES_WINDOWS.md','README.md'],['docs/BRANCH_HUB_SETUP.md','BRANCH_HUB_SETUP.md']]
const sums=[]
for(const [source,destination]of files){
  const data=fs.readFileSync(path.join(root,source)),output=path.join(target,destination)
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,data)
  sums.push(`${crypto.createHash('sha256').update(data).digest('hex')}  ${destination}`)
}
fs.writeFileSync(path.join(target,'SHA256SUMS.txt'),sums.join('\n')+'\n')
console.log(`Prepared branch-server-${version}: ${files.length} reviewed files; no credentials or business databases included`)
