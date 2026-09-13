import fs from 'node:fs/promises';
import path from 'node:path';
import { PAGES_ROOT } from './content/paths.mjs';
import { parseFrontmatter } from './content/frontmatter.mjs';

const ROOT = process.cwd();
const DEVLOG_DIR = path.join(ROOT, 'devlog');
const PAGES_OUT = path.join(ROOT, 'pages');
const SEARCH_INDEX = path.join(ROOT, 'search-index.json');

async function collectDraftSlugs() {
  const drafts = [];
  async function walkPages(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const postsDir = path.join(dir, entry.name, 'posts');
      let posts = [];
      try {
        posts = await fs.readdir(postsDir, { withFileTypes: true });
      } catch {
        posts = [];
      }
      for (const p of posts) {
        if (!p.isFile() || !p.name.endsWith('.md')) continue;
        const raw = await fs.readFile(path.join(postsDir, p.name), 'utf8');
        const { meta } = parseFrontmatter(raw);
        if (meta.status === 'draft') {
          drafts.push(meta.slug || p.name.replace(/\.md$/, ''));
        }
      }
      const sub = path.join(dir, entry.name, 'subpages');
      await walkPages(sub);
    }
  }
  await walkPages(PAGES_ROOT);
  return drafts;
}

async function listHtmlFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.endsWith('.html') || e.name.endsWith('.json') || e.name.endsWith('.xml')) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

async function main() {
  const drafts = await collectDraftSlugs();
  if (drafts.length === 0) {
    console.log('leak-check: no drafts found in content; OK.');
    return;
  }
  const files = [
    ...(await listHtmlFiles(DEVLOG_DIR)),
    ...(await listHtmlFiles(PAGES_OUT)),
  ];
  try {
    files.push(SEARCH_INDEX);
  } catch {
    // search-index may not exist yet
  }

  const leaks = [];
  for (const file of files) {
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const slug of drafts) {
      // A draft leaks if its post URL appears in the published output.
      const patterns = [`${slug}.html`, `"/${slug}/"`, `"${slug}"`];
      for (const pat of patterns) {
        if (text.includes(pat)) {
          leaks.push(`${path.relative(ROOT, file)} references draft slug '${slug}'`);
        }
      }
    }
  }

  if (leaks.length > 0) {
    console.error('leak-check FAILED — draft content reached the published output:');
    for (const l of leaks) console.error(`  - ${l}`);
    console.error('Run `npm run build` in publish mode and re-check; fix content files.');
    process.exit(1);
  }
  console.log('leak-check OK — no draft content in published output.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});