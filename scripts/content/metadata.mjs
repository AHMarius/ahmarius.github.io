import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT, DEVLOG_ROOT } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { buildPageHierarchy } from './pages.mjs';

function isoFrom(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function postDates(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const { meta } = parseFrontmatter(raw);
    return {
      date: isoFrom(meta.date),
      updatedDate: isoFrom(meta.updatedDate || meta.date),
    };
  } catch {
    return { date: null, updatedDate: null };
  }
}

export function latestOf(...dates) {
  const valid = dates.filter(Boolean).map((d) => new Date(d).getTime());
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid)).toISOString().slice(0, 10);
}

export async function computePageUpdatedDate(pageDir) {
  const dates = [];
  const postsDir = path.join(pageDir, 'posts');
  try {
    const entries = await fs.readdir(postsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const { updatedDate } = await postDates(path.join(postsDir, entry.name));
        if (updatedDate) dates.push(updatedDate);
      }
    }
  } catch {
    // ignore
  }
  const subDir = path.join(pageDir, 'subpages');
  try {
    const entries = await fs.readdir(subDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const child = await computePageUpdatedDate(path.join(subDir, entry.name));
        if (child) dates.push(child);
      }
    }
  } catch {
    // ignore
  }
  return latestOf(...dates);
}

export async function buildUpdatedIndex(root = PAGES_ROOT) {
  const { pages } = await buildPageHierarchy(root);
  const index = new Map();
  for (const page of pages) {
    const updated = await computePageUpdatedDate(page.dir);
    index.set(page.slug, updated);
  }
  return index;
}
