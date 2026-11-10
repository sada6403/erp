/**
 * DEV ONLY demo seed. Verbatim sample data from the approved web demo (C:\work\mobile app\web-demo: app.js + index.html)
 * mapped onto the shared API contracts (backend/lib/app/contracts). Only ever reached through
 * src/dev/mockData.ts <- src/dev/mockAdapter.ts <- `if (__DEV__ && ENV.useMocks)` in src/api/instance.ts.
 * Never import this file from anywhere else.
 *
 * Demo fields the contracts cannot carry (emoji, rating, stock label, EMI text, banner badge, prize, ...) are kept in
 * `*_EXTRAS` maps and merged onto the wire objects as additive, optional properties.
 */
import type { BannerDto, BranchDto, CategoryDto, ProductDetailDto, ProductListItemDto, VariantDto } from '@contracts/catalog';
import type { AddressDto } from '@contracts/addresses';
import type { NotificationDto } from '@contracts/notifications';
import type { OrderItemDto } from '@contracts/orders';

/** Fixed demo clock so dates match the screenshots (demo "today" is around Oct 30 - Nov 7, 2026). */
export const DEMO_NOW_ISO = '2026-11-01T00:00:00.000Z';

/* ------------------------------------------------------------------ profile */
export const DEMO_USER = {
  id: 'u-customer',
  name: 'Sunil Jayawardena',
  phone: '0771234567',
  phoneDisplay: '077 123 4567',
  memberId: 'NP-1042',
  agentId: 'NP-AG-204',
  walletBalance: 48500,
} as const;

export const DEMO_AGENT = {
  id: 'ag1',
  name: 'Kamal Perera',
  code: 'NP-AG-204',
  phone: '0779876543',
  branchName: 'Kandy Central Branch',
  vehicle: 'Bajaj Pulsar',
  route: 'Kandy City Route',
} as const;

/* --------------------------------------------------------------- categories */
export interface DemoCategory {
  id: string;
  name: string;
  /** emoji + label used by the demo's category pills */
  pill: string;
  /** "Explore Plantation Departments" card */
  deptTitle: string;
  deptSub: string;
  icon: string;
}

export const DEMO_CATEGORIES: DemoCategory[] = [
  { id: 'c-groceries', name: 'Plantation Groceries', pill: '🌾 Plantation Groceries', deptTitle: 'Daily Agro Groceries', deptSub: 'Organic Rice, Pure Treacle, Farm Honey, Grains', icon: '🌾' },
  { id: 'c-spices', name: 'Spices & Tea', pill: '☕ Ceylon Spices & Tea', deptTitle: 'Ceylon Spices & Hill Tea', deptSub: 'ALBA Cinnamon, BOPF Tea, Black Pepper, Cardamom', icon: '☕' },
  { id: 'c-coconut', name: 'Pure Coconut & Oils', pill: '🥥 Coconut & Oils', deptTitle: 'Coconut & Essential Oils', deptSub: 'Virgin Coconut Oil, Citronella, Lemongrass Oil', icon: '🥥' },
  { id: 'c-plants', name: 'Live Plants & Saplings', pill: '🌱 Live Saplings', deptTitle: 'Commercial Saplings', deptSub: 'Mahogany, Teak, Agarwood, Grafted Fruit Plants', icon: '🌱' },
  { id: 'c-teak', name: 'Teak Furniture', pill: '🪑 Solid Teak Furniture', deptTitle: 'Solid Teak Furniture', deptSub: 'Dining sets, Verandah loungers, Teak tables', icon: '🪑' },
];

