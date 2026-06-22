BEGIN;

ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS equity NUMERIC NULL;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS margin NUMERIC NULL;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS free_margin NUMERIC NULL;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS leverage NUMERIC NULL;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS broker_name TEXT NULL;

INSERT INTO user_accounts (
  account_id, user_id, name, balance, api_key_hash, api_key_last4,
  api_key_rotated_at, source_ids_cache, metadata, status,
  equity, margin, free_margin, leverage, broker_name,
  created_at, updated_at
)
SELECT
  a.account_id,
  a.user_id,
  a.name,
  a.balance,
  a.api_key_hash,
  a.api_key_last4,
  a.api_key_rotated_at,
  COALESCE(a.source_ids_cache, '[]'::jsonb),
  COALESCE(a.metadata, '{}'::jsonb),
  COALESCE(a.status, 'ACTIVE'),
  a.equity,
  a.margin,
  a.free_margin,
  a.leverage,
  a.broker_name,
  COALESCE(a.created_at, NOW()),
  COALESCE(a.updated_at, NOW())
FROM accounts a
WHERE a.account_id IS NOT NULL
ON CONFLICT (account_id) DO UPDATE SET
  user_id = COALESCE(EXCLUDED.user_id, user_accounts.user_id),
  name = COALESCE(NULLIF(EXCLUDED.name, ''), user_accounts.name),
  balance = COALESCE(EXCLUDED.balance, user_accounts.balance),
  api_key_hash = COALESCE(EXCLUDED.api_key_hash, user_accounts.api_key_hash),
  api_key_last4 = COALESCE(EXCLUDED.api_key_last4, user_accounts.api_key_last4),
  api_key_rotated_at = COALESCE(EXCLUDED.api_key_rotated_at, user_accounts.api_key_rotated_at),
  source_ids_cache = COALESCE(EXCLUDED.source_ids_cache, user_accounts.source_ids_cache),
  metadata = COALESCE(EXCLUDED.metadata, user_accounts.metadata),
  status = COALESCE(NULLIF(EXCLUDED.status, ''), user_accounts.status),
  equity = COALESCE(EXCLUDED.equity, user_accounts.equity),
  margin = COALESCE(EXCLUDED.margin, user_accounts.margin),
  free_margin = COALESCE(EXCLUDED.free_margin, user_accounts.free_margin),
  leverage = COALESCE(EXCLUDED.leverage, user_accounts.leverage),
  broker_name = COALESCE(NULLIF(EXCLUDED.broker_name, ''), user_accounts.broker_name),
  updated_at = GREATEST(COALESCE(EXCLUDED.updated_at, user_accounts.updated_at), user_accounts.updated_at);

WITH mapped_trade_accounts AS (
  SELECT t.sid, ua.account_id
  FROM trades t
  JOIN LATERAL (
    SELECT account_id
    FROM user_accounts
    WHERE user_id = t.user_id
      AND COALESCE(status, 'ACTIVE') <> 'ARCHIVED'
    ORDER BY created_at ASC, account_id ASC
    LIMIT 1
  ) ua ON TRUE
  WHERE t.account_id = ''
)
UPDATE trades t
SET account_id = m.account_id
FROM mapped_trade_accounts m
WHERE t.sid = m.sid;

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_account_id_fkey;

DROP TABLE IF EXISTS accounts;
DROP SEQUENCE IF EXISTS accounts_id_seq;

COMMIT;
