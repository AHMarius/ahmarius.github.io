import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT } from './content/paths.mjs';
import { buildPageHierarchy } from './content/pages.mjs';
import { renderMarkdown, truncateText, buildReadTime, headingsFromMarkdown } from './content/markdown.mjs';
import { pageShell, escapeHtml, escapeAttribute, depthPrefix } from './content/templates.mjs';
import { parseFrontmatter } from './content/frontmatter.mjs';
import {
  generateFeed,
  generateAtom,
  generateRobotsTxt,
  generateSitemap,
  generateSearchIndex,
  relatedPosts,
  relatedPostsHtml,
  archiveSlug,
} from './site/helpers.mjs';
import { postHeadExtras, giscusScript, addToc, umamiScript } from './site/post-head.mjs';
import { ogImageSvg } from './site/og-image.mjs';

const ROOT = process.cwd();
const DEVLOG_DIR = path.join(ROOT, 'devlog');
const DIST_DIR = path.join(ROOT, 'dist');
const SITE_URL = 'https://ahmarius.github.io';

// Optional migration: any Markdown files that still live in the legacy
// `content/devlog/` directory are consumed by the same canonical loader so
// existing content keeps working, but the canonical source of truth for all
// *new* posts remains `content/pages/<page>/posts/<post>.md`.
const LEGACY_CONTENT_DIR = path.join(ROOT, 'content', 'devlog');

/** Parse the build mode from argv, defaulting to preview. */
export function parseMode(args = process.argv) {
  const idx = args.indexOf('--mode');
  const mode = idx >= 0 ? (args[idx + 1] || '') : '';
  return mode === 'publish' ? 'publish' : 'preview';
}

const runMode = parseMode();

