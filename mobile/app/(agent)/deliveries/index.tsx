import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { radii, shadows, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, MetricCard, SkeletonList } from '@/components/ui';
import { Gradient } from '@/components/Gradient';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { codToCollect, isDelivered, useAgentDashboard, useCommission, useDeliveries, type DeliveryItem } from '@/features/agent/hooks';
import { MOCK_FEATURES } from '@/features/agent/devFeatures';
import { ReceiptModal, SoonNote } from '@/features/agent/components';
import { monthLabel, thisMonth } from '@/features/agent/month';
import { useSessionStore } from '@/store/sessionStore';

const DOT: Record<string, 'green' | 'amber' | 'blue'> = { green: 'green', gold: 'amber', blue: 'blue' };
const DOT_ORDER = ['green', 'gold', 'blue'];

/** Bold the "Heading:" part and any "+Rs ... Bonus" part of the incentive banner, like the demo's <strong> spans. */
function BannerText({ text }: { text: string }) {
  const i = text.indexOf(':');
  const head = i > 0 ? text.slice(0, i + 1) : '';
  const rest = i > 0 ? text.slice(i + 1) : text;
  const m = /\+Rs [\d,]+ [^!]*/.exec(rest);
  return (
    <Text size={11} color="yellowText" lineHeightRatio={1.35} style={{ flex: 1 }}>
      {head ? <Text size={11} weight={700} color="yellowText">{head}</Text> : null}
      {m ? rest.slice(0, m.index) : rest}
      {m ? <Text size={11} weight={700} color="yellowText">{m[0]}</Text> : null}
      {m ? rest.slice(m.index + m[0].length) : ''}
    </Text>
  );
}

const DeliveryCard = React.memo(function DeliveryCard({ d }: { d: DeliveryItem }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const done = isDelivered(d);
  const pkg = d.items?.length ? d.items.map((i) => `${i.name} (x${i.quantity})`).join(', ') : null;
  return (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ backgroundColor: theme.colors.fill, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm }}>
          <Text size={11} weight={800}>{t('agent.orderNo', { id: d.order_number })}</Text>
        </View>
        <View style={{ backgroundColor: done ? theme.colors.successBg : theme.colors.warningBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm }}>
          <Text size={10} weight={800} color={done ? 'success' : 'warning'}>{done ? t('agent.status.delivered') : t(`agent.status.${d.status}`, { defaultValue: d.status })}</Text>
        </View>
      </View>
      <Text size={13} weight={700}>{d.customer_name}{d.customer_phone ? ` (📞 ${d.customer_phone})` : ''}</Text>
      {d.address ? <Text size={11} color="textMuted" style={{ marginTop: 2 }}>{d.address}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderStyle: 'dashed', borderBottomColor: theme.colors.surfaceBorder }}>
        {pkg ? <Text size={11} style={{ flex: 1 }}>{t('agent.package')}: <Text size={11} style={{ fontStyle: 'italic' }}>{pkg}</Text></Text> : <View style={{ flex: 1 }} />}
        {d.collect_cash ? (
          <Text size={11}>{t('agent.codDue')}: <Text size={11} weight={800} color="error">{formatRs(d.amount_due)}</Text></Text>
        ) : (
          <Text size={11} weight={800} color="success">{t('agent.prepaid')}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {done ? (
          <Button label={t('agent.printReceiptEsc')} icon={'📄'} variant="printBill" fullWidth onPress={() => router.push({ pathname: '/bill/[id]', params: { id: d.id } })} />
        ) : (
          <>
            <Button label={t('agent.verifyOtp')} icon={'🔐'} variant="verify" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/deliveries/[id]', params: { id: d.id } })} />
            <Button label={t('agent.escBill')} icon={'📄'} variant="printBill" onPress={() => router.push({ pathname: '/bill/[id]', params: { id: d.id } })} />
          </>
        )}
      </View>
    </View>
  );
});

