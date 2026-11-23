CREATE TABLE IF NOT EXISTS product_search_keywords (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  keyword_type TEXT NOT NULL CHECK(keyword_type IN ('word','tanglish','native_script','code')),
  script TEXT NOT NULL CHECK(script IN ('latin','tamil','sinhala','numeric')),
  source TEXT NOT NULL CHECK(source IN ('manual','import','auto_translit')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','branch','terminal','user')),
  scope_key TEXT NOT NULL,
  branch_id TEXT,
  terminal_id TEXT,
  user_id TEXT,
  parent_id TEXT REFERENCES product_search_keywords(id),
  review_status TEXT NOT NULL DEFAULT 'approved' CHECK(review_status IN ('pending','approved','rejected')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  CHECK((scope_type='global' AND scope_key='global' AND branch_id IS NULL AND terminal_id IS NULL AND user_id IS NULL)
     OR (scope_type='branch' AND scope_key='branch:'||branch_id AND branch_id IS NOT NULL AND terminal_id IS NULL AND user_id IS NULL)
     OR (scope_type='terminal' AND scope_key='terminal:'||terminal_id AND terminal_id IS NOT NULL AND branch_id IS NULL AND user_id IS NULL)
     OR (scope_type='user' AND scope_key='user:'||user_id AND user_id IS NOT NULL AND branch_id IS NULL AND terminal_id IS NULL)),
  UNIQUE(product_id,keyword_normalized,scope_key)
);
CREATE INDEX IF NOT EXISTS idx_keywords_normalized ON product_search_keywords(keyword_normalized);
CREATE INDEX IF NOT EXISTS idx_keywords_product ON product_search_keywords(product_id);
CREATE INDEX IF NOT EXISTS idx_keywords_scope ON product_search_keywords(scope_type,scope_key,is_active,review_status);
CREATE INDEX IF NOT EXISTS idx_keywords_updated ON product_search_keywords(updated_at,id);
CREATE TRIGGER IF NOT EXISTS deactivate_product_keywords AFTER UPDATE OF is_active ON products
WHEN NEW.is_active=0 AND OLD.is_active!=0
BEGIN
  UPDATE product_search_keywords SET is_active=0,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE product_id=NEW.id AND is_active=1;
END;
