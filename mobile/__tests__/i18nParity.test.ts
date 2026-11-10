// Every English string must exist in Tamil and Sinhala with the same {{placeholders}}.
import en from '../src/i18n/en.json';
import ta from '../src/i18n/ta.json';
import si from '../src/i18n/si.json';

type Tree = { [k: string]: string | Tree };

function flat(o: Tree, prefix = ''): [string, string][] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flat(v, prefix + k + '.')));
}
const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');

describe.each([
  ['ta', ta],
  ['si', si],
])('%s translations', (_lang, tree) => {
  const english = new Map(flat(en as Tree));
  const other = new Map(flat(tree as Tree));

  it('has every English key', () => {
    expect([...english.keys()].filter((k) => !other.has(k))).toEqual([]);
  });

  it('has no keys that English lacks', () => {
    expect([...other.keys()].filter((k) => !english.has(k))).toEqual([]);
  });

  it('keeps the same placeholders', () => {
    const bad = [...english].filter(([k, v]) => other.has(k) && placeholders(v) !== placeholders(other.get(k)!)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