/** Combine status + publish_at: future-dated posts stay hidden until then. */
function publishStatus(status, publishAt) {
  if (status !== 'published' || !publishAt) return status;
  const at = new Date(publishAt.endsWith('Z') ? publishAt : `${publishAt}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return status;
  return at.getTime() <= Date.now() ? status : 'draft';
}

/** Site-wide settings (giscus/umami) written by the editor before a build. */
async function loadStudioConfig() {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, '.studio-config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const studioConfig = await loadStudioConfig();

async function loadAllPosts(onlyPublished = false) {
  const posts = [];

  const hierarchy = await buildPageHierarchy(PAGES_ROOT);

  for (const page of hierarchy.pages) {
    const postsDir = path.join(page.dir, 'posts');
    let entries = [];
    try {
      entries = await fs.readdir(postsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const { meta, body } = parseFrontmatter(
        await fs.readFile(path.join(postsDir, entry.name), 'utf8'),
      );
      const slug = meta.slug || entry.name.replace(/\.md$/, '');
      const publishAt = meta.publishAt || meta.publish_at || '';
      // Scheduled posts: treat a future publish_at like a draft until its date.
      const status = publishStatus(meta.status || 'draft', publishAt);
      if (onlyPublished && status !== 'published') continue;
      const post = {
        file: entry.name,
        slug,
        title: meta.title || slug,
        date: meta.date || '',
        updatedDate: meta.updatedDate || meta.date || '',
        publishAt,
        status,
        featured: meta.featured === true || meta.featured === 'true',
        excerpt: meta.excerpt || truncateText(body, 180),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
        project: meta.project || '',
        series: meta.series || '',
        part: Number.parseInt(meta.part, 10) || 0,
        cover: meta.cover || '',
        comments: meta.comments !== false,
        page: page.slug,
        pageName: page.name,
        readTime: buildReadTime(body),
        body,
      };
      posts.push(post);
    }
  }

  // Legacy compatibility: consume any remaining posts directly under
  // `content/devlog/` so older content is not silently dropped.
  let legacyEntries;
  try {
    legacyEntries = await fs.readdir(LEGACY_CONTENT_DIR, { withFileTypes: true });
  } catch {
    legacyEntries = [];
  }
  for (const entry of legacyEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const { meta, body } = parseFrontmatter(
      await fs.readFile(path.join(LEGACY_CONTENT_DIR, entry.name), 'utf8'),
    );
    const slug = meta.slug || entry.name.replace(/\.md$/, '');
    const publishAt = meta.publishAt || meta.publish_at || '';
    const status = publishStatus(meta.status || 'published', publishAt);
    if (onlyPublished && status !== 'published') continue;
    const post = {
      file: entry.name,
      slug,
      title: meta.title || slug,
      date: meta.date || '',
      updatedDate: meta.updatedDate || meta.date || '',
      publishAt,
      status,
      featured: meta.featured === true || meta.featured === 'true',
      excerpt: meta.excerpt || truncateText(body, 180),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
      project: meta.project || '',
      series: meta.series || '',
      part: Number.parseInt(meta.part, 10) || 0,
      cover: meta.cover || '',
      comments: meta.comments !== false,
      page: 'devlog',
      pageName: 'Devlog',
      readTime: buildReadTime(body),
      body,
    };
    posts.push(post);
  }

  posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return posts;
}

/** The published subset (used for site-facing output in both modes). */
async function loadPublishedPosts() {
  return loadAllPosts(true);
}

function cardMarkup(post, nested = false) {
  const projectLabel = post.project
    ? `<a class="devlog-meta" href="project/${archiveSlug(post.project)}.html">${escapeHtml(post.project)}</a>`
    : '';
  const postHref = nested ? `${post.slug}.html` : `devlog/${post.slug}.html`;
  const pageLabel = post.pageName
    ? `<span class="devlog-meta devlog-page">${escapeHtml(post.pageName)}</span>`
    : '';
  const tags = (post.tags || []).map((tag) => `<a class="devlog-tag" href="tag/${archiveSlug(tag)}.html">${escapeHtml(tag)}</a>`).join('');
  const techs = (post.technologies || []).map((tech) => `<a class="devlog-tech-item" href="tech/${archiveSlug(tech)}.html">${escapeHtml(tech)}</a>`).join('');
  return `
    <article class="devlog-card" data-search="${escapeAttribute(
      `${post.title} ${post.excerpt} ${post.pageName} ${post.tags.join(' ')} ${post.technologies.join(' ')}`,
    )}" data-tags="${escapeAttribute(post.tags.join(' '))}" data-technologies="${escapeAttribute(
      post.technologies.join(' '),
    )}" data-project="${escapeAttribute(post.project)}" data-status="${escapeAttribute(post.status)}">
      <div class="devlog-card-header">
        <h3 class="devlog-card-title">${escapeHtml(post.title)}</h3>
        <span class="devlog-meta">${escapeHtml(post.date)}</span>
      </div>
      <p>${escapeHtml(post.excerpt)}</p>
      <div class="devlog-tags">${tags}</div>
      <div class="devlog-tech">${techs}</div>
      <div class="devlog-links">
        <span class="devlog-meta">${escapeHtml(post.readTime)}</span>
        ${projectLabel}
        ${pageLabel}
        <a class="devlog-link" href="${postHref}">Read article</a>
        <button type="button" class="devlog-share" data-url="${escapeAttribute(postHref)}" aria-label="Share this post">Share</button>
      </div>
    </article>
  `;
}

function toolbarOptions(posts, onlyPublished = false) {
  const tagOptions = Array.from(new Set(posts.flatMap((post) => post.tags)))
    .sort()
    .map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`)
    .join('');
  const techOptions = Array.from(new Set(posts.flatMap((post) => post.technologies)))
    .sort()
    .map((tech) => `<option value="${escapeAttribute(tech)}">${escapeHtml(tech)}</option>`)
    .join('');
  const projectOptions = Array.from(new Set(posts.map((post) => post.project).filter(Boolean)))
    .sort()
    .map((project) => `<option value="${escapeAttribute(project)}">${escapeHtml(project)}</option>`)
    .join('');
  // In publish mode, drafts never reach the DOM, so there's no reason to offer
  // a status filter option for values that cannot appear.
  const statusOption = onlyPublished
    ? '<option value="all">All</option><option value="published">Published</option>'
    : '<option value="all">All</option><option value="published">Published</option><option value="draft">Draft</option>';
  return `      <section class="devlog-toolbar" aria-label="Devlog filters">
        <div class="devlog-filter">
          <label for="devlog-search">Search</label>
          <input id="devlog-search" type="search" placeholder="Search posts..." />
        </div>
        <div class="devlog-filter">
          <label for="devlog-tag">Tag</label>
          <select id="devlog-tag">
            <option value="all">All tags</option>
            ${tagOptions}
          </select>
        </div>
        <div class="devlog-filter">
          <label for="devlog-tech">Technology</label>
          <select id="devlog-tech">
            <option value="all">All technologies</option>
            ${techOptions}
          </select>
        </div>
        <div class="devlog-filter">
          <label for="devlog-project">Project</label>
          <select id="devlog-project">
            <option value="all">All projects</option>
            ${projectOptions}
          </select>
        </div>
        <div class="devlog-filter">
          <label for="devlog-status">Status</label>
          <select id="devlog-status">
            ${statusOption}
          </select>
        </div>
      </section>`;
}

