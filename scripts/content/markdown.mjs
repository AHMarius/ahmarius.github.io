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
    });
  } catch (error) {
    const escaped = escapeHtml(latex);
    return `<span class="math-invalid" title="${escapeHtml(error.message)}">${escaped}</span>`;
  }
}

function renderInlineMathForBlock(text) {
  return text.replace(/\$([^\$\n]+?)\$/g, (_, latex) => renderKatex(latex, false));
}

function blockMathHtml(latex) {
  return `<div class="math-block">${renderKatex(latex, true)}</div>`;
}

const blockMathToken = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return src.indexOf('$$');
  },
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (match) {
      return {
        type: 'blockMath',
        raw: match[0],
        latex: match[1].trim(),
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
    return src.indexOf('$');
  },
  tokenizer(src) {
    const match = /^\$([^\$\n]+?)\$/.exec(src);
    if (match) {
      return {
        type: 'inlineMath',
        raw: match[0],
        latex: match[1],
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
