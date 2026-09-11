"use strict";

const TABLE_NAME = "media_yt_dlp_jobs";

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
`;

module.exports = { TABLE_NAME, sqliteSchema, postgresSchema };
