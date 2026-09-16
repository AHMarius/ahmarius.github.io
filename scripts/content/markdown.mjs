import { marked } from 'marked';
import katex from 'katex';

marked.setOptions({ breaks: false, gfm: true });

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderKatex(latex, displayMode) {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
      trust: false,
      maxExpand: 1000,
      macros: {
        '\\RR': '\\mathbb{R}',
        '\\NN': '\\mathbb{N}',
        '\\ZZ': '\\mathbb{Z}',
        '\\QQ': '\\mathbb{Q}',
        '\\CC': '\\mathbb{C}',
      },
    });
  } catch (error) {
    const escaped = escapeHtml(latex);
    return `<span class="math-invalid" title="${escapeHtml(error.message)}">${escaped}</span>`;
  }
}

function blockMathHtml(latex) {
  return `<div class="math-block">${renderKatex(latex, true)}</div>`;
}

function firstMathIndex(src, delimiters) {
  const indexes = delimiters.map((delimiter) => src.indexOf(delimiter)).filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : undefined;
}

const blockMathToken = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return firstMathIndex(src, ['$$', '\\[', '\\begin{']);
  },
  tokenizer(src) {
    const dollar = /^ {0,3}\$\$[ \t]*(?:\n)?([\s\S]*?)\n? {0,3}\$\$(?:[ \t]*(?:\n|$))/.exec(src);
    if (dollar) {
      return {
        type: 'blockMath',
        raw: dollar[0],
        latex: dollar[1].trim(),
      };
    }

    const bracket = /^ {0,3}\\\[[ \t]*(?:\n)?([\s\S]*?)\n? {0,3}\\\](?:[ \t]*(?:\n|$))/.exec(src);
    if (bracket) {
      return {
        type: 'blockMath',
        raw: bracket[0],
        latex: bracket[1].trim(),
      };
    }

    // KaTeX supports the common AMS display environments directly. Accepting
    // them without an extra $$ wrapper also makes pasted LaTeX documents work
    // as expected in both preview and published output.
    const environment = /^ {0,3}(\\begin\{(equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|flalign\*?|split|cases|[pbBvV]?matrix|array|CD)\}[\s\S]*?\\end\{\2\})(?:[ \t]*(?:\n|$))/.exec(src);
    if (environment) {
      return {
        type: 'blockMath',
        raw: environment[0],
        latex: environment[1].trim(),
      };
    }
    return undefined;
  },
  renderer(token) {
    return blockMathHtml(token.latex);
  },
};

const inlineMathToken = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    return firstMathIndex(src, ['$', '\\(']);
  },
  tokenizer(src) {
    const paren = /^\\\(((?:\\.|[^\\\n])*?)\\\)/.exec(src);
    if (paren) {
      return {
        type: 'inlineMath',
        raw: paren[0],
        latex: paren[1],
      };
    }

    // Do not treat $$ as inline math. A numeric character immediately after
    // the closing delimiter is rejected to avoid turning "$5 and $10" into
    // an accidental equation while still accepting deliberate `$5$` math.
    const dollar = /^\$(?!\$)((?:\\.|[^\\$\n])+?)\$(?!\$|\d)/.exec(src);
    if (dollar) {
      // A second currency amount can otherwise pair with a later real math
      // delimiter (for example "$5 and $10, but $x$"). Keep obvious prose
      // prices literal without rejecting numeric equations such as `$10+x$`.
      if (/^\d+(?:[.,]\d+)?(?:\s+[A-Za-z]{2,}|,\s*[A-Za-z])/.test(dollar[1])) {
        return undefined;
      }
      return {
        type: 'inlineMath',
        raw: dollar[0],
        latex: dollar[1],
      };
    }
    return undefined;
  },
  renderer(token) {
    return renderKatex(token.latex, false);
  },
};

marked.use({ extensions: [blockMathToken, inlineMathToken] });

export function renderMarkdown(markdown = '') {
  const raw = marked.parse(String(markdown || ''), { async: false });
  return String(raw);
}

/**
 * Rewrite rendered-HTML references to post-local assets (`assets/...` or
 * `./assets/...`) so they point at the asset's published location. Only src,
 * href and srcset attributes are touched; plain text and code blocks are left
 * alone.
 */
export function rewriteAssetUrls(html, publicBase) {
  const base = String(publicBase || '').replace(/\/+$/, '');
  if (!base) return String(html);
  return String(html).replace(
    /(src|href|srcset)\s*=\s*(["'])([^"']*?)((?:\.\.?\/)*assets\/)([^"']*)\2/g,
    (match, attr, quote, head, _prefix, tail) => `${attr}=${quote}${head}${base}/${tail}${quote}`,
  );
}

export function renderInlineMath(latex) {
  return renderKatex(latex, false);
}

export function renderBlockMath(latex) {
  return renderKatex(latex, true);
}

export function toText(markdown = '') {
  return String(markdown || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\$\$[\s\S]+?\$\$/g, ' ')
    .replace(/\\\[[\s\S]+?\\\]/g, ' ')
    .replace(/\\begin\{([A-Za-z*]+)\}[\s\S]+?\\end\{\1\}/g, ' ')
    .replace(/\\\([^\n]+?\\\)/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    .replace(/[#>*`~\[\]()\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateText(markdown = '', maxLength = 180) {
  const text = toText(markdown);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

export function buildReadTime(markdown = '', wordsPerMinute = 180) {
  const words = toText(markdown).split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / wordsPerMinute))} min read`;
}

function slugifyHeading(text = '') {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Extract h2/h3 headings (text + deduped slug) from Markdown source so the
 * site TOC matches what KaTeX/Markdown produces without re-parsing HTML.
 */
export function headingsFromMarkdown(markdown = '') {
  const lines = String(markdown || '').split('\n');
  const seen = new Map();
  const out = [];
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    // ignore headings inside fenced code blocks
    const text = m[2].trim();
    let slug = slugifyHeading(text.replace(/[$\\{}]/g, ''));
    if (seen.has(slug)) {
      const n = seen.get(slug);
      seen.set(slug, n + 1);
      slug = `${slug}-${n}`;
    } else {
      seen.set(slug, 1);
    }
    out.push({ level: m[1].length, text, slug, rendered: m[0] });
  }
  return out;
}
