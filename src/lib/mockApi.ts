// Browser preview mock — realistic data so the UI renders fully without Electron

const BRANCHES = [
  { id: 'branch-main', name: 'Colombo Main Branch', address: 'No. 123, Galle Road, Colombo 03', phone: '+94 11 234 5678', email: 'colombo@enterprise.lk', is_active: 1 },
  { id: 'branch-kandy', name: 'Kandy Branch', address: 'No. 45, Peradeniya Road, Kandy', phone: '+94 81 222 3344', email: 'kandy@enterprise.lk', is_active: 1 },
  { id: 'branch-galle', name: 'Galle Branch', address: 'No. 67, Matara Road, Galle', phone: '+94 91 234 5678', email: 'galle@enterprise.lk', is_active: 1 },
]

const CATEGORIES = [
  { id: 'cat-tv', name: 'Televisions', sort_order: 1, is_active: 1 },
  { id: 'cat-fridge', name: 'Refrigerators', sort_order: 2, is_active: 1 },
  { id: 'cat-washing', name: 'Washing Machines', sort_order: 3, is_active: 1 },
  { id: 'cat-sofa', name: 'Sofas & Living Room', sort_order: 4, is_active: 1 },
  { id: 'cat-bed', name: 'Bedroom Furniture', sort_order: 5, is_active: 1 },
  { id: 'cat-ac', name: 'Air Conditioners', sort_order: 6, is_active: 1 },
  { id: 'cat-laptop', name: 'Laptops', sort_order: 7, is_active: 1 },
  { id: 'cat-phone', name: 'Smartphones', sort_order: 8, is_active: 1 },
]

const PRODUCTS = [
  { id: 'p1', sku: 'SAM-TV-65-QLED', barcode: '8801234567890', name: 'Samsung 65" QLED 4K TV', category_id: 'cat-tv', category_name: 'Televisions', selling_price: 285000, cost_price: 210000, tax_rate: 8, min_stock_level: 3, stock: 12, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p2', sku: 'LG-TV-55-OLED', barcode: '8801234567891', name: 'LG 55" OLED Smart TV', category_id: 'cat-tv', category_name: 'Televisions', selling_price: 198000, cost_price: 148000, tax_rate: 8, min_stock_level: 3, stock: 7, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p3', sku: 'SAM-REF-450L-SBS', barcode: '8801234567892', name: 'Samsung 450L Side-by-Side Fridge', category_id: 'cat-fridge', category_name: 'Refrigerators', selling_price: 165000, cost_price: 120000, tax_rate: 8, min_stock_level: 2, stock: 5, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p4', sku: 'LG-WM-8KG-FRONT', barcode: '8801234567893', name: 'LG 8kg Front Load Washer', category_id: 'cat-washing', category_name: 'Washing Machines', selling_price: 89000, cost_price: 65000, tax_rate: 8, min_stock_level: 3, stock: 2, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p5', sku: 'DOM-SOFA-3S-GRY', barcode: '8801234567894', name: 'Domino 3-Seater Fabric Sofa Grey', category_id: 'cat-sofa', category_name: 'Sofas & Living Room', selling_price: 45000, cost_price: 28000, tax_rate: 0, min_stock_level: 5, stock: 18, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p6', sku: 'KIN-BED-QUEEN-WAL', barcode: '8801234567895', name: 'King Queen Bed Frame Walnut', category_id: 'cat-bed', category_name: 'Bedroom Furniture', selling_price: 62000, cost_price: 42000, tax_rate: 0, min_stock_level: 3, stock: 9, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p7', sku: 'MIT-AC-18K-INV', barcode: '8801234567896', name: 'Mitsubishi 18000 BTU Inverter AC', category_id: 'cat-ac', category_name: 'Air Conditioners', selling_price: 138000, cost_price: 98000, tax_rate: 8, min_stock_level: 2, stock: 4, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p8', sku: 'APP-MBP-M3-14', barcode: '8801234567897', name: 'Apple MacBook Pro M3 14"', category_id: 'cat-laptop', category_name: 'Laptops', selling_price: 385000, cost_price: 310000, tax_rate: 8, min_stock_level: 2, stock: 3, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p9', sku: 'SAM-S24-ULTRA-BLK', barcode: '8801234567898', name: 'Samsung Galaxy S24 Ultra 256GB', category_id: 'cat-phone', category_name: 'Smartphones', selling_price: 198000, cost_price: 158000, tax_rate: 8, min_stock_level: 5, stock: 1, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p10', sku: 'PAN-REF-320L-TOP', barcode: '8801234567899', name: 'Panasonic 320L Top Freezer Fridge', category_id: 'cat-fridge', category_name: 'Refrigerators', selling_price: 78000, cost_price: 55000, tax_rate: 8, min_stock_level: 3, stock: 11, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p11', sku: 'SON-TV-43-BRAVIA', barcode: '8801234567900', name: 'Sony 43" Bravia Smart TV', category_id: 'cat-tv', category_name: 'Televisions', selling_price: 115000, cost_price: 85000, tax_rate: 8, min_stock_level: 3, stock: 6, is_active: 1, unit: 'pcs', image_url: '' },
  { id: 'p12', sku: 'DEL-DINING-6S-OAK', barcode: '8801234567901', name: 'Delano 6-Seater Dining Set Oak', category_id: 'cat-sofa', category_name: 'Sofas & Living Room', selling_price: 95000, cost_price: 62000, tax_rate: 0, min_stock_level: 2, stock: 0, is_active: 1, unit: 'set', image_url: '' },
]

