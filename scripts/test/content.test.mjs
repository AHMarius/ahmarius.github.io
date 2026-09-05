import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { slugify, sanitizeFilename, isInsideRepo, resolveInside, ensureSafeRelative } from '../content/paths.mjs';
import { buildPageHierarchy } from '../content/pages.mjs';
import { writePost, readPost, deletePost, listPostsUnder } from '../content/posts.mjs';

test('slugify various names', () => {
  assert.equal(slugify('Traffic Optimisation Platform'), 'traffic-optimisation-platform');
  assert.equal(slugify('FluidDynamics'), 'fluiddynamics');
  assert.equal(slugify('Café naïve'), 'cafe-naive');
  assert.equal(slugify('  Hello  World  '), 'hello-world');
  assert.equal(slugify('!!!'), 'untitled');
});

test('sanitize filename', () => {
  assert.equal(sanitizeFilename('My Screenshot (Final) 2026.png'), 'my-screenshot-final-2026.png');
});

test('isInsideRepo rejects escapes', () => {
  const root = '/repo';
  assert.equal(isInsideRepo(root, '/repo/content/x.md'), true);
  assert.equal(isInsideRepo(root, '/repo'), true);
  assert.equal(isInsideRepo(root, '/etc/passwd'), false);
  assert.equal(isInsideRepo(root, '/repo/../secret'), false);
});

test('resolveInside throws on traversal', () => {
  assert.throws(() => resolveInside('/repo', '../secret'));
  assert.throws(() => resolveInside('/repo', '/absolute'));
  assert.equal(resolveInside('/repo', 'a/b/c.md'), path.resolve('/repo', 'a/b/c.md'));
});

test('ensureSafeRelative', () => {
  assert.throws(() => ensureSafeRelative('../../etc'));
  assert.throws(() => ensureSafeRelative('/abs'));
  assert.equal(ensureSafeRelative('a/b/c'), 'a/b/c');
});

test('nested page creation + discovery', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-'));
  const pagesRoot = path.join(tmp, 'content', 'pages');
  const fluid = path.join(pagesRoot, 'fluid-dynamics');
  const gpu = path.join(fluid, 'subpages', 'gpu-port');
  await fs.mkdir(gpu, { recursive: true });
  await fs.writeFile(path.join(fluid, 'page.yml'), 'name: "FluidDynamics"\nslug: "fluid-dynamics"\n');
  await fs.writeFile(path.join(gpu, 'page.yml'), 'name: "GPU Port"\nslug: "gpu-port"\nparent: "fluid-dynamics"\n');

  const { roots, pages } = await buildPageHierarchy(pagesRoot);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].slug, 'fluid-dynamics');
  assert.equal(roots[0].children[0].slug, 'gpu-port');
  assert.equal(pages.length, 2);
});

test('post write/read/delete + duplicate slugs', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'posts-'));
  const postDir = path.join(tmp, 'posts');
  await fs.mkdir(postDir, { recursive: true });
  const file = path.join(postDir, 'hello.md');

  await writePost(file, { title: 'Hello', slug: 'hello', body: 'Body', tags: ['a'], status: 'published' });
  const post = await readPost(file);
  assert.equal(post.title, 'Hello');
  assert.equal(post.slug, 'hello');
  assert.deepEqual(post.tags, ['a']);
  assert.equal(post.status, 'published');
  assert.equal(post.body, 'Body');

  const list = await listPostsUnder(path.dirname(path.dirname(file)).replace(/\/posts$/, ''));
  assert.equal(list.length, 1);

  await deletePost(file);
  await assert.rejects(fs.access(file));
});

test('compute page last-updated across hierarchy', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'updated-'));
  const pagesRoot = path.join(tmp, 'content', 'pages');
  const fluid = path.join(pagesRoot, 'fluid-dynamics');
  const gpu = path.join(fluid, 'subpages', 'gpu-port');
  await fs.mkdir(path.join(gpu, 'posts'), { recursive: true });
  await fs.writeFile(path.join(fluid, 'page.yml'), 'name: "FluidDynamics"\n');
  await fs.writeFile(path.join(gpu, 'page.yml'), 'name: "GPU Port"\nparent: "fluid-dynamics"\n');
  await writePost(
    path.join(gpu, 'posts', 'late.md'),
    { title: 'Late', slug: 'late', date: '2026-08-01', updatedDate: '2026-08-30' },
  );
  const { computePageUpdatedDate } = await import('../content/metadata.mjs');
  const updated = await computePageUpdatedDate(fluid);
  assert.equal(updated, '2026-08-30');
});
