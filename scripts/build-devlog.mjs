import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'content', 'devlog');
const DEVLOG_DIR = path.join(ROOT, 'devlog');
const DIST_DIR = path.join(ROOT, 'dist');
const ROUTE_MAP = {
  FluidDynamics: 'projects.html#project-fluid-dynamics',
  IronHalo: 'projects.html#project-ironhalo',
  JustDrive: 'projects.html#project-2d-racing-game',
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeForRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content.trim() };
  }

  const rawMeta = match[1];
  const body = match[2].trim();
  const lines = rawMeta.split('\n');
  const meta = {};
  let currentKey = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('  - ') || line.startsWith('- ')) {
      const item = line.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      if (!currentKey) continue;
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(item);
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim();
    const value = keyMatch[2].trim();

    if (value === '') {
      currentKey = key;
      meta[key] = [];
      continue;
    }

    currentKey = null;
    meta[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return { meta, body };
}

function renderInlineMarkdown(text = '') {
  let html = escapeHtml(text);
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function renderMarkdown(body = '') {
  const lines = body.split('\n');
  let html = '';
  let paragraph = [];
  let listItems = [];
  let quoteLines = [];
  let codeLines = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${renderInlineMarkdown(paragraph.join(' ').trim())}</p>`;
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html += `<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    html += `<blockquote>${quoteLines.map((line) => renderInlineMarkdown(line)).join('<br>')}</blockquote>`;
    quoteLines = [];
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      flushQuote();
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (line.startsWith('> ')) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^>\s?/, ''));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      flushQuote();
      listItems.push(line.replace(/^[-*]\s+/, '').trim());
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#{1,3}\s+/, '');
      html += `<h${level}>${renderInlineMarkdown(text)}</h${level}>`;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      flushQuote();
      listItems.push(`${line.replace(/^\d+\.\s+/, '')}`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushQuote();
  if (inCodeBlock) flushCode();

  return html;
}

function buildReadTime(body = '') {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 180))} min read`;
}

async function readPosts() {
  const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name);
  const posts = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(CONTENT_DIR, file), 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const slug = meta.slug || file.replace(/\.md$/, '');
    const title = meta.title || slug;
    const date = meta.date || new Date().toISOString().slice(0, 10);
    const excerpt = meta.excerpt || body.replace(/[#>*`\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
    const project = meta.project || '';
    const status = meta.status || 'published';
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const technologies = Array.isArray(meta.technologies) ? meta.technologies : [];

    posts.push({
      file,
      slug,
      title,
      date,
      updatedDate: meta.updatedDate || date,
      status,
      excerpt,
      tags,
      technologies,
      project,
      featured: meta.featured === 'true' || meta.featured === true,
      body,
      readTime: buildReadTime(body),
    });
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

function cardMarkup(post, nested = false) {
  const projectLabel = post.project ? `<span class="devlog-meta">${escapeHtml(post.project)}</span>` : '';
  const postHref = nested ? `${post.slug}.html` : `devlog/${post.slug}.html`;
  return `
    <article class="devlog-card" data-search="${escapeAttribute(`${post.title} ${post.excerpt} ${post.tags.join(' ')} ${post.technologies.join(' ')}`)}" data-tags="${escapeAttribute(post.tags.join(' '))}" data-technologies="${escapeAttribute(post.technologies.join(' '))}" data-project="${escapeAttribute(post.project)}" data-status="${escapeAttribute(post.status)}">
      <div class="devlog-card-header">
        <h3 class="devlog-card-title">${escapeHtml(post.title)}</h3>
        <span class="devlog-meta">${escapeHtml(post.date)}</span>
      </div>
      <p>${escapeHtml(post.excerpt)}</p>
      <div class="devlog-tags">${post.tags.map((tag) => `<span class="devlog-tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="devlog-tech">${post.technologies.map((tech) => `<span class="devlog-tech-item">${escapeHtml(tech)}</span>`).join('')}</div>
      <div class="devlog-links">
        <span class="devlog-meta">${escapeHtml(post.readTime)}</span>
        ${projectLabel}
        <a class="devlog-link" href="${postHref}">Read article</a>
      </div>
    </article>
  `;
}

function indexPage(posts, nested = false) {
  const cards = posts.filter((post) => post.status === 'published').map((post) => cardMarkup(post, nested)).join('\n');
  const tagOptions = Array.from(new Set(posts.flatMap((post) => post.tags))).sort().map((tag) => `<option value="${escapeAttribute(tag)}">${escapeHtml(tag)}</option>`).join('');
  const techOptions = Array.from(new Set(posts.flatMap((post) => post.technologies))).sort().map((tech) => `<option value="${escapeAttribute(tech)}">${escapeHtml(tech)}</option>`).join('');
  const projectOptions = Array.from(new Set(posts.map((post) => post.project).filter(Boolean))).sort().map((project) => `<option value="${escapeAttribute(project)}">${escapeHtml(project)}</option>`).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devlog — Alexandru-Marius Hrițcu</title>
    <meta name="description" content="Project notes, technical decisions, and engineering experiments from Alexandru-Marius Hrițcu." />
    <link rel="canonical" href="https://ahmarius.github.io/devlog.html" />
    <link rel="icon" type="image/svg+xml" href="assets/site/favicon.svg" />
    <meta name="theme-color" content="#000000" />
    <link rel="stylesheet" href="assets/css/style.css" />
    <link rel="stylesheet" href="assets/css/devlog.css" />
    <script defer src="assets/js/hero-fluid.js"></script>
    <script defer src="assets/js/script.js"></script>
    <script defer src="assets/js/devlog.js"></script>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <canvas id="hero-fluid" aria-hidden="true"></canvas>
    <nav class="topnav">
      <div class="topnav-inner">
        <span class="site-logo">DIGITAL CV</span>
        <button id="hamburger-btn" class="hamburger-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobile-menu">
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
        </button>
      </div>
      <ul id="mobile-menu" class="mobile-menu" hidden>
        <li><a href="index.html">Home</a></li>
        <li><a href="projects.html">Projects</a></li>
        <li><a href="games.html">Games</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="about.html#contact">Contact</a></li>
        <li><a aria-current="page" href="devlog.html">Devlog</a></li>
      </ul>
    </nav>
    <header class="page-header devlog-header">
      <p class="section-eyebrow">Project notes</p>
      <h1>Devlog</h1>
      <p class="section-intro">A lightweight journal of the technical choices, experiments, and learning moments behind the work on this site.</p>
    </header>
    <main id="main-content" class="devlog-shell">
      <section class="devlog-toolbar" aria-label="Devlog filters">
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
      </section>
      <div class="devlog-grid">${cards}</div>
      <div id="devlog-empty" class="devlog-empty">No posts match the current filters.</div>
    </main>
  </body>
</html>`;
}

