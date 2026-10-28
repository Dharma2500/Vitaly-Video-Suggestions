PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
    telegram_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT '',
    banned_at INTEGER NOT NULL,
    banned_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    source TEXT NOT NULL DEFAULT 'text',
    thumbnail_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'seen')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestions_status_created
    ON suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_telegram_id
    ON suggestions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_url_created
    ON suggestions(url, created_at DESC);

CREATE TABLE IF NOT EXISTS user_limits (
    telegram_id TEXT PRIMARY KEY,
    last_submission_at INTEGER NOT NULL,
    day_key TEXT NOT NULL,
    daily_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_telegram_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_telegram_id TEXT,
    suggestion_id TEXT,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
    ON admin_audit(created_at DESC);

-- Dedupe Telegram webhook retries so the same update cannot create duplicate suggestions.
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id INTEGER PRIMARY KEY,
    processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_updates_at
    ON processed_updates(processed_at);
