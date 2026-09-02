import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT, slugify, resolveInside } from './paths.mjs';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

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

export async function getPageTree(root = PAGES_ROOT) {
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
      // use defaults
    }
    byKey.set(p.dir, {
      slug: p.slug,
      name: meta.name || meta.slug || p.slug,
      description: meta.description || '',
      cover: meta.cover || '',
      order: Number(meta.order ?? 100),
      parent: meta.parent || p.parentPath || null,
      parentPath: p.parentPath || null,
      body,
      dir: p.dir,
    });
  }
  return Array.from(byKey.values());
}

export async function buildPageHierarchy(root = PAGES_ROOT) {
  const pages = await getPageTree(root);
  const postsByPage = new Map();

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

  const bySlugMap = new Map(pages.map((p) => [p.slug, p]));

  function attach(page, parentPath) {
    const children = [];
    for (const other of pages) {
      if (other.parent === page.slug) {
        other.children = attach(other, `${parentPath}/${other.slug}`).sort(byOrder);
        children.push(other);
      }
    }
    return children;
  }

  function byOrder(a, b) {
    return (a.order || 100) - (b.order || 100) || a.name.localeCompare(b.name);
  }

  const roots = pages
    .filter((p) => !p.parent)
    .sort(byOrder)
    .map((p) => {
      p.children = attach(p, p.slug).sort(byOrder);
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
