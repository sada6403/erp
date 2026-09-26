const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
console.log('Connecting to SQLite Database at:', dbPath);
const db = new Database(dbPath);

// 1. SRI LANKAN DISTRICT BRANCHES
const mainBranchId = 'b1111111-1111-4111-8111-111111111111';

// Update Main Branch to Colombo
db.prepare(`
  UPDATE branches 
  SET name = 'Colombo - Flagship Showroom & HQ',
      code = 'CMB',
      address = 'No. 142, Galle Road, Colombo 03, Western Province, Sri Lanka',
      phone = '+94 11 257 8900',
      email = 'colombo.hq@ceylonfurniture.lk',
      is_active = 1,
      updated_at = datetime('now')
  WHERE id = ?
`).run(mainBranchId);

// Add other Sri Lankan District Branches
const districtBranches = [
  {
    id: 'br_lk_kandy',
    name: 'Kandy - Central Province Showroom',
    code: 'KDY',
    address: 'No. 88, Dalada Veediya, Kandy District, Central Province, Sri Lanka',
    phone: '+94 81 223 4500',
    email: 'kandy@ceylonfurniture.lk',
  },
  {
    id: 'br_lk_galle',
    name: 'Galle - Southern Province Showroom',
    code: 'GLE',
    address: 'No. 65, Matara Road, Galle Fort Promenade, Southern Province, Sri Lanka',
    phone: '+94 91 224 5600',
    email: 'galle@ceylonfurniture.lk',
  },
  {
    id: 'br_lk_gampaha',
    name: 'Gampaha - Negombo Showroom & Logistics Hub',
    code: 'GMP',
    address: 'No. 210, Colombo - Negombo Road, Ja-Ela, Gampaha District, Sri Lanka',
    phone: '+94 31 223 7800',
    email: 'gampaha@ceylonfurniture.lk',
  },
  {
    id: 'br_lk_kurunegala',
    name: 'Kurunegala - North Western Showroom',
    code: 'KRN',
    address: 'No. 45, Dambulla Road, Kurunegala District, North Western Province, Sri Lanka',
    phone: '+94 37 222 3400',
    email: 'kurunegala@ceylonfurniture.lk',
  },
  {
    id: 'br_lk_jaffna',
    name: 'Jaffna - Northern Province Showroom',
    code: 'JAF',
    address: 'No. 112, Hospital Road, Jaffna District, Northern Province, Sri Lanka',
    phone: '+94 21 222 8900',
    email: 'jaffna@ceylonfurniture.lk',
  },
  {
    id: 'br_lk_batticaloa',
    name: 'Batticaloa - Eastern Province Showroom',
    code: 'BTC',
    address: 'No. 78, Trincomalee Road, Batticaloa District, Eastern Province, Sri Lanka',
    phone: '+94 65 222 4500',
    email: 'batticaloa@ceylonfurniture.lk',
  }
];

const insertBranchStmt = db.prepare(`
  INSERT INTO branches (id, name, code, address, phone, email, is_active, created_at, updated_at)
  VALUES (@id, @name, @code, @address, @phone, @email, 1, datetime('now'), datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    code = excluded.code,
    address = excluded.address,
    phone = excluded.phone,
    email = excluded.email,
    is_active = 1,
    updated_at = datetime('now')
`);

districtBranches.forEach(b => insertBranchStmt.run(b));
console.log('Sri Lankan District Branches configured: 7');

// 2. FURNITURE CATEGORIES
const furnitureCategories = [
  { id: 'cat_furn_living',  name: 'Living Room Furniture', short_code: 'LIV', description: 'Luxury Sofas, Teak Coffee Tables, TV Consoles, Recliners' },
  { id: 'cat_furn_bed',     name: 'Bedroom Furniture',    short_code: 'BED', description: 'Teak & Mahogany Beds, Wardrobes, Dressing Tables, Mattresses' },
  { id: 'cat_furn_dining',  name: 'Dining Room Furniture', short_code: 'DIN', description: 'Solid Wood Dining Suites, Crockery Cabinets, Bar Counters' },
  { id: 'cat_furn_office',  name: 'Office & Study Furniture', short_code: 'OFC', description: 'Executive Director Desks, Ergonomic Mesh Chairs, Bookshelves' },
  { id: 'cat_furn_outdoor', name: 'Outdoor & Garden Furniture', short_code: 'OUT', description: 'Treated Teak Patio Sets, Rattan Chairs, Weatherproof Swings' },
  { id: 'cat_furn_storage', name: 'Wardrobes & Storage Units', short_code: 'STR', description: 'Sliding & Hinged Wardrobes, Chest of Drawers, Shoe Racks' },
  { id: 'cat_furn_decor',   name: 'Solid Wood Decor & Carvings', short_code: 'DEC', description: 'Traditional Kandyan Carved Mirrors, Solid Brass Hardware' },
];

const insertCatStmt = db.prepare(`
  INSERT INTO categories (id, name, short_code, description, is_active, created_at, updated_at)
  VALUES (@id, @name, @short_code, @description, 1, datetime('now'), datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    short_code = excluded.short_code,
    description = excluded.description,
    is_active = 1,
    updated_at = datetime('now')
`);

furnitureCategories.forEach(c => insertCatStmt.run(c));
console.log('Furniture Categories seeded: ' + furnitureCategories.length);

