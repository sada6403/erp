-- Run only through the backup-first runner, which refuses populated tables.
DROP TABLE IF EXISTS import_job_rows;
DROP TABLE IF EXISTS import_mapping_templates;
DROP TABLE IF EXISTS import_jobs;
