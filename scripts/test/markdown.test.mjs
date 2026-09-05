import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInlineMath, renderBlockMath, toText, buildReadTime } from '../content/markdown.mjs';

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