// 3. SRI LANKAN FURNITURE & TIMBER SUPPLIERS (With complete template fields)
const suppliers = [
  {
    id: 'sup_moratuwa_teak',
    name: 'Moratuwa Master Craftsmen Woodworks (Pvt) Ltd',
    business_name: 'Moratuwa Teak & Timber Industries',
    first_name: 'Rohana',
    last_name: 'Fernando',
    middle_name: 'Jude',
    contact: 'Mr. Rohana Fernando (Managing Director)',
    phone: '+94773124567',
    mobile_number: '+94773124567',
    alt_mobile: '+94718456123',
    landline: '+94112654321',
    email: 'sales@moratuwateak.lk',
    address: 'No. 48, De Soysa Road, Rawathawatte, Moratuwa Woodcraft Hub',
    city: 'Moratuwa',
    state: 'Western Province',
    country: 'Sri Lanka',
    zip_code: '10400',
    tax_number: '109234857-7000',
    pay_terms: 'Net 30 Days',
    due_balance: 0.00
  },
  {
    id: 'sup_ceylon_mahogany',
    name: 'Ceylon Heritage Hardwood & Timber Mills',
    business_name: 'Ceylon Mahogany Exporters & Sawmills Ltd',
    first_name: 'Anura',
    last_name: 'Senanayake',
    middle_name: 'Bandara',
    contact: 'Mr. Anura Senanayake (Chief Timber Officer)',
    phone: '+94777891234',
    mobile_number: '+94777891234',
    alt_mobile: '+94702345678',
    landline: '+94332267890',
    email: 'orders@ceylonhardwood.lk',
    address: 'Kandy Road, Miriswatta Timber Industrial Zone, Gampaha',
    city: 'Gampaha',
    state: 'Western Province',
    country: 'Sri Lanka',
    zip_code: '11000',
    tax_number: '118745920-7000',
    pay_terms: 'Net 15 Days',
    due_balance: 45000.00
  },
  {
    id: 'sup_lanka_sofa',
    name: 'Lanka Comfort Upholstery & Cushion World',
    business_name: 'Lanka Modern Sofas & Recliners (Pvt) Ltd',
    first_name: 'Dilani',
    last_name: 'Wickramasinghe',
    middle_name: 'Kusum',
    contact: 'Mrs. Dilani Wickramasinghe (Production Director)',
    phone: '+94714567890',
    mobile_number: '+94714567890',
    alt_mobile: '+94768901234',
    landline: '+94112890123',
    email: 'supply@lankasofas.lk',
    address: 'No. 215, High Level Road, Maharagama, Colombo',
    city: 'Colombo',
    state: 'Western Province',
    country: 'Sri Lanka',
    zip_code: '10280',
    tax_number: '134567891-7000',
    pay_terms: 'Net 30 Days',
    due_balance: 0.00
  },
  {
    id: 'sup_kandy_carvings',
    name: 'Kandyan Traditional Wood Carvers Guild',
    business_name: 'Hill Country Antique & Carved Furniture Ltd',
    first_name: 'Bandara',
    last_name: 'Gunatilleke',
    middle_name: 'Tikiri',
    contact: 'Mr. Bandara Gunatilleke (Master Artisan & Curator)',
    phone: '+94772345678',
    mobile_number: '+94772345678',
    alt_mobile: '+94719012345',
    landline: '+94812234123',
    email: 'info@kandycarvings.lk',
    address: 'No. 32, Temple Road, Pilimathalawa Artisan Village, Kandy',
    city: 'Kandy',
    state: 'Central Province',
    country: 'Sri Lanka',
    zip_code: '20450',
    tax_number: '145678902-7000',
    pay_terms: '50% Advance, Balance on Delivery',
    due_balance: 15000.00
  },
  {
    id: 'sup_steel_office',
    name: 'Apex Steel & Ergonomic Office Systems',
    business_name: 'Apex Commercial Furniture & Modular Fittings Ltd',
    first_name: 'Sivakumar',
    last_name: 'Sivarajah',
    middle_name: 'K.',
    contact: 'Mr. K. Sivarajah (Corporate Solutions Head)',
    phone: '+94776123456',
    mobile_number: '+94776123456',
    alt_mobile: '+94754321098',
    landline: '+94112345678',
    email: 'corporate@apexoffice.lk',
    address: 'No. 89, Biyagama Export Processing Zone, Malwana',
    city: 'Gampaha',
    state: 'Western Province',
    country: 'Sri Lanka',
    zip_code: '11600',
    tax_number: '156789013-7000',
    pay_terms: 'Net 45 Days',
    due_balance: 0.00
  },
  {
    id: 'sup_southern_patio',
    name: 'Southern Teak & Cane Resort Furnishers',
    business_name: 'Galle Fort Colonial & Outdoor Furnishings Ltd',
    first_name: 'Lasantha',
    last_name: 'De Silva',
    middle_name: 'Priyantha',
    contact: 'Mr. Lasantha De Silva (General Manager)',
    phone: '+94779876543',
    mobile_number: '+94779876543',
    alt_mobile: '+94712345678',
    landline: '+94912233445',
    email: 'orders@southerndecor.lk',
    address: 'No. 14, Church Street, Galle Fort Heritage Quarter, Galle',
    city: 'Galle',
    state: 'Southern Province',
    country: 'Sri Lanka',
    zip_code: '80000',
    tax_number: '167890124-7000',
    pay_terms: 'Net 30 Days',
    due_balance: 0.00
  }
];

