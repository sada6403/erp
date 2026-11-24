-- Only the guarded migration runner may execute this after verifying zero rows
-- and taking a verified backup. Populated keyword tables are never dropped.
DROP TRIGGER IF EXISTS deactivate_product_keywords;
DROP TABLE IF EXISTS product_search_keywords;