export function indexContent(posts, nested = false, onlyPublished = false) {
  const cards = posts.map((post) => cardMarkup(post, nested)).join('\n');
  return `
    <header class="page-header devlog-header">
      <p class="section-eyebrow">Project notes</p>
      <h1>Devlog</h1>
    </header>
    <main id="main-content" class="devlog-shell">
      ${toolbarOptions(posts, onlyPublished)}
      <div class="devlog-grid">${cards}</div>
      <div id="devlog-empty" class="devlog-empty">No posts match the current filters.</div>
    </main>
  `;
}

export function indexPage(posts, nested = false, onlyPublished = false) {
  return pageShell({
    title: 'Devlog — Alexandru-Marius Hrițcu',
    description:
      'Project notes, technical decisions, and engineering experiments from Alexandru-Marius Hrițcu.',
    canonical: 'https://ahmarius.github.io/devlog.html',
    cssAssets: [
      'assets/css/style.css',
      'assets/css/devlog.css',
      'assets/css/pages.css',
      'assets/css/katex.min.css',
    ],
    jsAssets: [
      'assets/js/hero-fluid.js',
      'assets/js/script.js',
      'assets/js/devlog.js',
    ],
    activeNav: 'devlog',
    depth: nested ? 1 : 0,
    extraHead: umamiScript(studioConfig),
    content: indexContent(posts, nested, onlyPublished),
  });
}

function escapeForRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function seriesNavHtml(posts, current) {
  if (!current.series) return '';
  const partOf = (p) => (p.part > 0 ? p.part : Number.MAX_SAFE_INTEGER);
  const chain = posts
    .filter((p) => p.series === current.series)
    .sort(
      (a, b) =>
        partOf(a) - partOf(b) ||
        new Date(a.date || 0) - new Date(b.date || 0),
    );
  if (chain.length < 2) return '';
  const idx = chain.findIndex((p) => p.slug === current.slug);
  const prev = idx > 0 ? chain[idx - 1] : null;
  const next = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  if (!prev && !next) return '';
  return `
    <nav class="series-nav" aria-label="Series navigation">
      <div class="series-nav-label">Part of ${escapeHtml(current.series)}${current.part ? ` · part ${current.part}` : ''}</div>
      <div class="series-nav-links">
        ${prev ? `<a class="series-nav-link series-nav-prev" href="${prev.slug}.html">← ${escapeHtml(prev.title)}</a>` : ''}
        ${next ? `<a class="series-nav-link series-nav-next" href="${next.slug}.html">${escapeHtml(next.title)} →</a>` : ''}
      </div>
    </nav>
  `;
}

