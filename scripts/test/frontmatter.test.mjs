import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter } from '../content/frontmatter.mjs';

test('parse frontmatter with string fields', () => {
  const src = `---
title: "Hello"
slug: "hello"
date: "2026-09-01"
status: "published"
---
Body text
`;
  const { meta, body } = parseFrontmatter(src);
  assert.equal(meta.title, 'Hello');
  assert.equal(meta.slug, 'hello');
  assert.equal(meta.status, 'published');
  assert.equal(body, 'Body text');
});

test('parse frontmatter with list fields', () => {
  const src = `---
title: "X"
tags:
  - A
  - B
technologies:
  - C++
---
Body
`;
  const { meta } = parseFrontmatter(src);
  assert.deepEqual(meta.tags, ['A', 'B']);
  assert.deepEqual(meta.technologies, ['C++']);
});

test('parse without frontmatter', () => {
  const { meta, body } = parseFrontmatter('Just a body');
  assert.deepEqual(meta, {});
  assert.equal(body, 'Just a body');
});

test('serialize round-trip', () => {
  const meta = { title: 'Hi', tags: ['a', 'b'], featured: true, slug: 'hi' };
  const md = serializeFrontmatter(meta, 'Body');
  const { meta: parsed, body } = parseFrontmatter(md);
  assert.equal(parsed.title, 'Hi');
  assert.deepEqual(parsed.tags, ['a', 'b']);
  assert.equal(parsed.featured, 'true');
  assert.equal(body, 'Body');
});

test('serialize empty list', () => {
  const md = serializeFrontmatter({ tags: [] }, '');
  const { meta } = parseFrontmatter(md);
  assert.deepEqual(meta.tags, []);
});

test('detect invalid frontmatter (missing closing fence)', () => {
  // A malformed frontmatter without closing fence: trailing bare word is
  // captured as a metadatum rather than silently becoming body content.
  const { meta, body } = parseFrontmatter('---\ntitle: x\nbody');
  assert.equal(meta.title, 'x');
  assert.equal(body, '');
});
