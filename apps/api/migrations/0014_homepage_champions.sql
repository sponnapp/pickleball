CREATE TABLE homepage_champion_tournaments (
  tournament_id INTEGER PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);