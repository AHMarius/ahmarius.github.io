import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECTS_DB = path.join(ROOT, 'content', 'projects', 'catalog.sqlite3');
export const PROJECTS_TEMPLATE = path.join(ROOT, 'content', 'projects', 'projects.template.html');
export const PROJECTS_OUTPUT = path.join(ROOT, 'projects.html');
export const ADMIN_PROJECTS_SNAPSHOT = path.join(ROOT, 'admin-app', 'public', 'projects.json');

const START = '<!-- PROJECTS_DB_START -->';
const END = '<!-- PROJECTS_DB_END -->';

const schema = `
  CREATE TABLE IF NOT EXISTS portfolio_projects (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    date_label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    gallery_folder TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    article_html TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
  );
`;

function openProjectsDb(dbPath = PROJECTS_DB) {
  const resolved = path.resolve(dbPath);
  if (fsSync.existsSync(resolved) && fsSync.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`Refusing to open projects database through a symbolic link: ${resolved}`);
  }
  fsSync.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;');
  db.exec(schema);
  return db;
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(html) {
  return decodeHtml(String(html).replace(/<[^>]+>/g, ' '));
}

function first(article, expression) {
  const match = article.match(expression);
  return match ? textOf(match[1]) : '';
}

export function extractProjects(html) {
  const main = html.match(/<main\b[^>]*class="[^"]*project-feed[^"]*"[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) throw new Error('Could not find the project feed in projects.html.');
  const articles = main[1].match(/<article\b[\s\S]*?<\/article>/gi) || [];
  return articles.map((article, sortOrder) => {
    const slugMatch = article.match(/\bid="project-([^"]+)"/i);
    if (!slugMatch) throw new Error(`Project card ${sortOrder + 1} has no project-* id.`);
    const gallery = article.match(/\bdata-gallery-folder="([^"]+)"/i);
    const tags = Array.from(article.matchAll(/<li\b[^>]*class="[^"]*tag-bubble[^"]*"[^>]*>([\s\S]*?)<\/li>/gi), (m) => textOf(m[1]));
    const descriptions = Array.from(article.matchAll(/<p\b[^>]*class="[^"]*project-description[^"]*"[^>]*>([\s\S]*?)<\/p>/gi), (m) => textOf(m[1]));
    return {
      slug: slugMatch[1],
      name: first(article, /<h2\b[^>]*class="[^"]*project-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i),
      dateLabel: first(article, /<span\b[^>]*class="[^"]*badge-date[^"]*"[^>]*>([\s\S]*?)<\/span>/i),
      status: first(article, /<span\b[^>]*class="[^"]*badge-status[^"]*"[^>]*>([\s\S]*?)<\/span\s*>/i),
      galleryFolder: gallery ? decodeHtml(gallery[1]) : '',
      tags,
      description: descriptions.join('\n\n'),
      articleHtml: article,
      sortOrder,
    };
  });
}

export function replaceProjectFeed(html, replacement) {
  const feed = /(<main\b[^>]*class="[^"]*project-feed[^"]*"[^>]*>)[\s\S]*?(<\/main>)/i;
  if (!feed.test(html)) throw new Error('Could not find project feed markers.');
  return html.replace(feed, `$1\n      ${START}\n${replacement}\n      ${END}\n    $2`);
}

export async function migrateProjects(sourcePath = PROJECTS_OUTPUT, dbPath = PROJECTS_DB, templatePath = PROJECTS_TEMPLATE) {
  const html = await fs.readFile(sourcePath, 'utf8');
  const projects = extractProjects(html);
  if (!projects.length) throw new Error('Refusing to replace the project page because no project cards were found.');
  const db = openProjectsDb(dbPath);
  const insert = db.prepare(`
    INSERT INTO portfolio_projects
      (slug, name, date_label, status, gallery_folder, tags, description, article_html, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM portfolio_projects');
    for (const project of projects) {
      insert.run(project.slug, project.name, project.dateLabel, project.status,
        project.galleryFolder, JSON.stringify(project.tags), project.description,
        project.articleHtml, project.sortOrder, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
  await fs.writeFile(templatePath, replaceProjectFeed(html, ''), 'utf8');
  return projects;
}

export function listProjects(dbPath = PROJECTS_DB) {
  const db = openProjectsDb(dbPath);
  try {
    return db.prepare(`
      SELECT slug, name, date_label, status, gallery_folder, tags, description,
             article_html, sort_order, updated_at
      FROM portfolio_projects ORDER BY sort_order, id
    `).all().map((row) => ({ ...row, tags: JSON.parse(row.tags || '[]') }));
  } finally {
    db.close();
  }
}

export async function buildProjects({ outputPath = PROJECTS_OUTPUT, snapshotPath = ADMIN_PROJECTS_SNAPSHOT } = {}) {
  const template = await fs.readFile(PROJECTS_TEMPLATE, 'utf8');
  const projects = listProjects();
  const cards = projects.map((project) => `      ${project.article_html}`).join('\n\n');
  const output = template.replace(`${START}\n\n      ${END}`, `${START}\n${cards}\n      ${END}`);
  if (output === template) throw new Error('Project template database markers are missing or malformed.');
  await fs.writeFile(outputPath, output, 'utf8');
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(projects)}\n`, 'utf8');
  return projects;
}

async function main() {
  const command = process.argv[2] || 'build';
  if (command === 'migrate') {
    const projects = await migrateProjects();
    console.log(`Migrated ${projects.length} project cards into ${PROJECTS_DB}`);
  } else if (command === 'build') {
    const projects = await buildProjects();
    console.log(`Rendered ${projects.length} project cards from ${PROJECTS_DB}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
