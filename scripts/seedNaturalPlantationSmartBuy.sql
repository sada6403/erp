-- ============================================================================
-- Natural Plantation Smart Buy Complete Test Data Seed
-- Covers ALL 13 Smart Buy Modules and Screens:
--  1. Dashboard (/admin/smart-buy)
--  2. Scheme Master / Catalog Templates (/admin/scheme-master)
--  3. Schemes & Scheme Detail (/admin/chits & /admin/chits/:id)
--  4. Customers / Members (/admin/chit-customers)
--  5. Cycle Contributions & Payment Tracking
--  6. Bank Transfers Pending Verification (/admin/smart-buy-transfers)
--  7. Award Wizard for Pending Winners (/admin/smart-buy-award)
--  8. Smart Buy Agents & Remittances (/admin/smart-buy-agents)
--  9. Payment Reminders & History (/admin/smart-buy-reminders)
-- 10. Commission Rules & Ledger (/admin/commission-rules)
-- 11. Member Withdrawals / Exit Requests (withdrawal_requests)
-- 12. SmartBuy Wallet & POS Redemptions (smartbuy_wallet, /pos)
-- 13. SmartBuy Vouchers & Collaboration Invites
-- ============================================================================

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- 1. Ensure Natural Plantation Branches are Active
INSERT OR REPLACE INTO branches (id, name, code, address, phone, email, is_active, updated_at)
VALUES 
  ('br_plantation_main', 'Highland Organic Tea & Spice Estate - Main Branch', 'PLNT', 'Estate Road, Valparai Hills, Annamalai Range', '+91 4253 289100', 'estate.main@naturalplantation.com', 1, datetime('now')),
  ('br_valley_sub1', 'Green Valley Agro & Farm Outlet - Sub Branch 1', 'GVLY', '14/B, Agro Corridor, Pollachi Road, Coimbatore', '+91 422 2541200', 'greenvalley@naturalplantation.com', 1, datetime('now')),
  ('br_coastal_sub2', 'Coastal Agro Nursery & Plantation Hub - Sub Branch 2', 'COAS', 'Beach Agro Sector, Beypore Port Area, Kozhikode', '+91 495 2768900', 'coastal.hub@naturalplantation.com', 1, datetime('now'));

-- 2. Ensure Plantation Suppliers
INSERT OR REPLACE INTO suppliers (id, name, business_name, first_name, last_name, contact, phone, mobile_number, email, address, city, state, country, zip_code, tax_number, pay_terms, due_balance, is_active, updated_at)
VALUES
  ('sup_westernghats_spices', 'Western Ghats Organic Spices Growers Co-Op', 'Western Ghats Bio-Farming Ltd', 'Senthil', 'Murugan', 'Mr. Senthil Murugan', '+919443218901', '+919443218901', 'procurement@westernghatsspices.org', 'Plot 44, Estate Road, Valparai Hills', 'Valparai', 'Tamil Nadu', 'India', '642127', '33AAACW4982K1ZU', 'Net 30 Days', 0.00, 1, datetime('now')),
  ('sup_nilgiri_teas', 'Nilgiri Highland Bio-Tea Cultivators', 'Blue Mountain Organic Tea & Herbs Ltd', 'Kavitha', 'Ramanathan', 'Mrs. Kavitha Ramanathan', '+919443556789', '+919443556789', 'estateteas@nilgirihighlands.in', 'Tea Park Sector 4, Coonoor Road', 'Ooty', 'Tamil Nadu', 'India', '643001', '33AABCN7812L1ZT', 'Net 15 Days', 0.00, 1, datetime('now')),
  ('sup_ecotools_irrigation', 'Green Canopy Plantation Tools & Farm Tech', 'Canopy Agro-Tech Equipments Ltd', 'Venkatesh', 'Iyer', 'Mr. S. Venkatesh', '+919884012345', '+919884012345', 'b2b@canopyfarmtools.com', 'Industrial Estate Phase II, Ambattur', 'Chennai', 'Tamil Nadu', 'India', '600058', '33AAACC3344F1ZS', 'Net 45 Days', 0.00, 1, datetime('now')),
  ('sup_coastal_coconut_agro', 'Malabar Coastal Agro Produce & Honey Co-Op', 'Malabar Natural Harvest Consortium', 'Abdul', 'Rahman', 'Mr. Abdul Rahman', '+919847065432', '+919847065432', 'supply@malabarharvest.com', 'Beach Road Agro Center, Beypore', 'Kozhikode', 'Kerala', 'India', '673015', '32AABCM9012N1ZQ', 'Net 30 Days', 0.00, 1, datetime('now'));