export function postPage(post, seriesNav = '', related = []) {
  const normalizedBody = post.body
    .replace(new RegExp(`^#\\s*${escapeForRegex(post.title)}\\s*\\n?`, 'i'), '')
    .trim();
  const headings = headingsFromMarkdown(normalizedBody);
  const bodyRaw = renderMarkdown(normalizedBody);
  const { html: body, toc } = addToc(bodyRaw, headings);
  const backHref = depthPrefix(1, 'devlog.html');
  const tagLinks = (post.tags || []).map((tag) => `<a class="devlog-tag" href="tag/${archiveSlug(tag)}.html">${escapeHtml(tag)}</a>`).join('');
  const techLinks = (post.technologies || []).map((tech) => `<a class="devlog-tech-item" href="tech/${archiveSlug(tech)}.html">${escapeHtml(tech)}</a>`).join('');
  const relatedHtml = relatedPostsHtml(related);
  const giscus = giscusScript({
    repoId: studioConfig?.giscus?.repo_id || '',
    categoryId: studioConfig?.giscus?.category_id || '',
  });
  const ogCover = post.cover
    ? post.cover
    : `assets/og/${post.slug}.svg`;
  return pageShell({
    title: `${post.title} — Devlog`,
    description: post.excerpt,
    canonical: `${SITE_URL}/devlog/${post.slug}.html`,
    cssAssets: [
      'assets/css/style.css',
      'assets/css/devlog.css',
      'assets/css/pages.css',
      'assets/css/katex.min.css',
      'assets/css/print.css',
    ],
    jsAssets: ['assets/js/hero-fluid.js', 'assets/js/script.js', 'assets/js/post.js'],
    activeNav: 'devlog',
    depth: 1,
    extraHead:
      postHeadExtras(post, { cover: ogCover }) +
      umamiScript(studioConfig),
    content: `
      <article class="devlog-post" id="main-content">
        <div class="devlog-article">
          <a class="devlog-link" href="${backHref}">← All posts</a>
          <div class="devlog-meta">${escapeHtml(post.date)} • ${escapeHtml(post.readTime)}</div>
          <h1>${escapeHtml(post.title)}</h1>
          ${toc ? `${toc}` : ''}
          <div class="devlog-tags">${tagLinks}</div>
          <div class="devlog-tech" style="margin-top:0.75rem;">${techLinks}</div>
          ${body}
          ${seriesNav}
          ${relatedHtml}
          ${post.comments ? '<div class="giscus"></div>' : ''}
        </div>
      </article>
      ${giscus}
    `,
  });
}

async function buildArchives(posts, devlogDir) {
  const archives = [];
  const renderArchive = (label, values, kind) => {
    const slug = archiveSlug(label);
    const dir = path.join(devlogDir, kind, slug);
    const cards = posts.filter((p) => (kind === 'tag' ? (p.tags || []).includes(label) : kind === 'tech' ? (p.technologies || []).includes(label) : p.project === label)).map((p) => cardMarkup(p, false)).join('\n');
    const url = `/devlog/${kind}/${slug}.html`;
    return async () => {
      await fs.mkdir(dir, { recursive: true });
      const html = pageShell({
        title: `${kind === 'tag' ? 'Tag' : kind === 'tech' ? 'Technology' : 'Project'}: ${label} — Devlog`,
        description: `Posts tagged ${label}.`,
        canonical: `${SITE_URL}${url}`,
        cssAssets: ['assets/css/style.css', 'assets/css/devlog.css', 'assets/css/pages.css', 'assets/css/katex.min.css'],
        jsAssets: ['assets/js/hero-fluid.js', 'assets/js/script.js', 'assets/js/devlog.js'],
        activeNav: 'devlog',
        depth: 1,
        content: `
          <header class="page-header devlog-header">
            <p class="section-eyebrow">${kind === 'tag' ? 'Tag' : kind === 'tech' ? 'Technology' : 'Project'} archive</p>
            <h1>${escapeHtml(label)}</h1>
            <a class="devlog-link" href="../index.html">← All posts</a>
          </header>
          <main id="main-content" class="devlog-shell">
            <div class="devlog-grid">${cards || '<div class="devlog-empty is-visible">No posts.</div>'}</div>
          </main>
        `,
      });
      await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
      archives.push({ url });
    };
  };

  const jobs = [];
  const tags = new Set(posts.flatMap((p) => p.tags || []));
  for (const t of tags) jobs.push(renderArchive(t, posts, 'tag'));
  const techs = new Set(posts.flatMap((p) => p.technologies || []));
  for (const t of techs) jobs.push(renderArchive(t, posts, 'tech'));
  const projects = new Set(posts.map((p) => p.project).filter(Boolean));
  for (const p of projects) jobs.push(renderArchive(p, posts, 'project'));
  for (const job of jobs) await job();
  return archives;
}