const insertSupStmt = db.prepare(`
  INSERT INTO suppliers (
    id, name, business_name, first_name, last_name, middle_name, contact,
    phone, mobile_number, alt_mobile, landline, email, address,
    city, state, country, zip_code, tax_number, pay_terms, due_balance,
    is_active, created_at, updated_at
  ) VALUES (
    @id, @name, @business_name, @first_name, @last_name, @middle_name, @contact,
    @phone, @mobile_number, @alt_mobile, @landline, @email, @address,
    @city, @state, @country, @zip_code, @tax_number, @pay_terms, @due_balance,
    1, datetime('now'), datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    business_name = excluded.business_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    middle_name = excluded.middle_name,
    contact = excluded.contact,
    phone = excluded.phone,
    mobile_number = excluded.mobile_number,
    alt_mobile = excluded.alt_mobile,
    landline = excluded.landline,
    email = excluded.email,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state,
    country = excluded.country,
    zip_code = excluded.zip_code,
    tax_number = excluded.tax_number,
    pay_terms = excluded.pay_terms,
    due_balance = excluded.due_balance,
    is_active = 1,
    updated_at = datetime('now')
`);

suppliers.forEach(s => insertSupStmt.run(s));
console.log('Sri Lankan Furniture Suppliers seeded: ' + suppliers.length);

