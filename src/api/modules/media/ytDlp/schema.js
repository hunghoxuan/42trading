"use strict";

const TABLE_NAME = "media_yt_dlp_jobs";
const PUBLISH_TABLE_NAME = "media_publish_jobs";

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sid TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT,
    extractor TEXT,
    media_kind TEXT NOT NULL,
    requested_format TEXT NOT NULL,
    status TEXT NOT NULL,
    progress NUMERIC NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    speed_text TEXT,
    eta_text TEXT,
    output_files_json TEXT NOT NULL DEFAULT '[]',
    options_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_media_yt_dlp_jobs_user_created
    ON ${TABLE_NAME}(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_yt_dlp_jobs_status
    ON ${TABLE_NAME}(status);
  CREATE TABLE IF NOT EXISTS ${PUBLISH_TABLE_NAME} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sid TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    job_sid TEXT NOT NULL REFERENCES ${TABLE_NAME}(sid) ON DELETE CASCADE,
    file_index INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL,
    account_label TEXT,
    title TEXT NOT NULL,
    description TEXT,
    privacy TEXT NOT NULL,
    status TEXT NOT NULL,
    progress NUMERIC NOT NULL DEFAULT 0,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    remote_id TEXT,
    remote_url TEXT,
    error_message TEXT,
    options_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_publish_jobs_due
    ON ${PUBLISH_TABLE_NAME}(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_media_publish_jobs_user_created
    ON ${PUBLISH_TABLE_NAME}(user_id, created_at DESC);
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    id BIGSERIAL PRIMARY KEY,
    sid TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT,
    extractor TEXT,
    media_kind TEXT NOT NULL,
    requested_format TEXT NOT NULL,
    status TEXT NOT NULL,
    progress NUMERIC NOT NULL DEFAULT 0,
    downloaded_bytes BIGINT NOT NULL DEFAULT 0,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    speed_text TEXT,
    eta_text TEXT,
    output_files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_media_yt_dlp_jobs_user_created
    ON ${TABLE_NAME}(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_yt_dlp_jobs_status
    ON ${TABLE_NAME}(status);
  CREATE TABLE IF NOT EXISTS ${PUBLISH_TABLE_NAME} (
    id BIGSERIAL PRIMARY KEY,
    sid TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    job_sid TEXT NOT NULL REFERENCES ${TABLE_NAME}(sid) ON DELETE CASCADE,
    file_index INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL,
    account_label TEXT,
    title TEXT NOT NULL,
    description TEXT,
    privacy TEXT NOT NULL,
    status TEXT NOT NULL,
    progress NUMERIC NOT NULL DEFAULT 0,
    scheduled_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    remote_id TEXT,
    remote_url TEXT,
    error_message TEXT,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_publish_jobs_due
    ON ${PUBLISH_TABLE_NAME}(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_media_publish_jobs_user_created
    ON ${PUBLISH_TABLE_NAME}(user_id, created_at DESC);
`;

module.exports = { TABLE_NAME, PUBLISH_TABLE_NAME, sqliteSchema, postgresSchema };
