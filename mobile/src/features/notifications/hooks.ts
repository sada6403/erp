import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationSettingsDto, NotificationsResponse } from '@contracts/notifications';
import { notificationApi } from '@/api/endpoints';
import { qk } from '@/query/keys';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';

export function useNotifications() {
  const loggedIn = useSessionStore(selectIsLoggedIn);
  return useQuery({ queryKey: qk.me.notifications, queryFn: () => notificationApi.list(), enabled: loggedIn, refetchInterval: 60_000 });
}

export function useUnreadCount(): number {
  return useNotifications().data?.unread_count ?? 0;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => notificationApi.markRead(ids ? { ids } : { all: true }),
    onMutate: (ids) => {
      qc.setQueryData<NotificationsResponse>(qk.me.notifications, (old) => {
        if (!old) return old;
        const items = old.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
        return { ...old, items, unread_count: items.filter((n) => !n.read).length };
      });
    },
  });
}

export function useNotificationSettings() {
  const loggedIn = useSessionStore(selectIsLoggedIn);
  return useQuery({ queryKey: qk.me.notificationSettings, queryFn: notificationApi.settings, enabled: loggedIn });
}

export function useSaveNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: NotificationSettingsDto) => notificationApi.saveSettings(s),
    onSuccess: (data) => qc.setQueryData(qk.me.notificationSettings, data),
  });
}