// 4. FURNITURE PRODUCTS (Global products with branch_id = NULL so ALL branches see them!)
const furnitureProducts = [
  // Living Room
  {
    id: 'prod_furn_sofa_royal_teak_7s',
    category_id: 'cat_furn_living',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-SOF-TEAK-7S',
    barcode: '4790123400018',
    name: 'Solid Teak 7-Seater Royal Living Room Sofa Suite (3+2+1+1)',
    description: 'Master-crafted 100% seasoned solid Ceylon teak sofa set with hand-carved lion-claw arms, premium high-density resilience foam and stain-resistant velvet fabric.',
    unit: 'set',
    cost_price: 195000.00,
    selling_price: 285000.00,
    wholesale_price: 250000.00,
    tax_rate: 0.0,
    discount_pct: 5.0,
    min_stock_level: 2,
    alert_qty: 1,
    weight: 120.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'SHOWROOM-A1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Wood: 100% Seasoned Ceylon Teak',
    custom_field2: 'Seating: 7 Persons (3+2+1+1)',
    custom_field3: 'Warranty: 15 Years Wood Warranty'
  },
  {
    id: 'prod_furn_sofa_lshape_grey',
    category_id: 'cat_furn_living',
    supplier_id: 'sup_lanka_sofa',
    sku: 'FURN-SOF-LSHP-GRY',
    barcode: '4790123400025',
    name: 'Scandinavian Fabric L-Shape Sectional Corner Sofa (Storm Grey)',
    description: 'Contemporary modular corner couch with treated mahogany internal frame, removable washable linen fabric covers, and pocket sprung seating cushions.',
    unit: 'set',
    cost_price: 110000.00,
    selling_price: 168000.00,
    wholesale_price: 148000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 3,
    alert_qty: 2,
    weight: 85.0,
    brand: 'Lanka Comfort',
    rack_no: 'SHOWROOM-A2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Fabric: Breathable Hydrophobic Linen',
    custom_field2: 'Orientation: Universal Left/Right Reversible',
    custom_field3: 'Cushions: Includes 5 Throw Pillows'
  },
  {
    id: 'prod_furn_teak_coffee_table',
    category_id: 'cat_furn_living',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-TBL-COFF-TEAK',
    barcode: '4790123400032',
    name: 'Solid Teak Glass-Top Center Coffee Table (Carved Queen Anne Legs)',
    description: 'Rich natural teak center table featuring 8mm beveled tempered glass top, lower magazine shelf, and traditional Queen Anne carved legs.',
    unit: 'piece',
    cost_price: 24000.00,
    selling_price: 39500.00,
    wholesale_price: 33000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 5,
    alert_qty: 2,
    weight: 22.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'SHOWROOM-A3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Glass: 8mm Toughened Safety Glass',
    custom_field2: 'Dimensions: 48in x 24in x 18in',
    custom_field3: 'Finish: Natural Satin Teak Wax'
  },
  {
    id: 'prod_furn_leather_recliner',
    category_id: 'cat_furn_living',
    supplier_id: 'sup_lanka_sofa',
    sku: 'FURN-ARM-RECL-LTHR',
    barcode: '4790123400049',
    name: 'Luxury Leatherette Ergonomic High-Back Recliner Armchair',
    description: 'Smooth manual glider recliner with 3-position footrest, lumbar support pillow, and heavy gauge steel recline mechanism.',
    unit: 'piece',
    cost_price: 45000.00,
    selling_price: 68000.00,
    wholesale_price: 58000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 38.0,
    brand: 'Lanka Comfort',
    rack_no: 'SHOWROOM-A4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Material: Heavy Duty Air-Leather',
    custom_field2: 'Mechanism: German Engineered Recline',
    custom_field3: 'Weight Capacity: 150 kg'
  },
  {
    id: 'prod_furn_tv_console_unit',
    category_id: 'cat_furn_living',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-ENT-TV-CONS-6FT',
    barcode: '4790123400056',
    name: 'Modern 6ft Wall-Standing TV Entertainment Console (Teak & Brass)',
    description: '6-foot lowline TV console with soft-closing drawers, cable organizer channels, and brass accent handles. Accommodates up to 75-inch TVs.',
    unit: 'piece',
    cost_price: 38000.00,
    selling_price: 59000.00,
    wholesale_price: 50000.00,
    tax_rate: 0.0,
    discount_pct: 5.0,
    min_stock_level: 3,
    alert_qty: 1,
    weight: 45.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'SHOWROOM-A5',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Length: 72 inches (182 cm)',
    custom_field2: 'Drawers: 3 Soft-Close + 2 Open Niches',
    custom_field3: 'TV Compatibility: 43 - 75 Inches'
  },

  // Bedroom
  {
    id: 'prod_furn_bed_teak_king',
    category_id: 'cat_furn_bed',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-BED-TEAK-KING-72',
    barcode: '4790123400063',
    name: 'Solid Teak King Size Bed Frame (Floral Carved Headboard 72x78)',
    description: 'Majestic king size bed made from seasoned Grade-A Ceylon teak with intricate hand-carved floral motifs, heavy 4x4 timber corner posts and reinforced slat foundation.',
    unit: 'piece',
    cost_price: 92000.00,
    selling_price: 145000.00,
    wholesale_price: 125000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 3,
    alert_qty: 1,
    weight: 95.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'BEDROOM-B1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Mattress Size: 72in x 78in (6ft x 6.5ft)',
    custom_field2: 'Post Thickness: 4in Solid Timber',
    custom_field3: 'Timber: 100% Plantation Seasoned Teak'
  },
  {
    id: 'prod_furn_bed_mahogany_queen',
    category_id: 'cat_furn_bed',
    supplier_id: 'sup_ceylon_mahogany',
    sku: 'FURN-BED-MAHG-QUEEN-60',
    barcode: '4790123400070',
    name: 'Queen Size Solid Mahogany Minimalist Platform Bed (60x78)',
    description: 'Clean Scandinavian lines with rich warm reddish-brown Ceylon mahogany wood, low-profile sturdy frame and noise-free acoustic base.',
    unit: 'piece',
    cost_price: 58000.00,
    selling_price: 89000.00,
    wholesale_price: 76000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 70.0,
    brand: 'Ceylon Hardwood',
    rack_no: 'BEDROOM-B2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Mattress Size: 60in x 78in (5ft x 6.5ft)',
    custom_field2: 'Wood: 100% Solid Ceylon Mahogany',
    custom_field3: 'Design: Minimalist Platform No Squeak'
  },
  {
    id: 'prod_furn_wardrobe_teak_4door',
    category_id: 'cat_furn_storage',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-WDR-TEAK-4DR-MIRR',
    barcode: '4790123400087',
    name: 'Solid Teak 4-Door Wardrobe with Full-Length Beveled Mirror & Drawers',
    description: 'Spacious 4-door wardrobe featuring 2 full-length mirrors, 4 storage drawers, internal locker with lock & keys, and heavy-duty brass clothes hanging rails.',
    unit: 'piece',
    cost_price: 135000.00,
    selling_price: 198000.00,
    wholesale_price: 175000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 2,
    alert_qty: 1,
    weight: 140.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'BEDROOM-B3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Doors: 4 Panel Doors (2 Center Mirrors)',
    custom_field2: 'Security: Internal Locking Vault Box',
    custom_field3: 'Hardware: Antique Solid Brass'
  },
  {
    id: 'prod_furn_dressing_table_teak',
    category_id: 'cat_furn_bed',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-DRS-TEAK-6DRW',
    barcode: '4790123400094',
    name: 'Elegant Solid Teak Dressing Table with Cushioned Stool & 6-Drawers',
    description: 'Dressing table with large curved mirror, 6 smooth glide drawers for jewelry and cosmetics, plus matching upholstered teak stool.',
    unit: 'set',
    cost_price: 36000.00,
    selling_price: 54000.00,
    wholesale_price: 46000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 42.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'BEDROOM-B4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Mirror: Arch Beveled Glass Mirror',
    custom_field2: 'Storage: 6 Velvet-Lined Drawers',
    custom_field3: 'Includes: Matching Upholstered Stool'
  },
  {
    id: 'prod_furn_bedside_cupboard',
    category_id: 'cat_furn_bed',
    supplier_id: 'sup_ceylon_mahogany',
    sku: 'FURN-BED-SIDE-MAHG',
    barcode: '4790123400100',
    name: 'Mahogany Bedside Nightstand Table with 2 Soft-Close Drawers',
    description: 'Compact bedside nightstand crafted in solid mahogany with chamfered edge top and smooth metal drawer slides.',
    unit: 'piece',
    cost_price: 11000.00,
    selling_price: 17500.00,
    wholesale_price: 14500.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 6,
    alert_qty: 3,
    weight: 12.0,
    brand: 'Ceylon Hardwood',
    rack_no: 'BEDROOM-B5',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Drawers: 2 Smooth Soft-Close',
    custom_field2: 'Height: 22 inches',
    custom_field3: 'Timber: 100% Solid Mahogany'
  },
  {
    id: 'prod_furn_ortho_mattress_king',
    category_id: 'cat_furn_bed',
    supplier_id: 'sup_lanka_sofa',
    sku: 'FURN-MAT-ORTH-KING-72',
    barcode: '4790123400117',
    name: 'Royal Orthopedic Dual-Comfort Pocket Spring Mattress (King 72x78)',
    description: '10-inch luxury mattress with independent pocket springs, 2-inch natural latex euro top, and antimicrobial bamboo jacquard quilting.',
    unit: 'piece',
    cost_price: 52000.00,
    selling_price: 79000.00,
    wholesale_price: 68000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 5,
    alert_qty: 2,
    weight: 48.0,
    brand: 'Lanka Comfort',
    rack_no: 'BEDROOM-B6',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Thickness: 10 Inches (25 cm)',
    custom_field2: 'Layer: 100% Sri Lankan Natural Latex Top',
    custom_field3: 'Warranty: 10 Years Replacement Guarantee'
  },

  // Dining Room
  {
    id: 'prod_furn_dining_set_6s',
    category_id: 'cat_furn_dining',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-DIN-TEAK-6S',
    barcode: '4790123400124',
    name: 'Solid Teak 6-Seater Dining Table Suite (6ft Table + 6 Chairs)',
    description: 'Classic 6-foot heavy solid teak dining table with 10mm tempered glass top and 6 ergonomic high-back chairs with stain-resistant padded seats.',
    unit: 'set',
    cost_price: 115000.00,
    selling_price: 175000.00,
    wholesale_price: 152000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 3,
    alert_qty: 1,
    weight: 110.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'DINING-C1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Table Size: 72in x 36in x 30in',
    custom_field2: 'Chairs: 6 High-Back Cushioned',
    custom_field3: 'Top: 10mm Toughened Beveled Glass'
  },
  {
    id: 'prod_furn_dining_set_8s_mahg',
    category_id: 'cat_furn_dining',
    supplier_id: 'sup_ceylon_mahogany',
    sku: 'FURN-DIN-MAHG-8S',
    barcode: '4790123400131',
    name: 'Premium 8-Seater Solid Mahogany Banquet Dining Suite (8ft Table + 8 Chairs)',
    description: 'Executive 8-seater dining set for grand homes, featuring an 8-foot double pedestal table and 8 master carved mahogany chairs.',
    unit: 'set',
    cost_price: 165000.00,
    selling_price: 245000.00,
    wholesale_price: 215000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 2,
    alert_qty: 1,
    weight: 160.0,
    brand: 'Ceylon Hardwood',
    rack_no: 'DINING-C2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Table Size: 96in x 42in (8ft x 3.5ft)',
    custom_field2: 'Base: Heavy Dual Pedestal Base',
    custom_field3: 'Seats: 8 Full-Grain Fabric Padded'
  },
  {
    id: 'prod_furn_crockery_cupboard_3dr',
    category_id: 'cat_furn_dining',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-CRK-TEAK-3DR-GLS',
    barcode: '4790123400148',
    name: '3-Door Glass Display Crockery Cupboard / Curio Cabinet with LED Lights',
    description: 'Two-tier crockery cupboard with 3 glass display doors on top with interior LED spotlights and 3 teak panel doors below with brass locks.',
    unit: 'piece',
    cost_price: 78000.00,
    selling_price: 118000.00,
    wholesale_price: 102000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 2,
    alert_qty: 1,
    weight: 95.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'DINING-C3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Lighting: Integrated Warm LED Spotlights',
    custom_field2: 'Shelves: 8mm Glass Display Shelves',
    custom_field3: 'Timber: 100% Solid Ceylon Teak'
  },

  // Office & Study
  {
    id: 'prod_furn_director_desk_6ft',
    category_id: 'cat_furn_office',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-OFC-DSK-TEAK-6FT',
    barcode: '4790123400155',
    name: 'Executive Wooden Director Office Desk with Leather Inlay (6ft)',
    description: 'Imposing 6-foot executive desk with genuine leather writing pad, 6 side lockable drawers, modesty panel, and wire grommets.',
    unit: 'piece',
    cost_price: 68000.00,
    selling_price: 105000.00,
    wholesale_price: 92000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 3,
    alert_qty: 1,
    weight: 80.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'OFFICE-D1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Top: Genuine Leather Desktop Inlay',
    custom_field2: 'Locking: Central Keyed Locking System',
    custom_field3: 'Dimensions: 72in x 36in x 30in'
  },
  {
    id: 'prod_furn_mesh_executive_chair',
    category_id: 'cat_furn_office',
    supplier_id: 'sup_steel_office',
    sku: 'FURN-OFC-CHR-MSH-EXEC',
    barcode: '4790123400162',
    name: 'High-Back Ergonomic Mesh Swivel Executive Chair (Chrome Base)',
    description: 'Multi-function ergonomic office chair with breathable Korean mesh back, 3D adjustable armrests, synchronized tilt-lock and Class-4 gas cylinder.',
    unit: 'piece',
    cost_price: 22000.00,
    selling_price: 36500.00,
    wholesale_price: 31000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 8,
    alert_qty: 3,
    weight: 18.0,
    brand: 'Apex Steel',
    rack_no: 'OFFICE-D2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Lift: Class-4 Heavy Duty Gas Cylinder',
    custom_field2: 'Mechanism: Multi-Angle Synchro Tilt Lock',
    custom_field3: 'Base: 350mm Mirror Chrome 5-Star Base'
  },
  {
    id: 'prod_furn_bookshelf_5tier',
    category_id: 'cat_furn_office',
    supplier_id: 'sup_ceylon_mahogany',
    sku: 'FURN-SHL-BK-MAHG-5T',
    barcode: '4790123400179',
    name: '5-Tier Solid Mahogany Bookshelf & Display Rack (6.5ft Tall)',
    description: 'Open front sturdy 5-shelf library bookcase crafted in solid mahogany capable of holding heavy document binders and law books.',
    unit: 'piece',
    cost_price: 28000.00,
    selling_price: 44000.00,
    wholesale_price: 38000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 40.0,
    brand: 'Ceylon Hardwood',
    rack_no: 'OFFICE-D3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Shelves: 5 Fixed Heavy-Load Shelves',
    custom_field2: 'Height: 78 inches (6.5 feet)',
    custom_field3: 'Load: 40kg per shelf'
  },
  {
    id: 'prod_furn_steel_filing_cabinet',
    category_id: 'cat_furn_office',
    supplier_id: 'sup_steel_office',
    sku: 'FURN-OFC-STL-4DRW',
    barcode: '4790123400186',
    name: 'Heavy Gauge Steel 4-Drawer Vertical Filing Cabinet with Central Lock',
    description: 'Commercial grade powder-coated CRCA steel filing cabinet with anti-tilt interlocking mechanism and A4/Foolscap suspension folders support.',
    unit: 'piece',
    cost_price: 29000.00,
    selling_price: 43000.00,
    wholesale_price: 37500.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 5,
    alert_qty: 2,
    weight: 48.0,
    brand: 'Apex Steel',
    rack_no: 'OFFICE-D4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Gauge: 0.8mm Heavy Gauge Cold-Rolled Steel',
    custom_field2: 'Safety: Anti-Tilt Locking Feature',
    custom_field3: 'Finish: Scratch-Proof Epoxy Powder Coat'
  },

  // Outdoor & Garden
  {
    id: 'prod_furn_patio_set_teak',
    category_id: 'cat_furn_outdoor',
    supplier_id: 'sup_southern_patio',
    sku: 'FURN-OUT-PAT-TEAK-4S',
    barcode: '4790123400193',
    name: 'Weatherproof Treated Teak Patio Table Set (Round Table + 4 Armchairs)',
    description: 'Naturally oiled moisture and UV resistant Ceylon teak outdoor patio set with 42-inch round slatted table and 4 stackable armchairs.',
    unit: 'set',
    cost_price: 65000.00,
    selling_price: 98000.00,
    wholesale_price: 84000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 3,
    alert_qty: 1,
    weight: 55.0,
    brand: 'Southern Teak Resort',
    rack_no: 'OUTDOOR-E1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Resistance: Marine Teak Oil Coated',
    custom_field2: 'Hardware: Grade 304 Stainless Steel',
    custom_field3: 'Table: 42in Round with Center Umbrella Hole'
  },
  {
    id: 'prod_furn_rattan_swing_chair',
    category_id: 'cat_furn_outdoor',
    supplier_id: 'sup_southern_patio',
    sku: 'FURN-OUT-SWNG-RTN',
    barcode: '4790123400209',
    name: 'Handwoven Synthetic All-Weather Rattan Hanging Swing Egg Chair with Stand',
    description: 'Resort style hanging egg pod with heavy duty powder coated steel stand, spring suspension and water repellent polyester cushion.',
    unit: 'piece',
    cost_price: 32000.00,
    selling_price: 49500.00,
    wholesale_price: 42000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 5,
    alert_qty: 2,
    weight: 28.0,
    brand: 'Southern Teak Resort',
    rack_no: 'OUTDOOR-E2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Frame: 48mm Heavy Steel Pipe Stand',
    custom_field2: 'Weave: High Density Polyethylene Rattan',
    custom_field3: 'Capacity: 160 kg Safe Working Load'
  },
  {
    id: 'prod_furn_garden_bench_teak',
    category_id: 'cat_furn_outdoor',
    supplier_id: 'sup_southern_patio',
    sku: 'FURN-OUT-BNCH-TEAK-5FT',
    barcode: '4790123400216',
    name: 'Solid Teak 5ft Colonial Garden Bench (Curved Ergonomic Backrest)',
    description: 'British colonial style park and garden bench built from solid teak with contoured seat slats for comfortable outdoor lounging.',
    unit: 'piece',
    cost_price: 28000.00,
    selling_price: 42000.00,
    wholesale_price: 36000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 30.0,
    brand: 'Southern Teak Resort',
    rack_no: 'OUTDOOR-E3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Length: 60 inches (5 feet)',
    custom_field2: 'Capacity: 3 Adults Comfortable',
    custom_field3: 'Wood: 100% Solid Seasoned Teak'
  },

  // Decor & Carvings
  {
    id: 'prod_furn_kandyan_mirror',
    category_id: 'cat_furn_decor',
    supplier_id: 'sup_kandy_carvings',
    sku: 'FURN-DEC-MIRR-KNDY',
    barcode: '4790123400223',
    name: 'Handcrafted Traditional Kandyan Floral Carved Wall Mirror (3ft x 2ft)',
    description: 'Authentic Pilimathalawa artisan hand-carved solid hardwood mirror frame featuring ancient peacock and lotus vine motifs.',
    unit: 'piece',
    cost_price: 18000.00,
    selling_price: 29000.00,
    wholesale_price: 24000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 4,
    alert_qty: 2,
    weight: 8.5,
    brand: 'Kandyan Carvings',
    rack_no: 'DECOR-F1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Artisan: Hand-Carved in Pilimathalawa',
    custom_field2: 'Motif: Traditional Peacock & Lotus Petals',
    custom_field3: 'Glass: 5mm Belgian Distortion-Free Mirror'
  },
  {
    id: 'prod_furn_brass_handles_set6',
    category_id: 'cat_furn_decor',
    supplier_id: 'sup_kandy_carvings',
    sku: 'FURN-HRD-BRSS-HNDL-6P',
    barcode: '4790123400230',
    name: 'Antique Finish Solid Brass Cabinet Pull Handles (Pack of 6)',
    description: 'Heavy cast pure brass furniture handles with vintage patina finish, suitable for wardrobe doors, credenzas and kitchen drawers.',
    unit: 'pack',
    cost_price: 4500.00,
    selling_price: 7800.00,
    wholesale_price: 6500.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 12,
    alert_qty: 5,
    weight: 1.2,
    brand: 'Kandyan Carvings',
    rack_no: 'HARDWARE-G1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Material: 100% Solid Cast Brass',
    custom_field2: 'Quantity: 6 Handles with Mounting Screws',
    custom_field3: 'Finish: Vintage Antique Patina'
  },
  {
    id: 'prod_furn_sliding_wardrobe_3dr',
    category_id: 'cat_furn_storage',
    supplier_id: 'sup_moratuwa_teak',
    sku: 'FURN-WDR-SLID-3DR-LED',
    barcode: '4790123400247',
    name: 'Modern 3-Door Sliding Teak Wardrobe with Tinted Glass & Motion Sensor Lights',
    description: 'Contemporary sliding wardrobe with heavy aluminum track system, bronze tinted tempered glass panel, and built-in battery motion sensor illumination.',
    unit: 'piece',
    cost_price: 155000.00,
    selling_price: 235000.00,
    wholesale_price: 205000.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 2,
    alert_qty: 1,
    weight: 165.0,
    brand: 'Moratuwa Royal Wood',
    rack_no: 'BEDROOM-B7',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'System: Heavy-Duty Soft-Close Aluminum Sliding Rail',
    custom_field2: 'Lighting: Auto Motion Sensor Internal Lights',
    custom_field3: 'Width: 8 feet (240 cm)'
  }
];

