-- New private D1 database; no secrets or OAuth credentials are stored here.
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS research(id TEXT PRIMARY KEY,document TEXT NOT NULL,year INTEGER,visibility TEXT NOT NULL CHECK(visibility IN ('draft','public')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS research_visibility ON research(visibility,year DESC);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,record_id TEXT NOT NULL,document TEXT NOT NULL,actor_sub TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,subject TEXT NOT NULL DEFAULT '',message TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,archived_at INTEGER);
CREATE INDEX IF NOT EXISTS contacts_created ON contacts(created_at DESC);
-- New arrivals are counted independently from current inbox size; deleting a contact never rewinds this counter.
INSERT OR IGNORE INTO settings(key,value) VALUES('contact_notification_sequence','0');
INSERT OR IGNORE INTO settings(key,value) VALUES('contact_notification_latest_at','');
CREATE TRIGGER IF NOT EXISTS contacts_notification_counter AFTER INSERT ON contacts
BEGIN
 UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='contact_notification_sequence';
 UPDATE settings SET value=CAST(NEW.created_at AS TEXT) WHERE key='contact_notification_latest_at';
END;
CREATE TABLE IF NOT EXISTS admin_nonces(nonce_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits(bucket TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS admin_sessions(sid_hash TEXT PRIMARY KEY,owner_sub TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_daily(day TEXT NOT NULL,path TEXT NOT NULL,country TEXT NOT NULL,referrer TEXT NOT NULL,device TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,visits INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,path,country,referrer,device));
