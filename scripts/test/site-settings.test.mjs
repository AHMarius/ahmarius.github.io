import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeAnnouncementLink,
  publicSiteSettings,
  writePublicSiteSettings,
} from '../site/site-settings.mjs';

test('public site settings expose only normalized announcement fields', () => {
  const settings = publicSiteSettings({
    announcement: {
      enabled: true,
      text: '  Shipping   a new portfolio update  ',
      url: '/projects.html#project-snek',
      link_label: 'See the work',
      dismissible: false,
    },
    private_token: 'must-not-leak',
  });
  assert.deepEqual(settings, {
    announcement: {
      enabled: true,
      text: 'Shipping a new portfolio update',
      url: '/projects.html#project-snek',
      link_label: 'See the work',
      dismissible: false,
    },
  });
  assert.doesNotMatch(JSON.stringify(settings), /must-not-leak/);
});

test('announcement links reject unsafe and credential-bearing URLs', () => {
  assert.equal(normalizeAnnouncementLink('https://example.com/news'), 'https://example.com/news');
  assert.throws(() => normalizeAnnouncementLink('javascript:alert(1)'));
  assert.throws(() => normalizeAnnouncementLink('//evil.example/path'));
  assert.throws(() => normalizeAnnouncementLink('https://user:pass@example.com/'));
});

test('site build writes the public settings asset', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-settings-'));
  try {
    await fs.mkdir(path.join(root, 'content'), { recursive: true });
    await fs.writeFile(path.join(root, 'content', 'site-settings.json'), JSON.stringify({
      announcement: { enabled: true, text: 'Hello builders', dismissible: true },
      giscus: { repo_id: 'public-but-not-needed-at-runtime' },
    }));
    await writePublicSiteSettings(root);
    const output = JSON.parse(await fs.readFile(
      path.join(root, 'assets', 'site', 'site-settings.json'),
      'utf8',
    ));
    assert.equal(output.announcement.text, 'Hello builders');
    assert.equal(output.giscus, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

