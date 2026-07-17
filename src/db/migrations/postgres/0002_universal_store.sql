CREATE TABLE IF NOT EXISTS object_entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  parent_id TEXT NULL,
  derived_from_id TEXT NULL,
  user_id TEXT NULL,
  owner_id TEXT NULL,
  owner_team_id TEXT NULL,
  slug TEXT NULL,
  title TEXT NULL,
  subtitle TEXT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  state TEXT NULL,
  category TEXT NULL,
  subtype TEXT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  access_level TEXT NOT NULL DEFAULT 'OWNER_ONLY',
  scope_type TEXT NOT NULL DEFAULT 'TENANT',
  scope_tenant_id TEXT NULL,
  scope_module TEXT NULL,
  scope_user_id TEXT NULL,
  lang TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  country_code TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  currency TEXT NULL,
  amount NUMERIC NULL,
  quantity DOUBLE PRECISION NULL,
  price NUMERIC NULL,
  balance NUMERIC NULL,
  image_url TEXT NULL,
  icon TEXT NULL,
  source_system TEXT NULL,
  source_id TEXT NULL,
  sync_status TEXT NULL,
  version_no INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  effective_from TIMESTAMPTZ NULL,
  effective_to TIMESTAMPTZ NULL,
  start_at TIMESTAMPTZ NULL,
  end_at TIMESTAMPTZ NULL,
  due_at TIMESTAMPTZ NULL,
  scheduled_at TIMESTAMPTZ NULL,
  search_text TEXT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entity_type, entity_key, lang)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_tenant_type
  ON object_entities (tenant_id, entity_type, status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_user
  ON object_entities (tenant_id, user_id, entity_type, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_owner
  ON object_entities (tenant_id, owner_id, entity_type, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_parent
  ON object_entities (tenant_id, parent_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_state
  ON object_entities (tenant_id, entity_type, state, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_lang_status
  ON object_entities (tenant_id, entity_type, lang, status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_search
  ON object_entities (tenant_id, entity_type, search_text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_scope
  ON object_entities (scope_type, scope_tenant_id, scope_module, visibility, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_scope_user
  ON object_entities (scope_type, scope_tenant_id, scope_module, scope_user_id, visibility, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_category
  ON object_entities (tenant_id, entity_type, category, subtype, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_schedule
  ON object_entities (tenant_id, status, scheduled_at, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_source
  ON object_entities (tenant_id, source_system, source_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_currency
  ON object_entities (tenant_id, entity_type, currency, status, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_entities_country
  ON object_entities (tenant_id, entity_type, country_code, status, updated_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS object_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  from_type TEXT NULL,
  to_type TEXT NULL,
  link_type TEXT NOT NULL,
  user_id TEXT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, from_entity_id, to_entity_id, link_type)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_links_from
  ON object_links (tenant_id, from_entity_id, link_type, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_links_to
  ON object_links (tenant_id, to_entity_id, link_type, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_links_from_status
  ON object_links (tenant_id, from_entity_id, link_type, status, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_links_to_status
  ON object_links (tenant_id, to_entity_id, link_type, status, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_links_user
  ON object_links (tenant_id, user_id, link_type, updated_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS object_journal (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_id TEXT NULL,
  entity_type TEXT NULL,
  entity_key TEXT NULL,
  user_id TEXT NULL,
  entry_type TEXT NOT NULL,
  direction TEXT NULL,
  amount NUMERIC NULL,
  currency TEXT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_entity
  ON object_journal (tenant_id, entity_id, happened_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_type_key
  ON object_journal (tenant_id, entity_type, entity_key, happened_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_user
  ON object_journal (tenant_id, user_id, happened_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_entry
  ON object_journal (tenant_id, entry_type, happened_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_entity_entry
  ON object_journal (tenant_id, entity_id, entry_type, happened_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_journal_type_entry
  ON object_journal (tenant_id, entity_type, entry_type, happened_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS object_processes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  process_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  entity_id TEXT NULL,
  entity_type TEXT NULL,
  entity_key TEXT NULL,
  user_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  priority INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_processes_due
  ON object_processes (tenant_id, status, run_at, priority DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_processes_entity
  ON object_processes (tenant_id, entity_id, status, run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_processes_user
  ON object_processes (tenant_id, user_id, status, run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_processes_type
  ON object_processes (tenant_id, process_type, status, run_at, priority DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_object_processes_topic
  ON object_processes (tenant_id, topic, status, run_at, priority DESC);