const CUSTOMERS = [
  { id: 'cust-1', name: 'Ashan Fernando', phone: '0771234567', email: 'ashan@gmail.com', nic: '882345678V', loyalty_points: 1250, credit_limit: 50000, outstanding_due: 0, address: '23 Flower Road, Colombo 7' },
  { id: 'cust-2', name: 'Priya Wickramasinghe', phone: '0777654321', email: 'priya@gmail.com', nic: '905678901V', loyalty_points: 890, credit_limit: 100000, outstanding_due: 45000, address: '45 Temple Road, Kandy' },
  { id: 'cust-3', name: 'Roshan Perera', phone: '0712233445', email: 'roshan@email.com', nic: '790123456V', loyalty_points: 320, credit_limit: 75000, outstanding_due: 12000, address: '12 Beach Road, Galle' },
  { id: 'cust-4', name: 'Malini Jayawardena', phone: '0763344556', email: 'malini@email.com', nic: '845678901V', loyalty_points: 2100, credit_limit: 200000, outstanding_due: 0, address: '78 Lake Drive, Colombo 5' },
  { id: 'cust-5', name: 'Kasun Silva', phone: '0704455667', email: 'kasun@gmail.com', nic: '912345678V', loyalty_points: 150, credit_limit: 30000, outstanding_due: 8500, address: '34 Hill Street, Nuwara Eliya' },
]

const INVOICES = [
  { id: 'inv-1', invoice_number: 'INV-MAI-260523-000145', customer_name: 'Ashan Fernando', cashier_name: 'System Admin', total_amount: 285000, status: 'completed', created_at: new Date(Date.now()-1*3600000).toISOString() },
  { id: 'inv-2', invoice_number: 'INV-MAI-260523-000144', customer_name: 'Walk-in Customer', cashier_name: 'System Admin', total_amount: 45000, status: 'completed', created_at: new Date(Date.now()-2*3600000).toISOString() },
  { id: 'inv-3', invoice_number: 'INV-MAI-260523-000143', customer_name: 'Priya Wickramasinghe', cashier_name: 'System Admin', total_amount: 198000, status: 'completed', created_at: new Date(Date.now()-4*3600000).toISOString() },
  { id: 'inv-4', invoice_number: 'INV-MAI-260523-000142', customer_name: 'Roshan Perera', cashier_name: 'System Admin', total_amount: 89000, status: 'held', created_at: new Date(Date.now()-6*3600000).toISOString() },
]

