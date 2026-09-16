import katex from "katex";
import "katex/dist/katex.min.css";

export function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: false,
      trust: false,
      maxExpand: 1000,
      macros: {
        "\\RR": "\\mathbb{R}",
        "\\NN": "\\mathbb{N}",
        "\\ZZ": "\\mathbb{Z}",
        "\\QQ": "\\mathbb{Q}",
        "\\CC": "\\mathbb{C}",
      },
    });
  } catch (e) {
    return `<span class="math-invalid">${escapeHtml(latex)}</span>`;
  }
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface Heading {
  level: number;
  text: string;
  slug: string;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeHref(value: string): string {
  const href = value.trim();
  if (
    /^(?:https?:|mailto:)/i.test(href) ||
    /^(?:[./#]|[^:]+$)/.test(href)
  ) {
    return escapeHtml(href);
  }
  return "#";
}

function looksLikeCurrencyProse(latex: string): boolean {
  return /^\d+(?:[.,]\d+)?(?:\s+[A-Za-z]{2,}|,\s*[A-Za-z])/.test(latex);
}

function inline(text: string): string {
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
  let source = String(text);

  // Protect code and links before looking for math delimiters. This matches
  // the public renderer: `$...$` inside a code span or URL stays literal.
  source = source.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    hold(`<a href="${safeHref(href)}">${escapeHtml(label)}</a>`),
  );
  source = source.replace(/\\\(((?:\\.|[^\\\n])*?)\\\)/g, (_, latex) =>
    hold(renderKatex(latex, false)),
  );
  source = source.replace(
    /(?<!\\)\$(?!\$)((?:\\.|[^\\$\n])+?)(?<!\\)\$(?!\$|\d)/g,
    (match, latex) => (looksLikeCurrencyProse(latex) ? match : hold(renderKatex(latex, false))),
  );

  let out = escapeHtml(source);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
  out = out.replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => held[Number(index)] ?? "");
  return out;
}

const DISPLAY_ENVIRONMENT = /^(equation\*?|align\*?|alignat\*?|gather\*?|multline\*?|flalign\*?|split|cases|[pbBvV]?matrix|array|CD)$/;

function displayMathAt(lines: string[], start: number): { latex: string; end: number } | null {
  const first = lines[start].trim();
  const delimited = (open: string, close: string) => {
    if (!first.startsWith(open)) return null;
    const afterOpen = first.slice(open.length);
    if (afterOpen.endsWith(close) && afterOpen.length >= close.length) {
      return { latex: afterOpen.slice(0, -close.length).trim(), end: start };
    }
    const body: string[] = [];
    if (afterOpen) body.push(afterOpen);
    for (let i = start + 1; i < lines.length; i += 1) {
      const candidate = lines[i].trimEnd();
      if (candidate.trim().endsWith(close)) {
        const closing = candidate.lastIndexOf(close);
        if (closing > 0) body.push(candidate.slice(0, closing));
        return { latex: body.join("\n").trim(), end: i };
      }
      body.push(lines[i]);
    }
    return null;
  };

  const dollars = delimited("$$", "$$");
  if (dollars) return dollars;
  const brackets = delimited("\\[", "\\]");
  if (brackets) return brackets;

  const begin = /^\\begin\{([^}]+)\}/.exec(first);
  if (!begin || !DISPLAY_ENVIRONMENT.test(begin[1])) return null;
  const close = `\\end{${begin[1]}}`;
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].includes(close)) {
      return { latex: lines.slice(start, i + 1).join("\n").trim(), end: i };
    }
  }
  return null;
}

export function markdownToHtml(markdown: string): string {
  return markdownToHtmlDetailed(markdown).html;
}

export function markdownToHtmlDetailed(markdown: string): { html: string; headings: Heading[] } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  const headings: Heading[] = [];
  const headingSeen: Record<string, number> = {};
  let paragraph: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  let quoteBuf: string[] = [];
  let tableBuf: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(" ").trim()).replace(/\n/g, "<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listBuf) {
      const tag = listBuf.ordered ? "ol" : "ul";
      const items = listBuf.items.map((i) => `<li>${inline(i)}</li>`).join("");
      html.push(`<${tag}>${items}</${tag}>`);
      listBuf = null;
    }
  };
  const flushQuote = () => {
    if (quoteBuf.length) {
      html.push(`<blockquote>${quoteBuf.map((q) => inline(q)).join("<br>")}</blockquote>`);
      quoteBuf = [];
    }
  };
  const flushCode = () => {
    if (codeBuf.length) {
      const lang = codeLang ? ` class="lang-${escapeHtml(codeLang)}"` : "";
      html.push(`<pre><code${lang}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
      codeBuf = [];
      codeLang = "";
    }
  };
  const flushTable = () => {
    if (tableBuf.length > 1) {
      const head = tableBuf[0].map((c) => `<th>${inline(c)}</th>`).join("");
      const rows = tableBuf
        .slice(1)
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    tableBuf = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      continue;
    }
    const displayMath = displayMathAt(lines, lineIndex);
    if (displayMath) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      html.push(`<div class="math-block">${renderKatex(displayMath.latex, true)}</div>`);
      lineIndex = displayMath.end;
      continue;
    }
    const video = /^<video src="([^"<>\n]+)" controls preload="metadata"><\/video>$/.exec(line.trim());
    const embeddedVideo = /^<div class="video-embed"><iframe src="https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+|player\.vimeo\.com\/video\/\d+)" title="Embedded video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen><\/iframe><\/div>$/.test(line.trim());
    if ((video && safeHref(video[1]) !== "#") || embeddedVideo) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      html.push(video
        ? `<video src="${safeHref(video[1])}" controls preload="metadata"></video>`
        : line.trim());
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      flushParagraph();
      flushList();
      flushQuote();
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        continue;
      }
      tableBuf.push(cells);
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      flushTable();
      quoteBuf.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (!listBuf || listBuf.ordered) {
        flushList();
        listBuf = { ordered: false, items: [] };
      }
      listBuf.items.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (!listBuf || !listBuf.ordered) {
        flushList();
        listBuf = { ordered: true, items: [] };
      }
      listBuf.items.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      const level = line.match(/^#+/)?.[0].length || 1;
      const text = line.replace(/^#{1,6}\s+/, "");
      const baseSlug = slugifyHeading(text) || `heading-${level}`;
      const seen = headingSeen[baseSlug] ?? 0;
      headingSeen[baseSlug] = seen + 1;
      const slug = seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`;
      headings.push({ level, text, slug });
      html.push(`<h${level} id="${slug}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      html.push("<hr />");
      continue;
    }
    // image ![alt](src)
    if (/^!\[[^\]]*\]\(([^)\s]+)\)\s*$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      const m = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)/);
      if (m) {
        html.push(`<figure class="media-block"><img src="${escapeHtml(m[2])}" alt="${escapeHtml(m[1])}" /></figure>`);
      }
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushQuote();
  flushTable();
  if (inCode) flushCode();
  return { html: html.join("\n"), headings };
}