export async function buildDevlog(opts = {}) {
  const { copyDist = false, log = console, mode = runMode } = opts;
  const onlyPublished = mode === 'publish';
  await fs.mkdir(DEVLOG_DIR, { recursive: true });

  const allPosts = await loadAllPosts(onlyPublished);
  const published = allPosts.filter((p) => p.status === 'published');
  const gridPosts = onlyPublished ? published : allPosts;

  await fs.writeFile(path.join(ROOT, 'devlog.html'), indexPage(gridPosts, false, onlyPublished), 'utf8');
  await fs.writeFile(path.join(DEVLOG_DIR, 'index.html'), indexPage(gridPosts, true, onlyPublished), 'utf8');

  // Build archives from the published set (they only ever include published).
  const archives = await buildArchives(published, DEVLOG_DIR);

  // Remove stale post pages (e.g. a draft page left over from a preview build)
  // so publish-mode output reflects exactly the intended set.
  if (mode === 'publish') {
    const keep = new Set(gridPosts.map((p) => `${p.slug}.html`));
    const existing = await fs.readdir(DEVLOG_DIR).catch(() => []);
    for (const name of existing) {
      if (name === 'index.html' || !name.endsWith('.html') || keep.has(name)) continue;
      await fs.rm(path.join(DEVLOG_DIR, name), { force: true });
    }
  }

  // Individual post pages: in preview mode every visible post gets a page so
  // drafts can be inspected; in publish mode only published posts exist here.
  for (const post of gridPosts) {
    const related = relatedPosts(post, published, 3);
    await fs.writeFile(
      path.join(DEVLOG_DIR, `${post.slug}.html`),
      postPage(post, seriesNavHtml(published, post), related),
      'utf8',
    );
  }

  // Site-facing metadata outputs only ever reflect published content.
  await fs.writeFile(path.join(ROOT, 'feed.xml'), generateFeed(published), 'utf8');
  await fs.writeFile(path.join(ROOT, 'atom.xml'), generateAtom(published), 'utf8');
  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), generateSitemap(published, { staticPages: ['index.html', 'projects.html', 'games.html', 'devlog.html', 'pages.html', 'about.html'], archives }), 'utf8');
  await fs.writeFile(path.join(ROOT, 'robots.txt'), generateRobotsTxt(), 'utf8');
  await fs.writeFile(path.join(ROOT, 'search-index.json'), generateSearchIndex(published), 'utf8');

  // Open Graph images (SVG, no binary deps) for posts without a custom cover.
  const ogDir = path.join(ROOT, 'assets', 'og');
  await fs.mkdir(ogDir, { recursive: true });
  for (const post of published) {
    if (post.cover) continue;
    const svg = ogImageSvg({ title: post.title, subtitle: `${post.pageName || 'Devlog'} · ${post.date || ''}` });
    await fs.writeFile(path.join(ogDir, `${post.slug}.svg`), svg, 'utf8');
  }

  if (copyDist) await copyDistTree(log);

  log.log(`Built ${published.length} devlog posts (mode=${mode}).`);
  return { posts: published.length, mode };
}

async function copyDistTree(log = console) {
  const namesToSkip = new Set([
    '.git',
    '.idea',
    'node_modules',
    'dist',
    'content',
    'admin',
    'docs',
    'scripts',
    'package-lock.json',
    'package.json',
    'README.md',
  ]);
  async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (namesToSkip.has(entry.name)) continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(from, to);
      } else {
        await fs.copyFile(from, to);
      }
    }
  }
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
  await copyDir(ROOT, DIST_DIR);
  log.log('Built dist/ tree.');
}

async function main() {
  await buildDevlog({ copyDist: false });
}

if (
  process.argv[1] === import.meta.url ||
  process.argv[1] === new URL(import.meta.url).pathname
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { buildDevlog as buildLegacyDevlog };
export { loadAllPosts };
