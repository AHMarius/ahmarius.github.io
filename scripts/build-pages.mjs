import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT } from './content/paths.mjs';
import { buildPageHierarchy } from './content/pages.mjs';
import { renderMarkdown, truncateText, buildReadTime } from './content/markdown.mjs';
import { pageShell, escapeHtml, escapeAttribute } from './content/templates.mjs';
import { computePageUpdatedDate } from './content/metadata.mjs';
import { parseFrontmatter } from './content/frontmatter.mjs';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'pages');
const PUBLIC_HREF = 'pages.html';

function relFromPage(depth) {
  return depth > 0 ? '../'.repeat(depth) : '';
}

export function pageCard(page, href, coverRoot = '') {
  const childCount = (page.children || []).length;
  return `
    <article class="page-card" data-search="${escapeAttribute(`${page.name} ${page.description}`)}">
      <div class="page-card-header">
        ${page.cover ? `<img class="page-card-cover" src="${coverRoot}${escapeAttribute(page.cover)}" alt="" loading="lazy" />` : '<div class="page-card-cover page-card-cover-empty"></div>'}
        <h3 class="page-card-title">${escapeHtml(page.name)}</h3>
      </div>
      <p>${escapeHtml(page.description)}</p>
      <div class="page-card-meta">
        <span>${page.postCount ?? 0} post${(page.postCount ?? 0) === 1 ? '' : 's'}</span>
        ${childCount > 0 ? `<span>${childCount} sub-page${childCount === 1 ? '' : 's'}</span>` : ''}
      </div>
      <a class="devlog-link" href="${href}">Open page</a>
    </article>
  `;
}

function breadcrumb(pagesBySlug, slug) {
  const crumbs = [];
  let current = pagesBySlug.get(slug);
  const guard = new Set();
  while (current && !guard.has(current.slug)) {
    guard.add(current.slug);
    crumbs.unshift(current);
    current = current.parent ? pagesBySlug.get(current.parent) : null;
  }
  return crumbs;
}

function pageIndexPage(hierarchy) {
  const publishedCounts = publishedCountsByDir(hierarchy.postsByPage);
  const cards = hierarchy.roots
    .map((page) => pageCard({ ...page, postCount: publishedCounts.get(page.dir) || 0 }, `${page.slug}/index.html`, `${page.slug}/`))
    .join('\n');
  const content = `
    <header class="page-header devlog-header">
      <p class="section-eyebrow">Long-form writing</p>
      <h1>Pages</h1>
      <p class="section-intro">Project hubs and long-running documentation, organized into pages, sub-pages, and posts.</p>
    </header>
    <main id="main-content" class="devlog-shell">
      ${cards ? `<div class="pages-grid">${cards}</div>` : '<div class="devlog-empty is-visible">No pages yet.</div>'}
    </main>
  `;
  return pageShell({
    title: 'Pages — Alexandru-Marius Hrițcu',
    description: 'Project hubs, sub-pages, and posts.',
    canonical: 'https://ahmarius.github.io/pages.html',
    cssAssets: ['assets/css/style.css', 'assets/css/devlog.css', 'assets/css/pages.css', 'assets/css/katex.min.css'],
    activeNav: 'pages',
    content,
  });
}

function pageLandingPage(page, pagesBySlug, posts) {
  const crumbs = breadcrumb(pagesBySlug, page.slug);
  const crumbHtml = crumbs.map((c) => `<span>${escapeHtml(c.name)}</span>`).join(' <span class="crumb-sep">/</span> ');

  const childCards = (page.children || []).map((child) => {
    const childPosts = postsForPage(posts, child.slug);
    return pageCard({ ...child, postCount: childPosts.length }, `../${child.slug}/index.html`, `../${child.slug}/`);
  }).join('\n');

  const postCards = posts.map((post) => {
    const href = `${post.slug}.html`;
    return `
      <article class="devlog-card" data-search="${escapeAttribute(`${post.title} ${post.excerpt} ${post.tags.join(' ')}`)}">
        <div class="devlog-card-header">
          <h3 class="devlog-card-title">${escapeHtml(post.title)}</h3>
          <span class="devlog-meta">${escapeHtml(post.date)}</span>
        </div>
        <p>${escapeHtml(post.excerpt)}</p>
        <div class="devlog-tags">${post.tags.map((t) => `<span class="devlog-tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="devlog-links">
          <span class="devlog-meta">${buildReadTime(post.body)}</span>
          <a class="devlog-link" href="${href}">Read post</a>
        </div>
      </article>
    `;
  }).join('\n');

  const relativeRoot = relFromPage(1);
  const content = `
    <header class="page-header page-landing-header">
      <nav class="page-breadcrumb" aria-label="Breadcrumb">${crumbHtml}</nav>
      <h1>${escapeHtml(page.name)}</h1>
      ${page.description ? `<p class="section-intro">${escapeHtml(page.description)}</p>` : ''}
      ${page.cover ? `<img class="page-hero-cover" src="${relativeRoot}${escapeAttribute(page.cover)}" alt="" />` : ''}
    </header>
    <main id="main-content" class="devlog-shell">
      ${childCards ? `<section><h2>Sub-pages</h2><div class="pages-grid">${childCards}</div></section>` : ''}
      ${postCards ? `<section><h2>Posts</h2><div class="devlog-grid">${postCards}</div></section>` : '<div class="devlog-empty is-visible">No posts yet.</div>'}
    </main>
  `;
  return pageShell({
    title: `${page.name} — Alexandru-Marius Hrițcu`,
    description: page.description,
    canonical: `https://ahmarius.github.io/pages/${page.slug}/index.html`,
    cssAssets: ['assets/css/style.css', 'assets/css/devlog.css', 'assets/css/pages.css', 'assets/css/katex.min.css'],
    activeNav: 'pages',
    depth: 1,
    content,
  });
}

