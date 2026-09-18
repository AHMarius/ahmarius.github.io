import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(process.cwd());
const SCRIPT = await fs.readFile(path.join(ROOT, 'assets/js/script.js'), 'utf8');
const DEVLOG = await fs.readFile(path.join(ROOT, 'assets/js/devlog.js'), 'utf8');
const POST = await fs.readFile(path.join(ROOT, 'assets/js/post.js'), 'utf8');

function dom(html) {
  return new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://ahmarius.github.io/index.html',
  });
}

function evaluateWithoutDomReady(window, source) {
  const listeners = [];
  const original = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') listeners.push(listener);
    else original(type, listener, options);
  };
  window.eval(source);
  window.document.addEventListener = original;
  return listeners;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('home preload markup is valid and theme toggle is not duplicated inline', async () => {
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<linklam/i);
  assert.doesNotMatch(html, /const themeToggle\s*=/);
});

test('site theme follows the system until the user chooses an explicit theme', () => {
  const page = dom('<!doctype html><html><body></body></html>');
  page.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  evaluateWithoutDomReady(page.window, SCRIPT);
  page.window.initThemeToggle();
  assert.equal(page.window.document.documentElement.dataset.theme, 'dark');
  const button = page.window.document.querySelector('.theme-toggle');
  assert.ok(button);
  button.click();
  assert.equal(page.window.document.documentElement.dataset.theme, 'light');
  assert.equal(page.window.localStorage.getItem('theme'), 'light');
  assert.equal(page.window.document.querySelectorAll('.theme-toggle').length, 1);
});

test('GitHub stats treats non-OK and malformed responses as cached fallback data', async () => {
  for (const response of [
    { ok: false, status: 403, json: async () => ({ message: 'rate limited' }) },
    { ok: true, status: 200, json: async () => ({ public_repos: 'unknown' }) },
  ]) {
    const page = dom('<span id="github-repo-count"></span><span id="github-repo-status"></span>');
    page.window.fetch = async () => response;
    evaluateWithoutDomReady(page.window, SCRIPT);
    await page.window.initGitHubStats();
    assert.equal(page.window.document.querySelector('#github-repo-count').textContent, '20+');
    assert.equal(page.window.document.querySelector('#github-repo-status').textContent, 'cached');
  }
});

test('single-image galleries omit inert arrows and generate readable fallback alt text', () => {
  const page = dom('<div id="gallery"></div>');
  evaluateWithoutDomReady(page.window, SCRIPT);
  page.window.renderGallery(page.window.document.querySelector('#gallery'), 'Tower/', ['tower_final-shot.png']);
  assert.equal(page.window.document.querySelectorAll('.carousel-btn').length, 0);
  assert.equal(page.window.document.querySelector('img').alt, 'tower final shot screenshot');
});

test('project expansion uses a dedicated button without nested button semantics on the card', () => {
  const page = dom('<article class="project-card"><header class="card-header"><h2 class="project-title">Demo</h2></header><a href="#demo">Open</a></article>');
  evaluateWithoutDomReady(page.window, SCRIPT);
  page.window.initProjectKeyboardControls();
  const card = page.window.document.querySelector('.project-card');
  const toggle = page.window.document.querySelector('.project-expand-toggle');
  assert.equal(card.hasAttribute('role'), false);
  assert.equal(card.hasAttribute('tabindex'), false);
  assert.ok(toggle);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(card.classList.contains('is-expanded'), true);
});

test('hamburger closes for nested link clicks and Escape restores button focus', () => {
  const page = dom('<button id="hamburger-btn"><span></span></button><ul id="mobile-menu" hidden><li><a href="#x"><span id="nested">Open</span></a></li></ul>');
  evaluateWithoutDomReady(page.window, SCRIPT);
  page.window.initHamburgerMenu();
  const button = page.window.document.querySelector('#hamburger-btn');
  const menu = page.window.document.querySelector('#mobile-menu');
  button.click();
  assert.equal(menu.hidden, false);
  page.window.document.querySelector('#nested').click();
  assert.equal(menu.hidden, true);
  button.click();
  page.window.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(page.window.document.activeElement, button);
});

test('site search closes on backdrop, restores focus, rejects unsafe URLs, and tolerates malformed indexes', async () => {
  const page = dom(`
    <button id="nav-search-btn" data-index-url="search-index.json">Search</button>
    <div id="search-overlay" hidden><div class="search-overlay-panel">
      <input id="search-input" /><div id="search-results"></div><button id="search-close">Close</button>
    </div></div>`);
  let payload = [{ title: 'Unsafe result', excerpt: '', kind: 'post', url: 'javascript:alert(1)' }];
  page.window.fetch = async () => ({ ok: true, json: async () => payload });
  evaluateWithoutDomReady(page.window, SCRIPT);
  page.window.initSiteSearch();
  const button = page.window.document.querySelector('#nav-search-btn');
  const overlay = page.window.document.querySelector('#search-overlay');
  const input = page.window.document.querySelector('#search-input');
  button.focus();
  button.click();
  input.value = 'unsafe';
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await flush();
  assert.equal(page.window.document.querySelector('.search-result').getAttribute('href'), '#');
  overlay.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  assert.equal(overlay.hidden, true);
  assert.equal(page.window.document.activeElement, button);

  payload = { error: 'not an array' };
  button.click();
  input.value = 'anything';
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await flush();
  assert.match(page.window.document.querySelector('#search-results').textContent, /No results/);
});

test('devlog reset remains enabled for non-default filters even when every card matches', () => {
  const page = dom(`
    <input id="devlog-search" /><select id="devlog-tag"><option value="all">all</option></select>
    <select id="devlog-tech"><option value="all">all</option></select><select id="devlog-project"><option value="all">all</option></select>
    <select id="devlog-status"><option value="all">all</option></select>
    <select id="devlog-sort"><option value="newest">newest</option><option value="oldest">oldest</option></select>
    <button id="devlog-reset"></button><button id="devlog-view"></button><span id="devlog-count"></span><div id="devlog-empty"></div>
    <div class="devlog-grid"><article class="devlog-card" data-search="demo" data-date="2026-01-01"></article></div>`);
  const [ready] = evaluateWithoutDomReady(page.window, DEVLOG);
  ready();
  const reset = page.window.document.querySelector('#devlog-reset');
  assert.equal(reset.disabled, true);
  const sort = page.window.document.querySelector('#devlog-sort');
  sort.value = 'oldest';
  sort.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.equal(reset.disabled, false);
});

test('post TOC escapes heading text, cancelled sharing has no clipboard side effect, and no duplicate back-to-top is created', async () => {
  const page = dom(`
    <article class="devlog-article"><h2>&lt;img src=x onerror=alert(1)&gt;</h2><h2>Second</h2><h3>Third</h3></article>
    <button class="devlog-share" data-url="/safe.html">Share</button>`);
  let clipboardWrites = 0;
  page.window.navigator.share = async () => { throw new page.window.DOMException('cancelled', 'AbortError'); };
  Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async () => { clipboardWrites += 1; } } });
  const [ready] = evaluateWithoutDomReady(page.window, POST);
  ready();
  assert.equal(page.window.document.querySelector('.post-toc img'), null);
  assert.match(page.window.document.querySelector('.post-toc').innerHTML, /&lt;img/);
  page.window.document.querySelector('.devlog-share').click();
  await flush();
  assert.equal(clipboardWrites, 0);
  assert.equal(page.window.document.querySelectorAll('.back-to-top').length, 0);
});
