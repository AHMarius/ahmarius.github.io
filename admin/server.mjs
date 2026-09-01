import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'content', 'devlog');
const ADMIN_DIR = path.join(ROOT, 'admin');
const PORT = Number(process.env.PORT || 4175);
const HOST = '127.0.0.1';

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: markdown.trim() };
  }

  const meta = {};
  let currentKey = null;
  const lines = match[1].split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('  - ') || line.startsWith('- ')) {
      const item = line.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      if (!currentKey) continue;
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(item);
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim();
    const value = keyMatch[2].trim();
    if (value === '') {
      currentKey = key;
      meta[key] = [];
    } else {
      currentKey = null;
      meta[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }

  return { meta, body: match[2].trim() };
}

function toMarkdown(post) {
  const tags = (post.tags || []).map((tag) => `  - ${tag}`).join('\n');
  const technologies = (post.technologies || []).map((tech) => `  - ${tech}`).join('\n');
  const lines = [
    '---',
    `title: "${(post.title || '').replace(/"/g, '\\"')}"`,
    `slug: "${(post.slug || '').replace(/"/g, '\\"')}"`,
    `date: "${(post.date || '').replace(/"/g, '\\"')}"`,
    `updatedDate: "${(post.updatedDate || post.date || '').replace(/"/g, '\\"')}"`,
    `status: "${(post.status || 'published').replace(/"/g, '\\"')}"`,
    `featured: ${post.featured === true ? 'true' : 'false'}`,
    'technologies:',
    technologies || '  - Technology',
    'tags:',
    tags || '  - Notes',
    `project: "${(post.project || '').replace(/"/g, '\\"')}"`,
    '---',
    '',
    post.body || '',
  ];
  return lines.join('\n').trim() + '\n';
}

async function readPosts() {
  const files = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  const markdownFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name);
  const posts = [];

  for (const file of markdownFiles) {
    const content = await fs.readFile(path.join(CONTENT_DIR, file), 'utf8');
    const { meta, body } = parseFrontMatter(content);
    posts.push({
      title: meta.title || file.replace(/\.md$/, ''),
      slug: meta.slug || file.replace(/\.md$/, ''),
      date: meta.date || '',
      updatedDate: meta.updatedDate || meta.date || '',
      status: meta.status || 'published',
      featured: meta.featured === 'true' || meta.featured === true,
      project: meta.project || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
      excerpt: meta.excerpt || body.slice(0, 180),
      body,
      path: path.join(CONTENT_DIR, file),
    });
  }

  return posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

async function getFileForSlug(slug) {
  const entries = await fs.readdir(CONTENT_DIR, { withFileTypes: true });
  const file = entries.find((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name.replace(/\.md$/, '') === slug);
  return file ? path.join(CONTENT_DIR, file.name) : null;
}

async function serveFile(filePath, res) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
    };

    res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return serveFile(path.join(ADMIN_DIR, 'index.html'), res);
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const posts = await readPosts();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(posts.map(({ title, slug, date, status, project, tags, technologies, excerpt, body }) => ({ title, slug, date, status, project, tags, technologies, excerpt, body }))));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) {
    const slug = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
    const filePath = await getFileForSlug(slug);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Post not found.' }));
    }
    const markdown = await fs.readFile(filePath, 'utf8');
    const { meta, body } = parseFrontMatter(markdown);
    const post = {
      title: meta.title || slug,
      slug,
      date: meta.date || '',
      updatedDate: meta.updatedDate || meta.date || '',
      status: meta.status || 'published',
      featured: meta.featured === 'true' || meta.featured === true,
      project: meta.project || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      technologies: Array.isArray(meta.technologies) ? meta.technologies : [],
      excerpt: meta.excerpt || body.slice(0, 180),
      body,
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(post));
  }

  if (req.method === 'POST' && url.pathname === '/api/posts') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const input = JSON.parse(body || '{}');
        const title = String(input.title || '').trim();
        const slug = String(input.slug || '').trim();
        const date = String(input.date || '').trim();
        const status = String(input.status || 'published').trim();

        if (!title || !slug || !date || !input.body) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'Title, slug, date, and body are required.' }));
        }

        const filePath = path.join(CONTENT_DIR, `${slug}.md`);
        await fs.mkdir(CONTENT_DIR, { recursive: true });
        await fs.writeFile(filePath, toMarkdown(input), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ message: `Saved ${slug}.md` }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
    const slug = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
    const filePath = await getFileForSlug(slug);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Post not found.' }));
    }
    await fs.unlink(filePath);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ message: `Deleted ${slug}.md` }));
  }

  if (req.method === 'POST' && url.pathname === '/api/build') {
    const child = spawn('node', ['scripts/build-devlog.mjs'], { cwd: ROOT, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: stderr || stdout || 'Build failed.' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ message: 'Build succeeded.', output: stdout.trim() }));
    });
    return;
  }

  const safePath = path.normalize(url.pathname).replace(/^\/+/, '');
  const requested = path.join(ROOT, safePath);
  if (safePath && requested.startsWith(ROOT) && safePath !== 'content' && safePath !== 'admin') {
    try {
      await fs.access(requested);
      return serveFile(requested, res);
    } catch {
      // continue to 404 below
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Local admin is running at http://${HOST}:${PORT}`);
});
