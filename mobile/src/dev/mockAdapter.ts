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
import {
  DEMO_ADDRESSES, DEMO_AGENT, DEMO_AGENT_MEMBERS, DEMO_AGENT_STATS, DEMO_COMMISSION, DEMO_COUPON, DEMO_DELIVERIES, DEMO_DELIVERY_FEE, DEMO_DRAWS,
  DEMO_NOTIFICATIONS, DEMO_PAYMENT_METHODS, DEMO_PRINTER, DEMO_RECEIPT, DEMO_SCHEME, DEMO_SCHEME_2, DEMO_TRACKING, DEMO_USER, DEMO_WALLET, DEMO_WISHLIST_IDS,
  deliveryItems, productId,
} from './demoData';

const NOW = () => new Date().toISOString();
const DELAY = 250;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function userFor(identifier: string): AuthUser {
  const id = identifier.trim().toUpperCase();
  const agent = id.startsWith('NP-AG') || id.includes('AGENT');
  const member = id.startsWith('NP-1') || id.includes('MEMBER');
  return {
    id: agent ? 'u-agent' : member ? 'u-member' : DEMO_USER.id,
    name: agent ? DEMO_AGENT.name : DEMO_USER.name,
    phone: agent ? DEMO_AGENT.phone : DEMO_USER.phone,
    email: null,
    email_verified: false,
    roles: agent ? ['agent', 'customer'] : member ? ['smartbuy', 'customer'] : ['customer'],
    member_no: member ? DEMO_USER.memberId : null,
    agent_code: agent ? DEMO_AGENT.code : null,
    language: 'en',
    must_change_password: false,
    phone_verified: true,
  };
}

const db = {
  user: null as AuthUser | null,
  addresses: DEMO_ADDRESSES.map((a) => ({ ...a })) as AddressDto[],
  wishlist: new Set<string>(DEMO_WISHLIST_IDS.map(productId)),
  orders: [] as OrderDto[],
  notifications: DEMO_NOTIFICATIONS.map(({ age_min, time_label, icon, ...n }) => ({ ...n, created_at: new Date(Date.now() - age_min * 60_000).toISOString(), time_label, icon })) as NotificationDto[],
  wallet: DEMO_WALLET.balance as number,
  walletTx: DEMO_WALLET.transactions.map((t) => ({ ...t })) as { id: string; type: string; amount: number; balance_after: number; source: string | null; note: string; created_at: string }[],
  couponCode: null as string | null,
  joinRequests: [] as { id: string; scheme_id: string; nic: string; status: string; created_at: string }[],
  completedThisSession: 0,
  settings: { orders: true, deliveries: true, smartbuy: true, account: true, offers: false, quiet_hours_start: null, quiet_hours_end: null } as NotificationSettingsDto,
  deliveries: [] as AgentDeliveryDto[],
  otpByDelivery: {} as Record<string, string>,
  seeded: false,
};

const STEP_LABELS: [TrackingStep['key'], string][] = DEMO_TRACKING.steps.map((x) => [x.key, x.label]);

const DEMO_ORDER_STATUS = { dispatched: 'dispatched', delivered: 'delivered' } as const;

