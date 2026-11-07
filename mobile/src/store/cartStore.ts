import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';
import { defaultQtyRules, lineTotal, round2, roundQty, snapQty, stepQty, type QtyRules } from '@/lib/money';

export interface CartLine {
  /** product_id or product_id:variant_id */
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  /** Last price seen in the catalog. Display only: /checkout/quote has the real price. */
  unitPrice: number;
  unit: string;
  saleBy: 'normal' | 'weight';
  step: number;
  minQty: number;
  qty: number;
  thumbnail: string | null;
  emoji: string | null;
}

export interface CartProductInput {
  productId: string;
  variantId?: string | null;
  name: string;
  variantName?: string | null;
  unitPrice: number;
  unit: string;
  saleBy: 'normal' | 'weight';
  step?: number | null;
  minQty?: number | null;
  thumbnail?: string | null;
  emoji?: string | null;
}

interface CartState {
  lines: CartLine[];
  couponCode: string | null;
  add: (input: CartProductInput, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  increment: (key: string) => void;
  decrement: (key: string) => void;
  remove: (key: string) => void;
  setCoupon: (code: string | null) => void;
  clear: () => void;
}

export const cartKey = (productId: string, variantId?: string | null) =>
  variantId ? `${productId}:${variantId}` : productId;

export function rulesFor(line: Pick<CartLine, 'saleBy' | 'step' | 'minQty'>): QtyRules {
  return defaultQtyRules(line.saleBy, line.step, line.minQty);
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      couponCode: null,
      add: (input, qty) =>
        set((s) => {
          const key = cartKey(input.productId, input.variantId);
          const rules = defaultQtyRules(input.saleBy, input.step, input.minQty);
          const addQty = qty != null ? snapQty(qty, rules) : rules.min;
          const existing = s.lines.find((l) => l.key === key);
          if (existing) {
            return {
              lines: s.lines.map((l) =>
                l.key === key ? { ...l, qty: roundQty(l.qty + addQty), unitPrice: input.unitPrice } : l,
              ),
            };
          }
          const line: CartLine = {
            key,
            productId: input.productId,
            variantId: input.variantId ?? null,
            name: input.name,
            variantName: input.variantName ?? null,
            unitPrice: input.unitPrice,
            unit: input.unit,
            saleBy: input.saleBy,
            step: rules.step,
            minQty: rules.min,
            qty: addQty,
            thumbnail: input.thumbnail ?? null,
            emoji: input.emoji ?? null,
          };
          return { lines: [...s.lines, line] };
        }),
      setQty: (key, qty) =>
        set((s) => ({
          lines: s.lines.flatMap((l) => {
            if (l.key !== key) return [l];
            if (qty <= 0) return [];
            return [{ ...l, qty: snapQty(qty, rulesFor(l)) }];
          }),
        })),
      increment: (key) =>
        set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, qty: stepQty(l.qty, 1, rulesFor(l)) } : l)) })),
      decrement: (key) =>
        set((s) => ({
          lines: s.lines.flatMap((l) => {
            if (l.key !== key) return [l];
            const next = stepQty(l.qty, -1, rulesFor(l));
            return next <= 0 ? [] : [{ ...l, qty: next }];
          }),
        })),
      remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
      setCoupon: (couponCode) => set({ couponCode }),
      clear: () => set({ lines: [], couponCode: null }),
    }),
    { name: 'np-cart', storage: createJSONStorage(() => zustandStorage) },
  ),
);

/** Indicative subtotal from last-seen catalog prices. The server quote is authoritative. */
export function cartSubtotal(lines: CartLine[]): number {
  return round2(lines.reduce((sum, l) => sum + lineTotal(l.unitPrice, l.qty), 0));
}

/** Badge number = number of distinct lines (weight quantities make a unit count meaningless). */
export function cartLineCount(lines: CartLine[]): number {
  return lines.length;
}

export const toQuoteItems = (lines: CartLine[]) =>
  lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.qty }));
