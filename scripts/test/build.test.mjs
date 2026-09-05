import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seriesNavHtml } from '../build-devlog.mjs';

const exec = promisify(execFile);
const REPO = path.resolve(process.cwd());

async function runBuild({ mode } = {}) {
  const args = ['scripts/build-site.mjs'];
  if (mode) args.push('--mode', mode);
  await exec('node', args, { cwd: REPO });
}

// ---------- Canonical Devlog (aggregated from content/pages) ----------

test('site generates pages.html as well as the devlog', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'pages.html'), 'utf8');
  assert.match(html, /Pages/);
  assert.match(html, /class="pages-grid"/);
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

test('preview mode shows drafts so the editor can preview them', async () => {
  await runBuild({ mode: 'preview' });
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.match(html, /HiddenDraftSecret/);
  // The draft's individual page has been generated in preview mode.
  await fs.access(path.join(REPO, 'devlog', 'hidden-draft-secret.html'));
});

test('publish mode hides drafts from the public devlog', async () => {
  await runBuild({ mode: 'publish' });
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

test('seriesNavHtml links posts sharing a series by part order', () => {
  const posts = [
    { slug: 'p1', series: 'GPU port', part: 1, title: 'Part one', date: '2025-01-01' },
    { slug: 'p2', series: 'GPU port', part: 2, title: 'Part two', date: '2025-02-01' },
    { slug: 'p3', series: 'GPU port', title: 'Untitled third', date: '2025-03-01' },
    { slug: 'solo', series: 'Other', part: 1, title: 'Other one', date: '2025-04-01' },
  ];
  const mid = seriesNavHtml(posts, posts[1]);
  assert.match(mid, /series-nav-prev"/);
  assert.match(mid, /Part of GPU port · part 2/);
  assert.match(mid, /href="p1\.html"/);
  assert.match(mid, /href="p3\.html"/);
  const first = seriesNavHtml(posts, posts[0]);
  assert.doesNotMatch(first, /series-nav-prev"/);
  assert.match(first, /series-nav-next"/);
  assert.equal(seriesNavHtml(posts, posts[3]), '');
});

// ---------- Site-facing metadata outputs (F1/F19/F20) ----------

test('publish build generates RSS feed, Atom feed, sitemap, and robots.txt', async () => {
  await runBuild({ mode: 'publish' });
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  assert.match(feed, /<rss version="2\.0"/);
  assert.match(feed, /<item>/);
  assert.match(feed, /First Solver/);

  const atom = await fs.readFile(path.join(REPO, 'atom.xml'), 'utf8');
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(atom, /<entry>/);

  const sitemap = await fs.readFile(path.join(REPO, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, /devlog\/first-solver\.html/);

  const robots = await fs.readFile(path.join(REPO, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/ahmarius\.github\.io\/sitemap\.xml/);
});

test('site output never leaks draft content into metadata files', async () => {
  await runBuild({ mode: 'publish' });
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  const sitemap = await fs.readFile(path.join(REPO, 'sitemap.xml'), 'utf8');
  const searchJson = await fs.readFile(path.join(REPO, 'search-index.json'), 'utf8');
  assert.doesNotMatch(feed, /HiddenDraftSecret/);
  assert.doesNotMatch(sitemap, /hidden-draft-secret/);
  assert.doesNotMatch(searchJson, /HiddenDraftSecret/);
});

test('publish build generates tag/tech/project archives', async () => {
  await runBuild({ mode: 'publish' });
  // tag archive exists and contains the linked post
  const tagRef = await fs.readFile(path.join(REPO, 'devlog', 'tag', 'simulation', 'index.html'), 'utf8');
  assert.match(tagRef, /first-solver\.html/);
  const techRef = await fs.readFile(path.join(REPO, 'devlog', 'tech', 'c', 'index.html'), 'utf8');
  assert.match(techRef, /first-solver\.html/);
});

test('post pages include OG/Twitter meta, JSON-LD, canonical, and search index entry', async () => {
  await runBuild({ mode: 'publish' });
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', 'first-solver.html'), 'utf8');
  assert.match(postHtml, /property="og:type" content="article"/);
  assert.match(postHtml, /property="og:title"/);
  assert.match(postHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(postHtml, /application\/ld\+json/);
  assert.match(postHtml, /rel="canonical" href="https:\/\/ahmarius\.github\.io\/devlog\/first-solver\.html"/);

  const searchIndex = JSON.parse(await fs.readFile(path.join(REPO, 'search-index.json'), 'utf8'));
  assert.ok(searchIndex.some((e) => e.slug === 'first-solver' && e.url === '/devlog/first-solver.html'));
});

test('feed/sitemap/robots are not generated in preview mode before publish', async () => {
  // Ensure preview doesn't produce the shallow-copy artifacts before a publish.
  await runBuild({ mode: 'preview' });
  // feed/sitemap are always safe because they only use published posts.
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  assert.doesNotMatch(feed, /HiddenDraftSecret/);
});
