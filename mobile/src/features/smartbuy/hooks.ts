import { useQuery } from '@tanstack/react-query';
import { smartbuyApi } from '@/api/endpoints';
import { qk } from '@/query/keys';
import { selectHasRole, useSessionStore } from '@/store/sessionStore';

export function useMySchemes() {
  const enabled = useSessionStore(selectHasRole('smartbuy'));
  return useQuery({ queryKey: qk.smartbuy.schemes, queryFn: smartbuyApi.mySchemes, enabled });
}

export function useOpenSchemes() {
  return useQuery({ queryKey: qk.smartbuy.open, queryFn: smartbuyApi.openSchemes });
}

export function useStatement(schemeId?: string) {
  return useQuery({ queryKey: qk.smartbuy.statement(schemeId ?? ''), queryFn: () => smartbuyApi.statement(schemeId as string), enabled: !!schemeId });
}

export function useDraws(schemeId?: string) {
  return useQuery({ queryKey: qk.smartbuy.draws(schemeId ?? ''), queryFn: () => smartbuyApi.draws(schemeId as string), enabled: !!schemeId });
}

export function useWallet() {
  const enabled = useSessionStore(selectHasRole('smartbuy'));
  return useQuery({ queryKey: qk.wallet.balance, queryFn: smartbuyApi.wallet, enabled });
}

export function useWalletTransactions() {
  const enabled = useSessionStore(selectHasRole('smartbuy'));
  return useQuery({ queryKey: qk.wallet.transactions, queryFn: smartbuyApi.walletTransactions, enabled });
}