-- 3. Plantation Products (Including Smart Buy Award Products)
INSERT OR REPLACE INTO products (id, category_id, supplier_id, branch_id, sku, barcode, name, description, unit, cost_price, selling_price, wholesale_price, tax_rate, brand, is_manage_stock, updated_at)
VALUES
  ('prod_tool_organic_processing_kit', 'cat_plant_tools', 'sup_ecotools_irrigation', 'br_plantation_main', 'TOOL-PROC-KIT-55K', '8901234500100', 'Artisanal Tea & Spice Home Processing Unit (Estate Pro Kit)', 'Complete motorized roller, moisture analyzer and precision packaging unit for artisanal estate harvest.', 'unit', 38000.00, 55000.00, 50000.00, 5.0, 'Canopy Agro-Tech', 1, datetime('now')),
  ('prod_tool_weeder_harvester', 'cat_plant_tools', 'sup_ecotools_irrigation', 'br_valley_sub1', 'TOOL-WEED-HARV-26K', '8901234500101', 'Multi-Attachment 4-Stroke Agro Brush Cutter & Harvester', 'Heavy duty 52cc agricultural brush cutter with paddy harvesting blade and inter-cultivator weeder wheels.', 'unit', 18000.00, 26000.00, 23500.00, 5.0, 'Canopy Agro-Tech', 1, datetime('now')),
  ('prod_tool_eco_power_sprayer', 'cat_plant_tools', 'sup_ecotools_irrigation', 'br_plantation_main', 'TOOL-SPRAY-25L', '8901234500102', 'High-Pressure 25L Battery-Powered Agro Micronizer Sprayer', 'Dual battery 12V 14Ah backpack sprayer with telescopic brass lance and pressure regulator for plantations.', 'unit', 8500.00, 12500.00, 11000.00, 5.0, 'Canopy Agro-Tech', 1, datetime('now')),
  ('prod_tea_orthodox_green_1kg', 'cat_plant_tea', 'sup_nilgiri_teas', 'br_plantation_main', 'TEA-ORTH-GRN-1KG', '8901234500018', 'Nilgiri Orthodox Whole Leaf Green Tea (1kg Estate Pack)', 'Single-origin high-altitude whole leaf green tea rich in antioxidants and polyphenols.', 'pack', 650.00, 950.00, 820.00, 5.0, 'Nilgiri Highlands', 1, datetime('now')),
  ('prod_tea_masala_chai_500g', 'cat_plant_tea', 'sup_nilgiri_teas', 'br_plantation_main', 'TEA-MASALA-500G', '8901234500025', 'Artisanal Hilltop Masala Chai Blend with Crushed Spices (500g)', 'Strong CTC black tea blended with freshly crushed organic cardamom, ginger, cinnamon, and cloves.', 'pack', 280.00, 420.00, 360.00, 5.0, 'Nilgiri Highlands', 1, datetime('now')),
  ('prod_spice_cardamom_bold_500g', 'cat_plant_spices', 'sup_westernghats_spices', 'br_plantation_main', 'SPICE-CARD-8MM-500G', '8901234500030', 'Premium Alleppey Green Extra Bold Cardamom 8mm+ (500g)', 'Hand-sorted green cardamom pods with high volatile oil aroma and rich flavor.', 'pack', 1500.00, 2100.00, 1850.00, 5.0, 'Western Ghats Spices', 1, datetime('now')),
  ('prod_spice_black_pepper_1kg', 'cat_plant_spices', 'sup_westernghats_spices', 'br_plantation_main', 'SPICE-PEPPER-TGSEB-1KG', '8901234500031', 'Tellicherry Extra Bold Special Garbled Black Pepper (1kg)', 'Estate-garbled 4.75mm+ mature berries with intense pungency and deep piperine notes.', 'pack', 800.00, 1150.00, 1000.00, 5.0, 'Western Ghats Spices', 1, datetime('now')),
  ('prod_tool_pruning_shear_carbon', 'cat_plant_tools', 'sup_ecotools_irrigation', 'br_plantation_main', 'TOOL-PRUN-SHEAR-SK5', '8901234500040', 'Professional High-Carbon SK-5 Bypass Pruning Shears', 'Ergonomic non-slip aluminum handle with hardened Japanese SK-5 steel blade for clean tea bush pruning.', 'piece', 1200.00, 1850.00, 1600.00, 5.0, 'Canopy Agro-Tech', 1, datetime('now')),
  ('prod_agro_virgin_coconutoil_1l', 'cat_plant_fruits', 'sup_coastal_coconut_agro', 'br_coastal_sub2', 'OIL-VIRGIN-COCO-1L', '8901234500050', 'Cold-Pressed Extra Virgin Coconut Plantation Oil (1 Liter)', 'Pure centrifugal cold-extracted coconut oil from fresh coastal kernel.', 'bottle', 420.00, 620.00, 540.00, 5.0, 'Malabar Harvest', 1, datetime('now')),
  ('prod_agro_wild_honey_500g', 'cat_plant_fruits', 'sup_coastal_coconut_agro', 'br_coastal_sub2', 'HNY-FOREST-RAW-500G', '8901234500051', 'Multi-Flora Wild Forest Raw Honey with Comb Chunk (500g)', 'Unprocessed raw forest honey sustainably collected from Western Ghats floral canopies.', 'jar', 320.00, 480.00, 420.00, 5.0, 'Malabar Harvest', 1, datetime('now'));

-- Product Stocks in Branches
INSERT OR REPLACE INTO stocks (id, product_id, branch_id, quantity)
VALUES
  ('stk_proc_kit_main', 'prod_tool_organic_processing_kit', 'br_plantation_main', 25),
  ('stk_proc_kit_valley', 'prod_tool_organic_processing_kit', 'br_valley_sub1', 15),
  ('stk_weeder_main', 'prod_tool_weeder_harvester', 'br_plantation_main', 40),
  ('stk_weeder_valley', 'prod_tool_weeder_harvester', 'br_valley_sub1', 50),
  ('stk_sprayer_main', 'prod_tool_eco_power_sprayer', 'br_plantation_main', 60),
  ('stk_tea_green_main', 'prod_tea_orthodox_green_1kg', 'br_plantation_main', 350),
  ('stk_tea_masala_main', 'prod_tea_masala_chai_500g', 'br_plantation_main', 500),
  ('stk_cardamom_main', 'prod_spice_cardamom_bold_500g', 'br_plantation_main', 200),
  ('prod_black_pepper_main', 'prod_spice_black_pepper_1kg', 'br_plantation_main', 400),
  ('stk_pruning_shear_main', 'prod_tool_pruning_shear_carbon', 'br_plantation_main', 150),
  ('stk_oil_coastal', 'prod_agro_virgin_coconutoil_1l', 'br_coastal_sub2', 300),
  ('stk_honey_coastal', 'prod_agro_wild_honey_500g', 'br_coastal_sub2', 250);

