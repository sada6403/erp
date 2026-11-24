import { treeOrder } from '../src/features/staff/ManagerParts';
import { isManagerLevel } from '../src/features/staff/hooks';
import { useSessionStore } from '../src/store/sessionStore';

jest.mock('expo-location', () => ({}));
jest.mock('../src/lib/storage', () => ({
  zustandStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
jest.mock('../src/api/endpoints', () => ({ staffApi: {}, agentApi: {}, wishlistApi: {}, collectionsApi: {} }));

const row = (id: string, name: string, reports_to: string | null) => ({ staff_id: id, name, reports_to });

describe('management levels', () => {
  it('only field officers keep the agent tabs; every level above gets the management layout', () => {
    expect(isManagerLevel('field_officer')).toBe(false);
    expect(isManagerLevel(undefined)).toBe(false); // not on the hierarchy (403): plain agent
    for (const l of ['director', 'agm', 'manager', 'zonal_manager', 'regional_manager', 'branch_manager'] as const) expect(isManagerLevel(l)).toBe(true);
  });

  it('a manager can choose the field view and it resets at login and logout', () => {
    const s = useSessionStore.getState();
    s.setFieldView(true);
    expect(useSessionStore.getState().fieldView).toBe(true);
    s.setUser({ id: 'u', name: 'A', roles: ['agent'] } as never);
    expect(useSessionStore.getState().fieldView).toBe(false);
    expect(useSessionStore.getState().activeRole).toBe('agent');
    s.setFieldView(true);
    s.clear();
    expect(useSessionStore.getState().fieldView).toBe(false);
  });
});

describe('team tree', () => {
  it('orders the subtree depth first with indentation, and never shows the caller or people outside the subtree', () => {
    const items = [row('me', 'Me', null), row('b', 'Bravo', 'me'), row('a', 'Alpha', 'me'), row('a1', 'Alpha One', 'a'), row('a1x', 'Deep', 'a1'), row('other', 'Elsewhere', 'someone-else')];
    const out = treeOrder(items, 'me').map((o) => `${o.depth}:${o.item.name}`);
    expect(out).toEqual(['0:Alpha', '1:Alpha One', '2:Deep', '0:Bravo']);
  });

  it('is empty for someone with no team', () => {
    expect(treeOrder([row('me', 'Me', null)], 'me')).toEqual([]);
  });
});