// Insert Products with branch_id = NULL (Global Products)
const insertProdStmt = db.prepare(`
  INSERT INTO products (
    id, category_id, supplier_id, branch_id, sku, barcode, name, description, unit,
    cost_price, selling_price, wholesale_price, tax_rate, discount_pct,
    min_stock_level, alert_qty, weight, brand, rack_no, product_type, sale_by,
    is_manage_stock, is_active, custom_field1, custom_field2, custom_field3,
    created_at, updated_at
  ) VALUES (
    @id, @category_id, @supplier_id, NULL, @sku, @barcode, @name, @description, @unit,
    @cost_price, @selling_price, @wholesale_price, @tax_rate, @discount_pct,
    @min_stock_level, @alert_qty, @weight, @brand, @rack_no, @product_type, @sale_by,
    @is_manage_stock, 1, @custom_field1, @custom_field2, @custom_field3,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    category_id = excluded.category_id,
    supplier_id = excluded.supplier_id,
    branch_id = NULL,
    sku = excluded.sku,
    barcode = excluded.barcode,
    name = excluded.name,
    description = excluded.description,
    unit = excluded.unit,
    cost_price = excluded.cost_price,
    selling_price = excluded.selling_price,
    wholesale_price = excluded.wholesale_price,
    tax_rate = excluded.tax_rate,
    discount_pct = excluded.discount_pct,
    min_stock_level = excluded.min_stock_level,
    alert_qty = excluded.alert_qty,
    weight = excluded.weight,
    brand = excluded.brand,
    rack_no = excluded.rack_no,
    product_type = excluded.product_type,
    sale_by = excluded.sale_by,
    is_manage_stock = excluded.is_manage_stock,
    is_active = 1,
    custom_field1 = excluded.custom_field1,
    custom_field2 = excluded.custom_field2,
    custom_field3 = excluded.custom_field3,
    updated_at = datetime('now')
`);

