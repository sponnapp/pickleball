ALTER TABLE tournaments ADD COLUMN playoff_seeding TEXT NOT NULL DEFAULT 'score_reseed'
  CHECK (playoff_seeding IN ('score_reseed', 'fixed_bracket'));