/* ----------------------------------------------------------------- products */
export interface DemoProduct {
  /** demo numeric id (also the cart/wishlist id) */
  id: number;
  name: string;
  category: string;
  price: number;
  origPrice: number;
  installment: string;
  emoji: string;
  rating: number;
  reviews: number;
  stock: string;
  desc: string;
  variants: string[];
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: 101, name: 'Certified Organic Suwandel Red Raw Rice 5kg Bag', category: 'Plantation Groceries', price: 2450, origPrice: 2800, installment: 'Rs 245/mo', emoji: '🌾', rating: 4.9, reviews: 210, stock: 'In Stock • Kandy Grain Depot', desc: 'Ancient Sri Lankan heirloom rice variety cultivated using organic compost in Matale valley estates. Rich aroma, high fiber and essential trace minerals.', variants: ['5kg Economy Bag', '10kg Farm Sack', '1kg Trial Pack'] },
  { id: 102, name: 'Traditional Hill Country Pure Kithul Treacle 750ml', category: 'Plantation Groceries', price: 1850, origPrice: 2200, installment: 'Rs 185/mo', emoji: '🍯', rating: 5.0, reviews: 145, stock: 'Fresh Weekly Tapping', desc: '100% pure sap extracted from wild Kithul palms in Sinharaja border plantations. Unadulterated, low GI organic sweetener with rich caramel note.', variants: ['750ml Glass Bottle', '375ml Bottle', 'Block Hakuru Jaggery 500g'] },
  { id: 103, name: 'Ceylon High-Grown Organic Multi-Flora Bee Honey 500g', category: 'Plantation Groceries', price: 2900, origPrice: 3400, installment: 'Rs 290/mo', emoji: '🐝', rating: 4.8, reviews: 98, stock: 'In Stock', desc: 'Raw unfiltered honey collected from sustainable hives inside organic spice estates in Knuckles range. Zero artificial feeding or heating.', variants: ['500g Jar', '1kg Family Tub', '250g Squeeze Bottle'] },
  { id: 1, name: 'Ceylon Organic Cinnamon (ALBA Grade 500g)', category: 'Spices & Tea', price: 3600, origPrice: 4200, installment: 'Rs 360/mo for 10 mos', emoji: '🌿', rating: 4.9, reviews: 128, stock: 'In Stock (Kandy Warehouse)', desc: 'Highest grade ALBA pure Ceylon cinnamon quills hand-peeled in our certified organic estate. Sweet floral aroma and coumarin-safe.', variants: ['500g Pack', '1kg Pack', '250g Glass Jar'] },
  { id: 2, name: 'Hill Country Single Estate BOPF Tea 1kg', category: 'Spices & Tea', price: 2200, origPrice: 2600, installment: 'Rs 220/mo', emoji: '☕', rating: 4.8, reviews: 95, stock: 'In Stock', desc: 'Pure Ceylon Broken Orange Pekoe Fannings from high-grown Nuwara Eliya slopes. Intense golden liquor and brisk malty notes.', variants: ['1kg Pouch', '500g Tin', 'Tea Bags (100s)'] },
  { id: 104, name: 'Estate Ground Black Pepper & Green Cardamom Set (250g x 2)', category: 'Spices & Tea', price: 2650, origPrice: 3100, installment: 'Rs 265/mo', emoji: '🧂', rating: 4.9, reviews: 82, stock: 'In Stock', desc: 'High-piperine bold black pepper and fragrant green cardamom hand-sorted from hill country shady plantations.', variants: ['250g Combo', '500g Bulk Pack', 'Whole Spice Pods'] },
  { id: 5, name: 'Extra Virgin Cold-Pressed Coconut Oil 1L', category: 'Pure Coconut & Oils', price: 1950, origPrice: 2300, installment: 'Rs 195/mo', emoji: '🥥', rating: 4.9, reviews: 88, stock: 'In Stock', desc: 'Cold-pressed from selected fresh coconuts within 48 hours of harvest in Kurunegala coconut triangle. Unrefined, pure crystal clear.', variants: ['1 Litre Glass Bottle', '500ml Bottle', '4 Litre Bulk Can'] },
  { id: 6, name: 'Kandy Citronella & Lemongrass Essential Oil 100ml', category: 'Pure Coconut & Oils', price: 2800, origPrice: 3200, installment: 'Rs 280/mo', emoji: '🧪', rating: 4.8, reviews: 51, stock: 'In Stock', desc: 'Steam-distilled pure essential oil from estate-grown citronella grass. Therapeutic aroma and natural organic insect deterrent.', variants: ['100ml Dropper', '50ml Spray', '250ml Refill'] },
  { id: 3, name: 'Live Mahogany Estate Sapling (2-3 Feet High)', category: 'Live Plants & Saplings', price: 1400, origPrice: 1800, installment: 'Rs 140/mo', emoji: '🌱', rating: 4.7, reviews: 64, stock: '15 saplings left in nursery', desc: 'Commercial timber sapling with vigorous root ball. Ideal for homestead perimeter planting or agro-forestry investment schemes.', variants: ['Single Sapling', 'Bundle of 5', 'Bundle of 10'] },
  { id: 4, name: 'Plantation Solid Teak Wood Dining Chair', category: 'Teak Furniture', price: 7500, origPrice: 9500, installment: 'Rs 750/mo for 10 mos', emoji: '🪑', rating: 5.0, reviews: 42, stock: 'Handmade by Kandy Craftsmen', desc: 'Handcrafted from seasoned 30-year plantation teak wood with natural satin lacquer finish. Termite proof and built to last generations.', variants: ['Natural Golden Teak', 'Dark Walnut Stain', 'Rustic Matte'] },
];

