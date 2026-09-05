import { escapeHtml, escapeAttribute } from '../content/templates.mjs';
import { SITE_URL } from './helpers.mjs';

/** Umami tracking snippet built from the site config written by the editor. */
export function umamiScript(config = {}) {
  const url = (config?.umami?.url || '').trim();
  const websiteId = (config?.umami?.website_id || '').trim();
  if (!url || !websiteId) return '';
  const scriptUrl = `${String(url).replace(/\/+$/, '')}/script.js`;
  return `    <script defer src="${escapeAttribute(scriptUrl)}" data-website-id="${escapeAttribute(websiteId)}"></script>`;
}

/**
 * Per-post <head> extras: Open Graph, Twitter Card, JSON-LD BlogPosting +
 * BreadcrumbList, canonical.
 */
export function postHeadExtras(post, { cover } = {}) {
  const url = `${SITE_URL}/devlog/${post.slug}.html`;
  const image = cover
    ? `${SITE_URL}/${String(cover).replace(/^\/+/, '')}`
    : `${SITE_URL}/assets/og/${post.slug}.png`;
  const excerpt = escapeAttribute(post.excerpt || post.title || '');
  const title = escapeAttribute(`${post.title} — Devlog` || '');
  const datePublished = post.date || '';
  const dateModified = post.updatedDate || post.date || '';

  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished,
    dateModified,
    description: post.excerpt || '',
    mainEntityOfPage: url,
    author: {
      '@type': 'Person',
      name: 'Alexandru-Marius Hrițcu',
      url: SITE_URL,
    },
  });

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Devlog', item: `${SITE_URL}/devlog.html` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  });

  return `
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${excerpt}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${excerpt}" />
    <meta name="twitter:image" content="${image}" />
    <script type="application/ld+json">${escapeHtml(ld)}</script>
    <script type="application/ld+json">${escapeHtml(breadcrumbLd)}</script>`;
}

/** giscus embed script for a post, when comments aren't disabled. */
export function giscusScript({ repoId = '', categoryId = '', mapping = 'pathname', lang = 'en' } = {}) {
  if (!repoId || !categoryId) return '';
  return `<script src="https://giscus.app/client.js"
    data-repo="ahmarius/ahmarius.github.io"
    data-repo-id="${escapeAttribute(repoId)}"
    data-category="Announcements"
    data-category-id="${escapeAttribute(categoryId)}"
    data-mapping="${escapeAttribute(mapping)}"
    data-strict="0"
    data-reactions-enabled="1"
    data-emit-metadata="0"
    data-input-position="bottom"
    data-theme="preferred_color_scheme"
    data-lang="${escapeAttribute(lang)}"
    crossorigin="anonymous"
    async>
  </script>`;
}

/**
 * Generate heading ids for a rendered HTML body and build a nested TOC.
 * Returns { html, toc } where html has ids injected onto h2/h3 and toc is
 * either an empty string (fewer than 3 headings) or <nav class="post-toc">.
 */
export function addToc(bodyHtml, headings) {
  const usable = (headings || []).filter((h) => h.level === 2 || h.level === 3);
  if (usable.length < 3) return { html: bodyHtml, toc: '' };

  const seen = new Map();
  let html = bodyHtml;
  // Inject ids by matching heading text order; we operate on the heading list
  // computed from the markdown source so ids remain stable/human-readable.
  for (const h of usable) {
    let id = h.slug;
    const count = seen.get(id) || 0;
    if (count > 0) id = `${id}-${count}`;
    seen.set(h.slug, (seen.get(h.slug) || 0) + 1);
    // Rough but safe: replace the opening tag for an exact heading text.
    const re = new RegExp(`<h${h.level}([^>]*)>${escapeRegExp(h.rendered || '')}</h${h.level}>`);
    html = html.replace(re, `<h${h.level}$1 id="${escapeAttribute(id)}">${h.rendered || ''}</h${h.level}>`);
  }

  const items = usable
    .map((h) => {
      let id = h.slug;
      const count = seen.get(h.slug) || 0;
      if (count > 0) id = `${h.slug}-${count}`;
      seen.set(h.slug, (seen.get(h.slug) || 0) + 1);
      return `<li class="post-toc-l${h.level}"><a href="#${id}">${escapeHtml(h.text)}</a></li>`;
    })
    .join('');
  const toc = `<nav class="post-toc" aria-label="Table of contents">
    <span class="post-toc-title">On this page</span>
    <ul>${items}</ul>
  </nav>`;
  return { html, toc };
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
