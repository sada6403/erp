/** Optional identifier-only convenience. Storage denial must never block login. */
export function readRememberedLogin(key:string){try{return localStorage.getItem(key)||''}catch{return ''}}
export function rememberLogin(key:string,identifier:string,enabled:boolean){try{if(enabled)localStorage.setItem(key,identifier.trim());else localStorage.removeItem(key)}catch{/* Browser privacy/quota mode: continue without remembering. */}}
