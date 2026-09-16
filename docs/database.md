# Database decision & local index

Status: **Implemented** — static deployment backed by build-time content
databases, plus an optional local post index for editor tooling.

## Decision

- The deployed site remains fully static and needs no live database server.
  The projects page is generated at build time from the committed SQLite
  catalog at `content/projects/catalog.sqlite3`; browsers receive the rendered
  HTML snapshot.
- A **local SQLite index** (`scripts/db/`) is available as a **feature-gated
  helper** for editor-side workflows: search over imported/edited posts before
  they are committed, verification that drafts never leak into search, and
  cheap lookups for the Admin App.
- The index is a **cache mirror** of the canonical source. It is never the
  source of truth and is never required by the site build. Losing it costs
  nothing; it can be rebuilt at any time with:

  ```sh
  node scripts/db/index.mjs ./local-index.db ./content
  ```

- Non-goals:
  - a client/server database for the site;
  - making SQLite the canonical article format (Markdown remains canonical for
    devlog posts; the portfolio project catalog is intentionally SQLite);
  - storing secrets or mutable editor state in this index.

## Why this is safe

- `package.json` has **zero new runtime dependencies**: the index uses only
  Node's built-in `node:sqlite` (stable in current Node, FTS5 enabled).
- Publish workflow never touches the database. `npm test` runs the DB tests,
  but `npm run build` and the Actions `build` step are unaffected.
- The index is disposable: `script/db/index.mjs` rebuilds it from
  `content/pages` in one pass.

## Portfolio projects catalog

`content/projects/catalog.sqlite3` is the canonical source for the cards that
appear on `projects.html`. `scripts/projects-db.mjs` reads the catalog and
regenerates the page from `content/projects/projects.template.html`. The same
database is opened read-only by the Tauri admin app, which renders the complete
project record, including its original long-form HTML, tags, links and gallery.
For Android, where there may be no local Git checkout, the build also writes
`admin-app/public/projects.json`; this bundled read-only snapshot is generated
from SQLite and is used only when the native database command is unavailable.

The one-time migration command is `npm run projects:migrate`; normal builds use
`npm run projects:build` (also invoked by `npm run build`). The migration stores
the full original `<article>` markup in `article_html`, so prose, lists and link
labels are retained verbatim rather than reconstructed from shortened fields.

## Local post-index schema

Canonical DDL lives in `scripts/db/schema.sql` and is applied by
`applySchema()`. Core tables:

- `pages` — mirror of each `content/pages/<page>/page.yml`
  (`slug`, `name`, `description`, `cover`, `parent`, `sort_order`, `path`).
- `posts` — mirror of each post's Markdown frontmatter
  (`page`, `slug`, `title`, `subtitle`, `excerpt`, `cover`, `status`,
  `featured`, `project`, `series`, `part`, `date`, `updated_date`, `tags`
  as JSON, `technologies` as JSON, `body`, `file_path`).
- `posts_fts` — FTS5 index over `title`, `subtitle`, `excerpt`, `body`,
  synced by `AFTER INSERT/UPDATE/DELETE` triggers on `posts`.
- `published_posts` — convenience view of published posts joined with rank.
- `draft_leaks` — diagnostic view of drafts colliding with a published slug,
  used by the "imported post is searchable" verification.
- `PRAGMA journal_mode = WAL` and foreign keys enabled.

## Local security controls

The index can contain unpublished draft text, so it is treated as private
local data. `openIndex()` refuses a symbolic-link database path and applies
owner-only (`0600`) permissions to on-disk caches. SQLite runs with foreign
keys, `trusted_schema=OFF`, `secure_delete=ON`, a five-second busy timeout,
WAL journaling, and full synchronous writes. All queries use bound parameters;
search results are capped at 100 and query text at 500 characters. Rebuilds
are transactional: a failed read leaves the previous index intact.

## Usage from code

```js
import { openIndex, applySchema, rebuildIndex, searchPosts, listPosts } from './scripts/db/index.mjs';

const db = openIndex(':memory:');
await applySchema(db);
await rebuildIndex(db, process.cwd() + '/content');

const hits = searchPosts(db, 'solver');          // published, FTS-ranked
const all = listPosts(db, { status: 'draft' });  // editor-only listing
```

## End-to-end verification (no GitHub, no Action)

`npm test` includes `scripts/test/db.test.mjs`, which:

1. writes a fresh post with `writePost()` (the same code path the editor uses);
2. rebuilds the index from that content directory;
3. asserts the imported post is immediately searchable via `searchPosts()`;
4. asserts drafts are listable but never searchable;
5. asserts deleted posts/pages are pruned;
6. verifies the schema applies cleanly and idempotently.

These run entirely on the local filesystem — no network, no GitHub, no CI.