function postsForPage(posts, slug) {
  return posts.filter((p) => p.pageSlug === slug);
}

function publishedCountsByDir(postsByPage) {
  const counts = new Map();
  for (const [dir, posts] of postsByPage) {
    counts.set(dir, posts.filter((p) => p.status === 'published').length);
  }
  return counts;
}

function readPostPublic(filePath, pageSlug) {
  const raw = fs.readFile(filePath, 'utf8').then((content) => {
    const { meta, body } = parseFrontmatter(content);
    const slug = meta.slug || path.basename(filePath).replace(/\.md$/, '');
    const title = meta.title || slug;
    return {
      title,
      slug,
      date: meta.date || '',
      updatedDate: meta.updatedDate || meta.date || '',
      status: meta.status || 'draft',
      excerpt: meta.excerpt || truncateText(body, 180),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
      subtitle: meta.subtitle || '',
      body,
      pageSlug,
    };
  });
  return raw;
}

function postPagePublic(post, crumbs, pagesBySlug) {
  const body = renderMarkdown(post.body.replace(new RegExp(`^#\\s*${escapeForRegex(post.title)}\\s*\\n?`, 'i'), '').trim());
  const crumbHtml = crumbs.map((c) => `<span>${escapeHtml(c.name)}</span>`).join(' <span class="crumb-sep">/</span> ');
  const parentCrumb = crumbs.length > 0 ? `<a class="devlog-link" href="../${crumbs[crumbs.length - 1].slug}/index.html">← ${escapeHtml(crumbs[crumbs.length - 1].name)}</a>` : '';

  const content = `
    <article class="devlog-post" id="main-content">
      <div class="devlog-article">
        <nav class="page-breadcrumb" aria-label="Breadcrumb">${crumbHtml}</nav>
        ${parentCrumb}
        <div class="devlog-meta">${escapeHtml(post.date)}</div>
        <h1>${escapeHtml(post.title)}</h1>
        ${post.subtitle ? `<p class="post-subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
        <div class="devlog-tags" style="margin-top:0.75rem;">${post.tags.map((t) => `<span class="devlog-tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="devlog-tech" style="margin-top:0.75rem;">${post.technologies.map((t) => `<span class="devlog-tech-item">${escapeHtml(t)}</span>`).join('')}</div>
        ${body}
      </div>
    </article>
  `;
  return pageShell({
    title: `${post.title} — Pages`,
    description: post.excerpt,
    canonical: `https://ahmarius.github.io/pages/${post.pageSlug}/${post.slug}.html`,
    cssAssets: ['assets/css/style.css', 'assets/css/devlog.css', 'assets/css/pages.css', 'assets/css/katex.min.css'],
    activeNav: 'pages',
    depth: 1,
    content,
  });
}

function escapeForRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function buildPages(opts = {}) {
  const { log = console } = opts;
  const hierarchy = await buildPageHierarchy(PAGES_ROOT);
  const { roots, pages, postsByPage } = hierarchy;

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(ROOT, PUBLIC_HREF), pageIndexPage(hierarchy), 'utf8');

  const pagesBySlug = new Map(pages.map((p) => [p.slug, p]));

  const allPosts = [];
  for (const page of pages) {
    let subEntries = [];
    try {
      const postsDir = path.join(page.dir, 'posts');
      subEntries = await fs.readdir(postsDir, { withFileTypes: true });
    } catch {
      subEntries = [];
    }
    for (const entry of subEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const post = await readPostPublic(path.join(page.dir, 'posts', entry.name), page.slug);
      allPosts.push(post);
    }
  }

  const published = allPosts.filter((p) => p.status === 'published');
  for (const page of pages) {
    const crumbs = breadcrumb(pagesBySlug, page.slug);
    const pagePosts = published.filter((p) => p.pageSlug === page.slug);
    const subDir = path.join(OUT_DIR, page.slug);
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(subDir, 'index.html'), pageLandingPage(page, pagesBySlug, pagePosts), 'utf8');
    for (const post of pagePosts) {
      await fs.writeFile(path.join(subDir, `${post.slug}.html`), postPagePublic(post, crumbs, pagesBySlug), 'utf8');
    }
  }

  log.log(`Built ${published.length} pages posts across ${pages.length} pages.`);
  return { pages: pages.length, posts: published.length };
}

async function main() {
  await buildPages();
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
