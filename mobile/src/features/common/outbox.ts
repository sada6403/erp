import * as Notifications from 'expo-notifications';
import i18n from '@/i18n';
import { agentApi, collectionsApi, staffApi, wishlistApi } from '@/api/endpoints';
import { toAppError } from '@/api/client';
import { queryClient } from '@/query/queryClient';
import { qk } from '@/query/keys';
import { useCollectionStore } from '@/store/collectionStore';
import { useOutboxStore, type OutboxItem } from '@/store/outboxStore';
import { useUiStore } from '@/store/uiStore';

let flushing = false;
const MAX_ATTEMPTS = 8;

async function send(item: OutboxItem): Promise<void> {
  switch (item.type) {
    case 'delivery_status':
      await agentApi.deliveryStatus(item.payload.deliveryId, { status: item.payload.status });
      return;
    case 'delivery_complete':
      // item.id is the event_id / Idempotency-Key, so replays are safe.
      await agentApi.deliveryComplete(item.payload.deliveryId, { otp: item.payload.otp, event_id: item.id, note: item.payload.note });
      return;
    case 'visit':
      await staffApi.createVisit({ ...item.payload, client_event_id: item.id });
      return;
    case 'collection': {
      const body = { ...item.payload, client_event_id: item.id };
      try {
        await collectionsApi.create(body);
      } catch (e) {
        const err = toAppError(e);
        // The server already holds this receipt number under another collection (e.g. after a reinstall): take the next free number, keep the same event id.
        if (err.code !== 'CONFLICT' || !err.details?.receipt_number) throw e;
        await collectionsApi.create({ ...body, receipt_number: useCollectionStore.getState().reissue(item.payload.receipt_number) });
      }
      useCollectionStore.getState().patch(item.id, { status: 'pending_verification' });
      return;
    }
    case 'wishlist_add':
      await wishlistApi.add({ product_id: item.payload.productId }, item.id);
      return;
    case 'wishlist_remove':
      await wishlistApi.remove(item.payload.productId);
      return;
  }
}

/** Flush queued items in order when online. Stops at the first unreachable error. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of [...useOutboxStore.getState().items]) {
      try {
        await send(item);
        useOutboxStore.getState().remove(item.id);
      } catch (e) {
        const err = toAppError(e);
        if (err.isUnreachable) break;
        // Server rejected it (e.g. wrong OTP): drop after a few tries so the queue never jams.
        useOutboxStore.getState().bumpAttempts(item.id);
        if (item.attempts + 1 >= MAX_ATTEMPTS || err.status === 400 || err.status === 404 || err.status === 409) {
          useOutboxStore.getState().remove(item.id);
          if (item.type === 'delivery_complete') useUiStore.getState().showToast(err.message);
          // The server refused a cash collection (e.g. the POS already recorded that payment): the agent must see it, never lose it silently.
          if (item.type === 'collection') {
            useCollectionStore.getState().patch(item.id, { status: 'rejected' });
            useUiStore.getState().showToast(`${item.payload.receipt_number}: ${err.message}`);
          }
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: qk.agent.all });
  } finally {
    flushing = false;
  }
}

/** Reconnect hook: flush the outbox and fire the "Notify me" local notification. */
export async function onReconnected(): Promise<void> {
  await flushOutbox();
  const ui = useUiStore.getState();
  if (ui.notifyMePending) {
    ui.setNotifyMePending(false);
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: i18n.t('app.name'), body: i18n.t('offline.backOnlineNotify') },
        trigger: null,
      });
    } catch {
      /* no permission: the app is open anyway, show a toast */
      ui.showToast(i18n.t('offline.backOnlineGo'));
    }
  }
}
