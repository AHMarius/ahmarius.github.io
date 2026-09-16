import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProjects, listProjects, PROJECTS_TEMPLATE } from '../projects-db.mjs';

test('project catalog preserves and renders every migrated project card', async () => {
  const projects = listProjects();
  assert.equal(projects.length, 19);
  assert.deepEqual(projects.map((project) => project.sort_order), [...Array(19).keys()]);
  assert.ok(projects.every((project) => project.name && project.date_label && project.status));

  const allMarkup = projects.map((project) => project.article_html).join('\n');
  assert.match(allMarkup, /Because of my lack of experience managing a team/);
  assert.match(allMarkup, /AI-powered personalized travel itinerary generation/);
  assert.match(allMarkup, /Traffic Optimisation Platform/);

  const template = await fs.readFile(PROJECTS_TEMPLATE, 'utf8');
  assert.doesNotMatch(template, /<article\b/);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'projects-db-'));
  const outputPath = path.join(temp, 'projects.html');
  const snapshotPath = path.join(temp, 'projects.json');
  await buildProjects({ outputPath, snapshotPath });
  const output = await fs.readFile(outputPath, 'utf8');
  assert.equal((output.match(/<article\b/g) || []).length, 19);
  assert.match(output, /id="project-turistrap"/);
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  assert.equal(snapshot.length, 19);
  assert.match(snapshot[1].article_html, /lack of experience managing a team/);
});
