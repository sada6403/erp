/**
 * Money and quantity helpers.
 * Money is a plain number of rupees. Quantities are REAL numbers (weight items sell in 0.25 kg steps),
 * never integers (kickoff section 2, supermarket rules). All arithmetic is rounded to avoid 0.1+0.2 drift.
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Quantities keep up to 3 decimals (e.g. 0.125 kg). */
export function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * formatRs(145000) -> "Rs 145,000"; formatRs(48500, { decimals: 2 }) -> "Rs 48,500.00".
 * Fractional amounts always show two decimals unless `decimals` says otherwise.
 */
export function formatRs(amount: number, opts: { decimals?: number; sign?: boolean } = {}): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  const decimals = opts.decimals ?? (Number.isInteger(round2(abs)) ? 0 : 2);
  const [i, d] = abs.toFixed(decimals).split('.');
  const body = `Rs ${groupThousands(i)}${d ? `.${d}` : ''}`;
  if (negative) return `-${body}`;
  return opts.sign ? `+${body}` : body;
}

/** Line total = unit price x quantity, rounded to cents. */
export function lineTotal(unitPrice: number, qty: number): number {
  return round2(unitPrice * qty);
}

/** "0.25 kg", "1.5 kg", "3" (pieces have no unit label). */
export function formatQty(qty: number, unit?: string | null): string {
  const q = roundQty(qty);
  const text = Number.isInteger(q) ? String(q) : String(q);
  return unit && unit !== 'pcs' && unit !== 'unit' ? `${text} ${unit}` : text;
}

/** "Rs 450 / kg" for weight items. */
export function formatPricePerUnit(price: number, unit: string): string {
  return `${formatRs(price)} / ${unit}`;
}

export interface QtyRules {
  /** step for +/- buttons: 1 for pieces, 0.25 for weight items */
  step: number;
  min: number;
  max?: number | null;
}

export function defaultQtyRules(saleBy: 'unit' | 'normal' | 'weight' | undefined, step?: number | null, min?: number | null): QtyRules {
  if (saleBy === 'weight') {
    const s = step && step > 0 ? step : 0.25;
    return { step: s, min: min && min > 0 ? min : s };
  }
  return { step: 1, min: 1 };
}

/** Next quantity after pressing + or -. Returns 0 when going below the minimum (remove the line). */
export function stepQty(current: number, direction: 1 | -1, rules: QtyRules): number {
  const next = roundQty(current + direction * rules.step);
  if (direction === -1 && next < rules.min) return 0;
  if (rules.max != null && next > rules.max) return roundQty(rules.max);
  return Math.max(next, 0);
}

/** Snap a typed quantity to the nearest allowed step, never below the minimum. */
export function snapQty(value: number, rules: QtyRules): number {
  if (!Number.isFinite(value) || value <= 0) return rules.min;
  const steps = Math.round(value / rules.step);
  const snapped = roundQty(Math.max(steps, 1) * rules.step);
  const bounded = Math.max(snapped, rules.min);
  return rules.max != null ? Math.min(bounded, roundQty(rules.max)) : bounded;
}
