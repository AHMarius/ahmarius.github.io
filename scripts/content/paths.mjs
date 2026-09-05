import path from 'node:path';

export const CONTENT_ROOT = path.join(process.cwd(), 'content');
export const PAGES_ROOT = path.join(CONTENT_ROOT, 'pages');
export const DEVLOG_ROOT = path.join(CONTENT_ROOT, 'devlog');

export function slugify(value = '') {
  const normalized = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = normalized
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled';
}

export function sanitizeFilename(name = '') {
  const base = path.basename(String(name).trim());
  const slug = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'asset';
}

export function normalizePageSlug(slug = '') {
  return slugify(slug.replace(/[\\/]+/g, '-'));
}

export function isInsideRepo(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveInside(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  if (!isInsideRepo(root, candidate)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return candidate;
}

export function ensureSafeRelative(relativePath = '') {
  const cleaned = String(relativePath).replace(/\\/g, '/');
  if (path.isAbsolute(cleaned) || cleaned.split('/').includes('..')) {
    throw new Error(`Unsafe path: ${relativePath}`);
  }
  return cleaned;
}
