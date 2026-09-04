-- Adds a 'superuser' role scoped to specific tournaments ("seasons") via tournament_managers.
-- SQLite CHECK constraints require a table rebuild to change the allowed role values, and
-- D1 always enforces foreign keys (PRAGMA foreign_keys=OFF is not honored, and D1 disallows
-- temp tables), so tournaments' FK to users.id is nulled out and restored via a scratch
-- table around the rebuild instead.

CREATE TABLE _tournament_creators AS
  SELECT id, created_by FROM tournaments WHERE created_by IS NOT NULL;

UPDATE tournaments SET created_by = NULL;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('admin', 'organizer', 'superuser', 'player')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, email, name, password_hash, google_sub, role, created_at)
  SELECT id, email, name, password_hash, google_sub, role, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

UPDATE tournaments
  SET created_by = (SELECT created_by FROM _tournament_creators WHERE _tournament_creators.id = tournaments.id)
  WHERE id IN (SELECT id FROM _tournament_creators);

DROP TABLE _tournament_creators;

-- Assigns a superuser to one or more tournaments ("seasons") they may manage.
CREATE TABLE tournament_managers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tournament_id)
);
