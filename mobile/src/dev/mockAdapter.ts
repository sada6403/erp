/**
 * DEV ONLY. An axios adapter that answers /api/app/v1 calls with in-memory data so every screen can be
 * exercised without a backend. Only ever required from src/api/instance.ts inside `if (__DEV__ && ENV.useMocks)`,
 * which Metro removes from release bundles. Never import this file anywhere else.
 */
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser } from '@contracts/auth';
import type { AddressDto } from '@contracts/addresses';
import type { CreateOrderRequest, OrderDto, OrderItemDto, QuoteLineDto, QuoteRequest, TrackingStep } from '@contracts/orders';
import type { AgentDeliveryDto } from '@contracts/agent';
import type { NotificationDto, NotificationSettingsDto } from '@contracts/notifications';
import { sha256Hex } from '@/lib/sha256';
import { BANNERS, BRANCHES, CATEGORIES, PRODUCTS, productDetail } from './mockData';

const NOW = () => new Date().toISOString();
const DELAY = 250;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function userFor(identifier: string): AuthUser {
  const id = identifier.trim().toUpperCase();
  const agent = id.startsWith('NP-AG') || id.includes('AGENT');
  const member = id.startsWith('NP-1') || id.includes('MEMBER');
  return {
    id: agent ? 'u-agent' : member ? 'u-member' : 'u-customer',
    name: agent ? 'Kasun Perera' : member ? 'Nimali Fernando' : 'Ruwan Silva',
    phone: agent ? '0779876543' : '0771234567',
    email: null,
    email_verified: false,
    roles: agent ? ['agent', 'customer'] : member ? ['smartbuy', 'customer'] : ['customer'],
    member_no: member ? 'NP-1042' : null,
    agent_code: agent ? 'NP-AG-204' : null,
    language: 'en',
    must_change_password: false,
    phone_verified: true,
  };
}

const db = {
  user: null as AuthUser | null,
  addresses: [
    { id: 'a1', label: 'Home', recipient_name: 'Ruwan Silva', phone: '0771234567', line1: '12 Temple Road', line2: null, city: 'Kandy', district: 'Kandy', postal_code: null, latitude: null, longitude: null, is_default: true },
  ] as AddressDto[],
  wishlist: new Set<string>(),
  orders: [] as OrderDto[],
  notifications: [
    { id: 'n1', type: 'order_status', channel: 'orders', title: 'Order confirmed', body: 'Your order is being prepared.', url: 'naturalplantation://orders/o-seed', read: false, created_at: NOW() },
    { id: 'n2', type: 'offer', channel: 'offers', title: 'Weekend deals', body: 'Up to 20% off fresh vegetables.', url: null, read: true, created_at: NOW() },
  ] as NotificationDto[],
  settings: { orders: true, deliveries: true, smartbuy: true, account: true, offers: false, quiet_hours_start: null, quiet_hours_end: null } as NotificationSettingsDto,
  deliveries: [] as AgentDeliveryDto[],
  otpByDelivery: {} as Record<string, string>,
  seeded: false,
};

