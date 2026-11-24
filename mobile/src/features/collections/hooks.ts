import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionDto, MemberDueDto } from '@contracts/collections';
import { collectionsApi } from '@/api/endpoints';
import { toAppError } from '@/api/client';
import { qk } from '@/query/keys';
import { useAgentDashboard } from '@/features/agent/hooks';
import { useCompany } from '@/features/common/hooks';
import { selectHasRole, useSessionStore } from '@/store/sessionStore';
import { useCollectionStore, type LocalReceipt } from '@/store/collectionStore';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { useOutboxStore, uuid } from '@/store/outboxStore';

/** Today's collections and the cash summary. Server figures also settle the status of receipts kept on this phone (pending -> approved / rejected). */
export function useCollectionsToday() {
  const enabled = useSessionStore(selectHasRole('agent'));
  const q = useQuery({ queryKey: qk.agent.collectionsToday, queryFn: collectionsApi.today, enabled, staleTime: 30_000 });
  const data = q.data;
  useEffect(() => {
    if (data) useCollectionStore.getState().mergeServer(data.items);
  }, [data]);
  return q;
}

export type CollectInput = { memberId: string; customerName: string; schemeName: string; due: MemberDueDto; amount: number; notes?: string };

/**
 * Take cash from a member. Online it goes straight to the server; offline (or unreachable) it is queued with its own client event id, which is
 * also the server's contribution id, so a replay can never create a second row. The receipt number comes from this phone's counter
 * (AG001-000123), continued from the highest number the server has seen, and the server re-validates everything.
 */
export function useLogCollection() {
  const qc = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const company = useCompany();
  const dash = useAgentDashboard();
  const today = useCollectionsToday();
  return async (c: CollectInput): Promise<{ result: 'sent' | 'queued'; receipt: LocalReceipt }> => {
    const code = user?.agent_code ?? dash.data?.agent.code ?? 'AG';
    const id = uuid();
    const collectedAt = new Date().toISOString();
    const receiptNumber = useCollectionStore.getState().nextReceiptNumber(code, today.data?.last_receipt_seq ?? 0);
    const receipt: LocalReceipt = {
      id, receipt_number: receiptNumber, member_id: c.memberId, customer_name: c.customerName, scheme_name: c.schemeName, scheme_number: null,
      cycle_no: c.due.cycle_no, amount: c.amount,
      late_fee_applied: c.due.late_fee > 0 && c.amount > c.due.late_fee ? c.due.late_fee : 0,
      balance_after: Math.max(0, Math.round((c.due.collectable - c.amount) * 100) / 100), collected_at: collectedAt,
      agent_code: code, agent_name: user?.name ?? dash.data?.agent.name ?? code, company_name: company?.name ?? '',
      branch_name: (dash.data as { extras?: { branch_name?: string | null } } | undefined)?.extras?.branch_name ?? null, status: 'queued',
    };
    const body = { member_id: c.memberId, amount: c.amount, receipt_number: receiptNumber, collected_at: collectedAt, ...(c.notes ? { notes: c.notes } : {}) };
    const queue = () => {
      useCollectionStore.getState().add(receipt);
      useOutboxStore.getState().enqueue({ type: 'collection', payload: body }, id);
      return { result: 'queued' as const, receipt };
    };
    if (selectIsOffline(useUiStore.getState())) return queue();
    try {
      const res = await collectionsApi.create({ ...body, client_event_id: id });
      const stored: LocalReceipt = { ...receipt, ...serverFields(res.collection), status: res.collection.status };
      useCollectionStore.getState().add(stored);
      void qc.invalidateQueries({ queryKey: [...qk.agent.all, 'collections'] });
      void qc.invalidateQueries({ queryKey: qk.agent.members });
      return { result: 'sent', receipt: stored };
    } catch (e) {
      if (toAppError(e).isUnreachable) return queue();
      throw e;
    }
  };
}

const serverFields = (c: CollectionDto): Partial<LocalReceipt> => ({
  receipt_number: c.receipt_number, amount: c.amount, late_fee_applied: c.late_fee_applied, balance_after: c.balance_after, cycle_no: c.cycle_no,
});
