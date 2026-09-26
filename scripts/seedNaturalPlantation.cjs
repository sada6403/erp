const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(os.homedir(), 'AppData', 'Roaming', 'pos-erp', 'pos-erp.db');
console.log('Connecting to SQLite Database at:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('Error: Database file does not exist at:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Ensure Plantation Branches
const branches = [
  {
    id: 'br_plantation_main',
    name: 'Highland Organic Tea & Spice Estate - Main Branch',
    code: 'PLNT',
    address: 'Estate Road, Valparai Hills, Annamalai Range',
    phone: '+91 4253 289100',
    email: 'estate.main@naturalplantation.com',
    is_active: 1
  },
  {
    id: 'br_valley_sub1',
    name: 'Green Valley Agro & Farm Outlet - Sub Branch 1',
    code: 'GVLY',
    address: '14/B, Agro Corridor, Pollachi Road, Coimbatore',
    phone: '+91 422 2541200',
    email: 'greenvalley@naturalplantation.com',
    is_active: 1
  },
  {
    id: 'br_coastal_sub2',
    name: 'Coastal Agro Nursery & Plantation Hub - Sub Branch 2',
    code: 'COAS',
    address: 'Beach Agro Sector, Beypore Port Area, Kozhikode',
    phone: '+91 495 2768900',
    email: 'coastal.hub@naturalplantation.com',
    is_active: 1
  }
];

for (const b of branches) {
  db.prepare(`
    INSERT OR REPLACE INTO branches (id, name, code, address, phone, email, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(b.id, b.name, b.code, b.address, b.phone, b.email, b.is_active);
}
console.log('Branches seeded:', branches.length);

// 2. Categories for Natural Plantation
const categories = [
  {
    id: 'cat_plant_tea',
    name: 'Organic Teas & Plantation Beverages',
    description: 'Certified hill-grown orthodox whole leaf teas, single-estate green teas, and artisanal herbal infusions.',
    short_code: 'TEA',
    show_in_menu: 1,
    sort_order: 1
  },
  {
    id: 'cat_plant_spices',
    name: 'Natural Spices & Herbal Cultivation',
    description: 'Estate-grown Tellicherry black pepper, Ceylon cinnamon quills, bold cardamom, wild cloves & heirloom turmeric.',
    short_code: 'SPICE',
    show_in_menu: 1,
    sort_order: 2
  },
  {
    id: 'cat_plant_fruits',
    name: 'Fresh Plantation Fruits & Agro Harvest',
    description: 'Naturally harvested estate fruits, cold-pressed virgin coconut oil, wild honey & traditional coconut palm sugar.',
    short_code: 'FRUIT',
    show_in_menu: 1,
    sort_order: 3
  },
  {
    id: 'cat_plant_bio_inputs',
    name: 'Bio-Fertilizers & Soil Enrichers',
    description: 'Microbial vermicompost, Panchagavya, cold-pressed neem pesticide, washed cocopeat blocks, and bio-nutrients.',
    short_code: 'BIO',
    show_in_menu: 1,
    sort_order: 4
  },
  {
    id: 'cat_plant_saplings',
    name: 'Nursery Saplings, Live Plants & Heirloom Seeds',
    description: 'Hybrid coconut seedlings, high-piperine pepper runner vines, grafted dragonfruit stems, and native agro seeds.',
    short_code: 'SEED',
    show_in_menu: 1,
    sort_order: 5
  },
  {
    id: 'cat_plant_tools',
    name: 'Eco Plantation Tools & Irrigation Supplies',
    description: 'Forged carbon steel bypass pruning shears, horticultural grafting knives, moisture probes, and harvesting gear.',
    short_code: 'TOOL',
    show_in_menu: 1,
    sort_order: 6
  }
];

for (const c of categories) {
  db.prepare(`
    INSERT OR REPLACE INTO categories
      (id, name, description, short_code, show_in_menu, sort_order, is_active, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(c.id, c.name, c.description, c.short_code, c.show_in_menu, c.sort_order);
}
console.log('Categories seeded:', categories.length);

// 3. Suppliers with Full Template Fields
const suppliers = [
  {
    id: 'sup_westernghats_spices',
    name: 'Western Ghats Organic Spices Growers Co-Op',
    business_name: 'Western Ghats Bio-Farming Producers Ltd',
    first_name: 'Senthil',
    last_name: 'Murugan',
    middle_name: 'Kumar',
    contact: 'Mr. Senthil Murugan (Procurement Head)',
    phone: '+919443218901',
    mobile_number: '+919443218901',
    alt_mobile: '+918220154321',
    landline: '04253289451',
    email: 'procurement@westernghatsspices.org',
    address: 'Plot 44, Estate Road, Valparai Hills, Annamalai Sanctuary Zone',
    city: 'Valparai',
    state: 'Tamil Nadu',
    country: 'India',
    zip_code: '642127',
    tax_number: '33AAACW4982K1ZU',
    pay_terms: 'Net 30 Days',
    due_balance: 0.00
  },
  {
    id: 'sup_nilgiri_teas',
    name: 'Nilgiri Highland Bio-Tea Cultivators',
    business_name: 'Blue Mountain Organic Tea & Herbs Ltd',
    first_name: 'Kavitha',
    last_name: 'Ramanathan',
    middle_name: 'Devi',
    contact: 'Mrs. Kavitha Ramanathan (Supply Chain Director)',
    phone: '+919842176543',
    mobile_number: '+919842176543',
    alt_mobile: '+919443188776',
    landline: '04232445892',
    email: 'orders@nilgiribiotea.com',
    address: 'Kotagiri Road, Coonoor Tea Estates Hub',
    city: 'Coonoor',
    state: 'Tamil Nadu',
    country: 'India',
    zip_code: '643101',
    tax_number: '33AABCN7812P1ZN',
    pay_terms: 'Net 15 Days',
    due_balance: 12500.00
  },
  {
    id: 'sup_kerala_seeds',
    name: 'Wayanad Eco-Agro Seeds & Sapling Labs',
    business_name: 'Green Valley Indigenous Seed Bank & Tissue Culture',
    first_name: 'Mathew',
    last_name: 'Thomas',
    middle_name: 'Varghese',
    contact: 'Dr. Mathew Thomas (Chief Horticulturist)',
    phone: '+919745532109',
    mobile_number: '+919745532109',
    alt_mobile: '+919895012345',
    landline: '04936202411',
    email: 'dispatch@wayanadagro.org',
    address: 'Meppadi Agro Valley, Kalpetta Post',
    city: 'Wayanad',
    state: 'Kerala',
    country: 'India',
    zip_code: '673577',
    tax_number: '32AADCW5123L1ZT',
    pay_terms: 'Immediate / 50% Advance',
    due_balance: 0.00
  },
  {
    id: 'sup_vedic_biofertilizers',
    name: 'Vedic Green Bio-Fertilizers & Compost Farms',
    business_name: 'Vedic Organics & Microbial Inputs Pvt Ltd',
    first_name: 'Radhakrishnan',
    last_name: 'Gounder',
    middle_name: 'Natesan',
    contact: 'Mr. N. Radhakrishnan (Plantation Soil Specialist)',
    phone: '+919486145678',
    mobile_number: '+919486145678',
    alt_mobile: '+919787123456',
    landline: '04259223344',
    email: 'sales@vedicgreenbio.com',
    address: 'Organic Agro Corridor, Dharapuram Main Road, Pollachi',
    city: 'Pollachi',
    state: 'Tamil Nadu',
    country: 'India',
    zip_code: '642002',
    tax_number: '33AACCV8910M1ZR',
    pay_terms: 'Net 21 Days',
    due_balance: 5400.00
  },
  {
    id: 'sup_coastal_coconut_agro',
    name: 'Malabar Coastal Agro Produce & Honey Co-Op',
    business_name: 'Malabar Natural Harvest Consortium',
    first_name: 'Abdul',
    last_name: 'Rahman',
    middle_name: 'Hassan',
    contact: 'Mr. Abdul Rahman (Harvest Operations Coordinator)',
    phone: '+919847065432',
    mobile_number: '+919847065432',
    alt_mobile: '+919447099887',
    landline: '04952761234',
    email: 'supply@malabarharvest.com',
    address: 'Beach Road Agro Center, Beypore Port Sector',
    city: 'Kozhikode',
    state: 'Kerala',
    country: 'India',
    zip_code: '673015',
    tax_number: '32AABCM9012N1ZQ',
    pay_terms: 'Net 30 Days',
    due_balance: 0.00
  },
  {
    id: 'sup_ecotools_irrigation',
    name: 'Green Canopy Plantation Tools & Farm Tech',
    business_name: 'Canopy Agro-Tech Equipments Ltd',
    first_name: 'Venkatesh',
    last_name: 'Iyer',
    middle_name: 'Subramanian',
    contact: 'Mr. S. Venkatesh (Equipment Logistics Manager)',
    phone: '+919884012345',
    mobile_number: '+919884012345',
    alt_mobile: '+919444054321',
    landline: '04424987654',
    email: 'b2b@canopyfarmtools.com',
    address: 'Industrial Estate Phase II, Agro Machinery Zone, Ambattur',
    city: 'Chennai',
    state: 'Tamil Nadu',
    country: 'India',
    zip_code: '600058',
    tax_number: '33AAACC3344F1ZS',
    pay_terms: 'Net 45 Days',
    due_balance: 18000.00
  }
];

for (const s of suppliers) {
  db.prepare(`
    INSERT OR REPLACE INTO suppliers
      (id, name, business_name, first_name, last_name, middle_name, contact, phone, mobile_number, alt_mobile, landline,
       email, address, city, state, country, zip_code, tax_number, pay_terms, due_balance, is_active, updated_at)
    VALUES
      (@id, @name, @business_name, @first_name, @last_name, @middle_name, @contact, @phone, @mobile_number, @alt_mobile, @landline,
       @email, @address, @city, @state, @country, @zip_code, @tax_number, @pay_terms, @due_balance, 1, datetime('now'))
  `).run(s);
}
console.log('Suppliers seeded:', suppliers.length);

// 4. Products with Full Template Fields
const products = [
  {
    id: 'prod_tea_orthodox_green_1kg',
    category_id: 'cat_plant_tea',
    supplier_id: 'sup_nilgiri_teas',
    branch_id: 'br_plantation_main',
    sku: 'TEA-ORTH-GRN-1KG',
    barcode: '8901234500018',
    name: 'Nilgiri Orthodox Whole Leaf Green Tea (1kg Estate Pack)',
    description: 'Single-origin high-altitude whole leaf green tea rich in antioxidants and polyphenols, harvested from pesticide-free Nilgiri slopes.',
    unit: 'pack',
    cost_price: 650.00,
    selling_price: 950.00,
    wholesale_price: 820.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 10,
    alert_qty: 8,
    weight: 1.0,
    brand: 'Nilgiri Highlands',
    rack_no: 'RACK-A1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Grade: Super Fine Tippy Golden Flowery Orange Pekoe (SFTGFOP)',
    custom_field2: 'Elevation: 6,800 ft above sea level',
    custom_field3: 'Organic Certification: NPOP/NAB/001'
  },
  {
    id: 'prod_tea_masala_chai_500g',
    category_id: 'cat_plant_tea',
    supplier_id: 'sup_nilgiri_teas',
    branch_id: 'br_plantation_main',
    sku: 'TEA-MASALA-500G',
    barcode: '8901234500025',
    name: 'Artisanal Hilltop Masala Chai Blend with Crushed Spices (500g)',
    description: 'Strong CTC black tea blended with freshly crushed organic cardamom, ginger, cinnamon, and cloves from plantation gardens.',
    unit: 'pack',
    cost_price: 280.00,
    selling_price: 420.00,
    wholesale_price: 360.00,
    tax_rate: 5.0,
    discount_pct: 5.0,
    min_stock_level: 15,
    alert_qty: 10,
    weight: 0.5,
    brand: 'Nilgiri Highlands',
    rack_no: 'RACK-A2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Spices: 15% Real Cardamom, Ginger & Cinnamon',
    custom_field2: 'Cup Profile: Strong Malty Body',
    custom_field3: 'Brewing: 3-4 mins in boiling milk & water'
  },
  {
    id: 'prod_tea_white_needle_100g',
    category_id: 'cat_plant_tea',
    supplier_id: 'sup_nilgiri_teas',
    branch_id: 'br_plantation_main',
    sku: 'TEA-SILV-NEED-100G',
    barcode: '8901234500032',
    name: 'Hand-Plucked Silver Needle Imperial White Tea (100g Tin)',
    description: 'Ultra-premium spring harvest unopened tea buds sun-dried with delicate floral aroma and exceptional natural purity.',
    unit: 'tin',
    cost_price: 750.00,
    selling_price: 1200.00,
    wholesale_price: 1050.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 5,
    alert_qty: 3,
    weight: 0.1,
    brand: 'Nilgiri Highlands',
    rack_no: 'RACK-A3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Harvest: First Flush Spring Hand-Picked',
    custom_field2: 'Polyphenol Content: >22% Active EGCG',
    custom_field3: 'Packaging: Nitrogen-Flushed Air-Tight Tin'
  },
  {
    id: 'prod_coffee_robusta_beans_1kg',
    category_id: 'cat_plant_tea',
    supplier_id: 'sup_westernghats_spices',
    branch_id: 'br_plantation_main',
    sku: 'BEV-COFFEE-ROB-1KG',
    barcode: '8901234500087',
    name: 'Shade-Grown Plantation Robusta Cherry Coffee Beans (1kg Bag)',
    description: 'Slow-matured shade-grown coffee beans from misty plantation valleys, offering rich crema and heavy dark chocolate notes.',
    unit: 'bag',
    cost_price: 520.00,
    selling_price: 780.00,
    wholesale_price: 670.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 10,
    alert_qty: 5,
    weight: 1.0,
    brand: 'Valley Estate',
    rack_no: 'RACK-A4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Processing: Washed Parchment / Sun-Dried',
    custom_field2: 'Roast Level: Green Unroasted Cherry Beans',
    custom_field3: 'Shade Canopy: Grown under Silver Oak & Fig Trees'
  },
  {
    id: 'prod_spice_black_pepper_500g',
    category_id: 'cat_plant_spices',
    supplier_id: 'sup_westernghats_spices',
    branch_id: 'br_plantation_main',
    sku: 'SPC-PEPPER-500G',
    barcode: '8901234500049',
    name: 'Tellicherry Garbled Extra Bold Black Pepper (500g Jar)',
    description: 'Sun-ripened bold peppercorns (TGSEB grade) hand-picked from canopy vines of the Western Ghats rainforest.',
    unit: 'jar',
    cost_price: 480.00,
    selling_price: 690.00,
    wholesale_price: 590.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 15,
    alert_qty: 10,
    weight: 0.5,
    brand: 'Western Spices',
    rack_no: 'RACK-B1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Grade: TGSEB (Tellicherry Garbled Special Extra Bold)',
    custom_field2: 'Piperine Content: >5.8%',
    custom_field3: 'Density: 570 g/L Guaranteed Bold'
  },
  {
    id: 'prod_spice_cardamom_bold_250g',
    category_id: 'cat_plant_spices',
    supplier_id: 'sup_westernghats_spices',
    branch_id: 'br_plantation_main',
    sku: 'SPC-CARDAMOM-250G',
    barcode: '8901234500056',
    name: 'Green Cardamom Pods Extra Bold 8mm+ (250g Vacuum Pack)',
    description: 'Vibrant deep green estate cardamom dried under controlled low-temperature curing sheds to preserve volatile essential oils.',
    unit: 'pack',
    cost_price: 850.00,
    selling_price: 1250.00,
    wholesale_price: 1080.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 10,
    alert_qty: 6,
    weight: 0.25,
    brand: 'Western Spices',
    rack_no: 'RACK-B2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Pod Size: Extra Bold 8mm to 8.5mm Diameter',
    custom_field2: 'Curing: Natural Fireless Heated Air Dehydration',
    custom_field3: 'Moisture: <10.5%'
  },
  {
    id: 'prod_spice_cinnamon_quills_200g',
    category_id: 'cat_plant_spices',
    supplier_id: 'sup_westernghats_spices',
    branch_id: 'br_plantation_main',
    sku: 'SPC-CINNAMON-200G',
    barcode: '8901234500063',
    name: 'True Ceylon Cinnamon Quills Grade Alba (200g Box)',
    description: 'Delicate multi-layered sweet aromatic quills with low coumarin content, ideal for wellness and culinary excellence.',
    unit: 'box',
    cost_price: 320.00,
    selling_price: 490.00,
    wholesale_price: 410.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 12,
    alert_qty: 8,
    weight: 0.2,
    brand: 'Western Spices',
    rack_no: 'RACK-B3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Grade: Alba (Cinnamomum verum)',
    custom_field2: 'Coumarin Content: Trace (<0.004%)',
    custom_field3: 'Origin: Plantation Forest Border Cultivation'
  },
  {
    id: 'prod_spice_wild_cloves_250g',
    category_id: 'cat_plant_spices',
    supplier_id: 'sup_westernghats_spices',
    branch_id: 'br_plantation_main',
    sku: 'SPC-CLOVES-250G',
    barcode: '8901234500070',
    name: 'Hand-Picked Hillgrown Aromatic Cloves with Full Heads (250g)',
    description: 'Full-headed, oil-rich plantation cloves grown in shade alongside nutmeg and coffee bushes in hill estates.',
    unit: 'pack',
    cost_price: 340.00,
    selling_price: 520.00,
    wholesale_price: 440.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 10,
    alert_qty: 6,
    weight: 0.25,
    brand: 'Western Spices',
    rack_no: 'RACK-B4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Eugenol Oil Content: >18%',
    custom_field2: 'Head Retention: >95% Intact Buds',
    custom_field3: 'Harvested: Manual Bamboo Ladder Climbing'
  },
  {
    id: 'prod_agro_virgin_coconutoil_1l',
    category_id: 'cat_plant_fruits',
    supplier_id: 'sup_coastal_coconut_agro',
    branch_id: 'br_plantation_main',
    sku: 'OIL-VIRGIN-COCO-1L',
    barcode: '8901234500094',
    name: 'Cold-Pressed Extra Virgin Coconut Plantation Oil (1 Liter Bottle)',
    description: 'Centrifuged unrefined virgin oil extracted from fresh organic mature coconut milk within 4 hours of harvest.',
    unit: 'bottle',
    cost_price: 410.00,
    selling_price: 620.00,
    wholesale_price: 530.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 20,
    alert_qty: 12,
    weight: 1.0,
    brand: 'Malabar Harvest',
    rack_no: 'RACK-C1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Lauric Acid Content: >51.2%',
    custom_field2: 'Cold Centrifuged: No Heat Applied (<38°C)',
    custom_field3: 'Shelf Life: 18 Months in UV-Protected Glass'
  },
  {
    id: 'prod_agro_wild_honey_500g',
    category_id: 'cat_plant_fruits',
    supplier_id: 'sup_coastal_coconut_agro',
    branch_id: 'br_plantation_main',
    sku: 'HNY-FOREST-RAW-500G',
    barcode: '8901234500100',
    name: 'Multi-Flora Wild Forest Raw Honey with Comb Chunk (500g Glass)',
    description: 'Unpasteurized, unfiltered honey collected from flowering plantation trees and forest flora by tribal cooperatives.',
    unit: 'jar',
    cost_price: 310.00,
    selling_price: 480.00,
    wholesale_price: 400.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 15,
    alert_qty: 8,
    weight: 0.5,
    brand: 'Malabar Harvest',
    rack_no: 'RACK-C2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Pollen Analysis: 100% Multi-Floral Forest Flora',
    custom_field2: 'C4 Sugar / Corn Syrup Adulteration: Zero',
    custom_field3: 'Moisture: Natural 18.2%'
  },
  {
    id: 'prod_agro_organic_jaggery_1kg',
    category_id: 'cat_plant_fruits',
    supplier_id: 'sup_coastal_coconut_agro',
    branch_id: 'br_plantation_main',
    sku: 'SWT-PALM-JAG-1KG',
    barcode: '8901234500117',
    name: 'Natural Chemical-Free Coconut Palm Sugar / Jaggery Blocks (1kg)',
    description: 'Low GI unrefined traditional natural sweetener made from sweet coconut inflorescence sap without additives.',
    unit: 'block',
    cost_price: 210.00,
    selling_price: 320.00,
    wholesale_price: 270.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 25,
    alert_qty: 15,
    weight: 1.0,
    brand: 'Malabar Harvest',
    rack_no: 'RACK-C3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Glycemic Index: Low GI (~35)',
    custom_field2: 'Chemical Bleaching / Sulphur: Zero',
    custom_field3: 'Potassium & Iron Enriched'
  },
  {
    id: 'prod_bio_vermicompost_25kg',
    category_id: 'cat_plant_bio_inputs',
    supplier_id: 'sup_vedic_biofertilizers',
    branch_id: 'br_plantation_main',
    sku: 'BIO-VERMI-25KG',
    barcode: '8901234500124',
    name: 'Microbial-Enriched Organic Vermicompost with Trichoderma (25kg Bag)',
    description: 'Earthworm cast compost fortified with beneficial microbes, humic acids, and natural root growth enhancers.',
    unit: 'bag',
    cost_price: 380.00,
    selling_price: 580.00,
    wholesale_price: 490.00,
    tax_rate: 0.0,
    discount_pct: 5.0,
    min_stock_level: 30,
    alert_qty: 15,
    weight: 25.0,
    brand: 'Vedic Earth',
    rack_no: 'RACK-D1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'C:N Ratio: 14:1 Optimum',
    custom_field2: 'Biocontrol Inoculant: Trichoderma viride enriched',
    custom_field3: 'Moisture: 20-25% Crumbly Texture'
  },
  {
    id: 'prod_bio_panchagavya_5l',
    category_id: 'cat_plant_bio_inputs',
    supplier_id: 'sup_vedic_biofertilizers',
    branch_id: 'br_plantation_main',
    sku: 'BIO-PANCHA-5L',
    barcode: '8901234500131',
    name: 'Fermented Traditional Panchagavya Organic Bio-Stimulant (5 Liters)',
    description: 'Natural organic liquid fertilizer promoting vigorous plant immunity, flowering boost, and pest deterrence.',
    unit: 'can',
    cost_price: 450.00,
    selling_price: 700.00,
    wholesale_price: 600.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 15,
    alert_qty: 10,
    weight: 5.0,
    brand: 'Vedic Earth',
    rack_no: 'RACK-D2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Fermentation Period: 30 Days Anaerobic Maturation',
    custom_field2: 'Dilution Rate: 3% (30ml in 1 Liter water)',
    custom_field3: 'Indigenous Desi Cow Ingredients Only'
  },
  {
    id: 'prod_bio_neem_oil_1l',
    category_id: 'cat_plant_bio_inputs',
    supplier_id: 'sup_vedic_biofertilizers',
    branch_id: 'br_plantation_main',
    sku: 'BIO-NEEM-10K-1L',
    barcode: '8901234500148',
    name: 'Cold-Pressed Pure Neem Seed Oil 10,000 PPM Azadirachtin (1 Liter)',
    description: 'Broad-spectrum organic repellent and anti-feedant for plantation pest control without toxic chemical residues.',
    unit: 'bottle',
    cost_price: 340.00,
    selling_price: 540.00,
    wholesale_price: 460.00,
    tax_rate: 5.0,
    discount_pct: 0,
    min_stock_level: 20,
    alert_qty: 10,
    weight: 1.0,
    brand: 'Vedic Earth',
    rack_no: 'RACK-D3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Active Principle: 10,000 PPM Certified Azadirachtin',
    custom_field2: 'Emulsifier Included: Mixes instantly in water',
    custom_field3: 'Bee & Pollinator Safe Formulation'
  },
  {
    id: 'prod_bio_cocopeat_block_5kg',
    category_id: 'cat_plant_bio_inputs',
    supplier_id: 'sup_vedic_biofertilizers',
    branch_id: 'br_plantation_main',
    sku: 'BIO-COPEAT-5KG',
    barcode: '8901234500155',
    name: 'Low-EC Washed Coir Pith Compressed Grow Block 5:1 Expansion (5kg)',
    description: 'Washed low-salinity organic coir medium for nursery germination, potting mixes, and moisture retention.',
    unit: 'block',
    cost_price: 140.00,
    selling_price: 230.00,
    wholesale_price: 190.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 40,
    alert_qty: 20,
    weight: 5.0,
    brand: 'Vedic Earth',
    rack_no: 'RACK-D4',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Electrical Conductivity: Low EC <0.5 mS/cm',
    custom_field2: 'Expansion Yield: 75 Liters per 5kg block',
    custom_field3: 'pH Range: 5.8 - 6.8 Optimal'
  },
  {
    id: 'prod_seed_coconut_sapling',
    category_id: 'cat_plant_saplings',
    supplier_id: 'sup_kerala_seeds',
    branch_id: 'br_plantation_main',
    sku: 'SAP-COCO-HYB-DXT',
    barcode: '8901234500162',
    name: 'Certified Dwarf x Tall (D x T) High-Yield Hybrid Coconut Seedling',
    description: 'Early-bearing disease-resistant coconut variety commencing tender nuts within 3.5 years of field planting.',
    unit: 'sapling',
    cost_price: 220.00,
    selling_price: 360.00,
    wholesale_price: 310.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 50,
    alert_qty: 20,
    weight: 3.5,
    brand: 'Wayanad Nursery',
    rack_no: 'NURSERY-BAY-1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Genetic Cross: Malayan Yellow Dwarf x West Coast Tall',
    custom_field2: 'Expected Annual Yield: 200-240 Nuts / Palm',
    custom_field3: 'Age at Supply: 9 to 12 Months Hardened Rootball'
  },
  {
    id: 'prod_seed_black_pepper_vine',
    category_id: 'cat_plant_saplings',
    supplier_id: 'sup_kerala_seeds',
    branch_id: 'br_plantation_main',
    sku: 'SAP-PEPPER-PANIYUR',
    barcode: '8901234500179',
    name: 'Rooted Panniyur-1 High-Yield Black Pepper Runner Vine in Polybag',
    description: 'Heavy-cluster high piperine yielding pepper variety conditioned for fast trellis climbing and high harvest.',
    unit: 'polybag',
    cost_price: 45.00,
    selling_price: 80.00,
    wholesale_price: 65.00,
    tax_rate: 0.0,
    discount_pct: 5.0,
    min_stock_level: 100,
    alert_qty: 40,
    weight: 0.8,
    brand: 'Wayanad Nursery',
    rack_no: 'NURSERY-BAY-2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Cultivar: Panniyur-1 (IISR Validated)',
    custom_field2: 'Root System: Trichoderma Soil Inoculated',
    custom_field3: 'Trellis Ready with 3 Active Growth Nodes'
  },
  {
    id: 'prod_seed_dragonfruit_plant',
    category_id: 'cat_plant_saplings',
    supplier_id: 'sup_kerala_seeds',
    branch_id: 'br_plantation_main',
    sku: 'SAP-DRAGON-RED',
    barcode: '8901234500186',
    name: 'Royal Red Pulp Exotic Dragon Fruit Mature Grafted Stem Cutting',
    description: 'Self-pollinating drought-tolerant cactus cultivar producing vibrant sweet crimson fruit with high market demand.',
    unit: 'plant',
    cost_price: 60.00,
    selling_price: 110.00,
    wholesale_price: 90.00,
    tax_rate: 0.0,
    discount_pct: 0,
    min_stock_level: 60,
    alert_qty: 25,
    weight: 0.6,
    brand: 'Wayanad Nursery',
    rack_no: 'NURSERY-BAY-3',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Variety: Hylocereus costaricensis (Deep Red Pulp)',
    custom_field2: 'Brix Level: High Sweetness 16-18° Brix',
    custom_field3: 'Fungus & Canker Pre-Treated'
  },
  {
    id: 'prod_tool_pruning_shears',
    category_id: 'cat_plant_tools',
    supplier_id: 'sup_ecotools_irrigation',
    branch_id: 'br_plantation_main',
    sku: 'TOL-PRUNER-SK5',
    barcode: '8901234500193',
    name: 'Heavy-Duty Japanese SK5 Carbon Steel Bypass Pruning Shears (8.5")',
    description: 'Professional ergonomic forged shears with sap groove and shock-absorbing buffer for clean branch pruning.',
    unit: 'pcs',
    cost_price: 650.00,
    selling_price: 1050.00,
    wholesale_price: 900.00,
    tax_rate: 12.0,
    discount_pct: 0,
    min_stock_level: 10,
    alert_qty: 5,
    weight: 0.3,
    brand: 'Canopy Tools',
    rack_no: 'RACK-E1',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Blade Steel: Drop-Forged Japanese SK5 Hardened',
    custom_field2: 'Cutting Capacity: Up to 25mm Green Branches',
    custom_field3: 'Ergonomic Non-Slip Rubber Grip with Safety Catch'
  },
  {
    id: 'prod_tool_grafting_knife_set',
    category_id: 'cat_plant_tools',
    supplier_id: 'sup_ecotools_irrigation',
    branch_id: 'br_plantation_main',
    sku: 'TOL-GRAFT-KIT-SET',
    barcode: '8901234500209',
    name: 'Double-Edge Plantation Budding & Grafting Knife Set with Parafilm Tape',
    description: 'Razor-sharp stainless horticultural grafting kit complete with breathable self-adhesive grafting tapes.',
    unit: 'set',
    cost_price: 520.00,
    selling_price: 850.00,
    wholesale_price: 730.00,
    tax_rate: 12.0,
    discount_pct: 0,
    min_stock_level: 8,
    alert_qty: 4,
    weight: 0.4,
    brand: 'Canopy Tools',
    rack_no: 'RACK-E2',
    product_type: 'single',
    sale_by: 'normal',
    is_manage_stock: 1,
    custom_field1: 'Includes: 1 Budding Knife, 1 Grafting Knife, 2 Tapes',
    custom_field2: 'Tape Specification: Moisture Retentive Biodegradable',
    custom_field3: 'Brass Bark Lifter Horn Integrated'
  }
];

for (const p of products) {
  db.prepare(`
    INSERT OR REPLACE INTO products
      (id, category_id, supplier_id, branch_id, sku, barcode, name, description, unit,
       cost_price, selling_price, wholesale_price, tax_rate, discount_pct, min_stock_level,
       is_active, sort_name, brand, rack_no, alert_qty, weight, product_type, sale_by,
       is_manage_stock, custom_field1, custom_field2, custom_field3, updated_at)
    VALUES
      (@id, @category_id, @supplier_id, @branch_id, @sku, @barcode, @name, @description, @unit,
       @cost_price, @selling_price, @wholesale_price, @tax_rate, @discount_pct, @min_stock_level,
       1, @name, @brand, @rack_no, @alert_qty, @weight, @product_type, @sale_by,
       @is_manage_stock, @custom_field1, @custom_field2, @custom_field3, datetime('now'))
  `).run(p);

  // Seed Stocks across 3 branches
  const stockAllocations = [
    { branch_id: 'br_plantation_main', qty: 150 },
    { branch_id: 'br_valley_sub1', qty: 75 },
    { branch_id: 'br_coastal_sub2', qty: 60 }
  ];

  for (const s of stockAllocations) {
    const stockId = `stk_${p.id}_${s.branch_id}`;
    db.prepare(`
      INSERT OR REPLACE INTO stocks (id, product_id, branch_id, quantity, damaged_qty, updated_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `).run(stockId, p.id, s.branch_id, s.qty);
  }
}
console.log('Products & Stocks seeded:', products.length);

// 5. Customers for Natural Plantation & Agro Produce
const customers = [
  {
    id: 'cust_green_valley_resort',
    branch_id: 'br_plantation_main',
    name: 'Green Valley Eco Retreat & Plantation Resort',
    phone: '+919442011223',
    email: 'accounts@greenvalleyresort.com',
    address: 'Misty Valley View Road, Ooty Hills, The Nilgiris',
    nic: 'TN-RESORT-4891',
    credit_limit: 100000.00,
    outstanding_due: 14500.00,
    loyalty_points: 450,
    notes: 'Premium luxury estate hospitality client — orders organic tea, virgin coconut oil & spices monthly.'
  },
  {
    id: 'cust_nature_basket_organics',
    branch_id: 'br_valley_sub1',
    name: "Nature's Basket Organic Supermarket & Herbals",
    phone: '+919841044556',
    email: 'procurement@naturesbasketorganics.in',
    address: '122, R.S. Puram West Main Road, Coimbatore',
    nic: 'TN-RETAIL-9012',
    credit_limit: 250000.00,
    outstanding_due: 0.00,
    loyalty_points: 1200,
    notes: 'Wholesale & retail organic chain store — weekly bulk procurement with prompt 15-day clearance.'
  },
  {
    id: 'cust_subramaniam_orchard',
    branch_id: 'br_valley_sub1',
    name: 'S. K. Subramaniam (Agro Farm Enthusiast)',
    phone: '+919789077889',
    email: 'sk.subramaniam@gmail.com',
    address: 'Farm No. 12, Coconut Agro Farm, Aliyar Dam Road, Pollachi',
    nic: 'IND-7890-4412',
    credit_limit: 25000.00,
    outstanding_due: 0.00,
    loyalty_points: 180,
    notes: 'Individual organic orchard grower purchasing vermicompost, bio-pesticides & nursery saplings.'
  },
  {
    id: 'cust_malabar_spice_exporters',
    branch_id: 'br_coastal_sub2',
    name: 'Malabar Heritage Spice Trading & Exports Ltd',
    phone: '+919447122334',
    email: 'exportdesk@malabarheritagespices.com',
    address: 'Spice Exchange Complex, Mattancherry, Kochi',
    nic: 'KL-EXPORT-3312',
    credit_limit: 500000.00,
    outstanding_due: 45000.00,
    loyalty_points: 3400,
    notes: 'International spice exporting consortium requiring highest garbled grade pepper & cardamom with testing certificates.'
  },
  {
    id: 'cust_ananya_urban_garden',
    branch_id: 'br_plantation_main',
    name: 'Dr. Ananya Sundaram (Urban Terrace Organic Garden)',
    phone: '+919940155667',
    email: 'ananya.sundaram@aims.org',
    address: '45/2, Greenways Road, R.A. Puram, Chennai',
    nic: 'IND-5566-7788',
    credit_limit: 15000.00,
    outstanding_due: 0.00,
    loyalty_points: 95,
    notes: 'Regular retail customer purchasing exotic dragonfruit plants, cocopeat, pruning tools and herbal teas.'
  }
];

for (const c of customers) {
  db.prepare(`
    INSERT OR REPLACE INTO customers
      (id, branch_id, name, phone, email, address, nic, credit_limit, outstanding_due, loyalty_points, notes, updated_at)
    VALUES
      (@id, @branch_id, @name, @phone, @email, @address, @nic, @credit_limit, @outstanding_due, @loyalty_points, @notes, datetime('now'))
  `).run(c);
}
console.log('Customers seeded:', customers.length);

console.log('--- ALL NATURAL PLANTATION DATA SEEDED SUCCESSFULLY ---');
db.close();