/** Demo extras merged onto product DTOs (additive; contracts have no such fields). */
export interface ProductExtras {
  emoji: string;
  rating: number;
  review_count: number;
  stock_label: string;
  emi_text: string;
}

const catId = (name: string) => DEMO_CATEGORIES.find((c) => c.name === name)?.id ?? null;
export const productId = (n: number) => String(n);

export function demoProductExtras(p: DemoProduct): ProductExtras {
  return { emoji: p.emoji, rating: p.rating, review_count: p.reviews, stock_label: p.stock, emi_text: p.installment };
}

export function toProductDto(p: DemoProduct): ProductListItemDto & ProductExtras {
  const id = productId(p.id);
  const left = /^(\d+) saplings left/.exec(p.stock);
  return {
    id,
    slug: id,
    sku: `NP-${String(p.id).padStart(4, '0')}`,
    name: p.name,
    category_id: catId(p.category),
    category_name: p.category,
    brand: null,
    short_description: p.desc,
    unit: 'pcs',
    sale_by: 'normal',
    qty_step: 1,
    min_qty: 1,
    price: p.price,
    original_price: p.origPrice,
    discount_pct: Math.round(((p.origPrice - p.price) / p.origPrice) * 100),
    thumbnail_url: null,
    in_stock: true,
    available_qty: left ? Number(left[1]) : 50,
    has_variants: true,
    emi_available: true,
    updated_at: DEMO_NOW_ISO,
    ...demoProductExtras(p),
  };
}

export function toProductDetailDto(p: DemoProduct): ProductDetailDto & ProductExtras {
  const base = toProductDto(p);
  // The demo lists variant names only; every variant keeps the product price (demo has no per-variant pricing).
  const variants: VariantDto[] = p.variants.map((name, i) => ({
    id: `v-${p.id}-${i + 1}`,
    name,
    sku: `${base.sku}-${i + 1}`,
    price: p.price,
    original_price: p.origPrice,
    attributes: {},
    image_url: null,
    in_stock: true,
    available_qty: base.available_qty,
  }));
  return { ...base, description: p.desc, gallery: [], variants, price_note: null };
}

export function categoriesDto(): CategoryDto[] {
  return DEMO_CATEGORIES.map((c, i) => ({
    id: c.id,
    name: c.name,
    parent_id: null,
    image_url: null,
    sort_order: i + 1,
    product_count: DEMO_PRODUCTS.filter((p) => p.category === c.name).length,
    updated_at: DEMO_NOW_ISO,
  }));
}

/* ------------------------------------------------------- cart / wishlist */
/** The demo opens with these three lines in the cart (qty 1 each). The cart is client state, so the mock API cannot seed it; use this to prefill the cart store in dev. */
export const DEMO_CART: { productId: number; qty: number }[] = [
  { productId: 101, qty: 1 },
  { productId: 1, qty: 1 },
  { productId: 102, qty: 1 },
];
export const DEMO_WISHLIST_IDS = [101, 1, 4];

/* ---------------------------------------------------- pricing / checkout */
export const DEMO_DELIVERY_FEE = 350;
export const DEMO_COUPON = { code: 'PLANT2026', discount: 500, successMessage: 'Promo Code Applied: Rs 500 Off your plantation groceries!', errorMessage: 'Invalid Promo Code. Try using PLANT2026' } as const;

export const DEMO_PAYMENT_METHODS = [
  { key: 'COD', contract: 'cod', title: 'Cash on Delivery (COD) with OTP', body: 'Pay cash to agent Kamal upon OTP handover at your doorstep.' },
  { key: 'WALLET', contract: null, title: 'Smart Buy Wallet (Rs 48,500.00 Available)', body: 'Instant debit from verified ledger balance. 0% transaction fee.' },
  { key: 'BANK', contract: 'bank_transfer', title: 'Bank Slip Transfer (BOC / Commercial)', body: 'Upload deposit slip for branch admin verification.' },
] as const;

