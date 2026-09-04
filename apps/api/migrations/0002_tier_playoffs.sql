-- Adds tier classification (Platinum/Gold/Silver/Bronze) computed from pool-play
-- standings, and expands matches.bracket_type so tier playoff brackets can be stored.

ALTER TABLE teams ADD COLUMN tier TEXT;

CREATE TABLE matches_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL DEFAULT 'main' CHECK (
    bracket_type IN ('main', 'winners', 'losers', 'pool', 'platinum', 'gold', 'silver', 'bronze')
  ),
  round INTEGER NOT NULL,
  match_number INTEGER NOT NULL,
  team1_id INTEGER REFERENCES teams(id),
  team2_id INTEGER REFERENCES teams(id),
  court_id INTEGER REFERENCES courts(id),
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
  score_json TEXT,
  winner_id INTEGER REFERENCES teams(id),
  next_match_id INTEGER REFERENCES matches_new(id),
  next_match_slot INTEGER,
  loser_next_match_id INTEGER REFERENCES matches_new(id),
  loser_next_match_slot INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO matches_new SELECT * FROM matches;
DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;

CREATE INDEX idx_matches_tournament ON matches(tournament_id);
