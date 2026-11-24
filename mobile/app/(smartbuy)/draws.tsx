import React from 'react';
import { Screen } from '@/components/Shell';
import { DrawsView } from '@/features/smartbuy/DrawsView';

/** Monthly draw results (demo view-smartbuy-draws). Other members' names arrive masked from the server. */
export default function DrawsScreen() {
  return (
    <Screen>
      <DrawsView />
    </Screen>
  );
}