/* ------------------------------------------------------------ banner/branch */
export const DEMO_BANNER = {
  badge: 'FARM FRESH HARVEST 2026',
  title: 'Pure Ceylon Agro & Groceries',
  body: 'Direct from hill country plantations to your door. Cash on delivery & branch dispatch!',
  cta: 'Explore Flash Deals',
  pill: '⚡ 2-Hour Branch Delivery',
  searchPlaceholder: 'Search rice, tea, cinnamon, oils, teak...',
} as const;

export function bannersDto(): (BannerDto & { badge: string; cta: string; pill: string })[] {
  return [{ id: 'bn1', title: DEMO_BANNER.title, subtitle: DEMO_BANNER.body, image_url: null, link_url: null, sort_order: 1, badge: DEMO_BANNER.badge, cta: DEMO_BANNER.cta, pill: DEMO_BANNER.pill }];
}

export const DEMO_BRANCHES: BranchDto[] = [
  { id: 'b1', name: 'Kandy Central Branch', code: 'KDY', address: 'Kandy Central', phone: '0812233445', latitude: null, longitude: null },
  { id: 'b2', name: 'Digana Hub', code: 'DGN', address: 'Digana, Kandy', phone: null, latitude: null, longitude: null },
];

export const DEMO_ADDRESSES: AddressDto[] = [
  { id: 'a1', label: 'Home', recipient_name: 'Sunil Jayawardena', phone: '0771234567', line1: 'No. 45, Peradeniya Road', line2: null, city: 'Kandy Central', district: 'Kandy', postal_code: null, latitude: null, longitude: null, is_default: true },
  { id: 'a2', label: 'Estate Office', recipient_name: 'Sunil Jayawardena', phone: '0771234567', line1: 'Plot 12, Hill Crest Estate', line2: null, city: 'Digana', district: 'Kandy', postal_code: null, latitude: null, longitude: null, is_default: false },
];

/* ---------------------------------------------------------------- Smart Buy */
export const DEMO_SCHEME = {
  member_id: 'm1',
  scheme_id: 's1',
  scheme_number: 'SB-PLANT-2026-M04',
  name: 'Mahogany & Teak Estate 12-Month Smart Scheme',
  frequency: 'weekly' as const,
  contribution_amount: 2500,
  cycle_count: 12,
  cycles_paid: 7,
  contributions_paid: 17500,
  /** demo "Target: Rs 30,000" */
  chit_value: 30000,
  next_draw_date: '2026-11-15T00:00:00.000Z',
  status: 'active',
  badge: 'ACTIVE SCHEME',
  won_cycle_no: null,
  agent_name: DEMO_AGENT.name,
  /** demo progress bar width */
  progress_pct: 58.3,
  last_contribution: { amount: 2500, label: 'Rs 2,500 (Paid ✓)' },
};

/** Second scheme seen in the demo (agent member list: Nimal Bandara). Not in the customer's own list. */
export const DEMO_SCHEME_2 = {
  id: 's2',
  scheme_number: null as string | null,
  name: 'Hill Country Spices Scheme',
  frequency: 'weekly' as const,
  contribution_amount: 1000,
};

export const DEMO_DRAWS = [
  {
    id: 'd7', cycle_no: 7, draw_date: '2026-10-25T00:00:00.000Z', method: 'live', winner_label: 'K. Rasika (Member #NP-1042)', is_me: false,
    badge: '🏆 OCTOBER CYCLE 7 DRAW WINNER', prize: 'Solid Teak King Bedroom Set', prize_value: 285000, note: 'Conducted live at Kandy Branch • Oct 25, 2026', avatar: '🥇',
    video: { badge: 'VERIFIED H.264 • 720p 60FPS', stage: 'POS Draw Ceremony — Kandy Branch Auditorium', reveal: 'Cycle 7 Winner: Token #42 (K. Rasika)' },
  },
  {
    id: 'd6', cycle_no: 6, draw_date: '2026-09-25T00:00:00.000Z', method: 'verified', winner_label: 'M. Farook (Member #NP-0891)', is_me: false,
    badge: 'SEPTEMBER CYCLE 6 WINNER', prize: '1-Acre Organic Spices Planting Kit', prize_value: 150000, note: 'Draw verified by Branch Manager • Sep 25, 2026', avatar: '🥈',
    video: null,
  },
];

