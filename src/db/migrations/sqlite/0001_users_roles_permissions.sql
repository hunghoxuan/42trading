ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT;
--> statement-breakpoint
UPDATE users
SET roles = CASE
  WHEN roles IS NOT NULL AND TRIM(roles) <> '' THEN roles
  WHEN LOWER(COALESCE(role, '')) = 'system' THEN '["admin"]'
  WHEN LOWER(COALESCE(role, '')) = 'merchant' THEN '["seller"]'
  WHEN LOWER(COALESCE(role, '')) = 'guest' THEN '["user"]'
  WHEN LOWER(COALESCE(role, '')) = 'admin' THEN '["admin"]'
  WHEN LOWER(COALESCE(role, '')) = 'seller' THEN '["seller"]'
  WHEN LOWER(COALESCE(role, '')) = 'user' THEN '["user"]'
  ELSE '["user"]'
END
WHERE roles IS NULL OR TRIM(roles) = '';
--> statement-breakpoint
UPDATE users
SET permissions = '[]'
WHERE permissions IS NULL OR TRIM(permissions) = '';
