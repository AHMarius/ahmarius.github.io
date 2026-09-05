function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function depthPrefix(depth, assetPath) {
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return `${prefix}${assetPath}`;
}

export function pageShell(opts = {}) {
  const {
    title = 'Alexandru-Marius Hrițcu',
    description = 'Portfolio and devlog.',
    canonical,
    cssAssets = ['assets/css/style.css', 'assets/css/devlog.css'],
    jsAssets = ['assets/js/hero-fluid.js', 'assets/js/script.js'],
    bodyClass = '',
    depth = 0,
    activeNav = '',
    content,
    extraHead = '',
  } = opts;

  const css = (cssAssets || []).map((a) => `<link rel="stylesheet" href="${depthPrefix(depth, a)}" />`).join('\n    ');
  const js = (jsAssets || []).map((a) => `<script defer src="${depthPrefix(depth, a)}"></script>`).join('\n    ');
  const navHref = (dest) => depthPrefix(depth, dest);
  const avc = (label) => (activeNav === label ? ' aria-current="page"' : '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttribute(description)}" />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="icon" type="image/svg+xml" href="${depthPrefix(depth, 'assets/site/favicon.svg')}" />
    <meta name="theme-color" content="#000000" />
    ${css}
    ${js}
    ${extraHead}
  </head>
  <body class="${bodyClass}">
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <canvas id="hero-fluid" aria-hidden="true"></canvas>
    <nav class="topnav">
      <div class="topnav-inner">
        <span class="site-logo">DIGITAL CV</span>
        <button id="hamburger-btn" class="hamburger-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobile-menu">
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
        </button>
      </div>
      <ul id="mobile-menu" class="mobile-menu" hidden>
        <li><a href="${navHref('index.html')}">Home</a></li>
        <li><a href="${navHref('projects.html')}">Projects</a></li>
        <li><a href="${navHref('games.html')}">Games</a></li>
        <li><a href="${navHref('pages.html')}"${avc('pages')}>Pages</a></li>
        <li><a href="${navHref('about.html')}">About</a></li>
        <li><a href="${navHref('about.html#contact')}">Contact</a></li>
        <li><a href="${navHref('devlog.html')}"${avc('devlog')}>Devlog</a></li>
        <li><button type="button" class="nav-search-btn" id="nav-search-btn" aria-haspopup="dialog" aria-expanded="false" data-index-url="${depthPrefix(depth, 'search-index.json')}">Search</button></li>
      </ul>
    </nav>
    <div id="search-overlay" class="search-overlay" hidden role="dialog" aria-modal="true" aria-label="Site search">
      <div class="search-overlay-panel">
        <label for="search-input">Search the site</label>
        <input id="search-input" type="search" placeholder="Search posts, tags, projects..." autocomplete="off" />
        <div id="search-results" class="search-results" role="listbox"></div>
        <button type="button" class="search-close" id="search-close">Close</button>
      </div>
    </div>
    ${content}
  </body>
</html>`;
}

export { escapeHtml, escapeAttribute, depthPrefix };
