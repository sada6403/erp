import { cartLineCount, cartSubtotal, toQuoteItems, useCartStore } from '@/store/cartStore';

const tomato = { productId: 'p1', name: 'Tomato', unitPrice: 480, unit: 'kg', saleBy: 'weight' as const, step: 0.25, minQty: 0.25 };
const soap = { productId: 'p2', variantId: 'v1', name: 'Soap', variantName: 'Large', unitPrice: 100, unit: 'pcs', saleBy: 'normal' as const };

describe('cart store', () => {
  beforeEach(() => useCartStore.getState().clear());

  it('adds weight items at the minimum step and merges repeats', () => {
    const s = useCartStore.getState();
    s.add(tomato);
    s.add(tomato, 0.5);
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0].qty).toBe(0.75);
  });

  it('keeps variants as separate lines with decimal-safe subtotal', () => {
    const s = useCartStore.getState();
    s.add(tomato, 0.75);
    s.add(soap, 2);
    const { lines } = useCartStore.getState();
    expect(lines.map((l) => l.key)).toEqual(['p1', 'p2:v1']);
    expect(cartSubtotal(lines)).toBe(360 + 200);
    expect(cartLineCount(lines)).toBe(2);
  });

  it('increment/decrement follow the step and decrement below min removes the line', () => {
    const s = useCartStore.getState();
    s.add(tomato);
    s.increment('p1');
    expect(useCartStore.getState().lines[0].qty).toBe(0.5);
    s.decrement('p1');
    s.decrement('p1');
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('builds quote items with decimal quantities', () => {
    useCartStore.getState().add(tomato, 1.25);
    useCartStore.getState().add(soap, 3);
    expect(toQuoteItems(useCartStore.getState().lines)).toEqual([
      { product_id: 'p1', variant_id: null, quantity: 1.25 },
      { product_id: 'p2', variant_id: 'v1', quantity: 3 },
    ]);
  });

  it('removes and clears', () => {
    const s = useCartStore.getState();
    s.add(tomato);
    s.add(soap);
    s.remove('p1');
    expect(useCartStore.getState().lines).toHaveLength(1);
    s.clear();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});
