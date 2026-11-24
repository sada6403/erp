export const normalizeLogin = (value:unknown) => String(value??'').normalize('NFC').trim().toLowerCase()
export function validateLoginId(value:unknown) {
 const id=normalizeLogin(value)
 if(!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id))throw new Error('User ID: use 2–64 letters, numbers, dots, underscores or hyphens')
 return id
}
export function suggestLoginId(email:unknown,used:Set<string>=new Set()) {
 let base=normalizeLogin(email).split('@')[0].replace(/[^a-z0-9._-]/g,'').replace(/^[^a-z0-9]+/,'').slice(0,48)||'user'
 if(base.length<2)base+='user'
 let id=base,n=1;while(used.has(id))id=base+ ++n
 return id
}