const SALES_DATA = Array.from({length:14}, (_,i) => {
  const d = new Date(); d.setDate(d.getDate()-(13-i));
  const base = 180000 + Math.random()*120000;
  return { date: d.toISOString().slice(0,10), total_revenue: Math.round(base), total_invoices: Math.floor(base/45000)+1, total_discount: Math.round(base*0.03), total_tax: Math.round(base*0.06) };
})

const TOP_PRODUCTS = [
  { product_id:'p1', name:'Samsung 65" QLED 4K TV', sku:'SAM-TV-65-QLED', total_qty:24, total_revenue:6840000 },
  { product_id:'p8', name:'Apple MacBook Pro M3 14"', sku:'APP-MBP-M3-14', total_qty:18, total_revenue:6930000 },
  { product_id:'p7', name:'Mitsubishi 18000 BTU Inverter AC', sku:'MIT-AC-18K-INV', total_qty:31, total_revenue:4278000 },
  { product_id:'p2', name:'LG 55" OLED Smart TV', sku:'LG-TV-55-OLED', total_qty:22, total_revenue:4356000 },
  { product_id:'p9', name:'Samsung Galaxy S24 Ultra 256GB', sku:'SAM-S24-ULTRA-BLK', total_qty:19, total_revenue:3762000 },
]

const USERS = [
  { id:'u1', name:'System Admin', email:'admin@pos.local', role_name:'Super Admin', branch_name:'All Branches', is_active:1, pin:'1234', last_login_at: new Date().toISOString() },
  { id:'u2', name:'Nimal Kumara', email:'nimal@enterprise.lk', role_name:'Branch Manager', branch_name:'Colombo Main Branch', is_active:1, pin:'2222', last_login_at: new Date(Date.now()-3600000).toISOString() },
  { id:'u3', name:'Chamari Perera', email:'chamari@enterprise.lk', role_name:'Cashier', branch_name:'Colombo Main Branch', is_active:1, pin:'3333', last_login_at: new Date(Date.now()-7200000).toISOString() },
  { id:'u4', name:'Suresh Bandara', email:'suresh@enterprise.lk', role_name:'Cashier', branch_name:'Kandy Branch', is_active:1, pin:'4444', last_login_at: new Date(Date.now()-86400000).toISOString() },
  { id:'u5', name:'Dilani Rathnayake', email:'dilani@enterprise.lk', role_name:'Warehouse Staff', branch_name:'Colombo Main Branch', is_active:1, pin:'5555', last_login_at: new Date(Date.now()-172800000).toISOString() },
  { id:'u6', name:'Roshan Herath', email:'roshan@enterprise.lk', role_name:'Delivery Staff', branch_name:'Galle Branch', is_active:0, pin:null, last_login_at: null },
]

const ROLES = [
  { id:'role-super-admin', name:'Super Admin', permissions:'{"all":true}' },
  { id:'role-branch-mgr', name:'Branch Manager', permissions:'{"pos":true,"inventory":true,"reports":true}' },
  { id:'role-cashier', name:'Cashier', permissions:'{"pos":true}' },
  { id:'role-warehouse', name:'Warehouse Staff', permissions:'{"inventory":true}' },
  { id:'role-delivery', name:'Delivery Staff', permissions:'{"deliveries":true}' },
]

