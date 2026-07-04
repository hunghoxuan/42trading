ALTER TABLE users ADD COLUMN IF NOT EXISTS roles JSONB;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;
--> statement-breakpoint
UPDATE users
SET roles = CASE
  WHEN roles IS NOT NULL THEN roles
  WHEN LOWER(COALESCE(role, '')) = 'system' THEN '["admin"]'::jsonb
  WHEN LOWER(COALESCE(role, '')) = 'merchant' THEN '["seller"]'::jsonb
  WHEN LOWER(COALESCE(role, '')) = 'guest' THEN '["user"]'::jsonb
  WHEN LOWER(COALESCE(role, '')) = 'admin' THEN '["admin"]'::jsonb
  WHEN LOWER(COALESCE(role, '')) = 'seller' THEN '["seller"]'::jsonb
  WHEN LOWER(COALESCE(role, '')) = 'user' THEN '["user"]'::jsonb
  ELSE '["user"]'::jsonb
END
WHERE roles IS NULL;
--> statement-breakpoint
UPDATE users
SET permissions = '[]'::jsonb
WHERE permissions IS NULL;
