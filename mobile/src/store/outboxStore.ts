import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CreateVisitRequest } from '@contracts/staff';
import { zustandStorage } from '@/lib/storage';

/**
 * Outbox: ONLY agent delivery status/completion, field visits and wishlist toggles are queued offline.
 * Orders, wallet payments, join requests and password changes are never queued (offline-cache skill).
 */
export type OutboxItem =
  | { id: string; type: 'delivery_status'; payload: { deliveryId: string; status: 'in_transit' }; attempts: number }
  | { id: string; type: 'delivery_complete'; payload: { deliveryId: string; otp: string; note?: string }; attempts: number }
  | { id: string; type: 'wishlist_add' | 'wishlist_remove'; payload: { productId: string }; attempts: number }
  // a field visit: item.id is the client_event_id, so a replay after a dropped connection returns the stored visit
  | { id: string; type: 'visit'; payload: Omit<CreateVisitRequest, 'client_event_id'>; attempts: number };

export type OutboxInput = OutboxItem extends infer T ? (T extends OutboxItem ? Omit<T, 'id' | 'attempts'> : never) : never;

interface OutboxState {
  items: OutboxItem[];
  enqueue: (item: OutboxInput, id?: string) => string;
  remove: (id: string) => void;
  bumpAttempts: (id: string) => void;
  clear: () => void;
}

/** RFC4122-ish v4 id (no crypto dependency); doubles as the Idempotency-Key / event_id. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      enqueue: (item, id = uuid()) => {
        set((s) => ({ items: [...s.items, { ...item, id, attempts: 0 } as OutboxItem] }));
        return id;
      },
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      bumpAttempts: (id) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1 } : i)) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'np-outbox', storage: createJSONStorage(() => zustandStorage) },
  ),
);
