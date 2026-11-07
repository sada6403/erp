import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';

export interface ToastMessage {
  id: number;
  text: string;
}

interface UiState {
  /** Buy-later sheet (shown instead of any server-only action while offline). */
  buyLaterOpen: boolean;
  openBuyLater: () => void;
  closeBuyLater: () => void;

  toast: ToastMessage | null;
  showToast: (text: string) => void;
  hideToast: (id: number) => void;

  /** In-app push banner (.system-push-banner). `url` is the deep link opened on tap. */
  push: PushMessage | null;
  showPush: (title: string, body: string, url?: string | null) => void;
  hidePush: (id: number) => void;

  /** Product detail sheet (.bottom-sheet #productModal): the product id being shown, or null. */
  productSheetId: string | null;
  openProduct: (id: string) => void;
  closeProduct: () => void;

  /** Phone connectivity (NetInfo) and server reachability (axios errors / maintenance). */
  netOnline: boolean;
  serverReachable: boolean;
  setNetOnline: (v: boolean) => void;
  setServerReachable: (v: boolean) => void;

  /** "Notify me" asked while offline; fires a local notification on reconnect. */
  notifyMePending: boolean;
  setNotifyMePending: (v: boolean) => void;

  /** Last successful catalog refresh (ms epoch) for the offline banner cache age. */
  catalogUpdatedAt: number | null;
  setCatalogUpdatedAt: (ms: number) => void;

  /** expo-updates downloaded a new JS bundle: show "Update ready - Restart". */
  updateReady: boolean;
  setUpdateReady: (v: boolean) => void;
}

export interface PushMessage {
  id: number;
  title: string;
  body: string;
  url?: string | null;
}

let toastSeq = 0;
let pushSeq = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      buyLaterOpen: false,
      openBuyLater: () => set({ buyLaterOpen: true }),
      closeBuyLater: () => set({ buyLaterOpen: false }),

      toast: null,
      showToast: (text) => set({ toast: { id: ++toastSeq, text } }),
      hideToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),

      push: null,
      showPush: (title, body, url) => set({ push: { id: ++pushSeq, title, body, url } }),
      hidePush: (id) => set((s) => (s.push?.id === id ? { push: null } : s)),

      productSheetId: null,
      openProduct: (productSheetId) => set({ productSheetId }),
      closeProduct: () => set({ productSheetId: null }),

      netOnline: true,
      serverReachable: true,
      setNetOnline: (netOnline) => set({ netOnline }),
      setServerReachable: (serverReachable) => set({ serverReachable }),

      notifyMePending: false,
      setNotifyMePending: (notifyMePending) => set({ notifyMePending }),

      catalogUpdatedAt: null,
      setCatalogUpdatedAt: (catalogUpdatedAt) => set({ catalogUpdatedAt }),

      updateReady: false,
      setUpdateReady: (updateReady) => set({ updateReady }),
    }),
    {
      name: 'np-ui',
      storage: createJSONStorage(() => zustandStorage),
      partialize: (s) => ({ notifyMePending: s.notifyMePending, catalogUpdatedAt: s.catalogUpdatedAt }),
    },
  ),
);

export const selectIsOffline = (s: UiState) => !s.netOnline || !s.serverReachable;
