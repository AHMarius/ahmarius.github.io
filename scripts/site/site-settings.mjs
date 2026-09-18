import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_REL = path.join('content', 'site-settings.json');
const PUBLIC_REL = path.join('assets', 'site', 'site-settings.json');

function oneLine(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeAnnouncementLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length > 500 || /[\u0000-\u001f\u007f\\]/.test(raw)) {
    throw new Error('Announcement link contains unsupported characters.');
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Announcement link must be an HTTPS URL or a root-relative site path.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Announcement link must be an HTTPS URL or a root-relative site path.');
  }
  return url.href;
}

export function publicSiteSettings(source = {}) {
  const raw = source?.announcement && typeof source.announcement === 'object'
    ? source.announcement
    : {};
  const text = oneLine(raw.text, 180);
  const url = normalizeAnnouncementLink(raw.url);
  const linkLabel = url ? oneLine(raw.link_label, 40) || 'Learn more' : '';
  return {
    announcement: {
      enabled: Boolean(raw.enabled && text),
      text,
      url,
      link_label: linkLabel,
      dismissible: raw.dismissible !== false,
    },
  };
}

export async function writePublicSiteSettings(root = process.cwd()) {
  let source = {};
  try {
    source = JSON.parse(await fs.readFile(path.join(root, SOURCE_REL), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const settings = publicSiteSettings(source);
  const destination = path.join(root, PUBLIC_REL);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
  return settings;
}

