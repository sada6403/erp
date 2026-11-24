import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDeliveriesResponse, AgentDeliveryDto } from '@contracts/agent';
import { agentApi } from '@/api/endpoints';
import type { DeliveryOfflineOtp } from '@/api/localTypes';
import type { AgentExtras, CommissionView, MemberView } from './types';
import { qk } from '@/query/keys';
import { selectHasRole, useSessionStore } from '@/store/sessionStore';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { useOutboxStore, uuid } from '@/store/outboxStore';
import { verifyDeliveryOtp } from '@/lib/sha256';

export type DeliveryItem = AgentDeliveryDto & DeliveryOfflineOtp;

export function useAgentDashboard() {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({
    queryKey: qk.agent.dashboard,
    queryFn: async () => (await agentApi.dashboard()) as Awaited<ReturnType<typeof agentApi.dashboard>> & { extras?: AgentExtras },
    enabled,
  });
}

export function useDeliveries() {
  const enabled = useSessionStore(selectHasRole('agent'));
  const q = useQuery({ queryKey: qk.agent.deliveries, queryFn: agentApi.deliveries, enabled });
  const items = useMemo(() => (q.data?.items ?? []) as DeliveryItem[], [q.data]);
  return { ...q, items };
}

export const isDelivered = (d: Pick<AgentDeliveryDto, 'status'>) => d.status === 'delivered';

/** Cash still to collect on open COD deliveries. */
export function codToCollect(items: AgentDeliveryDto[]): number {
  return items.filter((d) => !isDelivered(d) && d.collect_cash).reduce((s, d) => s + d.amount_due, 0);
}

export function useAgentMembers() {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({ queryKey: qk.agent.members, queryFn: async () => (await agentApi.members()) as Omit<Awaited<ReturnType<typeof agentApi.members>>, 'items'> & { items: MemberView[] }, enabled });
}

export function useCommission(month: string) {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({ queryKey: qk.agent.commission(month), queryFn: async () => (await agentApi.commission(month)) as unknown as CommissionView, enabled });
}

export function useBill(id: string) {
  return useQuery({ queryKey: qk.agent.bill(id), queryFn: () => agentApi.bill(id) });
}

export type CompleteResult = 'ok' | 'queued' | 'wrong_otp';

/**
 * Complete a delivery. If the delivery carries delivery_otp_hash the OTP is checked locally first, so a
 * wrong code is rejected offline. Offline completions go to the outbox (event id = idempotency key);
 * the server re-verifies on upload.
 */
export function useCompleteDelivery() {
  const qc = useQueryClient();
  const offline = useUiStore(selectIsOffline);
  return useMutation({
    mutationFn: async ({ delivery, otp, note }: { delivery: DeliveryItem; otp: string; note?: string }): Promise<CompleteResult> => {
      if (delivery.delivery_otp_hash && !verifyDeliveryOtp(otp, delivery.delivery_otp_hash)) return 'wrong_otp';
      const eventId = uuid();
      const applyLocal = () =>
        qc.setQueryData<AgentDeliveriesResponse>(qk.agent.deliveries, (old) =>
          old ? { items: old.items.map((d) => (d.id === delivery.id ? { ...d, status: 'delivered' as const } : d)) } : old,
        );
      if (offline) {
        if (!delivery.delivery_otp_hash) {
          // Cannot verify offline without the hash: still queue; the server decides.
        }
        useOutboxStore.getState().enqueue({ type: 'delivery_complete', payload: { deliveryId: delivery.id, otp, note } }, eventId);
        applyLocal();
        return 'queued';
      }
      await agentApi.deliveryComplete(delivery.id, { otp, event_id: eventId, note });
      applyLocal();
      qc.invalidateQueries({ queryKey: qk.agent.dashboard });
      return 'ok';
    },
  });
}
