import path from 'node:path';
import fs from 'node:fs/promises';
import { PAGES_ROOT, slugify, sanitizeFilename, resolveInside } from './paths.mjs';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { truncateText, buildReadTime } from './markdown.mjs';

const POSTS_DIR = 'posts';
const ASSETS_DIR = 'assets';

export function postFilename(slug) {
  return `${slug}.md`;
}

export async function readPost(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const slug = meta.slug || path.basename(filePath).replace(/\.md$/, '');
  return {
    title: meta.title || slug,
    slug,
    date: meta.date || '',
    updatedDate: meta.updatedDate || meta.date || '',
    status: meta.status || 'draft',
    featured: meta.featured === true || meta.featured === 'true',
    excerpt: meta.excerpt || truncateText(body, 180),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
    project: meta.project || '',
    page: meta.page || '',
    subtitle: meta.subtitle || '',
    cover: meta.cover || '',
    readTime: buildReadTime(body),
    body,
    meta,
    path: filePath,
  };
}

export async function writePost(filePath, post) {
  const tags = Array.isArray(post.tags) ? post.tags.filter(Boolean) : [];
  const technologies = Array.isArray(post.technologies) ? post.technologies.filter(Boolean) : [];
  const today = new Date().toISOString().slice(0, 10);
  const meta = {
    title: String(post.title || '').trim() || 'Untitled',
    slug: String(post.slug || '').trim() || slugify(post.title || 'untitled'),
    date: String(post.date || today),
  };
  if (post.updatedDate) meta.updatedDate = String(post.updatedDate);
  if (post.status) meta.status = String(post.status);
  if (post.featured === true) meta.featured = true;
  if (post.page) meta.page = String(post.page);
  if (post.project) meta.project = String(post.project);
  if (post.subtitle) meta.subtitle = String(post.subtitle);
  if (post.cover) meta.cover = String(post.cover);
  if (post.excerpt) meta.excerpt = truncateText(String(post.excerpt), 300);
  if (tags.length) meta.tags = tags;
  if (technologies.length) meta.technologies = technologies;

  const content = serializeFrontmatter(meta, String(post.body || ''));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, content);
  return meta.slug;
}

export async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);
}

export async function deletePost(filePath) {
  await fs.unlink(filePath);
  const assetsDir = path.join(path.dirname(filePath), ASSETS_DIR);
  try {
    await fs.rm(assetsDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export async function listPostsUnder(pageDir) {
  const postsDir = path.join(pageDir, POSTS_DIR);
  const results = [];
  let entries = [];
  try {
    entries = await fs.readdir(postsDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    try {
      results.push(await readPost(path.join(postsDir, entry.name)));
    } catch {
      // skip
    }
  }
  return results.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

export async function importAssetInto(postFile, sourcePath, originalName, mime) {
  const assetsDir = path.join(path.dirname(postFile), ASSETS_DIR);
  await fs.mkdir(assetsDir, { recursive: true });
  const ext = path.extname(originalName) || extForMime(mime);
  const base = sanitizeFilename(originalName.slice(0, -path.extname(originalName).length));
  let candidate = `${base}${ext}`;
  let counter = 1;
  while (true) {
    try {
      await fs.access(resolveInside(assetsDir, candidate));
      candidate = `${base}-${counter}${ext}`;
      counter += 1;
    } catch {
      break;
    }
  }
  const dest = path.join(assetsDir, candidate);
  await fs.copyFile(sourcePath, dest);
  return { fileName: candidate, relPath: `assets/${candidate}` };
}

function extForMime(mime = '') {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
  };
  return map[mime] || '.bin';
}