-- 4. Natural Plantation Customers (20 customers across branches)
INSERT OR REPLACE INTO customers (id, branch_id, name, phone, email, address, nic, credit_limit, outstanding_due, loyalty_points, notes, updated_at)
VALUES
  ('cust_ananya_urban_garden', 'br_plantation_main', 'Dr. Ananya Sundaram', '+919940155667', 'ananya.sundaram@aims.org', '45/2, Greenways Road, R.A. Puram, Chennai', 'TN-MED-9940', 25000.00, 0.00, 320, 'Winner of Cycle 1 in Tea & Spice Gold Scheme — verified claim received.', datetime('now')),
  ('cust_subramaniam_orchard', 'br_valley_sub1', 'S. K. Subramaniam', '+919789077889', 'sk.subramaniam@gmail.com', 'Farm No. 12, Coconut Agro Farm, Aliyar Dam Road, Pollachi', 'TN-AGRO-7890', 50000.00, 0.00, 480, 'Winner of Cycle 2 (Downgrade redemption) — has active Rs. 5,000 SmartBuy Wallet balance.', datetime('now')),
  ('cust_misty_mountain', 'br_plantation_main', 'Misty Mountain Estate Resort', '+919443881234', 'manager@mistymountainstay.com', 'Pariyer Estate Road, Valparai Hills', 'TN-RES-4438', 100000.00, 0.00, 850, 'Cycle 3 Winner awaiting product award — ready for Award Wizard test.', datetime('now')),
  ('cust_green_valley_resort', 'br_plantation_main', 'Green Valley Eco-Resort & Spa', '+919442011223', 'accounts@greenvalleyresort.com', 'Misty Valley View Road, Ooty Hills', 'TN-RES-4891', 150000.00, 0.00, 650, 'Enrolled member (Member 4), payments fully up-to-date.', datetime('now')),
  ('cust_nature_basket_organics', 'br_valley_sub1', "Nature's Basket Organic Supermarket", '+919841044556', 'procurement@naturesbasket.in', '122, R.S. Puram West Main Road, Coimbatore', 'TN-RET-9012', 250000.00, 0.00, 1400, 'Wholesale partner — has pending bank transfer for Cycle 4.', datetime('now')),
  ('cust_kovai_organic_hub', 'br_valley_sub1', 'Kovai Agro Organic Hub', '+919842112233', 'kovaiorganics@rediffmail.com', '56, Gandhipuram 4th Street, Coimbatore', 'TN-RET-4211', 80000.00, 0.00, 290, 'Has pending bank transfer for Cycle 4 verification.', datetime('now')),
  ('cust_malabar_spice_exporters', 'br_coastal_sub2', 'Malabar Heritage Spice Exports Ltd', '+919447122334', 'exportdesk@malabarspice.com', 'Spice Exchange Complex, Mattancherry, Kochi', 'KL-EXP-3312', 500000.00, 0.00, 3100, 'Pending bank transfer contribution of Rs. 10,000.', datetime('now')),
  ('cust_ramachandran_tea', 'br_plantation_main', 'M. Ramachandran (Senior Planter)', '+919443123456', 'ramachandran.valparai@gmail.com', 'Waterfall Estate Sector 2, Valparai', 'TN-PLNT-4312', 30000.00, 0.00, 190, 'Member 7 in Scheme 1, all 4 cycles paid.', datetime('now')),
  ('cust_priya_kavitha', 'br_valley_sub1', 'K. Priya & Kavitha Farm Agro', '+919789123456', 'priyakavitha.farms@yahoo.com', 'Kottur Malayandipattinam Road, Pollachi', 'TN-AGRO-8912', 40000.00, 5000.00, 140, 'Cycle 4 payment overdue — active Payment Reminder target.', datetime('now')),
  ('cust_murugesan_spice', 'br_plantation_main', 'P. Murugesan (Pepper Cultivator)', '+919442987654', 'murugesan.spices@gmail.com', 'Sholayar Dam Lower Camp, Valparai', 'TN-AGRO-4298', 25000.00, 10000.00, 95, 'Requested membership withdrawal due to farm relocation.', datetime('now')),
  ('cust_selvakumar_bio', 'br_valley_sub1', 'V. Selvakumar (Soil & Bio Care)', '+919840556677', 'selvakumar.biocare@gmail.com', '78, Udumalpet Highway, Pollachi', 'TN-AGRO-4055', 35000.00, 5000.00, 110, 'Overdue cycle payment reminder target.', datetime('now')),
  ('cust_deepa_rajan', 'br_coastal_sub2', 'Deepa Rajan (Aroma Herbals)', '+919447665544', 'deeparajan.herbs@gmail.com', 'Mavoor Road, Kozhikode', 'KL-RET-4766', 30000.00, 0.00, 220, 'Active member, paid on time.', datetime('now')),
  ('cust_sundaram_nursery', 'br_plantation_main', 'Sundaram Native Saplings Nursery', '+919843221100', 'sundaram.saplings@gmail.com', 'Iyerpadi Post, Valparai Hills', 'TN-NURS-4322', 45000.00, 0.00, 180, 'Active member, enrolled under Agent Senthil.', datetime('now')),
  ('cust_kerala_ayur_resort', 'br_coastal_sub2', 'Wayanad Ayurveda & Spice Sanctuary', '+919446001122', 'ayurstay@wayanadsanctuary.com', 'Lakkidi View Point, Wayanad', 'KL-RES-4600', 120000.00, 0.00, 420, 'Premium resort client enrolled in Scheme 2.', datetime('now')),
  ('cust_arun_kumar_agro', 'br_plantation_main', 'Arun Kumar (Agro Tech Engineer)', '+919941334455', 'arunkumar.agro@gmail.com', 'Ramanathapuram, Coimbatore', 'TN-AGRO-9413', 30000.00, 0.00, 85, 'Enrolled in pending Harvester Scheme 2.', datetime('now')),
  ('cust_karthika_orchard', 'br_valley_sub1', 'Karthika Devi Fruit Orchards', '+919788776655', 'karthikadevi.farms@gmail.com', 'Meenakshipuram Road, Pollachi', 'TN-AGRO-7887', 50000.00, 0.00, 130, 'Enrolled in Scheme 2.', datetime('now')),
  ('cust_balaji_coffee', 'br_plantation_main', 'Balaji Highland Coffee & Pepper Estate', '+919442443322', 'balaji.coffee@gmail.com', 'Mudis Estate Section, Valparai', 'TN-PLNT-4244', 60000.00, 0.00, 210, 'Enrolled in Scheme 2.', datetime('now')),
  ('cust_meenakshi_organics', 'br_valley_sub1', 'Meenakshi Natural Seed & Herbals', '+919841889900', 'meenakshi.seed@gmail.com', 'Sulur Agro Hub, Coimbatore', 'TN-RET-4188', 40000.00, 0.00, 115, 'Enrolled in Scheme 2.', datetime('now')),
  ('cust_cochin_spiceworld', 'br_coastal_sub2', 'Cochin Spice World & Extracts', '+919447998877', 'orders@cochinspiceworld.com', 'Broadway, Ernakulam, Kochi', 'KL-RET-4799', 75000.00, 0.00, 310, 'Completed Scheme 3 participant.', datetime('now')),
  ('cust_rajesh_terrace', 'br_plantation_main', 'Rajesh Kannan (Urban Grower)', '+919940223344', 'rajeshkannan.grow@gmail.com', 'Thiruvanmiyur, Chennai', 'TN-URB-9402', 20000.00, 0.00, 75, 'Completed Scheme 3 participant.', datetime('now'));

-- 5. Smart Buy Agents
INSERT OR REPLACE INTO agents (id, code, name, branch_id, phone, email, nic, default_commission_pct, status, updated_at)
VALUES
  ('ag_plant_senthil', 'AG-PLNT-01', 'Senthil Nathan (Valparai Head Collector)', 'br_plantation_main', '+919443012345', 'senthil.collector@naturalplantation.com', 'TN-AGT-0101', 5.0, 'active', datetime('now')),
  ('ag_plant_karthik', 'AG-PLNT-02', 'Karthikeyan Murugan (Pollachi Valley Field Agent)', 'br_valley_sub1', '+919789012345', 'karthik.valley@naturalplantation.com', 'TN-AGT-0102', 4.0, 'active', datetime('now')),
  ('ag_plant_fathima', 'AG-PLNT-03', 'Fathima Rameez (Coastal Nursery Agent)', 'br_coastal_sub2', '+919447012345', 'fathima.coastal@naturalplantation.com', 'KL-AGT-0103', 4.5, 'active', datetime('now')),
  ('ag_plant_ravi', 'AG-PLNT-04', 'Ravi Chandran (Highland Mobile Route Agent)', 'br_plantation_main', '+919940012345', 'ravi.route@naturalplantation.com', 'TN-AGT-0104', 5.0, 'active', datetime('now'));

-- 6. Agent Cash Remittances (Creates realistic unremitted agent balance)
-- Senthil: collected Rs. 65,000 cash, remitted Rs. 45,000 -> has Rs. 20,000 unremitted balance!
-- Karthik: collected Rs. 40,000 cash, remitted Rs. 25,000 -> has Rs. 15,000 unremitted balance!
INSERT OR REPLACE INTO agent_remittances (id, agent_id, branch_id, amount, method, bank_reference, submitted_at, received_by, notes)
VALUES
  ('rem_plant_senthil_01', 'ag_plant_senthil', 'br_plantation_main', 25000.00, 'cash', 'REMIT-SBI-VAL-4891', '2026-06-25 16:30:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Cycle 1 cash collection remittance hand-over.'),
  ('rem_plant_senthil_02', 'ag_plant_senthil', 'br_plantation_main', 20000.00, 'cash', 'REMIT-SBI-VAL-5120', '2026-07-28 17:00:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Cycle 2 partial cash collection remittance.'),
  ('rem_plant_karthik_01', 'ag_plant_karthik', 'br_valley_sub1', 25000.00, 'cash', 'REMIT-HDFC-POL-3012', '2026-08-20 15:45:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Pollachi valley advance enrollment remittance.');

