import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDevlog, parseMode } from './build-devlog.mjs';
import { buildPages } from './build-pages.mjs';

const ROOT = process.cwd();
const KATEX_SOURCE = path.join(ROOT, 'node_modules', 'katex', 'dist', 'katex.min.css');
const KATEX_DEST = path.join(ROOT, 'assets', 'css', 'katex.min.css');

const runMode = parseMode(process.argv);

async function copyKatexAssets() {
  try {
    await fs.mkdir(path.join(ROOT, 'assets', 'css'), { recursive: true });
    await fs.copyFile(KATEX_SOURCE, KATEX_DEST);
  } catch (error) {
    console.warn('Could not copy KaTeX CSS:', error.message);
  }
}

async function buildSite() {
  await copyKatexAssets();
  const devlogResult = await buildDevlog({ copyDist: false, mode: runMode });
  const pagesResult = await buildPages({ mode: runMode });
  return { devlogResult, pagesResult };
}

async function main() {
  await buildSite();
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { buildSite };
