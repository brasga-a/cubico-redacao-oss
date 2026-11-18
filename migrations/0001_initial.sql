-- Migration 0001: Better Auth 1.7.x core schema + atomic usage/quota ledger for ENEM 2026

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ),
  updatedAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON user (email);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ),
  updatedAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ),
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token ON session (token);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ),
  updatedAt TEXT NOT NULL DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') )
);

CREATE INDEX IF NOT EXISTS idx_account_user_provider ON account (userId, providerId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_account ON account (providerId, accountId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ),
  updatedAt TEXT DEFAULT ( strftime('%Y-%m-%dT%H:%M:%fZ', 'now') )
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification (identifier);

-- Atomic usage & concurrency ledger (stores only operational metadata and token/cost counters, never essay text)
CREATE TABLE IF NOT EXISTS usage_ledger (
  request_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
  day_key TEXT NOT NULL,
  month_key TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thought_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_status_expires
  ON usage_ledger (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_status_expires
  ON usage_ledger (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_day_status
  ON usage_ledger (user_id, day_key, status);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_month_status
  ON usage_ledger (month_key, status);