const SUPPLIERS = [
  { id:'s1', name:'Samsung Lanka (Pvt) Ltd', contact:'Mr. Pradeep', phone:'+94 11 456 7890', email:'pradeep@samsung.lk', tax_number:'VAT123456789', is_active:1 },
  { id:'s2', name:'LG Electronics Lanka', contact:'Ms. Nirosha', phone:'+94 11 567 8901', email:'nirosha@lg.lk', tax_number:'VAT234567890', is_active:1 },
  { id:'s3', name:'Domino Furniture Lanka', contact:'Mr. Saman', phone:'+94 11 678 9012', email:'saman@domino.lk', tax_number:'VAT345678901', is_active:1 },
  { id:'s4', name:'Apple Authorized Distributor', contact:'Ms. Asha', phone:'+94 11 789 0123', email:'asha@applesl.lk', tax_number:'VAT456789012', is_active:1 },
]

const STOCKS = PRODUCTS.map((p) => ({
  id: `stock-${p.id}`, product_id: p.id, branch_id: 'branch-main', warehouse_id: 'wh-main',
  product_name: p.name, sku: p.sku, min_stock_level: p.min_stock_level,
  quantity: p.stock, damaged_qty: Math.floor(Math.random()*2), warehouse_name: 'Main Warehouse'
}))

const DELIVERIES = [
  { id:'del-1', invoice_number:'INV-MAI-260523-000143', customer_name:'Priya Wickramasinghe', address:'45 Temple Road, Kandy', assigned_name:'Roshan Herath', status:'dispatched', scheduled_at: new Date().toISOString(), created_at: new Date().toISOString() },
  { id:'del-2', invoice_number:'INV-MAI-260523-000141', customer_name:'Malini Jayawardena', address:'78 Lake Drive, Colombo 5', assigned_name:'Roshan Herath', status:'pending', scheduled_at: new Date(Date.now()+86400000).toISOString(), created_at: new Date().toISOString() },
  { id:'del-3', invoice_number:'INV-MAI-260523-000138', customer_name:'Kasun Silva', address:'34 Hill Street, Nuwara Eliya', assigned_name:null, status:'delivered', scheduled_at: new Date(Date.now()-86400000).toISOString(), created_at: new Date(Date.now()-2*86400000).toISOString() },
]

const INSTALLMENTS = [
  { id:'inst-1', invoice_number:'INV-MAI-260523-000120', customer_name:'Priya Wickramasinghe', total_amount:198000, paid_amount:153000, due_amount:45000, installment_count:6, status:'active', next_due_date:'2026-06-15', created_at: new Date().toISOString() },
  { id:'inst-2', invoice_number:'INV-MAI-260523-000098', customer_name:'Roshan Perera', total_amount:89000, paid_amount:77000, due_amount:12000, installment_count:4, status:'overdue', next_due_date:'2026-05-01', created_at: new Date().toISOString() },
  { id:'inst-3', invoice_number:'INV-MAI-260523-000075', customer_name:'Kasun Silva', total_amount:138000, paid_amount:129500, due_amount:8500, installment_count:12, status:'active', next_due_date:'2026-06-20', created_at: new Date().toISOString() },
]

const STOCK_COUNT_SESSIONS = [
  { id: 'sc-1', branch_id: 'branch-main', branch_name: 'Colombo Main Branch', warehouse_name: 'Main Warehouse', status: 'completed', notes: 'Monthly stock take', created_by: 'System Admin', created_at: new Date(Date.now()-7*86400000).toISOString(), completed_at: new Date(Date.now()-6*86400000).toISOString(), item_count: 12, variance_count: 3 },
  { id: 'sc-2', branch_id: 'branch-main', branch_name: 'Colombo Main Branch', warehouse_name: 'Main Warehouse', status: 'in_progress', notes: 'Weekly spot check', created_by: 'System Admin', created_at: new Date(Date.now()-86400000).toISOString(), completed_at: null, item_count: 12, variance_count: 0 },
]

const STOCK_COUNT_ITEMS = PRODUCTS.map((p) => ({
  id: `sci-${p.id}`,
  session_id: 'sc-2',
  product_id: p.id,
  product_name: p.name,
  sku: p.sku,
  unit: p.unit,
  system_qty: p.stock,
  counted_qty: null as number | null,
  variance: null as number | null,
  notes: '',
}))

