import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import type { CreateVisitRequest, SetTargetRequest, StaffLevel } from '@contracts/staff';
import { staffApi } from '@/api/endpoints';
import { toAppError } from '@/api/client';
import { qk } from '@/query/keys';
import { selectHasRole, useSessionStore } from '@/store/sessionStore';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { useOutboxStore, uuid } from '@/store/outboxStore';

/**
 * The sales-force scope is decided by the server (staff_assignments). An agent who is not on the hierarchy gets 403, which means
 * "no Team area": the app hides it and never retries.
 */
export function useStaffDashboard(period?: string) {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({
    queryKey: period ? [...qk.agent.staffDashboard, period] : qk.agent.staffDashboard,
    queryFn: () => staffApi.dashboard(period),
    enabled,
    retry: (count, err) => toAppError(err).status !== 403 && count < 1,
    staleTime: 60_000,
  });
}

/** True once the server confirmed the caller is on the sales hierarchy. */
export function useIsStaff(): boolean {
  return !!useStaffDashboard().data;
}

export function useTeam(period: string) {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({ queryKey: qk.agent.team(period), queryFn: () => staffApi.team(period), enabled });
}

export function useVisitReport(period: string, enabled = true) {
  return useQuery({ queryKey: qk.agent.visitReport(period), queryFn: () => staffApi.visitReport(period), enabled });
}

export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, body }: { staffId: string; body: SetTargetRequest }) => staffApi.setTarget(staffId, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [...qk.agent.all, 'staff'] }); },
  });
}

export function useVisitsToday() {
  const enabled = useSessionStore(selectHasRole('agent'));
  return useQuery({ queryKey: qk.agent.visitsToday, queryFn: staffApi.visitsToday, enabled });
}

/** Position for a visit: null when permission is denied, location is off, or no fix within the time limit (the visit is then flagged). */
export async function currentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

export type VisitDraft = Omit<CreateVisitRequest, 'client_event_id' | 'visited_at' | 'lat' | 'lng'>;

/**
 * Save a visit. Works offline: the visit is queued with its own event id (same rule as deliveries) and the server answers a
 * replay with the stored row, so a dropped connection never makes a duplicate.
 */
export function useLogVisit() {
  const qc = useQueryClient();
  return async (draft: VisitDraft): Promise<{ result: 'sent' | 'queued'; gps: boolean }> => {
    const pos = await currentPosition();
    const body: Omit<CreateVisitRequest, 'client_event_id'> = { ...draft, visited_at: new Date().toISOString(), ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) };
    const eventId = uuid();
    const queue = () => { useOutboxStore.getState().enqueue({ type: 'visit', payload: body }, eventId); return { result: 'queued' as const, gps: !!pos }; };
    if (selectIsOffline(useUiStore.getState())) return queue();
    try {
      await staffApi.createVisit({ ...body, client_event_id: eventId });
      void qc.invalidateQueries({ queryKey: [...qk.agent.all, 'visits'] });
      return { result: 'sent', gps: !!pos };
    } catch (e) {
      if (toAppError(e).isUnreachable) return queue();
      throw e;
    }
  };
}

export const LEVEL_KEY: Record<StaffLevel, string> = {
  director: 'sf.level.director', agm: 'sf.level.agm', manager: 'sf.level.manager', zonal_manager: 'sf.level.zonal_manager',
  regional_manager: 'sf.level.regional_manager', branch_manager: 'sf.level.branch_manager', field_officer: 'sf.level.field_officer',
};
