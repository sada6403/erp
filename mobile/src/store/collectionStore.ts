import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CollectionStatus } from '@contracts/collections';
import { zustandStorage } from '@/lib/storage';

/** A receipt as the agent saw it on this phone. Kept so it can be shown (and shared) offline, before the server has seen it. */
export interface LocalReceipt {
  id: string;
  receipt_number: string;
  member_id: string;
  customer_name: string;
  scheme_name: string;
  scheme_number: string | null;
  cycle_no: number | null;
  amount: number;
  late_fee_applied: number;
  balance_after: number;
  collected_at: string;
  agent_code: string;
  agent_name: string;
  company_name: string;
  branch_name: string | null;
  /** 'queued' = taken offline, not on the server yet */
  status: 'queued' | CollectionStatus;
}

const KEEP = 60;
const pad = (n: number) => String(n).padStart(6, '0');
const parts = (receipt: string) => {
  const m = /^(.*?)(\d{1,9})$/.exec(receipt);
  return { prefix: m ? m[1] : `${receipt}-`, num: m ? Number(m[2]) : 0 };
};

interface CollectionState {
  /** Highest receipt number used per agent code on this phone */
  seq: Record<string, number>;
  receipts: LocalReceipt[];
  /** Next receipt number AG001-000123. `serverLast` is the highest the server has seen for this agent (continues after a reinstall). */
  nextReceiptNumber: (agentCode: string, serverLast?: number) => string;
  /** Same agent, a number the server already has under a different event: take the next free one. Returns it. */
  reissue: (oldNumber: string) => string;
  add: (r: LocalReceipt) => void;
  patch: (id: string, p: Partial<LocalReceipt>) => void;
  /** Newer server figures win; queued receipts the server does not know yet are kept */
  mergeServer: (rows: Pick<LocalReceipt, 'id' | 'status' | 'balance_after' | 'late_fee_applied' | 'amount'>[]) => void;
  clear: () => void;
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      seq: {},
      receipts: [],
      nextReceiptNumber: (agentCode, serverLast = 0) => {
        const next = Math.max(get().seq[agentCode] ?? 0, serverLast) + 1;
        set((s) => ({ seq: { ...s.seq, [agentCode]: next } }));
        return `${agentCode}-${pad(next)}`;
      },
      reissue: (oldNumber) => {
        const { prefix, num } = parts(oldNumber);
        const code = prefix.replace(/-$/, '');
        const next = Math.max(get().seq[code] ?? 0, num) + 1;
        const fresh = `${prefix}${pad(next)}`;
        set((s) => ({ seq: { ...s.seq, [code]: next }, receipts: s.receipts.map((r) => (r.receipt_number === oldNumber ? { ...r, receipt_number: fresh } : r)) }));
        return fresh;
      },
      add: (r) => set((s) => ({ receipts: [r, ...s.receipts.filter((x) => x.id !== r.id)].slice(0, KEEP) })),
      patch: (id, p) => set((s) => ({ receipts: s.receipts.map((r) => (r.id === id ? { ...r, ...p } : r)) })),
      mergeServer: (rows) =>
        set((s) => {
          const by = new Map(rows.map((r) => [r.id, r]));
          return { receipts: s.receipts.map((r) => (by.has(r.id) ? { ...r, ...by.get(r.id)! } : r)) };
        }),
      clear: () => set({ seq: {}, receipts: [] }),
    }),
    { name: 'np-collections', storage: createJSONStorage(() => zustandStorage) },
  ),
);
