-- Migration 0003: opt-in cloud history of completed evaluations.
-- Additive only: no existing auth or usage table/row is altered.
-- Metadata (listing) and full content (input snapshot + validated result) are
-- separate so that listing never reads essay text. Payloads are deleted together
-- with their evaluation (explicitly by the application and by ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  theme TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  total_score INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 1000),
  c1 INTEGER NOT NULL CHECK (c1 IN (0, 40, 80, 120, 160, 200)),
  c2 INTEGER NOT NULL CHECK (c2 IN (0, 40, 80, 120, 160, 200)),
  c3 INTEGER NOT NULL CHECK (c3 IN (0, 40, 80, 120, 160, 200)),
  c4 INTEGER NOT NULL CHECK (c4 IN (0, 40, 80, 120, 160, 200)),
  c5 INTEGER NOT NULL CHECK (c5 IN (0, 40, 80, 120, 160, 200)),
  word_count INTEGER NOT NULL DEFAULT 0,
  model_id TEXT,
  rubric_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  parent_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('correction', 'import')),
  stored_at INTEGER NOT NULL,
  CHECK (total_score = c1 + c2 + c3 + c4 + c5)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_user_created
  ON evaluations (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_created
  ON evaluations (created_at);

CREATE TABLE IF NOT EXISTS evaluation_payloads (
  evaluation_id TEXT PRIMARY KEY NOT NULL
    REFERENCES evaluations(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);

-- Explicit, revocable consent for cloud history. No row = never consented.
CREATE TABLE IF NOT EXISTS history_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  cloud_enabled INTEGER NOT NULL DEFAULT 0 CHECK (cloud_enabled IN (0, 1)),
  consent_version INTEGER,
  consented_at INTEGER,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL
);
