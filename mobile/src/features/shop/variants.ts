import type { VariantDto } from '@contracts/catalog';

export interface AttrGroup {
  key: string;
  values: string[];
}
export type Selection = Record<string, string>;

/** Attribute groups (colour, size, ...) in first-seen order, from the POS variants. Empty when variants carry no attributes. */
export function attributeGroups(variants: VariantDto[]): AttrGroup[] {
  const groups = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes ?? {})) {
      if (!val) continue;
      const list = groups.get(k) ?? [];
      if (!list.includes(val)) list.push(val);
      groups.set(k, list);
    }
  }
  return Array.from(groups, ([key, values]) => ({ key, values }));
}

/** The variant whose attributes match every selected key (extra attributes on the variant are ignored only if nothing else matches). */
export function pickVariant(variants: VariantDto[], selected: Selection): VariantDto | null {
  const keys = Object.keys(selected);
  if (!keys.length) return null;
  return variants.find((v) => keys.every((k) => (v.attributes ?? {})[k] === selected[k])) ?? null;
}

/** True when choosing `value` for `key` (keeping the other selected attributes) leaves at least one in-stock variant. */
export function optionAvailable(variants: VariantDto[], selected: Selection, key: string, value: string): boolean {
  const want: Selection = { ...selected, [key]: value };
  return variants.some((v) => v.in_stock && Object.entries(want).every(([k, val]) => (v.attributes ?? {})[k] === val));
}

/** Start with the first in-stock variant (or the first one) so price and stock are always those of a real variant. */
export function defaultSelection(variants: VariantDto[]): Selection {
  const v = variants.find((x) => x.in_stock) ?? variants[0];
  return v ? { ...(v.attributes ?? {}) } : {};
}

/** After the shopper changes one attribute, keep the others if that combination exists, else jump to the best variant with the new value. */
export function selectOption(variants: VariantDto[], selected: Selection, key: string, value: string): Selection {
  const want: Selection = { ...selected, [key]: value };
  if (pickVariant(variants, want)) return want;
  const alt = variants.find((v) => v.in_stock && (v.attributes ?? {})[key] === value) ?? variants.find((v) => (v.attributes ?? {})[key] === value);
  return alt ? { ...(alt.attributes ?? {}) } : selected;
}
