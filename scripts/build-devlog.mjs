import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT } from './content/paths.mjs';
import { buildPageHierarchy } from './content/pages.mjs';
import { renderMarkdown, truncateText, buildReadTime } from './content/markdown.mjs';
import { pageShell, escapeHtml, escapeAttribute, depthPrefix } from './content/templates.mjs';
import { parseFrontmatter } from './content/frontmatter.mjs';

const ROOT = process.cwd();
const DEVLOG_DIR = path.join(ROOT, 'devlog');

// Optional migration: any Markdown files that still live in the legacy
// `content/devlog/` directory are consumed by the same canonical loader so
// existing content keeps working, but the canonical source of truth for all
// *new* posts remains `content/pages/<page>/posts/<post>.md`.
const LEGACY_CONTENT_DIR = path.join(ROOT, 'content', 'devlog');

async function loadPublishedPosts() {
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
      const post = {
        file: entry.name,
        slug,
        title: meta.title || slug,
        date: meta.date || '',
        updatedDate: meta.updatedDate || meta.date || '',
        status: meta.status || 'draft',
        featured: meta.featured === true || meta.featured === 'true',
        excerpt: meta.excerpt || truncateText(body, 180),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
        project: meta.project || '',
        page: page.slug,
        pageName: page.name,
        readTime: buildReadTime(body),
        body,
      };
      if (post.status === 'published') posts.push(post);
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
    const post = {
      file: entry.name,
      slug,
      title: meta.title || slug,
      date: meta.date || '',
      updatedDate: meta.updatedDate || meta.date || '',
      status: meta.status || 'published',
      featured: meta.featured === true || meta.featured === 'true',
      excerpt: meta.excerpt || truncateText(body, 180),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
      project: meta.project || '',
      page: 'devlog',
      pageName: 'Devlog',
      readTime: buildReadTime(body),
      body,
    };
    if (post.status === 'published') posts.push(post);
  }

  posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return posts;
}

function cardMarkup(post, nested = false) {
  const projectLabel = post.project
    ? `<span class="devlog-meta">${escapeHtml(post.project)}</span>`
    : '';
  const postHref = nested ? `${post.slug}.html` : `devlog/${post.slug}.html`;
  const pageLabel = post.pageName
    ? `<span class="devlog-meta devlog-page">${escapeHtml(post.pageName)}</span>`
    : '';
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
      <div class="devlog-tags">${post.tags
        .map((tag) => `<span class="devlog-tag">${escapeHtml(tag)}</span>`)
        .join('')}</div>
      <div class="devlog-tech">${post.technologies
        .map((tech) => `<span class="devlog-tech-item">${escapeHtml(tech)}</span>`)
        .join('')}</div>
      <div class="devlog-links">
        <span class="devlog-meta">${escapeHtml(post.readTime)}</span>
        ${projectLabel}
        ${pageLabel}
        <a class="devlog-link" href="${postHref}">Read article</a>
      </div>
    </article>
  `;
}

function toolbarOptions(posts) {
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
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </section>`;
}

export function indexContent(posts, nested = false) {
  const cards = posts.map((post) => cardMarkup(post, nested)).join('\n');
  return `
    <header class="page-header devlog-header">
      <p class="section-eyebrow">Project notes</p>
      <h1>Devlog</h1>
    </header>
    <main id="main-content" class="devlog-shell">
      ${toolbarOptions(posts)}
      <div class="devlog-grid">${cards}</div>
      <div id="devlog-empty" class="devlog-empty">No posts match the current filters.</div>
    </main>
  `;
}

export function indexPage(posts, nested = false) {
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
    content: indexContent(posts, nested),
  });
}

function escapeForRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function postPage(post) {
  const normalizedBody = post.body
    .replace(new RegExp(`^#\\s*${escapeForRegex(post.title)}\\s*\\n?`, 'i'), '')
    .trim();
  const body = renderMarkdown(normalizedBody);
  const backHref = depthPrefix(1, 'devlog.html');
  return pageShell({
    title: `${post.title} — Devlog`,
    description: post.excerpt,
    canonical: `https://ahmarius.github.io/devlog/${post.slug}.html`,
    cssAssets: [
      'assets/css/style.css',
      'assets/css/devlog.css',
      'assets/css/pages.css',
      'assets/css/katex.min.css',
    ],
    jsAssets: ['assets/js/hero-fluid.js', 'assets/js/script.js'],
    activeNav: 'devlog',
    depth: 1,
    content: `
      <article class="devlog-post" id="main-content">
        <div class="devlog-article">
          <a class="devlog-link" href="${backHref}">← All posts</a>
          <div class="devlog-meta">${escapeHtml(post.date)} • ${escapeHtml(post.readTime)}</div>
          <h1>${escapeHtml(post.title)}</h1>
          <div class="devlog-tags">${post.tags
            .map((tag) => `<span class="devlog-tag">${escapeHtml(tag)}</span>`)
            .join('')}</div>
          <div class="devlog-tech" style="margin-top:0.75rem;">${post.technologies
            .map((tech) => `<span class="devlog-tech-item">${escapeHtml(tech)}</span>`)
            .join('')}</div>
          ${body}
        </div>
      </article>
    `,
  });
}

export async function buildDevlog(opts = {}) {
  const { copyDist = false, log = console } = opts;
  await fs.mkdir(DEVLOG_DIR, { recursive: true });

  const posts = await loadPublishedPosts();

  await fs.writeFile(path.join(ROOT, 'devlog.html'), indexPage(posts, false), 'utf8');
  await fs.writeFile(path.join(DEVLOG_DIR, 'index.html'), indexPage(posts, true), 'utf8');

  for (const post of posts) {
    await fs.writeFile(path.join(DEVLOG_DIR, `${post.slug}.html`), postPage(post), 'utf8');
  }

  if (copyDist) await copyDistTree(log);

  log.log(`Built ${posts.length} devlog posts.`);
  return { posts: posts.length };
}

async function copyDistTree(log = console) {
  const DIST_DIR = path.join(ROOT, 'dist');
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