furnitureProducts.forEach(p => insertProdStmt.run(p));
console.log('Furniture Products seeded: ' + furnitureProducts.length + ' (all set as Global branch_id=NULL)');

// 5. STOCKS ALLOCATION ACROSS ALL 7 SRI LANKAN BRANCHES
const allBranchIds = [
  mainBranchId,
  'br_lk_kandy',
  'br_lk_galle',
  'br_lk_gampaha',
  'br_lk_kurunegala',
  'br_lk_jaffna',
  'br_lk_batticaloa'
];

const checkStockStmt = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?');
const insertStockStmt = db.prepare(`
  INSERT INTO stocks (id, product_id, branch_id, quantity, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`);
const updateStockStmt = db.prepare(`
  UPDATE stocks SET quantity = ?, updated_at = datetime('now') WHERE id = ?
`);

let stockRowsCount = 0;
for (const p of furnitureProducts) {
  for (const bId of allBranchIds) {
    const existing = checkStockStmt.get(p.id, bId);
    // Quantity distribution: 4 to 12 units per branch for show/sale
    const qty = (bId === mainBranchId) ? 12 : Math.floor(Math.random() * 6) + 4;
    if (existing) {
      updateStockStmt.run(qty, existing.id);
    } else {
      const stockId = 'stk_' + p.id.replace('prod_', '') + '_' + bId.replace('br_lk_', '').replace('b1111111-1111-4111-8111-111111111111', 'cmb');
      insertStockStmt.run(stockId, p.id, bId, qty);
    }
    stockRowsCount++;
  }
}
console.log('Stock entries updated across all 7 branches: ' + stockRowsCount);

