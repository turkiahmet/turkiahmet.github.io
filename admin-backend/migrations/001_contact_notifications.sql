-- Idempotent addition for an existing private D1 database. Does not copy, expose, or delete messages.
-- Existing contacts are intentionally not counted as new arrivals.
INSERT OR IGNORE INTO settings(key,value) VALUES('contact_notification_sequence','0');
INSERT OR IGNORE INTO settings(key,value) VALUES('contact_notification_latest_at','');
CREATE TRIGGER IF NOT EXISTS contacts_notification_counter AFTER INSERT ON contacts
BEGIN
 UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='contact_notification_sequence';
 UPDATE settings SET value=CAST(NEW.created_at AS TEXT) WHERE key='contact_notification_latest_at';
END;
