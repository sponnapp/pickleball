-- Fixes "DELETE /api/teams/:id" failing with a FOREIGN KEY constraint error when a
-- team is still referenced by a match (team1_id/team2_id/winner_id). Deleting a team
-- now just clears those references on any matches that used it, instead of blocking
-- the delete (matching the court_id fix in 0003_court_delete_fk_fix.sql).

CREATE TABLE matches_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket_type TEXT NOT NULL DEFAULT 'main' CHECK (
    bracket_type IN ('main', 'winners', 'losers', 'pool', 'platinum', 'gold', 'silver', 'bronze')
  ),
  round INTEGER NOT NULL,
  match_number INTEGER NOT NULL,
  team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  court_id INTEGER REFERENCES courts(id) ON DELETE SET NULL,
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
  score_json TEXT,
  winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  next_match_id INTEGER REFERENCES matches_new(id),
  next_match_slot INTEGER,
  loser_next_match_id INTEGER REFERENCES matches_new(id),
  loser_next_match_slot INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stage INTEGER NOT NULL DEFAULT 1
);

INSERT INTO matches_new SELECT * FROM matches;
DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;

CREATE INDEX idx_matches_tournament ON matches(tournament_id);