const AUDIT_LOGS = [
  { id:'al-1', user_name:'System Admin', action:'LOGIN', table_name:'users', record_id:'u1', branch_id:'branch-main', created_at: new Date().toISOString() },
  { id:'al-2', user_name:'System Admin', action:'CREATE_INVOICE', table_name:'invoices', record_id:'inv-1', branch_id:'branch-main', created_at: new Date(Date.now()-600000).toISOString() },
  { id:'al-3', user_name:'System Admin', action:'CREATE_INVOICE', table_name:'invoices', record_id:'inv-2', branch_id:'branch-main', created_at: new Date(Date.now()-1200000).toISOString() },
  { id:'al-4', user_name:'Nimal Kumara', action:'STOCK_ADJUST', table_name:'stocks', record_id:'p4', branch_id:'branch-main', created_at: new Date(Date.now()-3600000).toISOString() },
  { id:'al-5', user_name:'System Admin', action:'LOGIN', table_name:'users', record_id:'u2', branch_id:'branch-kandy', created_at: new Date(Date.now()-7200000).toISOString() },
]

const delay = (ms=50) => new Promise(r => setTimeout(r, ms))
const ok = (data: unknown) => ({ success: true as const, data, error: undefined as string | undefined })

export const mockApi = {
  auth: {
    login: async (_p: unknown) => { await delay(); return ok({ user: { id:'u1', name:'System Admin', email:'admin@pos.local', role:{ name:'Super Admin', permissions:{ all:true } }, branch:{ id:'branch-main', name:'Colombo Main Branch' } }, token:'mock-token' }) },
    logout: async () => { await delay(); return ok(null) },
    whoami: async () => ok({ id:'u1', name:'System Admin', email:'admin@pos.local', role:{ name:'Super Admin', permissions:{ all:true } }, branch:{ id:'branch-main', name:'Colombo Main Branch' } }),
    pinLogin: async (_p: unknown) => ok({ user: { id:'u1', name:'System Admin', email:'admin@pos.local', role:{ name:'Super Admin', permissions:{ all:true } }, branch:{ id:'branch-main', name:'Colombo Main Branch' } }, token:'mock-token' }),
  },
  products: {
    list: async (f?: Record<string,unknown>) => { await delay(); let p = PRODUCTS; if (f?.category_id) p=p.filter(x=>x.category_id===f.category_id); return ok(p) },
    get: async (id: string) => ok(PRODUCTS.find(p=>p.id===id)||null),
    search: async (q: string) => { await delay(100); return ok(PRODUCTS.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.sku.toLowerCase().includes(q.toLowerCase()))) },
    searchSku: async (sku: string) => ok(PRODUCTS.find(p=>p.sku===sku||p.barcode===sku)||null),
    create: async (_p: unknown) => ok({ id:'new-'+Date.now() }),
    update: async (_id: string, _p: unknown) => ok(null),
    delete: async (_id: string) => ok(null),
    selectAndUploadImage: async () => ok(''),
    importExcel: async () => ok({ imported: PRODUCTS.length, skipped: 0, errors: [] }),
    exportCsv: async () => ok({ exported: PRODUCTS.length, path: 'mock-products.csv' }),
  },
  invoices: {
    list: async () => { await delay(); return ok(INVOICES) },
    get: async (id: string) => ok({ ...INVOICES.find(i=>i.id===id), items:[], payments:[] }),
    create: async (_p: unknown) => { await delay(300); return ok({ id:'inv-new-'+Date.now(), invoice_number:'INV-MAI-260526-000146' }) },
    update: async (_id: string, _p: unknown) => ok(null),
    hold: async (_id: string) => ok(null),
    cancel: async (_id: string) => ok(null),
    return: async (_id: string, _p: unknown) => ok(null),
    listHeld: async () => ok(INVOICES.filter(i=>i.status==='held')),
    nextNumber: async () => ok('INV-MAI-260526-000146'),
  },
  customers: {
    list: async (_f?: unknown) => { await delay(); return ok(CUSTOMERS) },
    get: async (id: string) => ok(CUSTOMERS.find(c=>c.id===id)||null),
    search: async (q: string) => { await delay(100); return ok(CUSTOMERS.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())||c.phone.includes(q))) },
    create: async (p: Record<string,unknown>) => ok({ id:'cust-new-'+Date.now(), ...p, loyalty_points:0, credit_limit:0, outstanding_due:0 }),
    update: async (_id: string, _p: unknown) => ok(null),
    installments: async (_id: string) => ok(INSTALLMENTS.slice(0,2)),
    history: async (_id: string) => ok(INVOICES.slice(0,3)),
  },
  stocks: {
    list: async () => { await delay(); return ok(STOCKS) },
    get: async (productId: string) => ok(STOCKS.find(s=>s.product_id===productId)||null),
    transfer: async (_p: unknown) => { await delay(200); return ok({ id:'tr-'+Date.now() }) },
    listTransfers: async () => ok([]),
    lowStock: async () => ok(STOCKS.filter(s=>s.quantity<=s.min_stock_level)),
    adjust: async (_p: unknown) => ok(null),
    availability: async (productId: string) => ok(BRANCHES.map((b, i) => ({
      id:`availability-${productId}-${b.id}`, product_id:productId, branch_id:b.id,
      branch_name:b.name, branch_address:b.address, quantity:Math.max(0, 12-i*5),
      damaged_qty:0, available_quantity:Math.max(0, 12-i*5)
    }))),
    updateTransfer: async (_id:string,_status:string,_p?:unknown) => ok(null),
  },
  orders: {
    list: async () => ok([]),
    get: async (_id:string) => ok(null),
    create: async (_p:unknown) => ok({ id:'order-'+Date.now(), order_number:`ORD-MAI-${Date.now().toString(36).toUpperCase()}` }),
    updateStatus: async (_id:string,_status:string,_p?:unknown) => ok(null),
  },
  analytics: {
    salesSummary: async (_f?: unknown) => { await delay(); return ok(SALES_DATA) },
    topProducts: async (_f?: unknown) => ok(TOP_PRODUCTS),
    branchPerformance: async (_f?: unknown) => ok(BRANCHES.map((b,i)=>({ branch_id:b.id, branch_name:b.name, total_revenue:(400000-i*80000)*Math.random()+200000, total_invoices:Math.floor(40-i*8+Math.random()*10), avg_invoice_value:45000+Math.random()*20000 }))),
    revenue: async (_f?: unknown) => ok({ today:{ revenue: SALES_DATA[SALES_DATA.length-1].total_revenue, invoices: SALES_DATA[SALES_DATA.length-1].total_invoices }, month:{ revenue: SALES_DATA.reduce((s,d)=>s+d.total_revenue,0), invoices: SALES_DATA.reduce((s,d)=>s+d.total_invoices,0) }, outstanding:{ total:65500 } }),
    dailyReport: async (_date: string) => ok({ summary:{ invoices:8, revenue:320000, discounts:9600, taxes:25600 }, byMethod:[{ method:'cash', total:180000, count:5 },{ method:'card', total:140000, count:3 }] }),
  },
  admin: {
    branches: { list: async () => ok(BRANCHES), create: async (_p:unknown) => ok({id:'br-'+Date.now()}), update: async (_id:string,_p:unknown) => ok(null) },
    users: { list: async () => { await delay(); return ok(USERS) }, create: async (_p:unknown) => ok({id:'u-'+Date.now()}), update: async (_id:string,_p:unknown) => ok(null) },
    roles: { list: async () => ok(ROLES) },
    suppliers: { list: async () => { await delay(); return ok(SUPPLIERS) }, create: async (_p:unknown) => ok({id:'s-'+Date.now()}), update: async (_id:string,_p:unknown) => ok(null) },
    categories: { list: async () => ok(CATEGORIES), create: async (_p:unknown) => ok({id:'c-'+Date.now()}), update: async (_id:string,_p:unknown) => ok(null), delete: async (_id:string) => ok(null) },
    auditLogs: { list: async (_f?: unknown) => { await delay(); return ok(AUDIT_LOGS) } },
    deliveries: { list: async (f?: Record<string,unknown>) => { await delay(); let d=DELIVERIES; if(f?.status) d=d.filter(x=>x.status===f.status); return ok(d) }, update: async (_id:string,_p:unknown) => ok(null) },
    installments: { list: async (f?: Record<string,unknown>) => { await delay(); let inst=INSTALLMENTS; if(f?.status) inst=inst.filter(x=>x.status===f.status); return ok(inst) }, recordPayment: async (_id:string,_p:unknown) => ok(null) },
  },
  stockCounts: {
    list: async () => { await delay(); return ok(STOCK_COUNT_SESSIONS) },
    create: async (_p: unknown) => { await delay(200); const id = 'sc-'+Date.now(); STOCK_COUNT_SESSIONS.push({ id, branch_id:'branch-main', branch_name:'Colombo Main Branch', warehouse_name:'Main Warehouse', status:'in_progress', notes: (_p as Record<string,string>)?.notes || '', created_by:'System Admin', created_at: new Date().toISOString(), completed_at: null, item_count: PRODUCTS.length, variance_count: 0 }); return ok({ id }) },
    get: async (id: string) => { await delay(); const session = STOCK_COUNT_SESSIONS.find(s => s.id === id); if (!session) return { success: false as const, error: 'Not found', data: undefined }; return ok({ ...session, items: STOCK_COUNT_ITEMS.map(i => ({ ...i, session_id: id })) }) },
    updateItem: async (_sessionId: string, itemId: string, countedQty: number) => { await delay(50); const item = STOCK_COUNT_ITEMS.find(i => i.id === itemId); if (item) { item.counted_qty = countedQty; item.variance = countedQty - item.system_qty } return ok(null) },
    finalize: async (id: string) => { await delay(300); const s = STOCK_COUNT_SESSIONS.find(x => x.id === id); if (s) { s.status = 'completed'; s.completed_at = new Date().toISOString() } return ok(null) },
    cancel: async (id: string) => { await delay(100); const s = STOCK_COUNT_SESSIONS.find(x => x.id === id); if (s) s.status = 'cancelled'; return ok(null) },
    exportCsv: async (_id: string) => ok({ exported: STOCK_COUNT_ITEMS.length, path: 'mock-stock-count.csv' }),
    importCsv: async (_id: string) => ok({ imported: STOCK_COUNT_ITEMS.length }),
  },
  sync: {
    status: async () => ok({ pending: 0, failed: 0, last_sync: new Date().toISOString() }),
    trigger: async () => ok(null),
    queueCount: async () => ok(0),
    queue: async () => ok([] as unknown[]),
    diagnose:    async () => ok([] as unknown[]),
    resetFailed: async () => ok(0),
  },
  printer: {
    printReceipt: async (_p: unknown) => ok({ receipt_text: 'Mock receipt' }),
    printInvoice: async (_p: unknown) => ok(null),
    emailInvoice: async (_p: unknown) => ok(null),
    test: async () => ok('Test OK'),
    listDevices: async () => ok([]),
  },
  settings: {
    get: async () => ok({ branch_id:'branch-main', branch_name:'Colombo Main Branch', currency:'LKR', currency_symbol:'Rs.', tax_label:'VAT', receipt_header:'Enterprise POS ERP\nColombo Main Branch', receipt_footer:'Thank you! Visit Again.', low_stock_threshold:5, cloud_api_url:'', cloud_api_key:'', theme:'dark' }),
    update: async (_p: unknown) => ok(null),
  },
  on: (_channel: string, _listener: (...args: unknown[]) => void) => () => {},
}
