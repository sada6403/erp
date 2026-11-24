import { fewLeftQty } from '../src/lib/stock';

describe('fewLeftQty', () => {
  it('shows the quantity only for in-stock items with 5 or fewer left', () => {
    expect(fewLeftQty(true, 3)).toBe(3);
    expect(fewLeftQty(true, 5)).toBe(5);
    expect(fewLeftQty(true, 2.5)).toBe(2.5);
    expect(fewLeftQty(true, 6)).toBeNull();
    expect(fewLeftQty(true, 0)).toBeNull();
    expect(fewLeftQty(false, 3)).toBeNull();
    expect(fewLeftQty(true, null)).toBeNull();
  });
});
