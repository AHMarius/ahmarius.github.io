import katex from "katex";
import "katex/dist/katex.min.css";

export function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "html",
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

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/~~(.+?)~~/g, "<del>$1</del>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\$([^$\n]+?)\$/g, (_, l) => renderKatex(l, false));
  return out;
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

  for (const raw of lines) {
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
    if (line.startsWith("$$")) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      const latex = line.replace(/^\$\$/, "").replace(/\$\$$/, "");
      html.push(`<div class="math-block">${renderKatex(latex, true)}</div>`);
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
