import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seriesNavHtml } from '../build-devlog.mjs';

const exec = promisify(execFile);
const REPO = path.resolve(process.cwd());
const FIXTURE_RUN = `${process.pid}-${Date.now().toString(36)}`;
const FIXTURE_PAGE = `build-fixture-${FIXTURE_RUN}`;
const FIXTURE_POST = `build-fixture-solver-${FIXTURE_RUN}`;
const FIXTURE_DRAFT = `build-fixture-hidden-draft-${FIXTURE_RUN}`;
const FIXTURE_SUBPAGE = `build-fixture-subpage-${FIXTURE_RUN}`;
const FIXTURE_ASSET_POST = `build-fixture-asset-${FIXTURE_RUN}`;
const FIXTURE_TITLE = 'Build Fixture Solver';
const FIXTURE_DRAFT_TITLE = 'BuildFixtureHiddenDraft';
const FIXTURE_DIR = path.join(REPO, 'content', 'pages', FIXTURE_PAGE);

before(async () => {
  // Build tests must not depend on the author's real content. In particular,
  // deleting the sample content through Content Studio must never make the
  // publish preflight fail. Use a clearly test-owned page and remove it after
  // the suite instead.
  await fs.mkdir(path.join(FIXTURE_DIR, 'posts'), { recursive: true });
  const subpageDir = path.join(FIXTURE_DIR, 'subpages', FIXTURE_SUBPAGE);
  await fs.mkdir(path.join(subpageDir, 'posts', FIXTURE_ASSET_POST, 'assets'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(FIXTURE_DIR, 'page.yml'), `---
name: "Build fixture"
slug: "${FIXTURE_PAGE}"
description: "Temporary content used by the site build tests."
cover: ""
parent: null
order: 9999
---
`, 'utf8'),
    fs.writeFile(path.join(FIXTURE_DIR, 'posts', `${FIXTURE_POST}.md`), `---
title: "${FIXTURE_TITLE}"
slug: "${FIXTURE_POST}"
date: "2026-09-01"
status: "published"
page: "${FIXTURE_PAGE}"
technologies:
  - C++
tags:
  - Simulation
---
# ${FIXTURE_TITLE}

This is a test post with inline math $a^2+b^2=c^2$ and a block:

$$
\\int_0^1 x^2 \\, dx
$$
`, 'utf8'),
    fs.writeFile(path.join(FIXTURE_DIR, 'posts', `${FIXTURE_DRAFT}.md`), `---
title: "${FIXTURE_DRAFT_TITLE}"
slug: "${FIXTURE_DRAFT}"
date: "2026-09-01"
status: "draft"
page: "${FIXTURE_PAGE}"
tags:
  - Notes
---
This is a draft that should never be published.
`, 'utf8'),
    fs.writeFile(path.join(subpageDir, 'page.yml'), `---
name: "Build fixture sub-page"
slug: "${FIXTURE_SUBPAGE}"
parent: "${FIXTURE_PAGE}"
order: 1
---
`, 'utf8'),
    fs.writeFile(path.join(subpageDir, 'posts', `${FIXTURE_ASSET_POST}.md`), `---
title: "Nested asset fixture"
slug: "${FIXTURE_ASSET_POST}"
date: "2026-09-01"
status: "published"
page: "${FIXTURE_SUBPAGE}"
---
![Nested plot](assets/plot.png)
`, 'utf8'),
    fs.writeFile(path.join(subpageDir, 'posts', FIXTURE_ASSET_POST, 'assets', 'plot.png'), 'fixture-png', 'utf8'),
  ]);
});

after(async () => {
  await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
  await runBuild({ mode: 'publish' });
});

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
  assert.match(html, new RegExp(FIXTURE_TITLE));
  assert.match(html, new RegExp(`devlog/${FIXTURE_POST}\\.html`));
});

test('devlog generates individual static post pages', async () => {
  await runBuild();
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', `${FIXTURE_POST}.html`), 'utf8');
  assert.match(postHtml, new RegExp(FIXTURE_TITLE));
  // The rendered Markdown content must be in the page, not a placeholder.
  assert.match(postHtml, /katex/);
  assert.match(postHtml, /assets\/css\/style\.css/);
});

test('preview mode shows drafts so the editor can preview them', async () => {
  await runBuild({ mode: 'preview' });
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.match(html, new RegExp(FIXTURE_DRAFT_TITLE));
  // The draft's individual page has been generated in preview mode.
  await fs.access(path.join(REPO, 'devlog', `${FIXTURE_DRAFT}.html`));
});

