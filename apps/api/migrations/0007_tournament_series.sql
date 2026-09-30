-- Adds an optional series container for qualifier and playoff tournaments.
CREATE TABLE competition_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE tournaments ADD COLUMN series_id INTEGER REFERENCES competition_series(id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN series_stage TEXT;
ALTER TABLE tournaments ADD COLUMN competition_type TEXT NOT NULL DEFAULT 'single' CHECK (competition_type IN ('single', 'series'));

CREATE INDEX idx_tournaments_series ON tournaments(series_id);