export const DEMO_WALLET = {
  balance: 48500,
  transactions: [
    { id: 't1', type: 'credit', amount: 5000, balance_after: 48500, source: 'Cycle 6 Dividend Award', note: 'Oct 18, 2026 • POS Sync', created_at: '2026-10-18T10:00:00.000Z' },
    { id: 't2', type: 'debit', amount: -12000, balance_after: 43500, source: 'Teak Dining Chair Order #NP-8812', note: 'Oct 05, 2026 • App Checkout', created_at: '2026-10-05T10:00:00.000Z' },
  ],
} as const;

/* ------------------------------------------------------------------- agent */
export const DEMO_AGENT_STATS = {
  rank_label: 'Star Gold Agent',
  rank_detail: 'Rank #2 in Kandy District',
  tier: 'Tier 1',
  rating: 4.9,
  review_count: 148,
  families_served: 148,
  smartbuy_members: 42,
  on_time_pct: 98.4,
  on_duty: true,
  pending_drops: 3,
  cod_to_collect: 18500,
  month_commission: 28450,
  branch_name: DEMO_AGENT.branchName,
  goal: { title: 'Target Milestone: "Champion Club"', subtitle: 'Earn Rs 35,000 this month to unlock season bonus', target: 35000, earned: 28450 },
  pct: 81,
  incentive_banner: '3 More Deliveries Today: Complete today\'s assigned drops to unlock +Rs 3,500 Festival Incentive Bonus!',
  badges: ['🏅 Century Club', '⚡ Quick Courier', '👑 Top Enroller'],
  badge_hints: ['Over 100 successful deliveries', 'Zero delivery delays this month', 'Over 40 Smart Buy scheme members registered'],
};

export const DEMO_COMMISSION = {
  month: '2026-10',
  title: 'October 2026 Commission Details',
  total: 28450,
  rows: [
    { id: 'c1', source: 'Grocery & Furniture Deliveries (48 drops)', detail: 'Rs 250 base + Rs 50 OTP on-time bonus per drop', base_amount: 14200, amount: 14200, color: 'green' },
    { id: 'c2', source: 'Smart Buy Scheme Enrolments (7 members)', detail: 'Rs 1,500 per approved member application', base_amount: 10500, amount: 10500, color: 'gold' },
    { id: 'c3', source: 'Weekly Installment Collections (5% Incentive)', detail: 'Collected Rs 75,000 from assigned members', base_amount: 75000, amount: 3750, color: 'blue' },
  ],
};

export const DEMO_AGENT_MEMBERS = [
  { member_id: 'm1', customer_name: 'Sunil Jayawardena (Member #NP-1042)', phone: '077 123 4567', area: 'Peradeniya Rd', scheme_id: 's1', scheme_name: 'Mahogany & Teak Scheme', weekly: 2500, contributions_paid: 17500, paid: true },
  { member_id: 'm2', customer_name: 'Nimal Bandara (Member #NP-0982)', phone: '071 556 7789', area: 'Katugastota Rd', scheme_id: 's2', scheme_name: 'Hill Country Spices Scheme', weekly: 1000, contributions_paid: 6000, paid: false },
];

export const DEMO_PRINTER = { name: 'ESC-POS-58 (BT-04)', title: 'ESC/POS Bluetooth Thermal Printer' };

/* -------------------------------------------------------------- deliveries */
export interface DemoDelivery {
  id: string;
  customer: string;
  phone: string;
  address: string;
  amount: number;
  otp: string;
  status: 'dispatched' | 'delivered';
  items: string;
}

export const DEMO_DELIVERIES: DemoDelivery[] = [
  { id: 'NP-ORD-9042', customer: 'Sunil Jayawardena', phone: '077 123 4567', address: 'No 45, Peradeniya Rd, Kandy Central', amount: 12500, otp: '4819', status: 'dispatched', items: 'Suwandel Rice 5kg (x1), Cinnamon 500g (x1), Kithul Treacle (x1)' },
  { id: 'NP-ORD-8991', customer: 'Anura Kumara', phone: '071 889 0012', address: 'Hill View Estate, Hantana, Kandy', amount: 6800, otp: '2294', status: 'dispatched', items: 'Cold-Pressed Virgin Coconut Oil 1L (x2)' },
  { id: 'NP-ORD-8810', customer: 'Priyanthi Silva', phone: '075 443 1188', address: 'Temple Rd, Ampitiya, Kandy', amount: 4200, otp: '7105', status: 'delivered', items: 'Live Mahogany Sapling 2ft (x3)' },
];

