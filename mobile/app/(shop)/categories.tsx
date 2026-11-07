import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { ScreenHeading, SkeletonList, EmptyState } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { emojiFor } from '@/components/ProductCard';
import { useCategories } from '@/features/shop/hooks';

/** Departments: one card per top-level category from the server (cached for offline). */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useCategories();
  const cats = (data?.items ?? []).filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  return (
    <Screen gap={0} onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('categories.title')} sub={t('categories.sub')} />
      {isLoading ? (
        <SkeletonList rows={5} height={64} />
      ) : cats.length === 0 ? (
        <EmptyState icon="🏷️" title={t('categories.empty')} />
      ) : (
        <View style={{ gap: 12 }}>
          {cats.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => router.push({ pathname: '/catalog', params: { category: c.id } })}
              style={({ pressed }) => ({
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 16,
                backgroundColor: pressed ? theme.colors.surfaceSubtle : theme.colors.surface,
                borderRadius: radii.card,
                borderWidth: 1,
                borderColor: theme.colors.surfaceBorder,
              })}
            >
              <View style={{ width: 48, height: 48, borderRadius: radii.control, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={24}>{emojiFor(c.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text size={14} weight={800}>{c.name}</Text>
                <Text size={11} color="textMuted" style={{ marginTop: 2 }}>{t('categories.count', { count: c.product_count })}</Text>
              </View>
              <Text size={14} color="primary">➔</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
