import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = path.resolve(process.cwd());

test('lint recursively validates posts in nested sub-pages', async () => {
  const id = `lint-fixture-${process.pid}-${Date.now().toString(36)}`;
  const root = path.join(REPO, 'content', 'pages', id);
  const child = path.join(root, 'subpages', `${id}-child`);
  await fs.mkdir(path.join(child, 'posts'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, 'page.yml'), `---\nname: "Lint root"\nslug: "${id}"\n---\n`),
    fs.writeFile(path.join(child, 'page.yml'), `---\nname: "Lint child"\nslug: "${id}-child"\nparent: "${id}"\n---\n`),
    fs.writeFile(path.join(child, 'posts', 'broken.md'), `---\ntitle: "Broken nested post"\nslug: "broken"\nstatus: "published"\npage: "${id}-child"\n---\nBody\n`),
  ]);
  try {
    await assert.rejects(exec('node', ['scripts/lint.mjs'], { cwd: REPO }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