// 6. SRI LANKAN CUSTOMERS (Hotels, Resorts, Corporate Offices, Residential)
const customers = [
  {
    id: 'cust_cinnamon_hotels',
    branch_id: mainBranchId,
    name: 'Cinnamon Grand & Lakeside Hotels (John Keells Holdings)',
    phone: '+94112497200',
    email: 'procurement@cinnamonhotels.com',
    address: 'No. 77, Galle Road, Colombo 03, Western Province',
    nic: 'LK-CORP-JKH-001',
    credit_limit: 1500000.00,
    outstanding_due: 0.00,
    loyalty_points: 2500,
    notes: 'Luxury 5-star hotel chain ordering teak suites and banquet dining tables.'
  },
  {
    id: 'cust_jetwing_villas',
    branch_id: 'br_lk_galle',
    name: 'Jetwing Luxury Hotels & Heritage Villas',
    phone: '+94912234500',
    email: 'projects@jetwinghotels.com',
    address: 'Jetwing Lighthouse, Dadella, Galle, Southern Province',
    nic: 'LK-CORP-JET-002',
    credit_limit: 1200000.00,
    outstanding_due: 185000.00,
    loyalty_points: 1800,
    notes: 'Boutique heritage resort villas requiring treated teak patio and colonial garden furniture.'
  },
  {
    id: 'cust_prime_residencies',
    branch_id: mainBranchId,
    name: 'Prime Lands Residencies (Pvt) Ltd',
    phone: '+94112699822',
    email: 'interiors@primelands.lk',
    address: 'No. 75, D.S. Senanayake Mawatha, Colombo 08',
    nic: 'LK-CORP-PLR-003',
    credit_limit: 2000000.00,
    outstanding_due: 0.00,
    loyalty_points: 3200,
    notes: 'Premium residential apartments developer buying turnkey living and bedroom furniture packages.'
  },
  {
    id: 'cust_jaffna_heritage',
    branch_id: 'br_lk_jaffna',
    name: 'Jaffna Heritage Hotel & Banquet Complex',
    phone: '+94212224567',
    email: 'admin@jaffnaheritage.com',
    address: 'No. 85, Temple Road, Nallur, Jaffna, Northern Province',
    nic: 'LK-CORP-JAF-004',
    credit_limit: 800000.00,
    outstanding_due: 95000.00,
    loyalty_points: 950,
    notes: 'Northern luxury hotel requiring traditional carved mirrors and dining suites.'
  },
  {
    id: 'cust_dr_sanjeewa',
    branch_id: mainBranchId,
    name: 'Dr. Sanjeewa Perera (Architectural Villa)',
    phone: '+94777123987',
    email: 'sanjeewa.perera@gmail.com',
    address: 'No. 18/2, Gregory Road, Colombo 07',
    nic: '751283940V',
    credit_limit: 500000.00,
    outstanding_due: 0.00,
    loyalty_points: 450,
    notes: 'Private architectural luxury villa residence in Colombo 07.'
  }
];

