import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = path.resolve(process.cwd());

async function runBuild() {
  await exec('node', ['scripts/build-site.mjs'], { cwd: REPO });
}

test('build generates pages.html index', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'pages.html'), 'utf8');
  assert.match(html, /class="page-card"/);
});

test('build generates nested page landing and post page', async () => {
  await runBuild();
  await fs.access(path.join(REPO, 'pages', 'fluid-dynamics', 'index.html'));
  await fs.access(path.join(REPO, 'pages', 'fluid-dynamics', 'first-solver.html'));
  await fs.access(path.join(REPO, 'pages', 'gpu-port', 'index.html'));
});

test('generated post page contains equations', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'pages', 'fluid-dynamics', 'first-solver.html'), 'utf8');
  assert.match(html, /katex/);
});

test('generated page includes breadcrumb', async () => {
  await runBuild();
  const html = await fs.readFile(path.join(REPO, 'pages', 'fluid-dynamics', 'index.html'), 'utf8');
  assert.match(html, /page-breadcrumb/);
});

test('legacy devlog.html still generates', async () => {
  await runBuild();
  await fs.access(path.join(REPO, 'devlog.html'));
});

test('legacy build-devlog.mjs still runs standalone', async () => {
  await exec('node', ['scripts/build-devlog.mjs'], { cwd: REPO });
  await fs.access(path.join(REPO, 'devlog.html'));
});

test('draft posts do not appear in public output', async () => {
  await runBuild();
  await assert.rejects(fs.access(path.join(REPO, 'pages', 'fluid-dynamics', 'hidden-draft-secret.html')));
});
