-- Backup first; the guarded migration runner must reject a populated table.
-- Prefer disabling the desktop feature to preserve keyword history.
DROP TABLE IF EXISTS product_search_keywords;
