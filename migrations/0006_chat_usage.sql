-- Experimental chat: per-user daily counters only (no message content).
-- Separate from usage_ledger, which accounts for essay corrections.
CREATE TABLE IF NOT EXISTS chat_usage (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thought_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_key)
);
