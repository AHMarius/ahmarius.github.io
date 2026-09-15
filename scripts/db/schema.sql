-- Local SQLite index for the ahmarius.github.io content pipeline.
--
-- This database is OPTIONAL and feature-gated. It is a pure cache/helper for
-- editors and tooling; it is NEVER used by the deployed site (the static build
-- reads Markdown + YAML frontmatter only). See docs/database.md for the
-- decision record and rationale.

-- Connection safety settings are applied by openIndex(). Keeping them out of
-- this schema makes applying the DDL safe even when a caller has a transaction
-- open for a migration or rebuild.

-- Canonical entry data mirror of content/pages/<page>/page.yml
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover       TEXT NOT NULL DEFAULT '',
  parent      TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  -- in-repo path of page.yml (repo-relative)
  path        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

-- Canonical post data mirror of content/pages/<page>/posts/<slug>.md
CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY,
  page           TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  title          TEXT NOT NULL,
  subtitle       TEXT NOT NULL DEFAULT '',
  excerpt        TEXT NOT NULL DEFAULT '',
  cover          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  featured       INTEGER NOT NULL DEFAULT 0,
  project        TEXT NOT NULL DEFAULT '',
  series         TEXT NOT NULL DEFAULT '',
  part           INTEGER NOT NULL DEFAULT 0,
  date           TEXT NOT NULL DEFAULT '',
  updated_date   TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '[]',   -- JSON array
  technologies   TEXT NOT NULL DEFAULT '[]',   -- JSON array
  body           TEXT NOT NULL DEFAULT '',
  -- repo-relative path of the markdown file
  file_path      TEXT NOT NULL DEFAULT '',
  UNIQUE (page, slug)
);

-- FTS5 search index over post text (title/excerpt/body).
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, subtitle, excerpt, body,
  content='posts', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, subtitle, excerpt, body)
  VALUES (new.id, new.title, new.subtitle, new.excerpt, new.body);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, subtitle, excerpt, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.excerpt, old.body);
END;

CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, subtitle, excerpt, body)
  VALUES ('delete', old.id, old.title, old.subtitle, old.excerpt, old.body);
  INSERT INTO posts_fts(rowid, title, subtitle, excerpt, body)
  VALUES (new.id, new.title, new.subtitle, new.excerpt, new.body);
END;

-- Convenience view: published posts with their FTS rank.
CREATE VIEW IF NOT EXISTS published_posts AS
SELECT p.id, p.page, p.slug, p.title, p.subtitle, p.excerpt,
       p.date, p.updated_date, p.project, p.tags, p.technologies,
       p.file_path,
       fts.rank
FROM posts p
JOIN posts_fts fts ON fts.rowid = p.id
WHERE p.status = 'published'
ORDER BY p.date DESC, p.id DESC;

-- Leak guard: drafts that are referenced by published pages/posts data
-- (e.g. a draft slug appearing in a published page). Mainly a diagnostic aid.
CREATE VIEW IF NOT EXISTS draft_leaks AS
SELECT p.page, p.slug, p.title, p.file_path
FROM posts p
WHERE p.status = 'draft'
  AND EXISTS (
    SELECT 1 FROM posts other
    WHERE other.status = 'published'
      AND other.page = p.page
      AND other.slug = p.slug
  );
