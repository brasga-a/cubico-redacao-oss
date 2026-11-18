-- Grading architecture metadata. Additive: existing rows read as the standard
-- single evaluation; no essay text is added to the operational ledger.

-- Operational ledger (always written): per-stage metrics and a content-free audit summary.
ALTER TABLE usage_ledger ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'single';
ALTER TABLE usage_ledger ADD COLUMN stages_json TEXT;
ALTER TABLE usage_ledger ADD COLUMN audit_json TEXT;

-- Opt-in history: which architecture and prompt produced the evaluation.
ALTER TABLE evaluations ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'single'
  CHECK (pipeline IN ('single', 'dual-review'));
ALTER TABLE evaluations ADD COLUMN prompt_version TEXT;
ALTER TABLE evaluations ADD COLUMN audit_status TEXT
  CHECK (audit_status IS NULL OR audit_status IN ('completed', 'skipped', 'failed'));
-- Stage metrics, initial vs final scores and the auditor's justifications.
ALTER TABLE evaluations ADD COLUMN execution_json TEXT;

CREATE INDEX IF NOT EXISTS idx_evaluations_user_pipeline
  ON evaluations (user_id, pipeline, created_at DESC);
