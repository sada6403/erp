import { defaultQtyRules, formatPricePerUnit, formatQty, formatRs, lineTotal, round2, roundQty, snapQty, stepQty } from '@/lib/money';

describe('money', () => {
  it('formats rupees with grouping', () => {
    expect(formatRs(145000)).toBe('Rs 145,000');
    expect(formatRs(48500, { decimals: 2 })).toBe('Rs 48,500.00');
    expect(formatRs(120.5)).toBe('Rs 120.50');
    expect(formatRs(-300)).toBe('-Rs 300');
    expect(formatRs(NaN)).toBe('Rs 0');
  });

  it('avoids floating point drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(lineTotal(480, 0.25)).toBe(120);
    expect(lineTotal(333.33, 0.75)).toBe(250);
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
  });

  it('formats quantities and per-kg prices', () => {
    expect(formatQty(0.25, 'kg')).toBe('0.25 kg');
    expect(formatQty(1.5, 'kg')).toBe('1.5 kg');
    expect(formatQty(3, 'pcs')).toBe('3');
    expect(formatPricePerUnit(480, 'kg')).toBe('Rs 480 / kg');
  });

  it('weight items step in 0.25 kg and normal items in 1', () => {
    const w = defaultQtyRules('weight', 0.25, 0.25);
    expect(stepQty(0.25, 1, w)).toBe(0.5);
    expect(stepQty(1.75, 1, w)).toBe(2);
    expect(stepQty(0.5, -1, w)).toBe(0.25);
    expect(stepQty(0.25, -1, w)).toBe(0); // below minimum removes the line
    const n = defaultQtyRules('normal');
    expect(stepQty(1, 1, n)).toBe(2);
    expect(stepQty(1, -1, n)).toBe(0);
  });

  it('respects a maximum and snaps typed values', () => {
    const w = { step: 0.25, min: 0.25, max: 2 };
    expect(stepQty(2, 1, w)).toBe(2);
    expect(snapQty(0.6, w)).toBe(0.5);
    expect(snapQty(0, w)).toBe(0.25);
    expect(snapQty(9, w)).toBe(2);
  });
});
