import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMath, renderBlockMath, rewriteAssetUrls, toText, buildReadTime } from '../content/markdown.mjs';
import { addToc } from '../site/post-head.mjs';

test('renders headings, emphasis, strong', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text.');
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
});

test('renders lists, code, blockquote, tables', () => {
  const html = renderMarkdown('- a\n- b\n\n> quote\n\n```js\nconst x = 1;\n```');
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<pre><code/);

  const table = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(table, /<table>/);
});

test('renders inline math', () => {
  const html = renderMarkdown('Inline $a^2+b^2=c^2$ math.');
  assert.match(html, /<span class="katex"/);
});

test('renders block math', () => {
  const html = renderMarkdown('$$\\int_0^1 x^2 \\, dx$$');
  assert.match(html, /math-block/);
  assert.match(html, /katex/);
});

test('renders multiline display math and TeX delimiters', () => {
  const dollar = renderMarkdown(`$$
\\begin{aligned}
a &= b + c \\\\
d &= e
\\end{aligned}
$$`);
  assert.match(dollar, /math-block/);
  assert.match(dollar, /class="mtable"/);

  const bracket = renderMarkdown('\\[\n\\sum_{i=1}^{n} i\n\\]');
  assert.match(bracket, /math-block/);
  assert.match(bracket, /katex-display/);

  const environment = renderMarkdown('\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\n');
  assert.match(environment, /math-block/);
  assert.match(environment, /katex-display/);
});

test('renders parenthesized inline math and common macros', () => {
  const html = renderMarkdown('A fraction \\(\\frac{a}{b}\\) in \\(\\RR\\).');
  assert.equal((html.match(/class="katex"/g) || []).length, 2);
  assert.match(html, /mathbb/);
});

test('does not render math delimiters inside code or ordinary prices', () => {
  const html = renderMarkdown('`$not_math$` and prices $5 and $10, but $x$ is math.');
  assert.match(html, /<code>\$not_math\$<\/code>/);
  assert.match(html, /prices \$5 and \$10/);
  assert.equal((html.match(/class="katex"/g) || []).length, 1);
});

test('renderInlineMath helper', () => {
  const html = renderInlineMath('\\frac{a}{b}');
  assert.match(html, /katex/);
});

test('toText strips markup', () => {
  assert.equal(toText('# Title\n\n**bold** body'), 'Title bold body');
});

test('buildReadTime', () => {
  assert.equal(buildReadTime('one two three'), '1 min read');
});

test('renders links and horizontal rule', () => {
  const html = renderMarkdown('[link](https://example.com)\n\n---');
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.match(html, /<hr/);
});

test('keeps video embeds and publishes post-local video paths', () => {
  const rendered = renderMarkdown('<video src="assets/demo.mp4" controls preload="metadata"></video>');
  const published = rewriteAssetUrls(rendered, '/assets/posts/math/demo');
  assert.match(published, /<video src="\/assets\/posts\/math\/demo\/demo\.mp4"/);

  const iframe = renderMarkdown('<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/abc12345" title="Embedded video" allowfullscreen></iframe></div>');
  assert.match(iframe, /youtube-nocookie\.com\/embed\/abc12345/);
});

test('generated table of contents links match unique heading ids', () => {
  const body = '<h2>Setup</h2><h2>Setup</h2><h3>Finish</h3>';
  const headings = [
    { level: 2, slug: 'setup', text: 'Setup', rendered: 'Setup' },
    { level: 2, slug: 'setup', text: 'Setup', rendered: 'Setup' },
    { level: 3, slug: 'finish', text: 'Finish', rendered: 'Finish' },
  ];
  const result = addToc(body, headings);
  assert.match(result.html, /id="setup"/);
  assert.match(result.html, /id="setup-1"/);
  assert.match(result.toc, /href="#setup"/);
  assert.match(result.toc, /href="#setup-1"/);
  assert.match(result.toc, /href="#finish"/);
});
