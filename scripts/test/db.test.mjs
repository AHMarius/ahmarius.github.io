import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { openIndex, applySchema, rebuildIndex, searchPosts, listPosts } from '../db/index.mjs';
import { writePost, readPost, deletePost } from '../content/posts.mjs';
import { atomicWrite } from '../content/posts.mjs';

async function makeTempContent() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahmarius-db-'));
  const pageDir = path.join(root, 'pages', 'fluid-dynamics');
  const postsDir = path.join(pageDir, 'posts');
  await fs.mkdir(postsDir, { recursive: true });
  await writePost(
    path.join(postsDir, 'first-solver.md'),
    {
      title: 'First Solver',
      slug: 'first-solver',
      date: '2026-09-01',
      status: 'published',
      page: 'fluid-dynamics',
      excerpt: 'An unsteady incompressible GPU fluid solver with vorticity confinement.',
      tags: ['GPGPU'],
      technologies: ['C++', 'Vulkan'],
      body: '# First Solver\n\nThis post describes the first GPU solver.',
    },
  );
  await atomicWrite(
    path.join(pageDir, 'page.yml'),
    [
      'name: "Fluid Dynamics"',
      'slug: "fluid-dynamics"',
      'description: "Simulation notes"',
    ].join('\n'),
  );
  return root;
}

test('index: schema applies cleanly and is idempotent', async () => {
  const db = openIndex(':memory:');
  await applySchema(db);
  await applySchema(db); // must not throw
  db.close();
});

test('index: on-disk caches are owner-only and reject symlink paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahmarius-db-security-'));
  const dbPath = path.join(root, 'index.sqlite');
  try {
    const db = openIndex(dbPath);
    await applySchema(db);
    db.close();
    const mode = (await fs.stat(dbPath)).mode & 0o777;
    assert.equal(mode, 0o600);

    const link = path.join(root, 'index-link.sqlite');
    await fs.symlink(dbPath, link);
    assert.throws(() => openIndex(link), /symbolic link/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: search bounds untrusted UI input', async () => {
  const root = await makeTempContent();
  try {
    const db = openIndex(':memory:');
    await applySchema(db);
    await rebuildIndex(db, root);
    assert.ok(searchPosts(db, 'solver', { limit: 9999 }).length <= 100);
    assert.deepEqual(searchPosts(db, 'solver', { limit: 0 }), []);
    assert.equal(searchPosts(db, 'x'.repeat(1000)).length, 0);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: rebuild imports a fresh content tree end-to-end', async () => {
  const root = await makeTempContent();
  try {
    const db = openIndex(':memory:');
    applySchema(db);
    await rebuildIndex(db, root);

    const all = listPosts(db);
    assert.equal(all.length, 1);
    assert.equal(all[0].slug, 'first-solver');
    assert.equal(all[0].status, 'published');
    assert.equal(all[0].page, 'fluid-dynamics');
    assert.deepEqual(JSON.parse(all[0].tags), ['GPGPU']);
    assert.deepEqual(JSON.parse(all[0].technologies), ['C++', 'Vulkan']);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: imported post is immediately available in search (no GitHub, no Action)', async () => {
  const root = await makeTempContent();
  try {
    const db = openIndex(':memory:');
    applySchema(db);
    await rebuildIndex(db, root);

    const hits = searchPosts(db, 'solver');
    assert.ok(hits.length >= 1, 'expected search to find the imported post');
    assert.equal(hits[0].slug, 'first-solver');

    // A query matching only draft-only words returns nothing.
    const none = searchPosts(db, 'zzzz-absent');
    assert.equal(none.length, 0);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: draft posts are listable but never searchable', async () => {
  const root = await makeTempContent();
  try {
    const pageDir = path.join(root, 'pages', 'fluid-dynamics');
    const postsDir = path.join(pageDir, 'posts');
    await writePost(
      path.join(postsDir, 'secret-draft.md'),
      {
        title: 'Secret Draft',
        slug: 'secret-draft',
        date: '2026-09-10',
        status: 'draft',
        page: 'fluid-dynamics',
        body: '# Draft that must not leak into search',
      },
    );

    const db = openIndex(':memory:');
    applySchema(db);
    await rebuildIndex(db, root);

    const all = listPosts(db);
    assert.equal(all.length, 2);
    const draftHits = searchPosts(db, 'secret or draft or leak');
    assert.equal(draftHits.length, 0, 'drafts must never surface in search');
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: deleting a post removes it from the index and search', async () => {
  const root = await makeTempContent();
  try {
    const postsDir = path.join(root, 'pages', 'fluid-dynamics', 'posts');
    const db = openIndex(':memory:');
    applySchema(db);
    await rebuildIndex(db, root);
    assert.equal(listPosts(db).length, 1);

    await deletePost(path.join(postsDir, 'first-solver.md'));
    await rebuildIndex(db, root);

    assert.equal(listPosts(db).length, 0);
    assert.equal(searchPosts(db, 'solver').length, 0);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: pages that disappear are pruned from the index', async () => {
  const root = await makeTempContent();
  try {
    const db = openIndex(':memory:');
    applySchema(db);
    await rebuildIndex(db, root);
    assert.equal(listPosts(db).length, 1);

    await fs.rm(path.join(root, 'pages', 'fluid-dynamics'), { recursive: true, force: true });
    await rebuildIndex(db, root);

    assert.equal(listPosts(db).length, 0);
    const pages = db.prepare("SELECT slug FROM pages WHERE slug = 'fluid-dynamics'").all();
    assert.equal(pages.length, 0);
    db.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('index: readPost round-trip after write is stable', async () => {
  const root = await makeTempContent();
  try {
    const postsDir = path.join(root, 'pages', 'fluid-dynamics', 'posts');
    const file = path.join(postsDir, 'first-solver.md');
    const before = await readPost(file);
    await writePost(file, before);
    const after = await readPost(file);
    assert.equal(after.title, before.title);
    assert.equal(after.slug, before.slug);
    assert.equal(after.body, before.body);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