const insertCustStmt = db.prepare(`
  INSERT OR REPLACE INTO customers (
    id, branch_id, name, phone, email, address, nic, credit_limit, outstanding_due,
    loyalty_points, notes, updated_at
  ) VALUES (
    @id, @branch_id, @name, @phone, @email, @address, @nic, @credit_limit, @outstanding_due,
    @loyalty_points, @notes, datetime('now')
  )
`);

customers.forEach(c => insertCustStmt.run(c));
console.log('Sri Lankan Furniture Customers seeded: ' + customers.length);

// 7. VERIFY QUERY SIMULATION FOR LOGGED IN USER
console.log('\n--- SIMULATING products:list FOR CURRENT LOGGED IN USER (branch_id: b1111111-1111-4111-8111-111111111111) ---');
const userBranchId = mainBranchId;
const testQuery = db.prepare(`
  SELECT p.id, p.name, p.sku, p.selling_price, c.name as category_name,
         COALESCE(s.quantity, 0) as stock
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
  WHERE p.is_active = 1
    AND (p.branch_id = ? OR p.branch_id IS NULL)
  ORDER BY p.name
`).all(userBranchId, userBranchId);

console.log('Products visible to user in list product: ' + testQuery.length);
console.log('Sample 3 products:');
console.log(testQuery.slice(0, 3));

console.log('\n--- ALL SRI LANKAN DISTRICT BRANCHES IN DB ---');
console.log(db.prepare('SELECT id, name, code, phone, address FROM branches').all());

console.log('\n--- SEEDING OF SRI LANKAN FURNITURE COMPANY COMPLETED SUCCESSFULLY ---');
