-- The lab is in La Mesa, CA (confirmed 2026-11-06): its calendar reads due
-- dates in Pacific time, matching LAB_TIMEZONE in packages/shared. Only the
-- seeded value moves; a zone staff already changed is left alone.
UPDATE "calendars" SET "timezone" = 'America/Los_Angeles' WHERE "key" = 'default' AND "timezone" = 'America/Chicago';
