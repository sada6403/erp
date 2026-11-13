import { flushOutbox } from '../src/features/common/outbox';
import { buildCollectionText } from '../src/features/agent/receipt';
import { useOutboxStore } from '../src/store/outboxStore';
import { useCollectionStore, type LocalReceipt } from '../src/store/collectionStore';
import { AppApiError } from '../src/api/client';

const mockCreate = jest.fn();

jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: jest.fn() }));
jest.mock('../src/lib/storage', () => ({
  zustandStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
jest.mock('../src/query/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../src/api/endpoints', () => ({
  agentApi: {},
  wishlistApi: {},
  staffApi: {},
  collectionsApi: { create: (...a: unknown[]) => mockCreate(...a) },
}));

const receipt = (over: Partial<LocalReceipt> = {}): LocalReceipt => ({
  id: 'evt-1', receipt_number: 'AG001-000007', member_id: 'm1', customer_name: 'Kamal Perera', scheme_name: 'Smart Buy 1000', scheme_number: null, cycle_no: 3,
  amount: 1200, late_fee_applied: 200, balance_after: 0, collected_at: '2026-11-13T04:30:00.000Z', agent_code: 'AG001', agent_name: 'Copy Agent',
  company_name: 'Natural Plantation', branch_name: 'Main Branch', status: 'pending_verification', ...over,
});
const payload = { member_id: 'm1', amount: 1200, receipt_number: 'AG001-000007', collected_at: '2026-11-13T04:30:00.000Z' };

describe('receipt numbers', () => {
  beforeEach(() => useCollectionStore.getState().clear());

  it('counts up per agent and continues after the highest number the server has seen', () => {
    const s = useCollectionStore.getState();
    expect(s.nextReceiptNumber('AG001')).toBe('AG001-000001');
    expect(s.nextReceiptNumber('AG001')).toBe('AG001-000002');
    expect(s.nextReceiptNumber('AG001', 120)).toBe('AG001-000121'); // reinstall: the server knows 120
    expect(s.nextReceiptNumber('AG002')).toBe('AG002-000001');
  });

  it('reissues the next free number and updates the stored receipt', () => {
    const s = useCollectionStore.getState();
    s.add(receipt({ receipt_number: 'AG001-000007', status: 'queued' }));
    expect(s.reissue('AG001-000007')).toBe('AG001-000008');
    expect(useCollectionStore.getState().receipts[0].receipt_number).toBe('AG001-000008');
    expect(useCollectionStore.getState().nextReceiptNumber('AG001')).toBe('AG001-000009');
  });
});

describe('cash collections in the offline outbox', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    useOutboxStore.getState().clear();
    useCollectionStore.getState().clear();
  });

  it('sends the queued collection with its own id as client_event_id, removes it and marks the receipt as with the branch', async () => {
    mockCreate.mockResolvedValue({ collection: {}, duplicate: false });
    useCollectionStore.getState().add(receipt({ id: 'ignored', status: 'queued' }));
    const id = useOutboxStore.getState().enqueue({ type: 'collection', payload }, 'evt-1');
    useCollectionStore.getState().add(receipt({ id, status: 'queued' }));
    await flushOutbox();
    expect(mockCreate).toHaveBeenCalledWith({ ...payload, client_event_id: 'evt-1' });
    expect(useOutboxStore.getState().items).toHaveLength(0);
    expect(useCollectionStore.getState().receipts.find((r) => r.id === id)?.status).toBe('pending_verification');
  });

  it('keeps the receipt queued while the network is unreachable (money is never dropped)', async () => {
    mockCreate.mockRejectedValue(new AppApiError('NETWORK', 'Network unreachable'));
    useOutboxStore.getState().enqueue({ type: 'collection', payload }, 'evt-1');
    await flushOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('takes the next receipt number when the server already has this one, and retries with the same event id', async () => {
    mockCreate
      .mockRejectedValueOnce(new AppApiError('CONFLICT', 'This receipt number is already used', 409, { receipt_number: 'AG001-000007' }))
      .mockResolvedValueOnce({ collection: {}, duplicate: false });
    useCollectionStore.getState().add(receipt({ id: 'evt-1', status: 'queued' }));
    useOutboxStore.getState().enqueue({ type: 'collection', payload }, 'evt-1');
    await flushOutbox();
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ client_event_id: 'evt-1', receipt_number: 'AG001-000008' });
    expect(useOutboxStore.getState().items).toHaveLength(0);
    expect(useCollectionStore.getState().receipts[0].receipt_number).toBe('AG001-000008');
  });

  it('when the server refuses the collection (e.g. nothing is due any more) the receipt is marked rejected, not lost silently', async () => {
    mockCreate.mockRejectedValue(new AppApiError('CONFLICT', 'Nothing is due for this cycle', 409));
    useCollectionStore.getState().add(receipt({ id: 'evt-1', status: 'queued' }));
    useOutboxStore.getState().enqueue({ type: 'collection', payload }, 'evt-1');
    await flushOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(0);
    expect(useCollectionStore.getState().receipts[0].status).toBe('rejected');
  });
});

describe('collection receipt text', () => {
  it('shows company, member, scheme, cycle, amount, late fee, balance, agent, Colombo time and status', () => {
    const text = buildCollectionText(receipt(), { tin: 'PV 12345', phone: '0771234567' });
    for (const part of ['NATURAL PLANTATION', 'Main Branch', 'Reg: PV 12345', 'AG001-000007', 'Kamal Perera', 'Smart Buy 1000', 'Cycle     : 3', 'Copy Agent (AG001)', 'incl. late fee', 'PENDING VERIFICATION']) {
      expect(text).toContain(part);
    }
    expect(text).toContain('10:00 AM'); // 04:30 UTC is 10:00 in Sri Lanka
    expect(text.split('\n').every((l) => l.length <= 32)).toBe(true);
  });

  it('says plainly when the receipt has not reached the server yet', () => {
    expect(buildCollectionText(receipt({ status: 'queued', late_fee_applied: 0 }))).toContain('NOT SENT YET');
  });
});
