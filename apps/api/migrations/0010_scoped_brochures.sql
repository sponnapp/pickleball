CREATE TABLE homepage_brochures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('tournament', 'series')),
  target_id INTEGER NOT NULL,
  title TEXT,
  brochure_path TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(target_type, target_id)
);

CREATE INDEX idx_homepage_brochures_target ON homepage_brochures(target_type, target_id);
