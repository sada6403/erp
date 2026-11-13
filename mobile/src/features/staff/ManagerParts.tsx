import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StaffPerformanceDto } from '@contracts/staff';
import { Text } from '@/components/Text';
import { ProgressBar } from '@/components/ui';
import { formatRs } from '@/lib/money';

/** Achieved vs target for one person or team (same figures the server sent; nothing is recomputed here). */
export function PerformanceBar({ p }: { p: StaffPerformanceDto }) {
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text size={11} color="textMuted">{`${t('sf.team.achieved')} ${formatRs(p.achieved, { decimals: 2 })}`}</Text>
        <Text size={11} weight={700} color="textMuted">
          {p.achievement_pct == null ? t('sf.team.noTarget') : t('sf.team.pct', { pct: p.achievement_pct.toFixed(1) })}
        </Text>
      </View>
      <ProgressBar pct={p.achievement_pct ?? 0} />
      <Text size={11} color="textMuted" style={{ marginTop: 4 }}>
        {p.target_source === 'none' ? t('sf.team.noTarget') : `${p.target_source === 'rollup' ? t('sf.team.teamTarget') : t('sf.team.target')} ${formatRs(p.target, { decimals: 2 })}`}
        {p.registrations_target != null ? ` • ${t('sf.team.regs')} ${p.registrations}/${p.registrations_target}` : ''}
      </Text>
    </View>
  );
}

/** Depth of each person under `meId`, from the reports_to links the server sent (people outside the subtree never appear). */
export function treeOrder<T extends { staff_id: string; reports_to: string | null; name: string }>(items: T[], meId: string): { item: T; depth: number }[] {
  const kids = new Map<string, T[]>();
  for (const i of items) if (i.staff_id !== meId && i.reports_to) kids.set(i.reports_to, [...(kids.get(i.reports_to) ?? []), i]);
  const out: { item: T; depth: number }[] = [];
  const walk = (id: string, depth: number) => {
    for (const k of (kids.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ item: k, depth });
      walk(k.staff_id, depth + 1);
    }
  };
  walk(meId, 0);
  return out;
}