const STEP_LABELS: Array<[TrackingStep['key'], string]> = [
  ['placed', 'Order placed'],
  ['confirmed', 'Confirmed'],
  ['packed', 'Packed'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
];

function seed() {
  if (db.seeded) return;
  db.seeded = true;
  const items: OrderItemDto[] = [{ product_id: 'p-tomato', variant_id: null, name: 'Tomato', variant_name: null, unit: 'kg', quantity: 0.5, unit_price: 480, line_total: 240, thumbnail_url: null }];
  db.orders.push({
    id: 'o-seed', order_number: 'ONL-1023', status: 'dispatched', stage: 'out_for_delivery', payment_method: 'cod', payment_status: 'pending',
    total_amount: 540, item_count: 1, created_at: NOW(), estimated_delivery_date: NOW(), branch_id: 'b1', branch_name: 'Kandy Branch',
    items, subtotal: 240, delivery_fee: 300, address: '12 Temple Road, Kandy', notes: null, needs_call_confirmation: false, can_cancel: false,
    delivery_otp: '4821', agent: { name: 'Kasun Perera', phone: '0779876543', code: 'NP-AG-204' },
  });
  db.deliveries.push(
    { id: 'o-seed', order_number: 'ONL-1023', status: 'dispatched', customer_name: 'Ruwan Silva', customer_phone: '0771234567', address: '12 Temple Road, Kandy', amount_due: 540, payment_method: 'cod', collect_cash: true, created_at: NOW(), items },
    { id: 'o-seed-2', order_number: 'ONL-1024', status: 'ready_for_delivery', customer_name: 'Sanduni Weerasinghe', customer_phone: '0712223344', address: '5 Lake View, Kandy', amount_due: 0, payment_method: 'bank_transfer', collect_cash: false, created_at: NOW(), items },
  );
  db.otpByDelivery['o-seed'] = '4821';
  db.otpByDelivery['o-seed-2'] = '1357';
}

function stepsFor(o: OrderDto): TrackingStep[] {
  const idx = o.stage === 'cancelled' ? 0 : ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered'].indexOf(o.stage);
  return STEP_LABELS.map(([key, label], i) => ({ key, label, done: i <= idx, at: i <= idx ? NOW() : null }));
}

function quote(req: QuoteRequest) {
  const lines: QuoteLineDto[] = req.items.map((it) => {
    const p = PRODUCTS.find((x) => x.id === it.product_id);
    const v = p && it.variant_id ? productDetail(p.id)?.variants.find((x) => x.id === it.variant_id) : null;
    const unit_price = v?.price ?? p?.price ?? 0;
    return {
      product_id: it.product_id, variant_id: it.variant_id ?? null, name: p?.name ?? 'Unknown', variant_name: v?.name ?? null, unit: p?.unit ?? 'pcs',
      quantity: it.quantity, unit_price, line_total: Math.round(unit_price * it.quantity * 100) / 100, available: !!p?.in_stock, available_qty: null,
      issue: p ? (p.in_stock ? null : 'OUT_OF_STOCK') : 'NOT_FOUND',
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const delivery_fee = subtotal >= 5000 ? 0 : 300;
  return {
    branch_id: req.branch_id ?? 'b1', lines, subtotal, delivery_fee, total: subtotal + delivery_fee, currency: 'LKR' as const,
    can_order: lines.every((l) => !l.issue), ordering_enabled: true, payment_methods: ['cod', 'bank_transfer'] as Array<'cod' | 'bank_transfer'>,
    wallet: { eligible: false as const }, estimated_delivery_date: NOW(),
  };
}

type Handler = (c: { method: string; path: string; params: Record<string, string>; body: any; query: Record<string, any> }) => unknown | Promise<unknown>;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const routes: Array<[string, RegExp, Handler]> = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:([a-z_]+)/g, '(?<$1>[^/]+)')}$`), h]);

on('GET', '/status', () => ({
  ordering_enabled: true, maintenance_message: null, min_app_version: '1.0.0', latest_version: '1.0.0', latest_version_critical: false, apk_url: null,
  server_time: NOW(), company: { name: 'Natural Plantation', currency: 'LKR' }, modules: { smartbuy: true, installments: false },
  delivery: { flat_fee: 300, free_over: 5000 }, bank_transfer: { enabled: true, instructions: 'Bank of Ceylon - 1234567 - Natural Plantation' },
}));
on('GET', '/watermark', () => ({ server_time: NOW(), areas: { catalog: null, categories: null, banners: null, settings: null } }));

on('POST', '/auth/login', ({ body }) => {
  if (body.password === 'wrong') throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong credentials');
  db.user = userFor(body.identifier);
  return { tokens: { access_token: 'dev-access', refresh_token: 'dev-refresh', expires_in: 900 }, user: db.user, must_change_password: false };
});
on('POST', '/auth/register', ({ body }) => {
  db.user = { ...userFor(body.phone), id: 'u-new', name: body.name, phone: body.phone, roles: ['customer'], member_no: null, agent_code: null };
  return { tokens: { access_token: 'dev-access', refresh_token: 'dev-refresh', expires_in: 900 }, user: db.user, must_change_password: false };
});
on('POST', '/auth/refresh', () => ({ access_token: 'dev-access', refresh_token: 'dev-refresh', expires_in: 900, user: db.user ?? userFor('') }));
on('POST', '/auth/logout', () => ({ ok: true }));
on('POST', '/auth/change-password', () => ({ tokens: { access_token: 'dev-access', refresh_token: 'dev-refresh', expires_in: 900 }, user: db.user ?? userFor('') }));
on('POST', '/auth/email/start', () => ({ sent: true, smtp_configured: true, expires_in: 600 }));
on('POST', '/auth/email/verify', ({ body }) => ({ email: body.email ?? 'dev@example.com', email_verified: true }));
on('POST', '/auth/forgot', () => ({ method: 'email_code', message: 'Code sent' }));
on('POST', '/auth/forgot/reset', () => ({ ok: true }));
on('GET', '/me', () => ({ ...(db.user ?? userFor('')), modules: { smartbuy: true, installments: false } }));
on('PATCH', '/me', ({ body }) => ({ ...(db.user ?? userFor('')), ...body, modules: { smartbuy: true, installments: false } }));
on('DELETE', '/me', () => ({ ok: true }));

on('GET', '/catalog/categories', () => ({ items: CATEGORIES, removed_ids: [], server_time: NOW() }));
on('GET', '/catalog/products', () => ({ items: PRODUCTS, removed_ids: [], next_cursor: null, server_time: NOW() }));
on('GET', '/catalog/products/:id', ({ params }) => {
  const d = productDetail(params.id);
  if (!d) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  return d;
});
on('GET', '/catalog/banners', () => ({ items: BANNERS }));
on('GET', '/catalog/search', ({ query }) => {
  const q = String(query.q ?? '').toLowerCase();
  const items = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  return { items, total: items.length };
});
on('GET', '/catalog/suggest', () => ({ suggestions: [], products: [] }));
on('GET', '/branches/nearby', () => ({ items: BRANCHES }));

on('GET', '/me/wishlist', () => ({ items: PRODUCTS.filter((p) => db.wishlist.has(p.id)) }));
on('POST', '/me/wishlist', ({ body }) => (db.wishlist.add(body.product_id), { ok: true }));
on('DELETE', '/me/wishlist/:id', ({ params }) => (db.wishlist.delete(params.id), { ok: true }));

on('GET', '/me/addresses', () => ({ items: db.addresses }));
on('POST', '/me/addresses', ({ body }) => {
  const a = { ...body, id: `a${db.addresses.length + 1}` } as AddressDto;
  db.addresses.push(a);
  return a;
});

on('POST', '/checkout/quote', ({ body }) => quote(body as QuoteRequest));
on('POST', '/orders', ({ body }) => {
  const b = body as CreateOrderRequest;
  const q = quote(b);
  if (b.expected_total != null && Math.abs(b.expected_total - q.total) > 0.01) throw new HttpError(409, 'PRICE_CHANGED', 'Price changed');
  const n = db.orders.length + 1;
  const items: OrderItemDto[] = q.lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, name: l.name, variant_name: l.variant_name, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total, thumbnail_url: null }));
  const o: OrderDto = {
    id: `o-${n}-${Date.now()}`, order_number: `ONL-${1030 + n}`, status: 'pending', stage: 'placed', payment_method: b.payment_method, payment_status: 'pending',
    total_amount: q.total, item_count: items.length, created_at: NOW(), estimated_delivery_date: NOW(), branch_id: q.branch_id, branch_name: 'Kandy Branch',
    items, subtotal: q.subtotal, delivery_fee: q.delivery_fee, address: db.addresses.find((a) => a.id === b.address_id)?.line1 ?? null, notes: null,
    needs_call_confirmation: false, can_cancel: true, delivery_otp: String(1000 + Math.floor(Math.random() * 9000)), agent: null,
  };
  db.orders.unshift(o);
  return o;
});
on('GET', '/orders', () => ({ items: db.orders, next_cursor: null }));
on('GET', '/orders/:id', ({ params }) => {
  const o = db.orders.find((x) => x.id === params.id);
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  return o;
});
on('GET', '/orders/:id/tracking', ({ params }) => {
  const o = db.orders.find((x) => x.id === params.id);
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  return { order_id: o.id, order_number: o.order_number, status: o.status, cancelled: o.stage === 'cancelled', steps: stepsFor(o), agent: o.agent, estimated_delivery_date: o.estimated_delivery_date, delivery_otp: o.delivery_otp };
});
on('POST', '/orders/:id/cancel', ({ params }) => {
  const o = db.orders.find((x) => x.id === params.id);
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  if (!o.can_cancel) throw new HttpError(409, 'ORDER_NOT_CANCELLABLE', 'Cannot cancel');
  o.status = 'cancelled';
  o.stage = 'cancelled';
  o.can_cancel = false;
  return o;
});

on('POST', '/me/devices', () => ({ ok: true }));
on('DELETE', '/me/devices', () => ({ ok: true }));
on('GET', '/me/notifications', () => ({ items: db.notifications, unread_count: db.notifications.filter((n) => !n.read).length, next_cursor: null }));
on('POST', '/me/notifications/read', ({ body }) => {
  db.notifications.forEach((n) => {
    if (body.all || body.ids?.includes(n.id)) n.read = true;
  });
  return { ok: true };
});
on('GET', '/me/notification-settings', () => db.settings);
on('PUT', '/me/notification-settings', ({ body }) => Object.assign(db.settings, body));

on('GET', '/smartbuy/schemes/open', () => ({ items: [{ id: 's1', name: 'Gold Saver 12', contribution_amount: 5000, frequency: 'monthly', cycle_count: 12, chit_value: 60000, member_count: 12, status: 'open' }] }));
on('GET', '/smartbuy/me/schemes', () => ({ items: [{ member_id: 'm1', scheme_id: 's1', scheme_number: 'SB-001', name: 'Gold Saver 12', frequency: 'monthly', contribution_amount: 5000, chit_value: 60000, cycle_count: 12, cycles_paid: 4, contributions_paid: 20000, next_draw_date: NOW(), status: 'active', badge: 'Active', won_cycle_no: null, agent_name: 'Kasun Perera' }] }));
on('GET', '/smartbuy/me/schemes/:id/statement', ({ params }) => ({ scheme_id: params.id, scheme_name: 'Gold Saver 12', total_paid: 20000, rows: [1, 2, 3, 4].map((n) => ({ id: `r${n}`, cycle_no: n, amount: 5000, method: 'cash', receipt_number: `RC-00${n}`, status: 'paid', paid_at: NOW() })) }));
on('GET', '/smartbuy/me/schemes/:id/draws', ({ params }) => ({ scheme_id: params.id, items: [{ id: 'd1', cycle_no: 3, draw_date: NOW(), method: 'random', winner_label: 'K. Ra... - Member #12', is_me: false, has_video: false }, { id: 'd2', cycle_no: 2, draw_date: NOW(), method: 'random', winner_label: 'Nimali F. - Member #7', is_me: true, has_video: false }] }));
on('GET', '/smartbuy/wallet', () => ({ balance: 12500, currency: 'LKR' }));
on('GET', '/smartbuy/wallet/transactions', () => ({ items: [{ id: 't1', type: 'credit', amount: 15000, balance_after: 15000, source: 'Draw prize', created_at: NOW() }, { id: 't2', type: 'debit', amount: -2500, balance_after: 12500, source: 'Shop purchase', created_at: NOW() }] }));

on('GET', '/agent/dashboard', () => ({
  agent: { id: 'ag1', code: 'NP-AG-204', name: 'Kasun Perera', branch_id: 'b1' },
  members_count: 18, schemes_count: 2, deliveries_pending: db.deliveries.filter((d) => d.status !== 'delivered').length,
  deliveries_completed_today: db.deliveries.filter((d) => d.status === 'delivered').length, commission_this_month: 18450, commission_pending: 6200, commission_paid_total: 92000,
  extras: { rank_label: 'Gold agent', tier: 'Tier 2', branch_name: 'Kandy Branch', goal: { title: 'Monthly goal', subtitle: 'Rs. 6,550 more to unlock the bonus', target: 25000, earned: 18450 } },
}));
on('GET', '/agent/schemes', () => ({ items: [] }));
on('GET', '/agent/members', () => ({ items: [{ member_id: 'm1', customer_name: 'Nimali Fernando', phone_masked: '077 *** 4567', scheme_id: 's1', scheme_name: 'Gold Saver 12', contributions_paid: 20000, status: 'active', won_cycle_no: null }], next_cursor: null }));
on('GET', '/agent/commission', ({ query }) => ({ month: query.month ?? '2026-11', total: 18450, pending: 6200, approved: 0, paid: 12250, rows: [{ id: 'c1', source: 'Delivery ONL-1020', base_amount: 3000, amount: 150, status: 'paid', created_at: NOW() }, { id: 'c2', source: 'Scheme contribution', base_amount: 5000, amount: 250, status: 'pending', created_at: NOW() }] }));
on('GET', '/agent/deliveries', () => ({
  items: db.deliveries.map((d) => ({ ...d, delivery_otp_hash: `salt$${sha256Hex(`salt${db.otpByDelivery[d.id] ?? ''}`)}` })),
}));
on('POST', '/agent/deliveries/:id/status', ({ params }) => {
  const d = db.deliveries.find((x) => x.id === params.id);
  if (d) d.status = 'in_transit';
  return { ok: true };
});
on('POST', '/agent/deliveries/:id/complete', ({ params, body }) => {
  const d = db.deliveries.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  if (db.otpByDelivery[d.id] !== body.otp) throw new HttpError(422, 'OTP_INVALID', 'Wrong code');
  d.status = 'delivered';
  return { order_id: d.id, status: 'delivered', delivered_at: NOW() };
});
on('GET', '/agent/deliveries/:id/bill', ({ params }) => {
  const d = db.deliveries.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  return {
    bill_no: `B-${d.order_number}`, order_number: d.order_number, date: NOW(), company_name: 'Natural Plantation', branch_name: 'Kandy Branch', branch_phone: '0812223344',
    agent_name: 'Kasun Perera', agent_code: 'NP-AG-204', customer_name: d.customer_name, address: d.address,
    lines: (d.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, line_total: i.line_total })),
    subtotal: 240, discount: 0, delivery_fee: 300, total: 540, payment_label: d.collect_cash ? 'Cash on delivery' : 'Paid', otp: null, paid_in_full: !d.collect_cash,
  };
});

function parseQuery(config: InternalAxiosRequestConfig) {
  return { ...(config.params ?? {}) } as Record<string, any>;
}

/** Axios adapter that routes requests to the handlers above. */
export function createMockAdapter(): AxiosAdapter {
  return async (config) => {
    seed();
    await wait(DELAY);
    const method = (config.method ?? 'get').toUpperCase();
    const path = (config.url ?? '').split('?')[0];
    const fail = (status: number, code: string, message: string) => {
      const response = { data: { error: { code, message } }, status, statusText: code, headers: {}, config } as AxiosResponse;
      return new AxiosError(message, String(status), config, null, response);
    };
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = re.exec(path);
      if (!match) continue;
      try {
        const body = typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data ?? {};
        const data = await handler({ method, path, params: { ...(match.groups ?? {}) }, body, query: parseQuery(config) });
        return { data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
      } catch (e) {
        if (e instanceof HttpError) throw fail(e.status, e.code, e.message);
        throw fail(500, 'INTERNAL', e instanceof Error ? e.message : 'mock error');
      }
    }
    throw fail(404, 'NOT_FOUND', `No mock for ${method} ${path}`);
  };
}
