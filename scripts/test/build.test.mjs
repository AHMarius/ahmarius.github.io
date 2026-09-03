import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = path.resolve(process.cwd());

async function runBuild() {
  await exec('node', ['scripts/build-site.mjs'], { cwd: REPO });
}

// ---------- Canonical Devlog (aggregated from content/pages) ----------

test('build no longer generates a separate pages section', async () => {
  await runBuild();
  // Only the Devlog is produced; the standalone pages.html / pages/* are gone.
  await assert.rejects(fs.access(path.join(REPO, 'pages.html')));
});

test('devlog.html generates and is not an empty shell', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.match(html, /class="devlog-grid"/);
  // The grid must contain real cards, not an empty <div class="devlog-grid"></div>
  assert.match(html, /class="devlog-card"/);
});

test('devlog aggregates published posts from the canonical content hierarchy', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  // first-solver is a published post under content/pages/fluid-dynamics/posts
  assert.match(html, /First Solver/);
  assert.match(html, /devlog\/first-solver\.html/);
});

test('devlog generates individual static post pages', async () => {
  await runBuild();
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', 'first-solver.html'), 'utf8');
  assert.match(postHtml, /First Solver/);
  // The rendered Markdown content must be in the page, not a placeholder.
  assert.match(postHtml, /katex/);
  assert.match(postHtml, /assets\/css\/style\.css/);
});

test('draft posts do NOT appear in the public devlog', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.doesNotMatch(html, /HiddenDraftSecret/);
  // The draft's individual page must not have been generated.
  await assert.rejects(fs.access(path.join(REPO, 'devlog', 'hidden-draft-secret.html')));
});

test('nested devlog pages reference working relative asset paths', async () => {
  await runBuild();
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', 'first-solver.html'), 'utf8');
  assert.match(postHtml, /href="\.\.\/assets\/css\/style\.css"/);
  assert.match(postHtml, /src="\.\.\/assets\/js\/hero-fluid\.js"/);
  const indexHtml = await fs.readFile(path.join(REPO, 'devlog', 'index.html'), 'utf8');
  assert.match(indexHtml, /href="\.\.\/assets\/css\/style\.css"/);
});

test('build-site.mjs stays deterministic across repeated builds', async () => {
  await runBuild();
  const before = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  await runBuild();
  const after = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.equal(before, after);
});

test('legacy build-devlog.mjs entry point still runs standalone', async () => {
  await exec('node', ['scripts/build-devlog.mjs'], { cwd: REPO });
  await fs.access(path.join(REPO, 'devlog.html'));
});
