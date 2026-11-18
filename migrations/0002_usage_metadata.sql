-- Additive operational metadata only. No essay or feedback storage.
ALTER TABLE usage_ledger ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_ledger ADD COLUMN usage_known INTEGER NOT NULL DEFAULT 0;