/** Line items for each demo delivery, priced from the catalog above. */
export function deliveryItems(id: string): OrderItemDto[] {
  const line = (pid: number, name: string, qty: number): OrderItemDto => {
    const p = DEMO_PRODUCTS.find((x) => x.id === pid)!;
    return { product_id: productId(pid), variant_id: null, name, variant_name: null, unit: 'pcs', quantity: qty, unit_price: p.price, line_total: p.price * qty, thumbnail_url: null };
  };
  if (id === 'NP-ORD-9042') return [line(101, 'Suwandel Rice 5kg', 1), line(1, 'Cinnamon 500g', 1), line(102, 'Kithul Treacle', 1)];
  if (id === 'NP-ORD-8991') return [line(5, 'Cold-Pressed Virgin Coconut Oil 1L', 2)];
  return [line(3, 'Live Mahogany Sapling 2ft', 3)];
}

/** Thermal receipt for NP-ORD-9042 exactly as the demo prints it. */
export const DEMO_RECEIPT = {
  bill_no: 'NP-ORD-9042',
  date: '2026-10-30T10:35:00.000Z',
  company_name: 'NATURAL PLANTATION',
  tagline: 'Pure Ceylon Agro Products',
  branch_name: 'Kandy Branch',
  branch_phone: '0812233445',
  lines: [
    { name: 'Organic Suwandel Red Rice 5kg', quantity: 1, unit: 'pcs', unit_price: 2450, line_total: 2450 },
    { name: 'Hill Tea Grade BOPF', quantity: 1, unit: 'pcs', unit_price: 2200, line_total: 2200 },
    { name: 'Pure Kithul Treacle', quantity: 1, unit: 'pcs', unit_price: 1850, line_total: 1850 },
  ],
  subtotal: 6500,
  discount: 500,
  delivery_fee: 350,
  total: 6350,
  payment_label: 'COD',
  footer: 'PAID IN FULL - CASH RECEIVED',
};

/** Customer tracking timeline for NP-ORD-9042 (labels and times from the demo stepper). */
export const DEMO_TRACKING = {
  eta: 'Today, within 45 mins',
  steps: [
    { key: 'placed' as const, label: 'Order Placed', sub: '10:20 AM • App Checkout Verified', at: '2026-10-30T10:20:00.000Z' },
    { key: 'confirmed' as const, label: 'Confirmed by Kandy Branch', sub: '10:24 AM • Inventory Allocated', at: '2026-10-30T10:24:00.000Z' },
    { key: 'packed' as const, label: 'Packed & Quality Sealed', sub: '10:30 AM • Organic Batch Inspected', at: '2026-10-30T10:30:00.000Z' },
    { key: 'out_for_delivery' as const, label: 'Out for Delivery', sub: 'Dispatched with Field Agent Kamal Perera', at: null },
    { key: 'delivered' as const, label: 'Delivered & Closed', sub: 'Awaiting Customer OTP Verification', at: null },
  ],
};

/* ----------------------------------------------------------- notifications */
export const DEMO_NOTIFICATIONS: (Omit<NotificationDto, 'created_at'> & { age_min: number; time_label: string; icon: string })[] = [
  { id: 'n1', type: 'order_status', channel: 'orders', title: 'Order Dispatched (#NP-ORD-9042)', body: 'Agent Kamal Perera is out for delivery with your plantation groceries.', url: null, read: false, age_min: 10, time_label: '10 min ago', icon: '📦' },
  { id: 'n2', type: 'draw_result', channel: 'smartbuy', title: 'Cycle 7 Draw Result Published', body: 'Watch the verified draw video in Smart Buy now. Member #NP-1042 won!', url: null, read: false, age_min: 60, time_label: '1 hour ago', icon: '🏆' },
  { id: 'n3', type: 'wallet', channel: 'smartbuy', title: 'Wallet Credited: Rs 5,000.00', body: 'Cycle 6 dividend bonus has been added to your ledger.', url: null, read: true, age_min: 24 * 60, time_label: 'Yesterday', icon: '💰' },
];
