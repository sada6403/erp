import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { CategoryDto } from '@contracts/catalog';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { ScreenHeading, SkeletonList, EmptyState } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { emojiFor } from '@/components/ProductCard';
import { useCategories } from '@/features/shop/hooks';

interface Dept {
  cat: CategoryDto;
  total: number;
  children: CategoryDto[];
}

/** Top-level departments with sub-categories; products in children count toward the parent; empty ones are hidden. */
export function buildDepartments(items: CategoryDto[]): Dept[] {
  const byParent = new Map<string, CategoryDto[]>();
  for (const c of items) if (c.parent_id) byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
  const ids = new Set(items.map((c) => c.id));
  return items
    .filter((c) => !c.parent_id || !ids.has(c.parent_id))
    .map((cat) => {
      const children = (byParent.get(cat.id) ?? []).filter((k) => k.product_count > 0).sort((a, b) => a.sort_order - b.sort_order);
      return { cat, children, total: cat.product_count + children.reduce((s, k) => s + k.product_count, 0) };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => a.cat.sort_order - b.cat.sort_order);
}

/** Departments: one card per top-level category from the server (cached for offline). */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useCategories();
  const depts = useMemo(() => buildDepartments(data?.items ?? []), [data]);
  const open = (id: string) => router.push({ pathname: '/catalog', params: { category: id } });
  return (
    <Screen gap={0} onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('categories.title')} sub={t('categories.sub')} />
      {isLoading ? (
        <SkeletonList rows={5} height={64} />
      ) : depts.length === 0 ? (
        <EmptyState icon="🏷️" title={t('categories.empty')} />
      ) : (
        <View style={{ gap: 12 }}>
          {depts.map(({ cat, total, children }) => (
            <View key={cat.id} style={{ backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, overflow: 'hidden' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cat.name}
                onPress={() => open(cat.id)}
                style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: pressed ? theme.colors.surfaceSubtle : 'transparent' })}
              >
                <View style={{ width: 48, height: 48, borderRadius: radii.control, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {cat.image_url ? <Image source={{ uri: cat.image_url }} style={{ width: 48, height: 48 }} contentFit="cover" cachePolicy="disk" /> : <Text size={24}>{emojiFor(cat.name)}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text size={14} weight={800} numberOfLines={1}>{cat.name}</Text>
                  <Text size={11} color="textMuted" style={{ marginTop: 2 }}>{t('categories.count', { count: total })}</Text>
                </View>
                <Text size={14} color="primary">➔</Text>
              </Pressable>
              {children.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 14 }}>
                  {children.map((k) => (
                    <Pressable
                      key={k.id}
                      accessibilityRole="button"
                      accessibilityLabel={k.name}
                      onPress={() => open(k.id)}
                      style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radii.control, backgroundColor: theme.colors.fill }}
                    >
                      <Text size={12} weight={700}>{k.name} · {k.product_count}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
