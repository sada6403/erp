#!/usr/bin/env node
// mask-secrets: stdin -> stdout, replaces secret VALUES with ***MASKED*** and keeps the key names.
// AGENTS.md rule 14: ANY command that reads a config / env / crontab / unit / dump file MUST pipe through this.
//   ssh -o BatchMode=yes nfvps 'crontab -l' | node scripts/mask-secrets.mjs
// Best effort, deliberately over-masks. Never rely on it for output you know holds secrets: print key NAMES only.

export const MASK = '***MASKED***'

// Key names that make a value secret.
const K = '(?:PASS(?:WORD|WD)?|SECRET|TOKEN|KEY|DATABASE_URL|SMTP|CRED|AUTH|SIGN|COOKIE|SALT|PRIVATE)'
const NAME = `[A-Za-z0-9_.-]*${K}[A-Za-z0-9_.-]*`
const BEFORE = '(?<![A-Za-z0-9_])'
const VAL = `"[^"\\n]*"|'[^'\\n]*'|[^\\s"'&,;}]+`

const already = (s) => s.includes(MASK)
// Re-quote helper: keeps the original quote style around the mask.
const maskVal = (v) => (v[0] === '"' ? `"${MASK}"` : v[0] === "'" ? `'${MASK}'` : MASK)

export function maskLine(line) {
  let s = line

  // 1. URL userinfo  scheme://user:pass@host  (also user:pass@ without scheme inside connection strings)
  s = s.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s:/@'"]+):([^\s@/'"]+)@/g, (m, a, u) => `${a}${u}:${MASK}@`)

  // 2. Cookie / Set-Cookie header: the whole rest of the line is secret
  s = s.replace(/(\b(?:set-)?cookie\s*:\s*)(?!\*\*\*MASKED)([^"'\n]+)/gi, (m, a) => `${a}${MASK}`)

  // 3. JSON  "key":"value"  (string values only)
  s = s.replace(new RegExp(`(")(${NAME})("\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")`, 'gi'), (m, q1, k, mid, v) =>
    already(v) ? m : `${q1}${k}${mid}"${MASK}"`)

  // 4. KEY=value   (env files, systemd Environment=, docker -e, --flag=value, query strings)
  s = s.replace(new RegExp(`${BEFORE}(${NAME})(\\s*=\\s*)(${VAL})`, 'gi'), (m, k, eq, v) =>
    already(v) ? m : `${k}${eq}${maskVal(v)}`)

  // 5. KEY: value  and HTTP headers incl. x-cron-secret: v, Authorization: Bearer v, YAML keys
  s = s.replace(new RegExp(`${BEFORE}(${NAME})(\\s*:\\s*)((?:Bearer|Basic|Token|Digest)\\s+)?(${VAL})`, 'gi'), (m, k, colon, scheme, v) =>
    already(v) ? m : `${k}${colon}${scheme || ''}${maskVal(v)}`)

  // 6. --flag value  (--password hunter2, --api-key abc)
  s = s.replace(new RegExp(`(\\s)(--?[A-Za-z0-9_-]*${K}[A-Za-z0-9_-]*)(\\s+)(?!-)(${VAL})`, 'gi'), (m, ws, flag, sp, v) =>
    already(v) ? m : `${ws}${flag}${sp}${maskVal(v)}`)

  // 7. Long random-looking tokens in ANY context: 32+ chars of hex/base64url containing a digit and a letter.
  //    '/' is not part of the token charset (paths and URLs stay readable); UUIDs are left alone.
  s = s.replace(/(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9+/_-])/g, (m) => {
    if (already(m)) return m
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m)) return m
    return /[0-9]/.test(m) && /[A-Za-z]/.test(m) ? MASK : m
  })
  return s
}

export function maskSecrets(text) {
  return String(text).split(/(\r?\n)/).map((p, i) => (i % 2 ? p : maskLine(p))).join('')
}

// CLI: only when run directly, not when imported by the unit test.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { buf += d })
  process.stdin.on('end', () => { process.stdout.write(maskSecrets(buf)) })
}
