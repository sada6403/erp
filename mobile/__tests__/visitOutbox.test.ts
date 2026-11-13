import { flushOutbox } from '../src/features/common/outbox';
import { useOutboxStore } from '../src/store/outboxStore';
import { AppApiError } from '../src/api/client';

const mockCreateVisit = jest.fn();

jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('../src/lib/storage', () => ({
  zustandStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
jest.mock('../src/query/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../src/api/endpoints', () => ({
  agentApi: {},
  wishlistApi: {},
  staffApi: { createVisit: (...a: unknown[]) => mockCreateVisit(...a) },
}));

const payload = { prospect_name: 'Kamal Stores', outcome: 'purchased' as const, visited_at: '2026-11-13T04:00:00.000Z', lat: 7.29, lng: 80.63 };

describe('field visits in the offline outbox', () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    useOutboxStore.getState().clear();
  });

  it('sends the queued visit with its own id as client_event_id (idempotent replay) and removes it', async () => {
    mockCreateVisit.mockResolvedValue({ visit: {}, duplicate: false });
    const id = useOutboxStore.getState().enqueue({ type: 'visit', payload });
    await flushOutbox();
    expect(mockCreateVisit).toHaveBeenCalledWith({ ...payload, client_event_id: id });
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it('keeps the visit while the network is unreachable', async () => {
    mockCreateVisit.mockRejectedValue(new AppApiError('NETWORK', 'Network unreachable'));
    useOutboxStore.getState().enqueue({ type: 'visit', payload });
    await flushOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('drops a visit the server refuses as invalid so the queue never jams', async () => {
    mockCreateVisit.mockRejectedValue(new AppApiError('VALIDATION', 'bad', 400));
    useOutboxStore.getState().enqueue({ type: 'visit', payload });
    await flushOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });
});
