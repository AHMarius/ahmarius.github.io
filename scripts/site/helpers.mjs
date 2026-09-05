import { slugify } from '../content/paths.mjs';

export const SITE_URL = 'https://ahmarius.github.io';

/** RFC 2822 date for RSS feeds (e.g. "Wed, 05 Sep 2026 10:00:00 +0000"). */
export function rfc2822(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate.endsWith('Z') || /\d[+-]\d\d:\d\d$/.test(isoDate) ? isoDate : `${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** W3C date for sitemap lastmod (YYYY-MM-DD). */
export function isoDate(value) {
  if (!value) return '';
  const d = new Date(value.endsWith('Z') || /\d[+-]\d\d:\d\d$/.test(value) ? value : `${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * RSS 2.0 feed derived from the latest published posts.
 */
export function generateFeed(posts, { title = 'Devlog', description = 'Project notes and technical writing from Alexandru-Marius Hrițcu.', limit = 50 } = {}) {
  const sorted = [...posts]
    .sort((a, b) => String(b.updatedDate || b.date || '').localeCompare(String(a.updatedDate || a.date || '')))
    .slice(0, limit);
  const items = sorted
    .map((p) => {
      const url = `${SITE_URL}/devlog/${p.slug}.html`;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">${url}</guid>
      <pubDate>${rfc2822(p.date || p.updatedDate)}</pubDate>
      <description>${esc(p.excerpt || p.title)}</description>
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${SITE_URL}/devlog.html</link>
    <description>${esc(description)}</description>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

/**
 * Atom feed (RFC 4287) from the same posts.
 */
export function generateAtom(posts, { title = 'Devlog', description = 'Project notes and technical writing from Alexandru-Marius Hrițcu.', limit = 50 } = {}) {
  const sorted = [...posts]
    .sort((a, b) => String(b.updatedDate || b.date || '').localeCompare(String(a.updatedDate || a.date || '')))
    .slice(0, limit);
  const entries = sorted
    .map((p) => {
      const url = `${SITE_URL}/devlog/${p.slug}.html`;
      return `  <entry>
    <title>${esc(p.title)}</title>
    <link href="${url}" />
    <id>${url}</id>
    <updated>${new Date((p.updatedDate || p.date).replace(' ', 'T')).toISOString()}</updated>
    <summary>${esc(p.excerpt || p.title)}</summary>
  </entry>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(title)}</title>
  <link href="${SITE_URL}/feed.xml" rel="self" />
  <id>${SITE_URL}/</id>
${entries}
</feed>
`;
}

export function generateRobotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

/**
 * Build a sitemap from static pages plus published posts.
 */
export function generateSitemap(posts, { staticPages = [], archives = [] } = {}) {
  const urls = [];
  for (const pagePath of staticPages) {
    urls.push({ loc: `${SITE_URL}/${pagePath}`, lastmod: '' });
  }
  for (const p of posts) {
    urls.push({ loc: `${SITE_URL}/devlog/${p.slug}.html`, lastmod: isoDate(p.updatedDate || p.date) });
  }
  for (const a of archives) {
    urls.push({ loc: `${SITE_URL}${a.url}`, lastmod: '' });
  }
  const body = urls
    .map((u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

/**
 * JSON search index consumed by the site's search widget.
 */
export function generateSearchIndex(posts) {
  const entries = posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || '',
    tags: p.tags || [],
    technologies: p.technologies || [],
    project: p.project || '',
    page: p.page || '',
    date: p.date || '',
    updatedDate: p.updatedDate || p.date || '',
    url: `/devlog/${p.slug}.html`,
  }));
  return JSON.stringify(entries, null, 2);
}

/** Deterministic archive filename/URL slug for a label. */
export function archiveSlug(label = '') {
  return slugify(label);
}

/**
 * Related-posts engine: score by tag (2x) + technology overlap.
 */
export function relatedPosts(target, all, limit = 3) {
  return all
    .filter((p) => p.slug !== target.slug && p.status === 'published')
    .map((p) => {
      const tagOverlap = (target.tags || []).filter((t) => (p.tags || []).includes(t)).length;
      const techOverlap = (target.technologies || []).filter((t) => (p.technologies || []).includes(t)).length;
      return { post: p, score: tagOverlap * 2 + techOverlap };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.post.date).localeCompare(String(a.post.date)))
    .slice(0, limit)
    .map((x) => x.post);
}

export function relatedPostsHtml(related) {
  if (!related.length) return '';
  const cards = related
    .map((p) => `
      <a class="related-post" href="devlog/${p.slug}.html">
        <span class="related-post-title">${esc(p.title)}</span>
        <span class="related-post-meta">${esc(p.date || '')} · ${esc(p.readTime || '')}</span>
      </a>`)
    .join('\n');
  return `<section class="related-posts">
    <h2>Related posts</h2>
    <div class="related-posts-grid">${cards}</div>
  </section>`;
}

export function escapeHtml(value) {
  return esc(value);
}