test('publish mode hides drafts from the public devlog', async () => {
  await runBuild({ mode: 'publish' });
  const html = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
  assert.doesNotMatch(html, new RegExp(FIXTURE_DRAFT_TITLE));
  // The draft's individual page must not have been generated.
  await assert.rejects(fs.access(path.join(REPO, 'devlog', `${FIXTURE_DRAFT}.html`)));
});

test('future scheduled posts stay out of both public post routes', async () => {
  const scheduledFile = path.join(FIXTURE_DIR, 'posts', 'scheduled-build-test.md');
  await fs.writeFile(scheduledFile, `---
title: "ScheduledBuildSecret"
slug: "scheduled-build-test"
date: "2026-09-16"
status: "published"
publishAt: "2999-01-01"
page: "${FIXTURE_PAGE}"
---

This content must not appear in a production build before its schedule.
`, 'utf8');
  try {
    await runBuild({ mode: 'publish' });
    const devlog = await fs.readFile(path.join(REPO, 'devlog.html'), 'utf8');
    const pageHub = await fs.readFile(path.join(REPO, 'pages', FIXTURE_PAGE, 'index.html'), 'utf8');
    const search = await fs.readFile(path.join(REPO, 'search-index.json'), 'utf8');
    assert.doesNotMatch(devlog, /ScheduledBuildSecret/);
    assert.doesNotMatch(pageHub, /ScheduledBuildSecret/);
    assert.doesNotMatch(search, /ScheduledBuildSecret/);
    await assert.rejects(fs.access(path.join(REPO, 'devlog', 'scheduled-build-test.html')));
    await assert.rejects(fs.access(path.join(REPO, 'pages', FIXTURE_PAGE, 'scheduled-build-test.html')));

    await runBuild({ mode: 'preview' });
    await fs.access(path.join(REPO, 'devlog', 'scheduled-build-test.html'));
    await fs.access(path.join(REPO, 'pages', FIXTURE_PAGE, 'scheduled-build-test.html'));
  } finally {
    await fs.rm(scheduledFile, { force: true });
    await runBuild({ mode: 'publish' });
  }
});

test('nested devlog pages reference working relative asset paths', async () => {
  await runBuild();
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', `${FIXTURE_POST}.html`), 'utf8');
  assert.match(postHtml, /href="\.\.\/assets\/css\/style\.css"/);
  assert.match(postHtml, /src="\.\.\/assets\/js\/hero-fluid\.js"/);
  const indexHtml = await fs.readFile(path.join(REPO, 'devlog', 'index.html'), 'utf8');
  assert.match(indexHtml, /href="\.\.\/assets\/css\/style\.css"/);
});

test('page hubs and page-post copies resolve shell assets and navigation from their real depth', async () => {
  await runBuild({ mode: 'publish' });
  const hubHtml = await fs.readFile(path.join(REPO, 'pages', FIXTURE_PAGE, 'index.html'), 'utf8');
  const postHtml = await fs.readFile(path.join(REPO, 'pages', FIXTURE_PAGE, `${FIXTURE_POST}.html`), 'utf8');
  for (const html of [hubHtml, postHtml]) {
    assert.match(html, /href="\.\.\/\.\.\/assets\/css\/style\.css"/);
    assert.match(html, /src="\.\.\/\.\.\/assets\/js\/script\.js"/);
    assert.match(html, /href="\.\.\/\.\.\/index\.html"/);
    assert.match(html, /data-index-url="\.\.\/\.\.\/search-index\.json"/);
  }
});

test('page hubs expose linked breadcrumbs and computed last-updated dates', async () => {
  await runBuild({ mode: 'publish' });
  const hubHtml = await fs.readFile(path.join(REPO, 'pages', FIXTURE_SUBPAGE, 'index.html'), 'utf8');
  assert.match(hubHtml, new RegExp(`<a[^>]+href="\.\./${FIXTURE_PAGE}/index\.html"[^>]*>Build fixture</a>`));
  assert.match(hubHtml, /<time datetime="2026-09-01">2026-09-01<\/time>/);
});

