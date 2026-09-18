import fs from 'node:fs/promises';
import path from 'node:path';
import { PAGES_ROOT } from './content/paths.mjs';
import { parseFrontmatter } from './content/frontmatter.mjs';
import { validatePostMeta, validatePageMeta } from './content/schema.mjs';
import { buildPageHierarchy } from './content/pages.mjs';

const ROOT = process.cwd();

const issues = [];
let sawError = false;

function report(severity, file, line = null, message) {
  issues.push({ severity, file, line, message });
  if (severity === 'error') sawError = true;
}

function isAssetRef(target) {
  const t = target.trimStart().replace(/^\.?\//, '');
  return t.startsWith('assets/');
}

async function targetExists(repo, postAssetsDir, target) {
  const name = target.trimStart().replace(/^\.\//, '');
  if (isAssetRef(name)) {
    const stripped = name.replace(/^assets\//, '');
    const resolved = path.join(postAssetsDir, stripped);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }
  // Refs are resolved against the repo root first, then the post assets dir.
  const asRoot = path.join(repo, name);
  try {
    await fs.access(asRoot);
    return true;
  } catch {
    try {
      await fs.access(path.join(postAssetsDir, name));
      return true;
    } catch {
      return false;
    }
  }
}

async function lintMarkdownEmbeddedLinks(repo, file, body, postAssetsDir) {
  // `](./...` inline links
  for (const [idx, line] of body.split('\n').entries()) {
    let rest = line;
    while (true) {
      const start = rest.indexOf('](./');
      if (start === -1) break;
      const after = rest.slice(start + 2);
      const end = after.indexOf(')');
      const target = end === -1 ? after : after.slice(0, end);
      if (target && !(await targetExists(repo, postAssetsDir, target))) {
        report('error', file, idx + 1, `Broken internal link/image: ${target}`);
      }
      rest = after.slice(end === -1 ? after.length : end);
    }
  }
  let i = body;
  while (true) {
    const start = i.indexOf('![](');
    if (start === -1) break;
    const after = i.slice(start + 4);
    const end = after.indexOf(')');
    const target = end === -1 ? after : after.slice(0, end);
    if (target && !target.startsWith('http') && !(await targetExists(repo, postAssetsDir, target))) {
      report('error', file, lineOf(i, start), `Missing image asset: ${target}`);
    }
    i = after.slice(end === -1 ? after.length : end);
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

async function walkContent(dir, pageSlug) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const file = path.join(dir, entry.name);
    const raw = await fs.readFile(file, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const fileRel = path.relative(ROOT, file);

    for (const message of validatePostMeta(meta)) {
      report('error', fileRel, null, message);
    }
    if (meta.page && pageSlug && meta.page !== pageSlug) {
      report('error', fileRel, null, `page '${meta.page}' does not match containing page '${pageSlug}'.`);
    }
    const slug = meta.slug || entry.name.replace(/\.md$/, '');
    await lintMarkdownEmbeddedLinks(ROOT, fileRel, body, path.join(dir, slug, 'assets'));
  }
}

async function walkPage(pageDir) {
  const pageYml = path.join(pageDir, 'page.yml');
  let pageSlug = path.basename(pageDir);
  try {
    const raw = await fs.readFile(pageYml, 'utf8');
    const { meta } = parseFrontmatter(raw);
    pageSlug = meta.slug || pageSlug;
    const pageRel = path.relative(ROOT, pageYml);
    for (const message of validatePageMeta(meta)) {
      report('error', pageRel, null, message);
    }
    if (meta.cover) {
      const cover = String(meta.cover).replace(/^\/+/, '');
      const candidate = cover.includes('/') ? path.join(ROOT, cover) : path.join(pageDir, cover);
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) throw new Error('not a file');
      } catch {
        report('error', pageRel, null, `Page cover does not exist: ${meta.cover}`);
      }
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      report('error', path.relative(ROOT, pageDir), null, 'Page directory is missing page.yml.');
    } else {
      report('error', path.relative(ROOT, pageYml), null, `Could not read page metadata: ${error.message || error}`);
    }
  }

  await walkContent(path.join(pageDir, 'posts'), pageSlug);
  const subpagesDir = path.join(pageDir, 'subpages');
  const children = await fs.readdir(subpagesDir, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    if (child.isDirectory()) await walkPage(path.join(subpagesDir, child.name));
  }
}

async function main() {
  let pages;
  try {
    pages = await fs.readdir(PAGES_ROOT, { withFileTypes: true });
  } catch {
    report('error', 'content/pages', null, 'content/pages directory is missing.');
    pages = [];
  }

  for (const entry of pages) {
    if (!entry.isDirectory()) continue;
    const pageDir = path.join(PAGES_ROOT, entry.name);
    await walkPage(pageDir);
  }

  try {
    await buildPageHierarchy(PAGES_ROOT, true);
  } catch (error) {
    report('error', 'content/pages', null, String(error?.message || error));
  }

  // sort: errors first, then by file/line
  issues.sort((a, b) => (a.severity === b.severity ? a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) : a.severity === 'error' ? -1 : 1));

  for (const issue of issues) {
    const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    console.log(`${issue.severity.padEnd(7)} ${loc}  ${issue.message}`);
  }
  console.log(`\nlint: ${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings`);
  process.exitCode = sawError ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