function postPage(post, nested = false) {
  const normalizedBody = post.body.replace(new RegExp(`^#\\s*${escapeForRegex(post.title)}\\s*\\n?`, 'i'), '').trim();
  const body = renderMarkdown(normalizedBody);
  const projectTarget = nested ? `../${ROUTE_MAP[post.project] || 'projects.html'}` : (ROUTE_MAP[post.project] || 'projects.html');
  const projectLink = post.project && ROUTE_MAP[post.project]
    ? `<a class="devlog-link devlog-project-link" href="${projectTarget}">Related project</a>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(post.title)} — Devlog</title>
    <meta name="description" content="${escapeHtml(post.excerpt)}" />
    <link rel="canonical" href="https://ahmarius.github.io/devlog/${post.slug}.html" />
    <link rel="icon" type="image/svg+xml" href="../assets/site/favicon.svg" />
    <meta name="theme-color" content="#000000" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <link rel="stylesheet" href="../assets/css/devlog.css" />
    <script defer src="../assets/js/hero-fluid.js"></script>
    <script defer src="../assets/js/script.js"></script>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <canvas id="hero-fluid" aria-hidden="true"></canvas>
    <nav class="topnav">
      <div class="topnav-inner">
        <span class="site-logo">DIGITAL CV</span>
        <button id="hamburger-btn" class="hamburger-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobile-menu">
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
        </button>
      </div>
      <ul id="mobile-menu" class="mobile-menu" hidden>
        <li><a href="../index.html">Home</a></li>
        <li><a href="../projects.html">Projects</a></li>
        <li><a href="../games.html">Games</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../about.html#contact">Contact</a></li>
        <li><a href="../devlog.html">Devlog</a></li>
      </ul>
    </nav>
    <article class="devlog-post" id="main-content">
      <div class="devlog-article">
        <div class="devlog-meta">${escapeHtml(post.date)} • ${escapeHtml(post.readTime)}</div>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="devlog-tags">${post.tags.map((tag) => `<span class="devlog-tag">${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="devlog-tech" style="margin-top:0.75rem;">${post.technologies.map((tech) => `<span class="devlog-tech-item">${escapeHtml(tech)}</span>`).join('')}</div>
        ${projectLink}
        ${body}
      </div>
    </article>
  </body>
</html>`;
}

async function ensureDirectories() {
  await fs.mkdir(DEVLOG_DIR, { recursive: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
}

async function copyDistTree() {
  const namesToSkip = new Set(['.git', '.idea', 'node_modules', 'dist', 'content', 'admin', 'docs', 'scripts', 'package-lock.json', 'package.json', 'README.md']);

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
}

export async function buildLegacyDevlog(opts = {}) {
  const { copyDist = true, log = console } = opts;
  await ensureDirectories();
  const posts = await readPosts();
  const publishedPosts = posts.filter((post) => post.status === 'published');

  await fs.writeFile(path.join(ROOT, 'devlog.html'), indexPage(posts, false), 'utf8');
  await fs.writeFile(path.join(DEVLOG_DIR, 'index.html'), indexPage(posts, true), 'utf8');

  for (const post of publishedPosts) {
    await fs.mkdir(path.join(DEVLOG_DIR, 'posts'), { recursive: true });
    await fs.writeFile(path.join(DEVLOG_DIR, `${post.slug}.html`), postPage(post, true), 'utf8');
  }

  if (copyDist) await copyDistTree();
  log.log(`Built ${publishedPosts.length} devlog posts.`);
  return { posts: publishedPosts.length };
}

async function main() {
  await buildLegacyDevlog();
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