-- 7. Scheme Master Catalog Templates (/admin/scheme-master)
INSERT OR REPLACE INTO chit_scheme_templates (id, scheme_name, monthly_contribution_amount, duration_months, minimum_members, product_value, status, created_by, updated_at)
VALUES
  ('tpl_plant_gold_5k', 'Estate Gold Spice & Tea Club 5000', 5000.00, 10, 12, 55000.00, 'active', '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')),
  ('tpl_plant_green_2k', 'Plantation Green Harvest Savings 2000', 2000.00, 12, 10, 26000.00, 'active', '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')),
  ('tpl_plant_harvester_10k', 'Agro Harvester & Equipment Elite 10000', 10000.00, 12, 8, 135000.00, 'active', '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')),
  ('tpl_plant_nursery_starter', 'Organic Nursery Saplings Plan 1500 (Seasonal)', 1500.00, 6, 5, 10000.00, 'inactive', '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now'));

-- 8. Chit Schemes (/admin/chits)
INSERT OR REPLACE INTO chit_schemes (
  id, scheme_number, name, branch_id, product_id, agent_id, template_id,
  member_count, min_members, cycle_count, frequency, contribution_amount, chit_value,
  early_redemption_count, early_redemption_amount, repayment_months, agent_commission_pct,
  start_date, next_draw_date, status, late_payment_days, late_fee_amount,
  projected_early_winners, avg_product_cost, other_expenses, notes, created_by, updated_at
) VALUES
  (
    'sch_plant_gold_01', 'PLNT-CHIT-2026-0001', 'Highland Organic Tea & Spice Gold Scheme (Batch #1)',
    'br_plantation_main', 'prod_tool_organic_processing_kit', 'ag_plant_senthil', 'tpl_plant_gold_5k',
    12, 10, 10, 'monthly', 5000.00, 55000.00,
    3, 50000.00, 12, 5.0,
    '2026-06-01', '2026-10-05', 'active', 5, 150.00,
    3, 38000.00, 3500.00, 'Flagship plantation savings scheme. Cycles 1, 2, 3 drawn. Cycle 4 current.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  ),
  (
    'sch_plant_harvester_02', 'PLNT-CHIT-2026-0002', 'Green Valley Agro Harvester Scheme (Batch #2)',
    'br_valley_sub1', 'prod_tool_weeder_harvester', 'ag_plant_karthik', 'tpl_plant_harvester_10k',
    10, 8, 12, 'monthly', 10000.00, 135000.00,
    2, 120000.00, 12, 4.0,
    '2026-10-01', '2026-11-05', 'pending', 7, 250.00,
    2, 95000.00, 5000.00, 'Currently has 6/8 members. Add 2 members to trigger auto-activation!',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  ),
  (
    'sch_plant_nursery_03', 'PLNT-CHIT-2025-0008', 'Plantation Nursery Yield Plan 2025 (Completed)',
    'br_plantation_main', 'prod_tool_eco_power_sprayer', 'ag_plant_ravi', 'tpl_plant_green_2k',
    6, 5, 6, 'monthly', 2000.00, 26000.00,
    1, 24000.00, 6, 5.0,
    '2025-10-01', '2026-04-01', 'completed', 5, 100.00,
    1, 18000.00, 1500.00, 'Fully finished historical scheme with all 6 cycles settled.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  ),
  (
    'sch_plant_coastal_04', 'PLNT-CHIT-2026-0003', 'Coastal Nursery Green Harvest Scheme (Batch #1)',
    'br_plantation_main', 'prod_tool_pruning_shear_carbon', 'ag_plant_fathima', 'tpl_plant_green_2k',
    10, 8, 12, 'monthly', 2000.00, 26000.00,
    2, 24000.00, 12, 4.5,
    '2026-11-01', '2026-12-05', 'pending', 5, 100.00,
    2, 18000.00, 2000.00, 'Has pending branch collaboration invitation for Coastal Hub.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  );

-- Registration dates for Scheme 2 (Demonstrating Registration Lock)
UPDATE chit_schemes
SET registration_start_date = '2026-09-01', registration_end_date = '2026-10-31'
WHERE id = 'sch_plant_harvester_02';

-- 9. Branch Collaboration Invites (chit_scheme_branches)
INSERT OR REPLACE INTO chit_scheme_branches (id, scheme_id, branch_id, status, requested_by, responded_by, responded_at, notes, updated_at)
VALUES
  -- Active collaboration: Green Valley participates in Main Estate's Scheme 1
  ('collab_gold_valley', 'sch_plant_gold_01', 'br_valley_sub1', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-05-28 10:00:00', 'Approved cross-branch enrollment for Pollachi customers.', datetime('now')),
  -- Pending invitation: Shows up as alert on Dashboard with Approve/Reject buttons!
  ('collab_coastal_pending', 'sch_plant_coastal_04', 'br_coastal_sub2', 'pending', '8fc32c59-2f06-4ce9-9239-531b22bb6994', NULL, NULL, 'Invited Coastal Branch to co-enroll 5 members for nursery tools.', datetime('now'));

-- 10. Chit Members (/admin/chit-customers)
-- 12 Enrolled Members in Scheme 1 (PLNT-CHIT-2026-0001)
INSERT OR REPLACE INTO chit_members (
  id, scheme_id, customer_id, agent_id, enrolled_branch_id, join_order,
  is_early_redemption, redemption_type, won_cycle_no, product_received_at, contributions_paid, status,
  paper_reference_code, claim_status, claim_due_date, claimed_at, entitlement_value,
  redeemed_product_id, redeemed_product_name, redeemed_qty, redeemed_value, wallet_credit_created, updated_at
) VALUES
  -- Member 1: Cycle 1 Winner, fully claimed product
  (
    'mem_gold_01', 'sch_plant_gold_01', 'cust_ananya_urban_garden', 'ag_plant_senthil', 'br_plantation_main', 1,
    0, 'draw', 1, '2026-06-15 11:30:00', 15000.00, 'won',
    'REF-PAP-PLNT-001', 'claimed', '2026-07-10', '2026-06-15 11:30:00', 55000.00,
    'prod_tool_organic_processing_kit', 'Artisanal Tea & Spice Home Processing Unit (Estate Pro Kit)', 1, 55000.00, 0.00, datetime('now')
  ),
  -- Member 2: Cycle 2 Winner, chose downgrade product -> Rs. 5,000 credited to SmartBuy Wallet!
  (
    'mem_gold_02', 'sch_plant_gold_01', 'cust_subramaniam_orchard', 'ag_plant_karthik', 'br_valley_sub1', 2,
    0, 'draw', 2, '2026-07-20 14:00:00', 15000.00, 'won',
    'REF-PAP-PLNT-002', 'claimed', '2026-08-10', '2026-07-20 14:00:00', 55000.00,
    'prod_furn_garden_bench_teak', 'Solid Teak 5ft Colonial Garden Bench + Pruning Set', 1, 50000.00, 5000.00, datetime('now')
  ),
  -- Member 3: Cycle 3 Winner -> PENDING PRODUCT CLAIM! Ready for SmartBuy Award Wizard (/admin/smart-buy-award)!
  (
    'mem_gold_03', 'sch_plant_gold_01', 'cust_misty_mountain', 'ag_plant_senthil', 'br_plantation_main', 3,
    0, 'draw', 3, NULL, 15000.00, 'won',
    'REF-PAP-PLNT-003', 'pending_claim', '2026-10-15', NULL, 55000.00,
    NULL, NULL, 1, NULL, 0.00, datetime('now')
  ),
  -- Member 4: Fully up to date (paid cycles 1, 2, 3, 4)
  ('mem_gold_04', 'sch_plant_gold_01', 'cust_green_valley_resort', 'ag_plant_senthil', 'br_plantation_main', 4, 0, NULL, NULL, NULL, 20000.00, 'active', 'REF-PAP-PLNT-004', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 5: Paid cycles 1, 2, 3; Cycle 4 pending bank transfer
  ('mem_gold_05', 'sch_plant_gold_01', 'cust_nature_basket_organics', 'ag_plant_karthik', 'br_valley_sub1', 5, 0, NULL, NULL, NULL, 15000.00, 'active', 'REF-PAP-PLNT-005', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 6: Paid cycles 1, 2, 3; Cycle 4 pending bank transfer
  ('mem_gold_06', 'sch_plant_gold_01', 'cust_kovai_organic_hub', 'ag_plant_karthik', 'br_valley_sub1', 6, 0, NULL, NULL, NULL, 15000.00, 'active', 'REF-PAP-PLNT-006', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 7: Up to date (paid cycles 1, 2, 3, 4)
  ('mem_gold_07', 'sch_plant_gold_01', 'cust_ramachandran_tea', 'ag_plant_senthil', 'br_plantation_main', 7, 0, NULL, NULL, NULL, 20000.00, 'active', 'REF-PAP-PLNT-007', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 8: Paid cycles 1, 2, 3; Cycle 4 OVERDUE (Payment Reminder target)
  ('mem_gold_08', 'sch_plant_gold_01', 'cust_priya_kavitha', 'ag_plant_karthik', 'br_valley_sub1', 8, 0, NULL, NULL, NULL, 15000.00, 'active', 'REF-PAP-PLNT-008', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 9: Paid cycles 1, 2; has pending withdrawal request
  ('mem_gold_09', 'sch_plant_gold_01', 'cust_murugesan_spice', 'ag_plant_senthil', 'br_plantation_main', 9, 0, NULL, NULL, NULL, 10000.00, 'active', 'REF-PAP-PLNT-009', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 10: Paid cycles 1, 2, 3; Cycle 4 OVERDUE (Payment Reminder target)
  ('mem_gold_10', 'sch_plant_gold_01', 'cust_selvakumar_bio', 'ag_plant_karthik', 'br_valley_sub1', 10, 0, NULL, NULL, NULL, 15000.00, 'active', 'REF-PAP-PLNT-010', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 11: Up to date (paid cycles 1, 2, 3, 4)
  ('mem_gold_11', 'sch_plant_gold_01', 'cust_deepa_rajan', 'ag_plant_senthil', 'br_plantation_main', 11, 0, NULL, NULL, NULL, 20000.00, 'active', 'REF-PAP-PLNT-011', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now')),
  -- Member 12: Up to date (paid cycles 1, 2, 3, 4)
  ('mem_gold_12', 'sch_plant_gold_01', 'cust_sundaram_nursery', 'ag_plant_senthil', 'br_plantation_main', 12, 0, NULL, NULL, NULL, 20000.00, 'active', 'REF-PAP-PLNT-012', 'pending_claim', NULL, NULL, 0.00, NULL, NULL, 1, NULL, 0.00, datetime('now'));

-- Members in Scheme 2 (PLNT-CHIT-2026-0002, Pending Scheme - 6 members enrolled)
INSERT OR REPLACE INTO chit_members (id, scheme_id, customer_id, agent_id, enrolled_branch_id, join_order, contributions_paid, status, updated_at)
VALUES
  ('mem_harv_01', 'sch_plant_harvester_02', 'cust_kerala_ayur_resort', 'ag_plant_karthik', 'br_valley_sub1', 1, 10000.00, 'active', datetime('now')),
  ('mem_harv_02', 'sch_plant_harvester_02', 'cust_arun_kumar_agro', 'ag_plant_karthik', 'br_valley_sub1', 2, 10000.00, 'active', datetime('now')),
  ('mem_harv_03', 'sch_plant_harvester_02', 'cust_karthika_orchard', 'ag_plant_karthik', 'br_valley_sub1', 3, 10000.00, 'active', datetime('now')),
  ('mem_harv_04', 'sch_plant_harvester_02', 'cust_balaji_coffee', 'ag_plant_karthik', 'br_valley_sub1', 4, 10000.00, 'active', datetime('now')),
  ('mem_harv_05', 'sch_plant_harvester_02', 'cust_meenakshi_organics', 'ag_plant_karthik', 'br_valley_sub1', 5, 10000.00, 'active', datetime('now')),
  ('mem_harv_06', 'sch_plant_harvester_02', 'cust_malabar_spice_exporters', 'ag_plant_karthik', 'br_valley_sub1', 6, 0.00, 'active', datetime('now'));

-- Members in Scheme 3 (Completed Scheme - all 6 completed)
INSERT OR REPLACE INTO chit_members (id, scheme_id, customer_id, agent_id, enrolled_branch_id, join_order, won_cycle_no, redemption_type, contributions_paid, status, updated_at)
VALUES
  ('mem_nurs_01', 'sch_plant_nursery_03', 'cust_cochin_spiceworld', 'ag_plant_ravi', 'br_plantation_main', 1, 1, 'draw', 12000.00, 'redeemed', datetime('now')),
  ('mem_nurs_02', 'sch_plant_nursery_03', 'cust_rajesh_terrace', 'ag_plant_ravi', 'br_plantation_main', 2, 2, 'draw', 12000.00, 'redeemed', datetime('now'));

-- 11. Chit Draws (chit_draws)
INSERT OR REPLACE INTO chit_draws (id, scheme_id, cycle_no, draw_date, winner_member_id, settled_count, eligible_count, method, conducted_by, witness_name, reference_number, notes)
VALUES
  ('draw_gold_c01', 'sch_plant_gold_01', 1, '2026-06-10', 'mem_gold_01', 1, 12, 'manual_pick', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Mr. S. Venkatesh (Canopy Tech)', 'DRAW-PLNT-2026-C01', 'Inaugural draw conducted at Valparai Main Estate Office.'),
  ('draw_gold_c02', 'sch_plant_gold_01', 2, '2026-07-10', 'mem_gold_02', 1, 11, 'manual_pick', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Mrs. Kavitha Ramanathan (Nilgiri Teas)', 'DRAW-PLNT-2026-C02', 'Second monthly draw with Pollachi growers delegation present.'),
  ('draw_gold_c03', 'sch_plant_gold_01', 3, '2026-08-10', 'mem_gold_03', 1, 10, 'manual_pick', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'Mr. Abdul Rahman (Malabar Produce)', 'DRAW-PLNT-2026-C03', 'Third monthly draw. Misty Mountain Estate selected.');

-- 12. Chit Contributions (chit_contributions)
-- Approved past contributions across June, July, August, September (creating beautiful charts)
INSERT OR REPLACE INTO chit_contributions (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number, reference, status, received_by, collected_by_agent_id, branch_id, commission_amount, paid_at)
VALUES
  -- June 2026 Collections (Cycle 1)
  ('cnt_g01_c1', 'sch_plant_gold_01', 'mem_gold_01', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-001', 'CASH-001', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-03 10:15:00'),
  ('cnt_g02_c1', 'sch_plant_gold_01', 'mem_gold_02', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-002', 'CASH-002', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-06-03 11:30:00'),
  ('cnt_g03_c1', 'sch_plant_gold_01', 'mem_gold_03', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-003', 'CASH-003', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-04 14:00:00'),
  ('cnt_g04_c1', 'sch_plant_gold_01', 'mem_gold_04', 1, 'cycle', 5000.00, 'bank_transfer', 'RCPT-PLNT-004', 'HDFC-NEFT-6621', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', NULL, 'br_plantation_main', 0.00, '2026-06-04 15:00:00'),
  ('cnt_g05_c1', 'sch_plant_gold_01', 'mem_gold_05', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-005', 'CASH-005', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-06-05 09:30:00'),
  ('cnt_g06_c1', 'sch_plant_gold_01', 'mem_gold_06', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-006', 'CASH-006', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-06-05 10:00:00'),
  ('cnt_g07_c1', 'sch_plant_gold_01', 'mem_gold_07', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-007', 'CASH-007', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-05 11:00:00'),
  ('cnt_g08_c1', 'sch_plant_gold_01', 'mem_gold_08', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-008', 'CASH-008', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-06-05 11:30:00'),
  ('cnt_g09_c1', 'sch_plant_gold_01', 'mem_gold_09', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-009', 'CASH-009', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-05 14:00:00'),
  ('cnt_g10_c1', 'sch_plant_gold_01', 'mem_gold_10', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-010', 'CASH-010', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-06-05 14:30:00'),
  ('cnt_g11_c1', 'sch_plant_gold_01', 'mem_gold_11', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-011', 'CASH-011', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-05 15:00:00'),
  ('cnt_g12_c1', 'sch_plant_gold_01', 'mem_gold_12', 1, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-012', 'CASH-012', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-06-05 16:00:00'),

  -- July 2026 Collections (Cycle 2)
  ('cnt_g01_c2', 'sch_plant_gold_01', 'mem_gold_01', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-013', 'CASH-013', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-02 10:00:00'),
  ('cnt_g02_c2', 'sch_plant_gold_01', 'mem_gold_02', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-014', 'CASH-014', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-07-03 11:00:00'),
  ('cnt_g03_c2', 'sch_plant_gold_01', 'mem_gold_03', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-015', 'CASH-015', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-03 14:00:00'),
  ('cnt_g04_c2', 'sch_plant_gold_01', 'mem_gold_04', 2, 'cycle', 5000.00, 'bank_transfer', 'RCPT-PLNT-016', 'HDFC-NEFT-7812', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', NULL, 'br_plantation_main', 0.00, '2026-07-04 15:00:00'),
  ('cnt_g05_c2', 'sch_plant_gold_01', 'mem_gold_05', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-017', 'CASH-017', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-07-04 16:00:00'),
  ('cnt_g06_c2', 'sch_plant_gold_01', 'mem_gold_06', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-018', 'CASH-018', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-07-05 10:00:00'),
  ('cnt_g07_c2', 'sch_plant_gold_01', 'mem_gold_07', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-019', 'CASH-019', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-05 11:00:00'),
  ('cnt_g08_c2', 'sch_plant_gold_01', 'mem_gold_08', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-020', 'CASH-020', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-07-05 12:00:00'),
  ('cnt_g09_c2', 'sch_plant_gold_01', 'mem_gold_09', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-021', 'CASH-021', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-05 14:00:00'),
  ('cnt_g10_c2', 'sch_plant_gold_01', 'mem_gold_10', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-022', 'CASH-022', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-07-05 15:00:00'),
  ('cnt_g11_c2', 'sch_plant_gold_01', 'mem_gold_11', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-023', 'CASH-023', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-05 16:00:00'),
  ('cnt_g12_c2', 'sch_plant_gold_01', 'mem_gold_12', 2, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-024', 'CASH-024', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-07-05 17:00:00'),

  -- August 2026 Collections (Cycle 3)
  ('cnt_g01_c3', 'sch_plant_gold_01', 'mem_gold_01', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-025', 'CASH-025', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-08-02 10:00:00'),
  ('cnt_g02_c3', 'sch_plant_gold_01', 'mem_gold_02', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-026', 'CASH-026', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-08-03 11:00:00'),
  ('cnt_g03_c3', 'sch_plant_gold_01', 'mem_gold_03', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-027', 'CASH-027', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-08-03 14:00:00'),
  ('cnt_g04_c3', 'sch_plant_gold_01', 'mem_gold_04', 3, 'cycle', 5000.00, 'bank_transfer', 'RCPT-PLNT-028', 'HDFC-NEFT-8910', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', NULL, 'br_plantation_main', 0.00, '2026-08-04 15:00:00'),
  ('cnt_g05_c3', 'sch_plant_gold_01', 'mem_gold_05', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-029', 'CASH-029', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-08-04 16:00:00'),
  ('cnt_g06_c3', 'sch_plant_gold_01', 'mem_gold_06', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-030', 'CASH-030', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-08-05 10:00:00'),
  ('cnt_g07_c3', 'sch_plant_gold_01', 'mem_gold_07', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-031', 'CASH-031', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-08-05 11:00:00'),
  ('cnt_g08_c3', 'sch_plant_gold_01', 'mem_gold_08', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-032', 'CASH-032', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-08-05 12:00:00'),
  ('cnt_g10_c3', 'sch_plant_gold_01', 'mem_gold_10', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-033', 'CASH-033', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_karthik', 'br_valley_sub1', 200.00, '2026-08-05 14:00:00'),
  ('cnt_g11_c3', 'sch_plant_gold_01', 'mem_gold_11', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-034', 'CASH-034', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-08-05 15:00:00'),
  ('cnt_g12_c3', 'sch_plant_gold_01', 'mem_gold_12', 3, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-035', 'CASH-035', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-08-05 16:00:00'),

  -- September 2026 Collections (Cycle 4 - Current Month)
  ('cnt_g04_c4', 'sch_plant_gold_01', 'mem_gold_04', 4, 'cycle', 5000.00, 'bank_transfer', 'RCPT-PLNT-036', 'HDFC-NEFT-9912', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', NULL, 'br_plantation_main', 0.00, '2026-09-02 11:00:00'),
  ('cnt_g07_c4', 'sch_plant_gold_01', 'mem_gold_07', 4, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-037', 'CASH-037', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-09-03 14:00:00'),
  ('cnt_g11_c4', 'sch_plant_gold_01', 'mem_gold_11', 4, 'cycle', 5000.00, 'cash', 'RCPT-PLNT-038', 'CASH-038', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-09-04 15:00:00'),
  ('cnt_g12_c4', 'sch_plant_gold_01', 'mem_gold_12', 4, 'cycle', 5150.00, 'cash', 'RCPT-PLNT-039', 'CASH-039-LATE', 'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'ag_plant_senthil', 'br_plantation_main', 250.00, '2026-09-12 16:30:00');

-- 13. PENDING BANK TRANSFERS (/admin/smart-buy-transfers)
-- 3 Pending Bank Transfer Contributions that user can click "Approve" or "Reject" on!
INSERT OR REPLACE INTO chit_contributions (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number, reference, status, received_by, collected_by_agent_id, branch_id, notes, paid_at)
VALUES
  (
    'cnt_pending_transfer_01', 'sch_plant_gold_01', 'mem_gold_05', 4, 'cycle', 5000.00,
    'bank_transfer', 'RCPT-PEND-001', 'HDFC-NEFT-9823412', 'pending',
    NULL, NULL, 'br_valley_sub1', 'Online NEFT deposit by Nature''s Basket Organics for Cycle 4.', '2026-09-28 11:20:00'
  ),
  (
    'cnt_pending_transfer_02', 'sch_plant_gold_01', 'mem_gold_06', 4, 'cycle', 5000.00,
    'bank_transfer', 'RCPT-PEND-002', 'AXIS-IMPS-771239', 'pending',
    NULL, NULL, 'br_valley_sub1', 'IMPS transfer from Kovai Agro Hub current account.', '2026-09-28 15:40:00'
  ),
  (
    'cnt_pending_transfer_03', 'sch_plant_harvester_02', 'mem_harv_06', 1, 'cycle', 10000.00,
    'bank_transfer', 'RCPT-PEND-003', 'SBI-UPI-8841920', 'pending',
    NULL, NULL, 'br_coastal_sub2', 'Advance installment via UPI for Agro Harvester Scheme 2.', '2026-09-29 08:30:00'
  );

-- 14. SmartBuy Wallet & Ledger (smartbuy_wallet & smartbuy_wallet_transactions)
INSERT OR REPLACE INTO smartbuy_wallet (id, customer_id, balance, created_at, updated_at)
VALUES
  ('wal_subramaniam', 'cust_subramaniam_orchard', 5000.00, '2026-07-20 14:00:00', datetime('now')),
  ('wal_ananya', 'cust_ananya_urban_garden', 3500.00, '2026-06-15 11:30:00', datetime('now'));

INSERT OR REPLACE INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, redemption_id, notes, created_by, created_at)
VALUES
  ('wtx_subra_01', 'wal_subramaniam', 'cust_subramaniam_orchard', 'credit', 5000.00, 5000.00, 'downgrade_redemption', 'mem_gold_02', 'Downgrade redemption from Cycle 2 winner entitlement (Rs. 55,000 product entitlement - Rs. 50,000 product selected).', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-07-20 14:00:00'),
  ('wtx_ananya_01', 'wal_ananya', 'cust_ananya_urban_garden', 'credit', 5000.00, 5000.00, 'downgrade_redemption', 'mem_gold_01', 'Bonus store credit from scheme settlement.', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-06-15 11:30:00'),
  ('wtx_ananya_02', 'wal_ananya', 'cust_ananya_urban_garden', 'debit', 1500.00, 3500.00, 'pos_purchase', NULL, 'Redeemed at Valparai Estate Counter for Green Tea & Honey.', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-07-15 16:20:00');

-- 15. Payment Reminders History (/admin/smart-buy-reminders)
INSERT OR REPLACE INTO chit_payment_reminders (id, member_id, scheme_id, cycle_no, reminder_type, message, sent_at, sent_by, delivery_status, notes)
VALUES
  (
    'rem_hist_01', 'mem_gold_08', 'sch_plant_gold_01', 4, 'payment_due',
    'Dear K. Priya, your Cycle 4 contribution of Rs. 5,000 for Highland Organic Tea & Spice Gold Scheme was due on 05-Sep-2026. Please pay before 10-Sep to avoid late fee.',
    '2026-09-08 10:30:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'sent', 'SMS delivered to +919789123456'
  ),
  (
    'rem_hist_02', 'mem_gold_10', 'sch_plant_gold_01', 4, 'payment_due',
    'Dear V. Selvakumar, your monthly installment of Rs. 5,000 for Highland Organic Scheme is pending. Kindly remit to avoid service disruption.',
    '2026-09-09 11:15:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'sent', 'WhatsApp reminder sent to +919840556677'
  ),
  (
    'rem_hist_03', 'mem_gold_09', 'sch_plant_gold_01', 3, 'late_fee_warning',
    'Dear P. Murugesan, Cycle 3 payment is past due date. Late fee of Rs. 150 has been applied.',
    '2026-08-15 14:00:00', '8fc32c59-2f06-4ce9-9239-531b22bb6994', 'sent', 'System automated reminder'
  );

-- 16. Commission Rules (/admin/commission-rules)
INSERT OR REPLACE INTO commission_rules (
  id, name, scope, scheme_id, product_id, category_id, brand,
  calculation_type, rate, ownership_model, registration_share_pct, sales_share_pct,
  is_bonus, priority, status, notes, created_by, updated_at
) VALUES
  (
    'crule_plant_global', 'Plantation Enterprise Standard Rule', 'global',
    NULL, NULL, NULL, NULL,
    'percentage', 3.0, 'split', 70.0, 30.0,
    0, 10, 'active', 'Company-wide base rule: 3% total commission (70% to registration agent, 30% to collection agent).',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  ),
  (
    'crule_plant_gold_scheme', 'Highland Spice Gold 5K Scheme Incentive', 'scheme',
    'sch_plant_gold_01', NULL, NULL, NULL,
    'percentage', 5.0, 'registration', 100.0, 0.0,
    0, 20, 'active', '5% direct incentive to enrolling agent for 5000/mo Gold Scheme.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  ),
  (
    'crule_plant_bonus_tea', 'Plantation Organic Green Tea Seasonal Bonus', 'category',
    NULL, NULL, 'cat_plant_tea', NULL,
    'percentage', 1.5, 'registration', 100.0, 0.0,
    1, 30, 'active', 'Stackable 1.5% bonus on tea-linked customer redemptions.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', datetime('now')
  );

-- Commission Ledger Entries (commission_ledger)
INSERT OR REPLACE INTO commission_ledger (
  id, source_table, source_id, scheme_id, member_id, rule_id, is_bonus,
  registration_agent_id, sales_agent_id, base_amount,
  registration_commission, sales_commission, total_commission,
  status, approved_by, approved_at, paid_at, branch_id, notes, created_at
) VALUES
  -- Approved & Paid
  (
    'cled_01', 'chit_contributions', 'cnt_g01_c1', 'sch_plant_gold_01', 'mem_gold_01', 'crule_plant_gold_scheme', 0,
    'ag_plant_senthil', 'ag_plant_senthil', 5000.00,
    250.00, 0.00, 250.00,
    'paid', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-06-10 12:00:00', '2026-06-25 16:30:00', 'br_plantation_main', 'Cycle 1 collection commission', '2026-06-03 10:15:00'
  ),
  (
    'cled_02', 'chit_contributions', 'cnt_g02_c1', 'sch_plant_gold_01', 'mem_gold_02', 'crule_plant_global', 0,
    'ag_plant_karthik', 'ag_plant_karthik', 5000.00,
    140.00, 60.00, 200.00,
    'paid', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-06-10 12:00:00', '2026-06-25 16:30:00', 'br_valley_sub1', 'Cycle 1 valley collection', '2026-06-03 11:30:00'
  ),
  -- Approved, pending payout
  (
    'cled_03', 'chit_contributions', 'cnt_g01_c2', 'sch_plant_gold_01', 'mem_gold_01', 'crule_plant_gold_scheme', 0,
    'ag_plant_senthil', 'ag_plant_senthil', 5000.00,
    250.00, 0.00, 250.00,
    'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-07-10 14:00:00', NULL, 'br_plantation_main', 'Cycle 2 collection commission', '2026-07-02 10:00:00'
  ),
  (
    'cled_04', 'chit_contributions', 'cnt_g03_c2', 'sch_plant_gold_01', 'mem_gold_03', 'crule_plant_gold_scheme', 0,
    'ag_plant_senthil', 'ag_plant_senthil', 5000.00,
    250.00, 0.00, 250.00,
    'approved', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-07-10 14:00:00', NULL, 'br_plantation_main', 'Cycle 2 collection commission', '2026-07-03 14:00:00'
  ),
  -- Pending Approval (Ready for user to click "Approve" or "Reject" on /admin/commission-rules!)
  (
    'cled_05', 'chit_contributions', 'cnt_g01_c3', 'sch_plant_gold_01', 'mem_gold_01', 'crule_plant_gold_scheme', 0,
    'ag_plant_senthil', 'ag_plant_senthil', 5000.00,
    250.00, 0.00, 250.00,
    'pending', NULL, NULL, NULL, 'br_plantation_main', 'Cycle 3 collection commission awaiting verification', '2026-08-02 10:00:00'
  ),
  (
    'cled_06', 'chit_contributions', 'cnt_g02_c3', 'sch_plant_gold_01', 'mem_gold_02', 'crule_plant_global', 0,
    'ag_plant_karthik', 'ag_plant_karthik', 5000.00,
    140.00, 60.00, 200.00,
    'pending', NULL, NULL, NULL, 'br_valley_sub1', 'Cycle 3 Pollachi collection pending manager review', '2026-08-03 11:00:00'
  ),
  (
    'cled_07', 'chit_contributions', 'cnt_g07_c4', 'sch_plant_gold_01', 'mem_gold_07', 'crule_plant_gold_scheme', 0,
    'ag_plant_senthil', 'ag_plant_senthil', 5000.00,
    250.00, 0.00, 250.00,
    'pending', NULL, NULL, NULL, 'br_plantation_main', 'Cycle 4 recent payment commission', '2026-09-03 14:00:00'
  );

-- Commission Payout History (commission_payouts)
INSERT OR REPLACE INTO commission_payouts (id, agent_id, branch_id, amount, method, reference, paid_by, paid_at, notes)
VALUES
  ('payout_senthil_01', 'ag_plant_senthil', 'br_plantation_main', 4500.00, 'cash', 'PAY-COMM-VAL-001', '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-06-25 16:30:00', 'June cycle agent commission settlement paid in cash.');

-- Link cled_01 to payout
UPDATE commission_ledger SET payout_id = 'payout_senthil_01' WHERE id = 'cled_01';

-- 17. Member Withdrawal / Refund Requests (withdrawal_requests)
INSERT OR REPLACE INTO withdrawal_requests (
  id, member_id, scheme_id, branch_id, requested_by, requested_at,
  reason, scheme_was_active, status, refund_amount, reviewed_by, reviewed_at, review_reason
) VALUES
  -- 1 Pending Request for review in SuperAdmin/SmartBuyManager view!
  (
    'wreq_murugesan_01', 'mem_gold_09', 'sch_plant_gold_01', 'br_plantation_main',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-09-15 10:30:00',
    'Relocating tea & pepper farming operations to Karnataka; unable to make further monthly contributions.',
    1, 'pending', 10000.00, NULL, NULL, NULL
  ),
  -- 1 Approved historical request
  (
    'wreq_historical_02', 'mem_nurs_02', 'sch_plant_nursery_03', 'br_plantation_main',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-03-10 11:00:00',
    'Crop damage due to unseasonal rain, mutual early closure requested.',
    1, 'approved', 4000.00, '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-03-12 15:00:00', 'Approved by Estate Management with 100% refund of contributions.'
  );

-- 18. Winner Entitlement Transfer History (smartbuy_transfer_history)
INSERT OR REPLACE INTO smartbuy_transfer_history (id, member_id, original_customer_id, new_customer_id, reason, approved_by, approved_at)
VALUES
  (
    'tx_hist_01', 'mem_gold_01', 'cust_ananya_urban_garden', 'cust_ananya_urban_garden',
    'Self-claim authorization with corporate GST billing invoice name.',
    '8fc32c59-2f06-4ce9-9239-531b22bb6994', '2026-06-15 11:00:00'
  );

-- 19. SmartBuy Vouchers (coupons)
INSERT OR REPLACE INTO coupons (
  id, code, name, customer_id, branch_id, initial_value, balance, status,
  valid_from, valid_until, issued_by, notes, source_type, source_id,
  smartbuy_scheme_id, smartbuy_member_id, smartbuy_cycle_no,
  smartbuy_entitlement_value, smartbuy_product_value,
  agent_id, agent_code, agent_name, updated_at
) VALUES
  (
    'coup_sbv_01', 'SBV-PLNT-90812', 'SmartBuy Estate Winner Voucher - Rs. 10,000',
    'cust_subramaniam_orchard', 'br_valley_sub1', 10000.00, 10000.00, 'active',
    '2026-07-20', '2027-07-20', '8fc32c59-2f06-4ce9-9239-531b22bb6994',
    'SmartBuy Voucher issued for Scheme 1 Cycle 2 entitlement redemption remainder.',
    'smartbuy', 'mem_gold_02', 'sch_plant_gold_01', 'mem_gold_02', 2,
    55000.00, 45000.00, 'ag_plant_karthik', 'AG-PLNT-02', 'Karthikeyan Murugan', datetime('now')
  ),
  (
    'coup_sbv_02', 'SBV-PLNT-44120', 'SmartBuy Organic Agro Voucher - Rs. 5,000',
    'cust_nature_basket_organics', 'br_valley_sub1', 5000.00, 5000.00, 'active',
    '2026-08-15', '2027-08-15', '8fc32c59-2f06-4ce9-9239-531b22bb6994',
    'SmartBuy Promotional Gift Voucher for retail partners.',
    'smartbuy', 'mem_gold_05', 'sch_plant_gold_01', 'mem_gold_05', 3,
    5000.00, 5000.00, 'ag_plant_karthik', 'AG-PLNT-02', 'Karthikeyan Murugan', datetime('now')
  );

COMMIT;

PRAGMA foreign_keys = ON;
