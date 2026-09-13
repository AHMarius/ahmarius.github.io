import path from 'node:path';
import fs from 'node:fs/promises';

// Post-local assets (content/pages/<page>/posts/<slug>/assets) are copied to a
// stable, published URL under assets/posts/<page>/<slug>/ and body image refs
// are rewritten by rewriteAssetUrls() to point there.
const ROOT = process.cwd();
export const POST_ASSETS_DIR = path.join(ROOT, 'assets', 'posts');

/** Public URL prefix under which a post's local assets are served. */
export function postAssetsBase(page, slug) {
  return `/assets/posts/${encodeURIComponent(page)}/${encodeURIComponent(slug)}`;
}

/** Copy one post's local assets folder into the published assets tree. */
export async function copyPostAssets(post) {
  const page = post.page || post.pageSlug;
  const src = path.join(ROOT, 'content', 'pages', page, 'posts', post.slug, 'assets');
  const dst = path.join(POST_ASSETS_DIR, page, post.slug);
  let entries = [];
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  await fs.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await fs.copyFile(path.join(src, entry.name), path.join(dst, entry.name)).catch(() => {});
  }
}

/** Copy every given post's assets (no cleanup — safe to call from multiple builds). */
export async function copyAllPostAssets(posts) {
  for (const post of posts) {
    await copyPostAssets(post);
  }
}

/** Remove the whole published assets tree (call once, before copying). */
export async function removePostAssets() {
  await fs.rm(POST_ASSETS_DIR, { recursive: true, force: true });
}