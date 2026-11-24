import fs from 'fs';
import path from 'path';
import en from '@/i18n/en.json';

const ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))];

describe('design system hygiene', () => {
  it('has no hard-coded hex colours outside src/theme and src/dev', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (rel.startsWith('src/theme/') || rel.startsWith('src/dev/')) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
}

describe('i18n coverage', () => {
  it('has an English string for every literal t("key") used in the app', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1];
        const plural = lookup(`${key}_other`) !== undefined;
        if (lookup(key) === undefined && !plural) missing.push(`${key} (${path.relative(ROOT, f)})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has an error message for every backend error code', () => {
    const common = fs.readFileSync(path.join(ROOT, '../backend/lib/app/contracts/common.ts'), 'utf8');
    const block = common.slice(common.indexOf('export type AppErrorCode'), common.indexOf('/** Every non-2xx'));
    const codes = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);
    const missing = codes.filter((c) => lookup(`errors.${c}`) === undefined);
    expect(missing).toEqual([]);
  });
});