function seed() {
  if (db.seeded) return;
  db.seeded = true;
  for (const d of DEMO_DELIVERIES) {
    const items = deliveryItems(d.id);
    const subtotal = items.reduce((a, i) => a + i.line_total, 0);
    db.deliveries.push({
      id: d.id, order_number: d.id, status: DEMO_ORDER_STATUS[d.status], customer_name: d.customer, customer_phone: d.phone, address: d.address,
      amount_due: d.status === 'delivered' ? 0 : d.amount, payment_method: 'cod', collect_cash: d.status !== 'delivered', created_at: NOW(), items,
    });
    db.otpByDelivery[d.id] = d.otp;
    // Customer 'Sunil' owns NP-ORD-9042 (shown in My Orders / tracking); the agent app sees all three.
    if (d.id === 'NP-ORD-9042') {
      db.orders.push({
        id: d.id, order_number: d.id, status: 'dispatched', stage: 'out_for_delivery', payment_method: 'cod', payment_status: 'pending',
        total_amount: d.amount, item_count: items.length, created_at: DEMO_TRACKING.steps[0].at ?? NOW(), estimated_delivery_date: NOW(), branch_id: 'b1',
        branch_name: DEMO_AGENT.branchName, items, subtotal, delivery_fee: DEMO_DELIVERY_FEE, address: d.address, notes: null, needs_call_confirmation: false,
        can_cancel: false, delivery_otp: d.otp, agent: { name: DEMO_AGENT.name, phone: DEMO_AGENT.phone, code: DEMO_AGENT.code },
      });
    }
  }
  // Wallet history order shown in the demo ledger (Oct 05, Teak Dining Chair Order #NP-8812)
  const chair = deliveryItems('NP-ORD-8810')[0];
  db.orders.push({
    id: 'NP-8812', order_number: 'NP-8812', status: 'delivered', stage: 'delivered', payment_method: 'cod', payment_status: 'paid', total_amount: 12000, item_count: 1,
    created_at: '2026-10-05T10:00:00.000Z', estimated_delivery_date: '2026-10-05T10:00:00.000Z', branch_id: 'b1', branch_name: DEMO_AGENT.branchName,
    items: [{ ...chair, product_id: productId(4), name: 'Plantation Solid Teak Wood Dining Chair', quantity: 1, unit_price: 12000, line_total: 12000 }],
    subtotal: 12000, delivery_fee: 0, address: DEMO_ADDRESSES[0].line1, notes: null, needs_call_confirmation: false, can_cancel: false, delivery_otp: null,
    agent: { name: DEMO_AGENT.name, phone: DEMO_AGENT.phone, code: DEMO_AGENT.code },
  });
}

function stepsFor(o: OrderDto): TrackingStep[] {
  const idx = o.stage === 'cancelled' ? 0 : ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered'].indexOf(o.stage);
  return STEP_LABELS.map(([key, label], i) => ({
    key, label, done: i <= idx, at: i <= idx ? (o.id === 'NP-ORD-9042' ? DEMO_TRACKING.steps[i].at ?? NOW() : NOW()) : null,
  }));
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
  const delivery_fee = subtotal > 0 ? DEMO_DELIVERY_FEE : 0;
  const discount = db.couponCode ? Math.min(DEMO_COUPON.discount, subtotal) : 0;
  return {
    branch_id: req.branch_id ?? 'b1', lines, subtotal, delivery_fee, total: Math.max(0, subtotal + delivery_fee - discount), discount, coupon_code: db.couponCode, currency: 'LKR' as const,
    can_order: lines.every((l) => !l.issue), ordering_enabled: true, payment_methods: ['cod', 'bank_transfer'] as ('cod' | 'bank_transfer')[],
    wallet: { eligible: false as const }, wallet_demo: { eligible: true, balance: db.wallet }, payment_options: DEMO_PAYMENT_METHODS, estimated_delivery_date: NOW(),
  };
}

