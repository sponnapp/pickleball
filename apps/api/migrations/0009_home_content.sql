CREATE TABLE homepage_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  brochure_visible INTEGER NOT NULL DEFAULT 1 CHECK (brochure_visible IN (0, 1)),
  brochure_path TEXT NOT NULL DEFAULT '/Tournament.jpeg',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO homepage_settings (id) VALUES (1);

CREATE TABLE homepage_sponsors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_homepage_sponsors_order ON homepage_sponsors(display_order, id);
