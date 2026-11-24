import React from 'react';
import { Screen } from '@/components/Shell';
import { SchemesView } from '@/features/smartbuy/SchemesView';
import { useMySchemes } from '@/features/smartbuy/hooks';

/** My Schemes hub (demo view-smartbuy-schemes). */
export default function SchemesScreen() {
  const { refetch, isRefetching } = useMySchemes();
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <SchemesView />
    </Screen>
  );
}