type Handler = (c: { method: string; path: string; params: Record<string, string>; body: any; query: Record<string, any> }) => unknown | Promise<unknown>;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:([a-z_]+)/g, '(?<$1>[^/]+)')}$`), h]);

on('GET', '/status', () => ({
  ordering_enabled: true, maintenance_message: null, min_app_version: '1.0.0', latest_version: '1.0.0', latest_version_critical: false, apk_url: null,
  server_time: NOW(), company: { name: 'Natural Plantation', currency: 'LKR' }, modules: { smartbuy: true, installments: false },
  delivery: { flat_fee: DEMO_DELIVERY_FEE, free_over: null }, bank_transfer: { enabled: true, instructions: 'Bank of Ceylon - 1234567 - Natural Plantation' },
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
    total_amount: q.total, item_count: items.length, created_at: NOW(), estimated_delivery_date: NOW(), branch_id: q.branch_id, branch_name: DEMO_AGENT.branchName,
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

on('GET', '/smartbuy/schemes/open', () => ({
  items: [DEMO_SCHEME_2, { id: DEMO_SCHEME.scheme_id, name: DEMO_SCHEME.name, frequency: DEMO_SCHEME.frequency, contribution_amount: DEMO_SCHEME.contribution_amount }].map((x) => ({
    id: x.id, name: x.name, contribution_amount: x.contribution_amount, frequency: x.frequency, cycle_count: 12, chit_value: x.contribution_amount * 12, member_count: 12, status: 'open',
  })),
}));
on('GET', '/smartbuy/me/schemes', () => ({ items: [{ ...DEMO_SCHEME }] }));
on('GET', '/smartbuy/me/schemes/:id/statement', ({ params }) => ({
  scheme_id: params.id, scheme_name: DEMO_SCHEME.name, total_paid: DEMO_SCHEME.contributions_paid,
  rows: Array.from({ length: DEMO_SCHEME.cycles_paid }, (_, k) => k + 1).reverse().map((n) => ({
    id: `r${n}`, cycle_no: n, amount: DEMO_SCHEME.contribution_amount, method: 'cash', receipt_number: `RC-00${n}`, status: 'paid',
    paid_at: new Date(Date.UTC(2026, 9, 30) - (DEMO_SCHEME.cycles_paid - n) * 7 * 86_400_000).toISOString(),
  })),
}));
on('GET', '/smartbuy/me/schemes/:id/draws', ({ params }) => ({ scheme_id: params.id, items: DEMO_DRAWS.map((d) => ({ ...d, has_video: false })) }));
on('GET', '/smartbuy/wallet', () => ({ balance: db.wallet, currency: 'LKR' }));
on('GET', '/smartbuy/wallet/transactions', () => ({ items: db.walletTx }));
/** Mock-only: wallet payment at checkout (the real contract only has cod/bank_transfer so far). */
on('POST', '/checkout/wallet-pay', ({ body }) => {
  const amount = Number(body.amount ?? 0);
  if (amount > db.wallet) throw new HttpError(409, 'INSUFFICIENT_WALLET', 'Wallet balance is too low');
  db.wallet -= amount;
  db.walletTx.unshift({ id: `t${db.walletTx.length + 1}`, type: 'debit', amount: -amount, balance_after: db.wallet, source: body.reference ?? 'App Checkout', note: 'App Checkout', created_at: NOW() });
  return { ok: true, balance: db.wallet };
});
/** Mock-only: promo code (demo accepts PLANT2026 = Rs 500 off). */
on('POST', '/checkout/coupon', ({ body }) => {
  const code = String(body.code ?? '').trim().toUpperCase();
  if (code !== DEMO_COUPON.code) {
    db.couponCode = null;
    throw new HttpError(422, 'INVALID_COUPON', DEMO_COUPON.errorMessage);
  }
  db.couponCode = code;
  return { code, discount: DEMO_COUPON.discount, message: DEMO_COUPON.successMessage };
});
on('DELETE', '/checkout/coupon', () => ((db.couponCode = null), { ok: true }));
/** Mock-only: "Apply for another Smart Buy scheme" (submitted for branch POS approval). */
on('POST', '/smartbuy/join-requests', ({ body }) => {
  const r = { id: `jr${db.joinRequests.length + 1}`, scheme_id: body.scheme_id, nic: body.nic, status: 'pending', created_at: NOW() };
  db.joinRequests.push(r);
  return r;
});

on('GET', '/smartbuy/agents/lookup', ({ query }) => {
  const code = String(query.code ?? '').toUpperCase();
  if (code !== DEMO_AGENT.code.toUpperCase()) throw new HttpError(404, 'NOT_FOUND', 'No agent found with this code');
  return { code: DEMO_AGENT.code, name: DEMO_AGENT.name, branch_id: 'b1', branch_name: null };
});

on('GET', '/agent/dashboard', () => {
  const x = DEMO_AGENT_STATS;
  return {
    agent: { id: DEMO_AGENT.id, code: DEMO_AGENT.code, name: DEMO_AGENT.name, branch_id: 'b1' },
    members_count: x.smartbuy_members, schemes_count: 2,
    deliveries_pending: Math.max(0, x.pending_drops - db.completedThisSession),
    deliveries_completed_today: db.deliveries.filter((d) => d.status === 'delivered').length,
    commission_this_month: x.month_commission, commission_pending: 0, commission_paid_total: 0,
    extras: {
      rank_label: x.rank_label, rank_detail: x.rank_detail, tier: x.tier, rating: x.rating, review_count: x.review_count, families_served: x.families_served,
      smartbuy_members: x.smartbuy_members, on_time_pct: x.on_time_pct, on_duty: x.on_duty, branch_name: x.branch_name, cod_to_collect: x.cod_to_collect,
      goal: x.goal, incentive_banner: x.incentive_banner, badges: x.badges, badge_hints: x.badge_hints,
    },
  };
});
on('GET', '/agent/schemes', () => ({ items: [] }));
on('GET', '/agent/members', () => ({
  items: DEMO_AGENT_MEMBERS.map((m) => ({
    member_id: m.member_id, customer_name: m.customer_name, phone_masked: `${m.phone} - ${m.area}`, scheme_id: m.scheme_id, scheme_name: m.scheme_name,
    contributions_paid: m.contributions_paid, status: m.paid ? 'paid_cycle_7' : 'due_cycle_7', won_cycle_no: null, weekly_amount: m.weekly,
  })),
  next_cursor: null,
}));
/** Mock-only: agent records a cash collection for a member (demo: Nimal Bandara Rs 1,000). */
on('POST', '/agent/members/:id/collections', ({ params, body }) => {
  const m = DEMO_AGENT_MEMBERS.find((x) => x.member_id === params.id);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  (m as { paid: boolean }).paid = true;
  (m as { contributions_paid: number }).contributions_paid += Number(body.amount ?? m.weekly);
  return { ok: true, receipt_number: `RC-${Date.now() % 100000}` };
});
on('GET', '/agent/commission', ({ query }) => ({
  month: query.month ?? DEMO_COMMISSION.month, total: DEMO_COMMISSION.total, pending: 0, approved: DEMO_COMMISSION.total, paid: 0, title: DEMO_COMMISSION.title,
  rows: DEMO_COMMISSION.rows.map((r) => ({ id: r.id, source: r.source, detail: r.detail, color: r.color, base_amount: r.base_amount, amount: r.amount, status: 'approved', created_at: '2026-10-31T00:00:00.000Z' })),
}));
on('GET', '/agent/printer', () => ({ name: DEMO_PRINTER.name, title: DEMO_PRINTER.title, connected: true }));
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
  d.collect_cash = false;
  db.completedThisSession += 1;
  return { order_id: d.id, status: 'delivered', delivered_at: NOW() };
});
on('GET', '/agent/deliveries/:id/bill', ({ params }) => {
  const d = db.deliveries.find((x) => x.id === params.id);
  if (!d) throw new HttpError(404, 'NOT_FOUND', 'Not found');
  const common = {
    order_number: d.order_number, company_name: DEMO_RECEIPT.company_name, branch_name: DEMO_RECEIPT.branch_name, branch_phone: DEMO_RECEIPT.branch_phone,
    agent_name: DEMO_AGENT.name, agent_code: DEMO_AGENT.code, customer_name: d.customer_name, address: d.address,
  };
  if (d.id === 'NP-ORD-9042') {
    return { ...common, bill_no: DEMO_RECEIPT.bill_no, date: DEMO_RECEIPT.date, lines: DEMO_RECEIPT.lines, subtotal: DEMO_RECEIPT.subtotal, discount: DEMO_RECEIPT.discount,
      delivery_fee: DEMO_RECEIPT.delivery_fee, total: DEMO_RECEIPT.total, payment_label: DEMO_RECEIPT.payment_label, otp: db.otpByDelivery[d.id], paid_in_full: true };
  }
  const lines = (d.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, line_total: i.line_total }));
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  return { ...common, bill_no: d.order_number, date: NOW(), lines, subtotal, discount: 0, delivery_fee: DEMO_DELIVERY_FEE, total: subtotal + DEMO_DELIVERY_FEE,
    payment_label: d.collect_cash ? 'COD' : 'Paid', otp: d.collect_cash ? null : db.otpByDelivery[d.id], paid_in_full: !d.collect_cash };
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
