import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC_PAGES = [
  'index.html',
  'about.html',
  'projects.html',
  'games.html',
  'game-player.html',
  'pages.html',
  'devlog.html',
  'devlog/index.html',
];

async function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), 'utf8');
}

test('public buttons have explicit behavior-safe types and unique ids', async () => {
  for (const page of PUBLIC_PAGES) {
    const html = await read(page);
    const buttons = [...html.matchAll(/<button\b([^>]*)>/gi)];
    for (const button of buttons) {
      assert.match(button[1], /\btype\s*=\s*["'](?:button|submit|reset)["']/i, `${page} has a button without an explicit type: ${button[0]}`);
    }

    const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page} contains duplicate ids`);
    assert.doesNotMatch(html, /\bonclick\s*=/i, `${page} uses a fragile inline click handler`);
  }
});

test('internal navigation targets and fragment buttons resolve', async () => {
  for (const page of PUBLIC_PAGES) {
    const html = await read(page);
    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (/^(?:https?:|mailto:|data:|javascript:|\/\/)/i.test(reference)) continue;

      const [filePart, fragment] = reference.split('#', 2);
      const targetPath = filePart
        ? path.resolve(ROOT, path.dirname(page), filePart.split('?')[0])
        : path.resolve(ROOT, page);
      await assert.doesNotReject(fs.access(targetPath), `${page} points to missing ${reference}`);

      if (fragment && targetPath.endsWith('.html')) {
        const targetHtml = targetPath === path.resolve(ROOT, page) ? html : await fs.readFile(targetPath, 'utf8');
        const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(targetHtml, new RegExp(`\\bid=["']${escaped}["']`), `${page} points to missing fragment ${reference}`);
      }
    }
  }
});

test('project action buttons expose valid secure URLs', async () => {
  const html = await read('projects.html');
  const urls = [...html.matchAll(/\bdata-url=["']([^"']+)["']/gi)].map((match) => match[1]);
  assert.ok(urls.length > 0, 'projects.html should contain project actions');
  for (const value of urls) {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:', `Project action should use HTTPS: ${value}`);
  }
});

test('home page has one shared theme control and working CV request entry points', async () => {
  const html = await read('index.html');
  assert.match(html, /id="downloadCvBtn"/);
  assert.match(html, /id="navCvLink"/);
  assert.match(html, /navCvLink\.addEventListener\("click", openCvModal\)/);
  assert.doesNotMatch(html, /createElement\("button"\)/, 'home page must not create a second theme button');
  assert.match(html, /<script defer src="assets\/js\/script\.js"><\/script>/);
});

test('project card toggle has matching script and style behavior', async () => {
  const [script, postScript, css] = await Promise.all([
    read('assets/js/script.js'),
    read('assets/js/post.js'),
    read('assets/css/style.css'),
  ]);
  assert.match(script, /classList\.toggle\("keyboard-open"\)/);
  assert.match(css, /\.project-card\.keyboard-open\s*\{/);
  assert.doesNotMatch(postScript, /createElement\("button"\)/, 'post pages must reuse the shared back-to-top control');
});
