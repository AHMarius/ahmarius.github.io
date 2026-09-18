import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT, slugify, resolveInside } from './paths.mjs';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { validatePageMeta, assertValidMeta } from './schema.mjs';

const PAGE_FILE = 'page.yml';
const POSTS_DIR = 'posts';
const SUBPAGES_DIR = 'subpages';

function dateToISO(date) {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function readPageMeta(pageDir) {
  const filePath = path.join(pageDir, PAGE_FILE);
  const raw = await fs.readFile(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  return { meta, body, path: filePath };
}

export async function pageExists(pageDir) {
  try {
    await fs.access(path.join(pageDir, PAGE_FILE));
    return true;
  } catch {
    return false;
  }
}

function isPage(fileName) {
  return fileName === PAGE_FILE;
}

export async function findPageDirectories(root = PAGES_ROOT) {
  const results = [];
  async function walk(dir, parentPath) {
    if (dir === root) {
      let entries = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), null);
      }
      return;
    }
    if (!(await pageExists(dir))) return;
    results.push({ dir, slug: path.basename(dir), parentPath });
    const subDir = path.join(dir, SUBPAGES_DIR);
    let subEntries = [];
    try {
      subEntries = await fs.readdir(subDir, { withFileTypes: true });
    } catch {
      subEntries = [];
    }
    for (const se of subEntries) {
      if (!se.isDirectory()) continue;
      const childParent = parentPath ? `${parentPath}/${path.basename(dir)}` : path.basename(dir);
      await walk(path.join(subDir, se.name), childParent);
    }
  }
  await walk(root, null);
  return results.filter((p) => p.dir !== root);
}

export async function getPageTree(root = PAGES_ROOT, strict = false) {
  const pages = await findPageDirectories(root);
  const byKey = new Map();
  for (const p of pages) {
    let meta = { name: p.slug };
    let body = '';
    try {
      const m = await readPageMeta(p.dir);
      meta = m.meta;
      body = m.body;
    } catch {
      // page.yml unreadable; fall through to defaults
    }
    const issues = validatePageMeta(meta);
    if (issues.length > 0) {
      if (strict) assertValidMeta(path.join(p.dir, PAGE_FILE), issues, true);
      else console.warn(`[lint-warning] ${path.join(p.dir, PAGE_FILE)}: ${issues.join('; ')}`);
    }
    const filesystemParent = p.parentPath ? p.parentPath.split('/').filter(Boolean).at(-1) : null;
    const declaredParent = meta.parent || null;
    byKey.set(p.dir, {
      slug: p.slug,
      name: meta.name || meta.slug || p.slug,
      description: meta.description || '',
      cover: meta.cover || '',
      order: Number(meta.order ?? 100),
      parent: declaredParent || filesystemParent,
      declaredParent,
      filesystemParent,
      parentPath: p.parentPath || null,
      body,
      dir: p.dir,
    });
  }
  return Array.from(byKey.values());
}

export async function buildPageHierarchy(root = PAGES_ROOT, strict = false) {
  const pages = await getPageTree(root, strict);
  const postsByPage = new Map();

  const bySlugMap = new Map();
  for (const page of pages) {
    if (bySlugMap.has(page.slug)) {
      throw new Error(`Duplicate page slug '${page.slug}' would collide in the public output.`);
    }
    bySlugMap.set(page.slug, page);
  }
  for (const page of pages) {
    if (page.parent && !bySlugMap.has(page.parent)) {
      throw new Error(`Parent page '${page.parent}' does not exist for '${page.slug}'.`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function verifyAcyclic(page, chain = []) {
    if (visiting.has(page.slug)) {
      throw new Error(`Page parent cycle: ${[...chain, page.slug].join(' -> ')}.`);
    }
    if (visited.has(page.slug)) return;
    visiting.add(page.slug);
    if (page.parent) verifyAcyclic(bySlugMap.get(page.parent), [...chain, page.slug]);
    visiting.delete(page.slug);
    visited.add(page.slug);
  }
  pages.forEach((page) => verifyAcyclic(page));
  for (const page of pages) {
    if (page.declaredParent && page.declaredParent !== page.filesystemParent) {
      throw new Error(
        `Page '${page.slug}' declares parent '${page.declaredParent}' but its filesystem parent is '${page.filesystemParent || '(root)'}'.`,
      );
    }
  }

  for (const page of pages) {
    const postsDir = path.join(page.dir, POSTS_DIR);
    const list = [];
    let entries = [];
    try {
      entries = await fs.readdir(postsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(postsDir, entry.name);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const slug = meta.slug || entry.name.replace(/\.md$/, '');
        list.push({
          file: entry.name,
          slug,
          title: meta.title || slug,
          date: meta.date || '',
          updatedDate: meta.updatedDate || meta.date || '',
          status: meta.status || 'draft',
          publishAt: meta.publishAt || meta.publish_at || '',
          featured: meta.featured === true || meta.featured === 'true',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
          excerpt: meta.excerpt || '',
          page: meta.page || page.slug,
          dir: postsDir,
          path: filePath,
          body,
        });
      } catch {
        // skip unreadable
      }
    }
    postsByPage.set(page.dir, list);
  }

  const childrenByParent = new Map();
  for (const page of pages) {
    if (!page.parent) continue;
    const children = childrenByParent.get(page.parent) || [];
    children.push(page);
    childrenByParent.set(page.parent, children);
  }

  function attach(page) {
    const children = childrenByParent.get(page.slug) || [];
    page.children = children.map((child) => {
      attach(child);
      return child;
    }).sort(byOrder);
    return page.children;
  }

  function byOrder(a, b) {
    return (a.order || 100) - (b.order || 100) || a.name.localeCompare(b.name);
  }

  const roots = pages
    .filter((p) => !p.parent)
    .sort(byOrder)
    .map((p) => {
      attach(p);
      return p;
    });

  return { roots, pages, postsByPage };
}

function computeUpdatedDate(meta, body, childDates = []) {
  const explicit = dateToISO(meta.updatedDate || meta.date);
  const candidates = [explicit, ...childDates].filter(Boolean).map((d) => new Date(d).getTime());
  if (candidates.length === 0) return meta.date || null;
  const latest = new Date(Math.max(...candidates)).toISOString().slice(0, 10);
  return latest;
}

export function relativeDate(isoDate) {
  if (!isoDate) return '';
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / 86400000);
  if (days < 1) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 30) return `Updated ${days} days ago`;
  return `Updated ${isoDate}`;
}

export async function slugExists(root, slug) {
  try {
    await fs.access(resolveInside(root, slug));
    return true;
  } catch {
    return false;
  }
}
