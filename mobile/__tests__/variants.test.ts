import type { VariantDto } from '@contracts/catalog';
import { attributeGroups, defaultSelection, optionAvailable, pickVariant, selectOption } from '@/features/shop/variants';

const v = (id: string, attributes: Record<string, string>, in_stock = true, price = 100): VariantDto => ({ id, name: id, sku: id, price, original_price: null, attributes, image_url: null, in_stock, available_qty: in_stock ? 5 : 0 });
const variants = [v('red-s', { Colour: 'Red', Size: 'S' }), v('red-m', { Colour: 'Red', Size: 'M' }, false), v('blue-m', { Colour: 'Blue', Size: 'M' }, true, 120)];

describe('variant selection', () => {
  it('builds attribute groups in first-seen order', () => {
    expect(attributeGroups(variants)).toEqual([{ key: 'Colour', values: ['Red', 'Blue'] }, { key: 'Size', values: ['S', 'M'] }]);
    expect(attributeGroups([v('a', {})])).toEqual([]);
  });
  it('defaults to the first in-stock variant', () => {
    expect(defaultSelection(variants)).toEqual({ Colour: 'Red', Size: 'S' });
    expect(defaultSelection([v('x', { Size: 'L' }, false)])).toEqual({ Size: 'L' });
  });
  it('picks the matching variant and its own price/stock', () => {
    expect(pickVariant(variants, { Colour: 'Blue', Size: 'M' })?.price).toBe(120);
    expect(pickVariant(variants, { Colour: 'Blue', Size: 'S' })).toBeNull();
  });
  it('marks an option unavailable when no in-stock variant remains', () => {
    expect(optionAvailable(variants, { Colour: 'Red' }, 'Size', 'M')).toBe(false);
    expect(optionAvailable(variants, { Colour: 'Red' }, 'Size', 'S')).toBe(true);
  });
  it('jumps to the best variant when the combination does not exist', () => {
    expect(selectOption(variants, { Colour: 'Red', Size: 'S' }, 'Colour', 'Blue')).toEqual({ Colour: 'Blue', Size: 'M' });
    expect(selectOption(variants, { Colour: 'Red', Size: 'S' }, 'Size', 'M')).toEqual({ Colour: 'Red', Size: 'M' });
  });
});
