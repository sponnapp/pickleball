CREATE TABLE tournament_managers_new (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  series_id INTEGER REFERENCES competition_series(id) ON DELETE CASCADE,
  CHECK ((tournament_id IS NOT NULL AND series_id IS NULL) OR (tournament_id IS NULL AND series_id IS NOT NULL))
);

INSERT INTO tournament_managers_new (user_id, tournament_id)
  SELECT user_id, tournament_id FROM tournament_managers;

DROP TABLE tournament_managers;
ALTER TABLE tournament_managers_new RENAME TO tournament_managers;

CREATE UNIQUE INDEX idx_tournament_managers_user_tournament
  ON tournament_managers(user_id, tournament_id) WHERE tournament_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tournament_managers_user_series
  ON tournament_managers(user_id, series_id) WHERE series_id IS NOT NULL;
CREATE INDEX idx_tournament_managers_series
  ON tournament_managers(series_id, user_id) WHERE series_id IS NOT NULL;