/** Agent home (demo view-agent-deliveries): hero, milestone, commission details and assigned deliveries. */
export default function AgentDeliveriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useSessionStore((s) => s.user);
  const dash = useAgentDashboard();
  const del = useDeliveries();
  const com = useCommission(thisMonth());
  const [slip, setSlip] = useState<string | null>(null);
  const showToast = useUiStore((st) => st.showToast);
  const x = dash.data?.extras;
  const d = dash.data;
  const c = com.data;
  const ordered = useMemo(() => [...del.items.filter((i) => !isDelivered(i)), ...del.items.filter(isDelivered)], [del.items]);
  const cod = x?.cod_to_collect ?? codToCollect(del.items);
  const goal = x?.goal;
  const pct = goal ? Math.round((goal.earned / Math.max(1, goal.target)) * 100) : 0;
  const code = d?.agent.code ?? user?.agent_code;
  const idLine = [code ? `${t('agent.agentId')}: ${code}` : null, x?.branch_name].filter(Boolean).join(' • ');
  const pdfSlip = () => {
    if (!MOCK_FEATURES || !c || !d) return;
    showToast(`📄 ${t('agent.slipGenerating', { month: monthLabel(c.month, t), amount: formatRs(c.total, { decimals: 2 }) })}`);
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildStatementText } = require('@/features/agent/devStatement') as typeof import('@/features/agent/devStatement');
      setSlip(buildStatementText({ agentName: d.agent.name, agentCode: d.agent.code, extras: x, commission: c }));
    }, 600);
  };

  return (
    <Screen onRefresh={() => { dash.refetch(); del.refetch(); com.refetch(); }} refreshing={del.isRefetching}>
      {/* Hero */}
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.hero, padding: 16, borderWidth: 1, borderColor: theme.colors.surfaceBorder }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={{ width: 44, height: 44, borderRadius: radii.circle, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={28}>{'🛵'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text size={15} weight={800}>{d?.agent.name ?? user?.name}</Text>
              {idLine ? <Text size={11} weight={600} color="textMuted">{idLine}</Text> : null}
            </View>
          </View>
          {x?.on_duty ? (
            <View style={{ backgroundColor: theme.colors.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
              <Text size={10} weight={800} color="success">{t('agent.onDuty')}</Text>
            </View>
          ) : null}
        </View>

        {x?.rank_label ? (
          <View style={{ borderRadius: radii.control, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.goldBorder, marginBottom: 12 }}>
            <Gradient direction="diagonal" from={theme.colors.goldBg} to={theme.colors.goldBg2} style={{ paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text size={20} color="warning">{'⭐'}</Text>
              <View style={{ flex: 1 }}>
                <Text size={12} weight={800} color="goldDark">{x.rank_detail ? `${x.rank_label} • ${x.rank_detail}` : x.rank_label}</Text>
                {x.rating != null ? (
                  <Text size={11} color="goldMid">
                    {t('agent.trustRating')}: <Text size={11} weight={800} color="goldMid">{`${x.rating} ★`}</Text>
                    {x.review_count != null ? ` (${t('agent.reviews', { count: x.review_count })})` : ''}
                  </Text>
                ) : null}
              </View>
              {x.tier ? (
                <View style={{ backgroundColor: theme.colors.warning, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.chip }}>
                  <Text size={10} weight={800} color="white">{x.tier}</Text>
                </View>
              ) : null}
            </Gradient>
          </View>
        ) : null}

        {x && (x.families_served != null || x.smartbuy_members != null || x.on_time_pct != null) ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[
              { icon: '👥', val: x.families_served, label: t('agent.familiesServed') },
              { icon: '💎', val: x.smartbuy_members, label: t('agent.smartBuyMembers') },
              { icon: '⚡', val: x.on_time_pct != null ? `${x.on_time_pct}%` : null, label: t('agent.onTime') },
            ].map((b) => (
              <View key={b.label} style={{ flex: 1, backgroundColor: theme.colors.surfaceSubtle, borderWidth: 1, borderColor: theme.colors.surfaceBorder, borderRadius: radii.input, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' }}>
                <Text size={18} style={{ marginBottom: 2 }}>{b.icon}</Text>
                <Text size={16} weight={800} mono>{b.val ?? '-'}</Text>
                <Text size={9.5} weight={700} color="textMuted" align="center" lineHeightRatio={1.2} style={{ marginTop: 2 }}>{b.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <MetricCard value={String(d?.deliveries_pending ?? 0)} label={t('agent.pendingDrops')} />
          <MetricCard value={formatRs(cod)} label={t('agent.codCash')} />
          <MetricCard value={formatRs(d?.commission_this_month ?? 0)} label={t('agent.monthCommission')} highlight />
        </View>
      </View>

      {/* Milestone */}
      {goal ? (
        <View style={{ borderRadius: radii.hero, ...shadows.banner, backgroundColor: theme.colors.ink }}>
          <View style={{ borderRadius: radii.hero, overflow: 'hidden' }}>
            <Gradient direction="diagonal" from={theme.colors.inkSoft} to={theme.colors.ink} style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Text size={28}>{'🏆'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text size={13} weight={800} color="white">{goal.title}</Text>
                    <Text size={11} color="textSubtle" style={{ marginTop: 1 }}>{goal.subtitle}</Text>
                  </View>
                </View>
                <Text size={15} weight={900} mono color="accent">{`${pct}%`}</Text>
              </View>
              <View style={{ height: 8, backgroundColor: theme.colors.slate200, borderRadius: radii.sm, overflow: 'hidden', marginTop: 8 }}>
                <Gradient direction="horizontal" from={theme.colors.accent} to={theme.colors.green} style={{ width: `${Math.min(100, pct)}%`, height: '100%' }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text size={11} color="slate300">{t('agent.earned')}: <Text size={11} weight={700} color="slate300">{formatRs(goal.earned)}</Text></Text>
                <Text size={11} color="slate300">{t('agent.goal')}: <Text size={11} weight={700} color="slate300">{formatRs(goal.target)}</Text></Text>
              </View>
              {x?.incentive_banner ? (
                <View style={{ backgroundColor: theme.colors.goldGlass, borderWidth: 1, borderColor: theme.colors.goldGlassBorder, borderRadius: radii.input, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text size={20}>{'🔥'}</Text>
                  <BannerText text={x.incentive_banner} />
                </View>
              ) : null}
              {x?.badges?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {x.badges.map((b, i) => (
                    <View key={b} accessibilityLabel={x.badge_hints?.[i] ? `${b}. ${x.badge_hints[i]}` : b} style={{ backgroundColor: theme.colors.glassSoft, borderWidth: 1, borderColor: theme.colors.glassBorder, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 }}>
                      <Text size={10.5} weight={700} color="surfaceSubtle">{b}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Gradient>
          </View>
        </View>
      ) : null}

      {/* Commission details */}
      {c ? (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.hero, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text size={11} weight={700} color="textMuted" letterSpacing={0.3} style={{ textTransform: 'uppercase' }}>{c.title ?? t('agent.commissionDetails', { month: monthLabel(c.month, t) })}</Text>
              <Text size={22} weight={800} color="primary" style={{ marginTop: 2 }}>{formatRs(c.total, { decimals: 2 })}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('agent.pdfSlip')}
              accessibilityState={{ disabled: !MOCK_FEATURES }}
              disabled={!MOCK_FEATURES}
              onPress={pdfSlip}
              hitSlop={{ top: 6, bottom: 6 }}
              style={{ minHeight: 36, backgroundColor: theme.colors.surfaceSubtle, borderWidth: 1, borderColor: theme.colors.surfaceBorder, borderRadius: radii.chip, paddingVertical: 6, paddingHorizontal: 12, justifyContent: 'center', opacity: MOCK_FEATURES ? 1 : 0.55 }}
            >
              <Text size={11} weight={700}>{`📄 ${t('agent.pdfSlip')}`}</Text>
            </Pressable>
          </View>
          {!MOCK_FEATURES ? <View style={{ marginBottom: 10 }}><SoonNote /></View> : null}
          {c.rows.length === 0 ? (
            <Text size={12} color="textMuted">{t('earnings.empty')}</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {c.rows.map((r, i) => (
                <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 }}>
                    <View style={{ width: 8, height: 8, borderRadius: radii.circle, marginTop: 5, backgroundColor: theme.colors[DOT[r.color ?? DOT_ORDER[i % 3]] ?? 'green'] }} />
                    <View style={{ flex: 1 }}>
                      <Text size={12} weight={700}>{r.source}</Text>
                      {r.detail ? <Text size={10} color="textMuted">{r.detail}</Text> : null}
                    </View>
                  </View>
                  <Text size={12} weight={800} color="success" style={{ marginLeft: 8 }}>{`+${formatRs(r.amount, { decimals: 2 })}`}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      <Text size={13} weight={800}>{`📦 ${t('agent.assignedTitle')}`}</Text>
      <View style={{ gap: 12 }}>
        {del.isLoading ? (
          <SkeletonList rows={3} height={130} />
        ) : del.isError && !del.data ? (
          <ErrorState onRetry={() => del.refetch()} />
        ) : ordered.length === 0 ? (
          <EmptyState icon={'🛵'} title={t('agent.noDeliveries')} />
        ) : (
          ordered.map((i) => <DeliveryCard key={i.id} d={i} />)
        )}
      </View>
      <ReceiptModal visible={slip != null} text={slip ?? ''} onClose={() => setSlip(null)} />
    </Screen>
  );
}
