import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getClient } from '@/api/instance';
import { qk } from '@/query/keys';
import { MOCK_FEATURES } from './devFeatures';
import type { PrinterInfo } from './types';

/** Dev-mock only: the paired thermal printer. Disabled (never fetched) in production. */
export function usePrinter() {
  return useQuery({
    queryKey: ['agent', 'printer'] as const,
    queryFn: async () => (await getClient().get<PrinterInfo>('/agent/printer')).data,
    enabled: MOCK_FEATURES,
  });
}

/** Dev-mock only: record a weekly cash collection for a member. */
export function useRecordCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, amount }: { memberId: string; amount: number }) =>
      (await getClient().post<{ ok: boolean }>(`/agent/members/${encodeURIComponent(memberId)}/collections`, { amount })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agent.members }),
  });
}