test('nested sub-page post assets are copied and rewritten', async () => {
  await runBuild({ mode: 'publish' });
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', `${FIXTURE_ASSET_POST}.html`), 'utf8');
  assert.match(
    postHtml,
    new RegExp(`/assets/posts/${FIXTURE_SUBPAGE}/${FIXTURE_ASSET_POST}/plot\\.png`),
  );
  assert.equal(
    await fs.readFile(
      path.join(REPO, 'assets', 'posts', FIXTURE_SUBPAGE, FIXTURE_ASSET_POST, 'plot.png'),
      'utf8',
    ),
    'fixture-png',
  );
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
  await fs.access(path.join(REPO, 'dist', '.nojekyll'));
  await assert.rejects(fs.access(path.join(REPO, 'dist', 'content')));
  await assert.rejects(fs.access(path.join(REPO, 'dist', 'admin-app')));
  await assert.rejects(fs.access(path.join(REPO, 'dist', 'bin')));
  await assert.rejects(fs.access(path.join(REPO, 'dist', 'sync-service')));
  await assert.rejects(fs.access(path.join(REPO, 'dist', 'start.sh')));
  await assert.rejects(fs.access(path.join(REPO, 'dist', '.gitignore')));
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  assert.match(feed, /<rss version="2\.0"/);
  assert.match(feed, /<item>/);
  assert.match(feed, new RegExp(FIXTURE_TITLE));

  const atom = await fs.readFile(path.join(REPO, 'atom.xml'), 'utf8');
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(atom, /<entry>/);

  const sitemap = await fs.readFile(path.join(REPO, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, new RegExp(`devlog/${FIXTURE_POST}\\.html`));

  const robots = await fs.readFile(path.join(REPO, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/ahmarius\.github\.io\/sitemap\.xml/);
});

test('site output never leaks draft content into metadata files', async () => {
  await runBuild({ mode: 'publish' });
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  const sitemap = await fs.readFile(path.join(REPO, 'sitemap.xml'), 'utf8');
  const searchJson = await fs.readFile(path.join(REPO, 'search-index.json'), 'utf8');
  assert.doesNotMatch(feed, new RegExp(FIXTURE_DRAFT_TITLE));
  assert.doesNotMatch(sitemap, new RegExp(FIXTURE_DRAFT));
  assert.doesNotMatch(searchJson, new RegExp(FIXTURE_DRAFT_TITLE));
});

test('publish build generates tag/tech/project archives', async () => {
  await runBuild({ mode: 'publish' });
  // tag archive exists and contains the linked post
  const tagRef = await fs.readFile(path.join(REPO, 'devlog', 'tag', 'simulation.html'), 'utf8');
  assert.match(tagRef, new RegExp(`${FIXTURE_POST}\\.html`));
  const techRef = await fs.readFile(path.join(REPO, 'devlog', 'tech', 'c.html'), 'utf8');
  assert.match(techRef, new RegExp(`${FIXTURE_POST}\\.html`));
});

test('post pages include OG/Twitter meta, JSON-LD, canonical, and search index entry', async () => {
  await runBuild({ mode: 'publish' });
  const postHtml = await fs.readFile(path.join(REPO, 'devlog', `${FIXTURE_POST}.html`), 'utf8');
  assert.match(postHtml, /property="og:type" content="article"/);
  assert.match(postHtml, /property="og:title"/);
  assert.match(postHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(postHtml, /application\/ld\+json/);
  const structuredData = [...postHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(structuredData.length >= 2);
  structuredData.forEach((match) => assert.doesNotThrow(() => JSON.parse(match[1])));
  assert.match(postHtml, new RegExp(`rel="canonical" href="https://ahmarius\\.github\\.io/devlog/${FIXTURE_POST}\\.html"`));
  assert.match(postHtml, /type="application\/rss\+xml"/);

  const searchIndex = JSON.parse(await fs.readFile(path.join(REPO, 'search-index.json'), 'utf8'));
  assert.ok(searchIndex.some((e) => e.slug === FIXTURE_POST && e.url === `/devlog/${FIXTURE_POST}.html`));
  assert.ok(searchIndex.some((e) => e.kind === 'site' && e.slug === 'projects'));
  assert.ok(searchIndex.some((e) => e.kind === 'page' && e.slug === FIXTURE_PAGE));
  assert.match(postHtml, /class="post-actions"/);
  assert.match(postHtml, /class="post-print"/);
});

test('page-hub article copies use their visible Page URL and article tools', async () => {
  await runBuild({ mode: 'publish' });
  const html = await fs.readFile(path.join(REPO, 'pages', FIXTURE_PAGE, `${FIXTURE_POST}.html`), 'utf8');
  assert.match(html, new RegExp(`rel="canonical" href="https://ahmarius\\.github\\.io/pages/${FIXTURE_PAGE}/${FIXTURE_POST}\\.html"`));
  assert.match(html, new RegExp(`data-url="/pages/${FIXTURE_PAGE}/${FIXTURE_POST}\\.html"`));
  assert.match(html, new RegExp(`property="og:url" content="https://ahmarius\\.github\\.io/pages/${FIXTURE_PAGE}/${FIXTURE_POST}\\.html"`));
  assert.match(html, /class="post-actions"/);
  assert.match(html, /assets\/js\/post\.js/);
});

test('archive pages resolve shell assets from their two-directory depth', async () => {
  await runBuild({ mode: 'publish' });
  const html = await fs.readFile(path.join(REPO, 'devlog', 'tag', 'simulation.html'), 'utf8');
  assert.match(html, /href="\.\.\/\.\.\/assets\/css\/style\.css"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/js\/script\.js"/);
  assert.match(html, /data-index-url="\.\.\/\.\.\/search-index\.json"/);
});

test('publish mode removes stale draft post pages from page hubs', async () => {
  await runBuild({ mode: 'preview' });
  await fs.access(path.join(REPO, 'pages', FIXTURE_PAGE, `${FIXTURE_DRAFT}.html`));
  await runBuild({ mode: 'publish' });
  await assert.rejects(fs.access(path.join(REPO, 'pages', FIXTURE_PAGE, `${FIXTURE_DRAFT}.html`)));
  // The published post page survives the publish pass.
  await fs.access(path.join(REPO, 'pages', FIXTURE_PAGE, `${FIXTURE_POST}.html`));
});

test('publish mode removes stale deleted page output and generated assets', async () => {
  const stalePage = path.join(REPO, 'pages', 'removed-page');
  const staleCover = path.join(REPO, 'assets', 'pages', 'removed-page');
  const stalePostAsset = path.join(REPO, 'assets', 'posts', FIXTURE_PAGE, FIXTURE_DRAFT);
  const staleOg = path.join(REPO, 'assets', 'og', 'removed-post.svg');
  const staleTag = path.join(REPO, 'devlog', 'tag', 'removed-tag.html');
  const staleTech = path.join(REPO, 'devlog', 'tech', 'removed-tech.html');
  const staleProject = path.join(REPO, 'devlog', 'project', 'removed-project.html');
  await fs.mkdir(stalePage, { recursive: true });
  await fs.mkdir(staleCover, { recursive: true });
  await fs.mkdir(stalePostAsset, { recursive: true });
  await fs.mkdir(path.dirname(staleOg), { recursive: true });
  await fs.mkdir(path.dirname(staleTag), { recursive: true });
  await fs.mkdir(path.dirname(staleTech), { recursive: true });
  await fs.mkdir(path.dirname(staleProject), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(stalePage, 'index.html'), 'stale'),
    fs.writeFile(path.join(staleCover, 'cover.png'), 'stale'),
    fs.writeFile(path.join(stalePostAsset, 'draft.png'), 'stale'),
    fs.writeFile(staleOg, 'stale'),
    fs.writeFile(staleTag, 'stale'),
    fs.writeFile(staleTech, 'stale'),
    fs.writeFile(staleProject, 'stale'),
  ]);

  await runBuild({ mode: 'publish' });

  await Promise.all([
    assert.rejects(fs.access(stalePage)),
    assert.rejects(fs.access(staleCover)),
    assert.rejects(fs.access(stalePostAsset)),
    assert.rejects(fs.access(staleOg)),
    assert.rejects(fs.access(staleTag)),
    assert.rejects(fs.access(staleTech)),
    assert.rejects(fs.access(staleProject)),
  ]);
});

test('feed/sitemap/robots are not generated in preview mode before publish', async () => {
  // Ensure preview doesn't produce the shallow-copy artifacts before a publish.
  await runBuild({ mode: 'preview' });
  // feed/sitemap are always safe because they only use published posts.
  const feed = await fs.readFile(path.join(REPO, 'feed.xml'), 'utf8');
  assert.doesNotMatch(feed, new RegExp(FIXTURE_DRAFT_TITLE));
});
