import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { findPageDirectories, readPageMeta, getPageTree } from '../content/pages.mjs';
import { readPost } from '../content/posts.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(MODULE_DIR, 'schema.sql');

/**
 * Open (creating if needed) the local index database at `dbPath`.
 * Returns a connected DatabaseSync handle.
 */
export function openIndex(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

/**
 * Apply the canonical schema from schema.sql to an open database.
 */
export async function applySchema(db) {
  const sql = await fs.readFile(SCHEMA_PATH, 'utf8');
  db.exec(sql);
}

/**
 * Rebuild the entire local index from content in `contentRoot`.
 * Uses the canonical Markdown source; the DB stays a pure cache.
 */
export async function rebuildIndex(db, contentRoot) {
  const pagesRoot = path.join(contentRoot, 'pages');
  const pages = await getPageTree(pagesRoot, false);
  const postsByDir = await collectPosts(pagesRoot);

  const pageSlugs = new Set();

  const upsertPage = db.prepare(`
    INSERT INTO pages (slug, name, description, cover, parent, sort_order, path, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      cover = excluded.cover,
      parent = excluded.parent,
      sort_order = excluded.sort_order,
      path = excluded.path,
      updated_at = excluded.updated_at
  `);

  const deletePostsFor = db.prepare('DELETE FROM posts WHERE page = ?');
  const insertPost = db.prepare(`
    INSERT INTO posts
      (page, slug, title, subtitle, excerpt, cover, status, featured,
       project, series, part, date, updated_date, tags, technologies, body, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');

  // Upsert all pages.
  for (const page of pages) {
    pageSlugs.add(page.slug);
    const relPath = path.relative(contentRoot, page.dir).replace(/\\/g, '/');
    const meta = await safePageMeta(page.dir);
    upsertPage.run(
      page.slug,
      page.name,
      page.description,
      meta.cover || page.cover || '',
      page.parent || page.parentPath || null,
      page.order,
      relPath,
      new Date().toISOString(),
    );
  }

  // Strips pages that no longer exist so renames/removals propagate.
  const allPages = db.prepare('SELECT slug FROM pages').all();
  const deletePage = db.prepare('DELETE FROM pages WHERE slug = ?');
  for (const row of allPages) {
    if (!pageSlugs.has(row.slug)) {
      deletePostsFor.run(row.slug);
      deletePage.run(row.slug);
    }
  }

  // Insert (or refresh) posts under each page.
  for (const page of pages) {
    deletePostsFor.run(page.slug);
    const posts = postsByDir.get(page.dir) || [];
    for (const post of posts) {
      const relPath = path.relative(contentRoot, post.path).replace(/\\/g, '/');
      insertPost.run(
        page.slug,
        post.slug,
        post.title,
        post.subtitle,
        post.excerpt,
        post.cover,
        post.status,
        post.featured ? 1 : 0,
        post.project,
        post.series,
        post.part || 0,
        post.date,
        post.updatedDate,
        JSON.stringify(post.tags),
        JSON.stringify(post.technologies),
        post.body,
        relPath,
      );
    }
  }

  // Post counts come from the posts table itself, nothing further needed.
  db.exec('COMMIT');
}

async function collectPosts(pagesRoot) {
  const dirs = await findPageDirectories(pagesRoot);
  const byDir = new Map();
  for (const { dir } of dirs) {
    const postsDir = path.join(dir, 'posts');
    const posts = [];
    let entries = [];
    try {
      entries = await fs.readdir(postsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      try {
        const post = await readPost(path.join(postsDir, entry.name));
        posts.push(post);
      } catch {
        // skip unreadable
      }
    }
    // Sort newest first so the editor can rank trivially.
    posts.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    byDir.set(dir, posts);
  }
  return byDir;
}

async function safePageMeta(dir) {
  try {
    const { meta } = await readPageMeta(dir);
    return meta;
  } catch {
    return {};
  }
}

/**
 * Search the local index. Returns published posts that match `query`.
 * Prefers the FTS5 index; falls back to a plain LIKE scan when a query
 * string trips FTS5's query grammar (e.g. stray `-`, unbalanced quotes).
 */
export function searchPosts(db, query, { limit = 25, page = null } = {}) {
  const terms = query.trim();
  if (!terms) return [];
  const extra = page ? ' AND p.page = ?' : '';
  const suffix = page ? [' ORDER BY match_rank LIMIT ?', page] : [' ORDER BY match_rank LIMIT ?'];
  const full = limit;

  try {
    const safe = terms.replace(/"/g, '""');
    const sql = `
      SELECT p.id, p.page, p.slug, p.title, p.subtitle, p.excerpt,
             p.date, p.cover, p.project, p.tags, p.technologies,
             p.file_path,
             fts.rank AS match_rank
      FROM posts p
      JOIN posts_fts fts ON fts.rowid = p.id
      WHERE p.status = 'published' AND posts_fts MATCH ?${extra}
      ORDER BY match_rank
      LIMIT ?
    `;
    const args = [safe];
    if (page) args.push(page);
    args.push(full);
    return db.prepare(sql).all(...args);
  } catch {
    // FTS5 grammar error — degrade to substring matching.
    const like = `%${terms.replace(/[%_\\]/g, '')}%`;
    let sql = `
      SELECT p.id, p.page, p.slug, p.title, p.subtitle, p.excerpt,
             p.date, p.cover, p.project, p.tags, p.technologies,
             p.file_path,
             0 AS match_rank
      FROM posts p
      WHERE p.status = 'published'
        AND (p.title LIKE ? OR p.excerpt LIKE ? OR lower(p.body) LIKE lower(?))${extra}
      ORDER BY p.date DESC
      LIMIT ?
    `;
    const args = [like, like, like];
    if (page) args.push(page);
    args.push(full);
    return db.prepare(sql).all(...args);
  }
}

/**
 * List posts (all statuses) for the editor, newest first.
 */
export function listPosts(db, { status = null, page = null } = {}) {
  let sql = `
    SELECT p.id, p.page, p.slug, p.title, p.subtitle, p.excerpt,
           p.date, p.updated_date, p.cover, p.project, p.status,
           p.tags, p.technologies, p.file_path
    FROM posts p
  `;
  const where = [];
  const args = [];
  if (status) {
    where.push('p.status = ?');
    args.push(status);
  }
  if (page) {
    where.push('p.page = ?');
    args.push(page);
  }
  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY p.date DESC, p.id DESC';
  return db.prepare(sql).all(...args);
}

/**
 * Expose a small CLI: `node scripts/db/index.mjs <dbPath> <contentRoot>`.
 * `dbPath` may be ':memory:' for testing.
 */
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const [dbPathArg = ':memory:', contentRootArg = process.cwd() + '/content'] = process.argv.slice(2);
  const dbPath = dbPathArg === ':memory:' ? dbPathArg : path.resolve(dbPathArg);
  const contentRoot = path.resolve(contentRootArg);
  const db = openIndex(dbPath);
  applySchema(db);
  await rebuildIndex(db, contentRoot);
  console.log(`Indexed ${listPosts(db).length} posts into ${dbPath}`);
  db.close();
}