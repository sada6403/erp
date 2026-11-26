-- PostgreSQL inventory compatibility migration. Apply only to an approved test/deployment database.
-- Existing quantities, prices and historical purchases are never rewritten.
BEGIN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_pricing_mode TEXT NOT NULL DEFAULT 'batch';
ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_markup_pct NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_as_latest_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_batches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_expiry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS due_balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS credit_balance NUMERIC NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS purchase_orders (
 id TEXT PRIMARY KEY,po_number TEXT NOT NULL,branch_id TEXT NOT NULL REFERENCES branches(id),supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 purchase_type TEXT NOT NULL DEFAULT 'order',status TEXT NOT NULL DEFAULT 'DRAFT',purchase_date DATE,supplier_invoice_number TEXT,expected_date DATE,
 received_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,cancelled_at TIMESTAMPTZ,notes TEXT,total_amount NUMERIC NOT NULL DEFAULT 0,created_by TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_type TEXT NOT NULL DEFAULT 'order';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_invoice_number TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS returned_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS applied_supplier_credit NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS refund_credit_amount NUMERIC NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_supplier_invoice ON purchase_orders(supplier_id,supplier_invoice_number) WHERE supplier_invoice_number IS NOT NULL AND btrim(supplier_invoice_number)<>'';
CREATE TABLE IF NOT EXISTS purchase_items (
 id TEXT PRIMARY KEY,po_id TEXT NOT NULL REFERENCES purchase_orders(id),product_id TEXT NOT NULL REFERENCES products(id),quantity NUMERIC NOT NULL DEFAULT 0,
 unit_cost NUMERIC NOT NULL DEFAULT 0,line_total NUMERIC NOT NULL DEFAULT 0,selling_price NUMERIC,received_qty NUMERIC NOT NULL DEFAULT 0,
 batch_number TEXT,mfg_date DATE,expiry_date DATE,notes TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS paid_quantity NUMERIC;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS free_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS purchase_unit_cost NUMERIC;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS mrp NUMERIC;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS entry_unit TEXT;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS entry_quantity NUMERIC;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS entry_free_quantity NUMERIC;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS product_uom (
 id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),uom_name TEXT NOT NULL,conversion_factor NUMERIC NOT NULL DEFAULT 1,is_base INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS product_batch_identities (
 id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),batch_no TEXT NOT NULL,expiry_date TEXT NOT NULL DEFAULT '',mfg_date TEXT,needs_review INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(product_id,batch_no,expiry_date));
CREATE TABLE IF NOT EXISTS product_batches (
 id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),branch_id TEXT NOT NULL REFERENCES branches(id),batch_number TEXT,expiry_date DATE,mfg_date DATE,
 quantity NUMERIC NOT NULL DEFAULT 0,cost_price NUMERIC NOT NULL DEFAULT 0,selling_price NUMERIC,mrp NUMERIC,po_id TEXT REFERENCES purchase_orders(id),purchase_item_id TEXT REFERENCES purchase_items(id),purchase_date DATE,
 original_quantity NUMERIC NOT NULL DEFAULT 0,sold_quantity NUMERIC NOT NULL DEFAULT 0,returned_quantity NUMERIC NOT NULL DEFAULT 0,damaged_quantity NUMERIC NOT NULL DEFAULT 0,
 historical_cost_known INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'available',created_by TEXT,notes TEXT,batch_identity_id TEXT REFERENCES product_batch_identities(id),
 batch_entry_mode TEXT NOT NULL DEFAULT 'new',batch_warning_ack INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS mrp NUMERIC;
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS supplier_returned_quantity NUMERIC NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS purchase_returns (
 id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchase_orders(id),branch_id TEXT NOT NULL REFERENCES branches(id),supplier_id TEXT NOT NULL REFERENCES suppliers(id),
 return_number TEXT NOT NULL,return_date DATE NOT NULL,reason TEXT NOT NULL,total_amount NUMERIC NOT NULL DEFAULT 0,created_by TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS purchase_return_items (
 id TEXT PRIMARY KEY,purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id),purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),batch_id TEXT NOT NULL REFERENCES product_batches(id),product_id TEXT NOT NULL REFERENCES products(id),
 quantity NUMERIC NOT NULL,unit_cost NUMERIC NOT NULL,line_total NUMERIC NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS sale_batch_allocations (
 id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id),product_id TEXT NOT NULL REFERENCES products(id),batch_id TEXT NOT NULL REFERENCES product_batches(id),branch_id TEXT NOT NULL REFERENCES branches(id),
 quantity NUMERIC NOT NULL,returned_quantity NUMERIC NOT NULL DEFAULT 0,unit_cost NUMERIC NOT NULL,unit_selling_price NUMERIC NOT NULL,cost_known INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),synced_at TIMESTAMPTZ);
-- Unconstrained NUMERIC expands capacity without reducing any existing integer or fractional digits.
DO $$ DECLARE column_record RECORD; BEGIN
 FOR column_record IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()
  AND table_name IN ('stocks','stock_movements','products','purchase_items','product_batches','product_uom','invoice_items','sale_batch_allocations','return_items','return_batch_allocations')
  AND column_name IN ('quantity','damaged_qty','ordered_qty','received_qty','returned_quantity','cost_price','selling_price','unit_cost','unit_price','unit_selling_price','conversion_factor')
  AND data_type IN ('numeric','integer','bigint','smallint')
 LOOP EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC USING %I::numeric',column_record.table_name,column_record.column_name,column_record.column_name); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION set_purchase_inventory_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
DO $$ DECLARE table_name TEXT; BEGIN
 FOREACH table_name IN ARRAY ARRAY['purchase_orders','purchase_items','product_uom','product_batch_identities','product_batches','purchase_returns','purchase_return_items','sale_batch_allocations'] LOOP
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(updated_at)','idx_'||table_name||'_inventory_updated',table_name);
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_'||table_name||'_inventory_updated') THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_purchase_inventory_updated_at()','trg_'||table_name||'_inventory_updated',table_name);
  END IF;
 END LOOP;
END $$;
COMMIT;
