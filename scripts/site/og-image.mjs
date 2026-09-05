import { escapeHtml } from '../content/templates.mjs';

/**
 * Generate a simple, dependency-free Open Graph image (1200×630) as SVG.
 * SVG works as an og:image in modern scrapers (Discord, Slack, Twitter/X)
 * and keeps the build pipeline free of binary/image deps.
 */
export function ogImageSvg({ title = '', subtitle = '', accent = '#4a90d9' } = {}) {
  const safeTitle = escapeHtml(title || 'Untitled')
    .split(/\s+/)
    .map(wrapWord)
    .join(' ');
  const safeSubtitle = escapeHtml(subtitle || 'ahmarius.github.io');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#101418" />
      <stop offset="100%" stop-color="${escapeHtml(accent)}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="48" y="48" width="1104" height="534" rx="24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2" />
  <text x="72" y="180" font-family="Georgia, serif" font-size="44" fill="#9fb3c8" letter-spacing="6">DEVLOG</text>
  <text x="72" y="360" font-family="Georgia, serif" font-size="64" fill="#ffffff" font-weight="bold">${safeTitle}</text>
  <text x="72" y="520" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#d7e0ea">${safeSubtitle}</text>
</svg>
`;
}

function wrapWord(word) {
  // Keep single words renderable; no-op wrapper for clarity.
  return word;
}