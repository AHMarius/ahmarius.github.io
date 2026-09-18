import { Heading, escapeHtml, markdownToHtmlDetailed } from "./markdown";

export type EditorMode = "source" | "preview" | "split";

function safeMediaUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /["'<>\n\r]/.test(value)) return null;
  if (/^(?:https?:\/\/|assets\/|\.\.?\/|\/)/i.test(value)) return value;
  if (!value.includes(":") && /^[A-Za-z0-9_][A-Za-z0-9._~!$&()+,;=@%/-]*$/.test(value)) return value;
  return null;
}

function videoMarkdown(raw: string): string | null {
  const value = safeMediaUrl(raw);
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      let embed = "";
      if (host === "youtu.be") {
        const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
        if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) embed = `https://www.youtube-nocookie.com/embed/${id}`;
      } else if (host === "youtube.com" || host === "m.youtube.com") {
        const id = parsed.pathname.startsWith("/embed/")
          ? parsed.pathname.split("/")[2] || ""
          : parsed.searchParams.get("v") || "";
        if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) embed = `https://www.youtube-nocookie.com/embed/${id}`;
      } else if (host === "vimeo.com") {
        const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
        if (/^\d+$/.test(id)) embed = `https://player.vimeo.com/video/${id}`;
      }
      if (embed) {
        return `<div class="video-embed"><iframe src="${embed}" title="Embedded video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
      }
    } catch {
      return null;
    }
  }

  return `<video src="${value}" controls preload="metadata"></video>`;
}

function assetMarkdown(relPath: string): string {
  return /\.(?:mp4|webm|ogg|ogv)(?:[?#].*)?$/i.test(relPath)
    ? videoMarkdown(relPath) || ""
    : `![](${relPath})`;
}

const wrap = (before: string, after: string) => {
  const ta = document.activeElement as HTMLTextAreaElement | null;
  if (ta && ta.tagName === "TEXTAREA") {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const sel = ta.value.slice(start, end);
    const replacement = `${before}${sel}${after}`;
    ta.setRangeText(replacement, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }
};

export interface EditorHooks {
  /** Open a native file picker and import the asset; resolves to the repo-relative path. */
  pickImage?: () => Promise<string | null>;
  /** Import pasted image bytes; resolves to the repo-relative path. */
  importPasted?: (name: string, data: ArrayBuffer) => Promise<string | null>;
  /** A file path was dropped/captured by the OS (already imported); resolve = rel path. */
  importDropped?: (path: string) => Promise<string | null>;
  /** Resolve a post-local `assets/...` reference for live preview. */
  resolveAsset?: (relPath: string) => Promise<string | null>;
}

export class Editor {
  private textarea: HTMLTextAreaElement;
  private preview: HTMLDivElement;
  private root: HTMLElement;
  private _mode: EditorMode = "source";
  private onChange: () => void;
  private hooks: EditorHooks;
  private autosaveHint: HTMLElement;
  private stats: HTMLElement;
  private suppressChange = false;
  private previewAssetCache = new Map<string, Promise<string | null>>();
  private previewGeneration = 0;
  private focusMode = false;

  constructor(onChange: () => void, hooks: EditorHooks = {}) {
    this.onChange = onChange;
    this.hooks = hooks;
    this.root = document.createElement("div");
    this.root.className = "editor-root";
    this.root.innerHTML = `
      <div class="editor-toolbar">
        ${this.toolbarHtml()}
        <div class="toolbar-group editor-utility-tools">
          <select class="editor-snippet" aria-label="Insert reusable block" title="Insert reusable block">
            <option value="">Insert block…</option>
            <option value="table">Table</option>
            <option value="checklist">Checklist</option>
            <option value="details">Collapsible details</option>
            <option value="align">Aligned equation</option>
          </select>
          <button type="button" data-editor-action="copy" title="Copy Markdown">Copy</button>
          <button type="button" data-editor-action="focus" title="Distraction-free editor">Focus</button>
        </div>
      </div>
      <div class="editor-body">
        <textarea class="editor-source" spellcheck="false" placeholder="Write Markdown here…"></textarea>
        <div class="editor-preview"></div>
      </div>
      <div class="editor-statusbar">
        <div class="editor-status-left">
          <span class="editor-mode-switch">
            <button data-mode="source">Source</button>
            <button data-mode="split">Split</button>
            <button data-mode="preview">Preview</button>
          </span>
          <span class="editor-hint"></span>
        </div>
        <span class="editor-stats"></span>
      </div>
    `;
    this.textarea = this.root.querySelector(".editor-source")!;
    this.preview = this.root.querySelector(".editor-preview")!;
    this.autosaveHint = this.root.querySelector(".editor-hint")!;
    this.stats = this.root.querySelector(".editor-stats")!;

    this.bindToolbar();
    this.bindEvents();
    this.setMode(this._mode);
  }

  getElement(): HTMLElement {
    return this.root;
  }

  private toolbarHtml(): string {
    const groups: Array<[string, string][]> = [
      [
        ["H1", "H1"],
        ["H2", "H2"],
        ["H3", "H3"],
      ],
      [
        ["B", "B"],
        ["I", "I"],
        ["U", "U"],
        ["S", "S"],
      ],
      [
        ["`", "Code"],
        ["code-block", "#"],
        ["List", "•"],
        ["Ol", "1."],
        ["Task", "☑"],
      ],
      [
        ["Quote", "❝"],
        ["Rule", "—"],
        ["Link", "🔗"],
        ["Image", "🖼"],
        ["Video", "▶"],
      ],
      [
        ["InlineMath", "$x$"],
        ["BlockMath", "$$"],
      ],
    ];
    return groups
      .map(
        (g) =>
          `<div class="toolbar-group">${g
            .map(([cmd, label]) => `<button type="button" data-cmd="${cmd}" title="${cmd}">${label}</button>`)
            .join("")}</div>`,
      )
      .join("");
  }

  /** Public entry point for global keyboard shortcuts. */
  command(cmd: string) {
    this.textarea.focus();
    this.runCommand(cmd);
  }

  private runCommand(cmd: string) {
    const v = this.getValue();
    switch (cmd) {
      case "H1":
      case "H2":
      case "H3": {
        const level = parseInt(cmd[1], 10);
        this.textarea.focus();
        const start = this.textarea.selectionStart;
        const lineStart = v.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = v.indexOf("\n", start);
        const endIdx = lineEnd === -1 ? v.length : lineEnd;
        const line = v.slice(lineStart, endIdx).replace(/^#{1,6}\s+/, "");
        const nl = `${"#".repeat(level)} ${line}`;
        setTextValueWith(this, v.slice(0, lineStart) + nl + v.slice(endIdx));
        break;
      }
      case "B":
        wrap("**", "**");
        break;
      case "I":
        wrap("*", "*");
        break;
      case "U":
        wrap("<u>", "</u>");
        break;
      case "S":
        wrap("~~", "~~");
        break;
      case "`":
        wrap("`", "`");
        break;
      case "code-block":
        this.textarea.focus();
        this.setBlock("```\n", "\n```");
        break;
      case "List":
        this.setLinePrefix("- ");
        break;
      case "Ol":
        this.setLinePrefix("1. ");
        break;
      case "Task":
        this.setLinePrefix("- [ ] ");
        break;
      case "Quote":
        this.setLinePrefix("> ");
        break;
      case "Rule":
        setTextValueWith(this, v + (v.endsWith("\n") ? "" : "\n") + "\n---\n");
        break;
      case "Link":
        this.promptLink("Link URL", (url) => wrap("[", `](${url})`));
        break;
      case "Image":
        void this.insertImage();
        break;
      case "Video":
        this.promptLink("Video path / embed URL", (url) => {
          const md = videoMarkdown(url);
          if (!md) {
            this.setStatus("Use a local/relative video path or an HTTPS YouTube, Vimeo, or video URL");
            return;
          }
          this.insertAtCursor(md);
        });
        break;
      case "InlineMath":
        wrap("$", "$");
        break;
      case "BlockMath":
        this.textarea.focus();
        this.setBlock("$$\n", "\n$$");
        break;
    }
  }

  private async insertImage() {
    if (this.hooks.pickImage) {
      const rel = await this.hooks.pickImage();
      if (rel) {
        this.insertAssetMarkdown(rel);
      }
      return;
    }
    this.promptLink("Image path / filename", (url) => wrap("![", `](${url})`));
  }

  private setBlock(before: string, after: string) {
    const v = this.getValue();
    setTextValueWith(this, v.trimEnd() + (v.endsWith("\n") || v === "" ? "" : "\n") + "\n" + before + after + "\n");
  }

  private setLinePrefix(prefix: string) {
    this.textarea.focus();
    const start = this.textarea.selectionStart;
    const lineStart = this.getValue().lastIndexOf("\n", start - 1) + 1;
    const lineEnd = this.getValue().indexOf("\n", start);
    const endIdx = lineEnd === -1 ? this.getValue().length : lineEnd;
    const line = this.getValue().slice(lineStart, endIdx);
    const newLine = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
    setTextValueWith(
      this,
      this.getValue().slice(0, lineStart) + newLine + this.getValue().slice(endIdx),
    );
  }

  private promptLink(title: string, cb: (url: string) => void) {
    const url = window.prompt(title);
    if (url) cb(url);
  }

  private bindToolbar() {
    this.root.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => this.runCommand(btn.dataset.cmd!));
    });
    this.root
      .querySelector(".editor-mode-switch")
      ?.querySelectorAll("button")
      .forEach((b) => {
        b.addEventListener("click", () => this.setMode((b.dataset.mode as EditorMode) || "split"));
      });
    this.root.querySelector<HTMLSelectElement>(".editor-snippet")?.addEventListener("change", (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      const snippets: Record<string, string> = {
        table: "| Column | Column |\n| --- | --- |\n| Value | Value |",
        checklist: "- [ ] First task\n- [ ] Next task",
        details: "<details>\n<summary>More details</summary>\n\nAdd the hidden details here.\n\n</details>",
        align: "\\begin{align}\na &= b + c \\\\\nd &= e\n\\end{align}",
      };
      if (snippets[select.value]) this.insertAtCursor(snippets[select.value]);
      select.value = "";
    });
    this.root.querySelector<HTMLButtonElement>('[data-editor-action="copy"]')?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.getValue());
        this.setStatus("Markdown copied");
      } catch {
        this.textarea.select();
        this.setStatus("Markdown selected — use Copy");
      }
    });
    this.root.querySelector<HTMLButtonElement>('[data-editor-action="focus"]')?.addEventListener("click", () => {
      this.toggleFocusMode();
    });
  }

  private bindEvents() {
    this.textarea.addEventListener("input", () => {
      this.refresh();
      if (!this.suppressChange) this.onChange();
    });
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.focusMode) {
        e.preventDefault();
        this.toggleFocusMode(false);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.target as HTMLTextAreaElement;
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        this.refresh();
        this.onChange();
      }
    });
    this.textarea.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file || !this.hooks.importPasted) continue;
          void file.arrayBuffer().then((buf) => {
            return this.hooks.importPasted!(file.name, buf).then((rel) => {
              if (!rel) return;
              this.insertAtCursor(`![](${rel})`);
              this.refresh();
              this.onChange();
            });
          });
          return;
        }
      }
    });
  }

  private toggleFocusMode(force?: boolean) {
    this.focusMode = force ?? !this.focusMode;
    this.root.classList.toggle("is-focus", this.focusMode);
    document.body.classList.toggle("editor-focus-active", this.focusMode);
    const button = this.root.querySelector<HTMLButtonElement>('[data-editor-action="focus"]');
    if (button) {
      button.textContent = this.focusMode ? "Exit focus" : "Focus";
      button.setAttribute("aria-pressed", String(this.focusMode));
    }
    if (this.focusMode) this.textarea.focus();
  }

  setMode(mode: EditorMode) {
    this._mode = mode;
    this.root.classList.remove("mode-source", "mode-preview", "mode-split");
    this.root.classList.add(`mode-${mode}`);
    this.root
      .querySelectorAll<HTMLButtonElement>(".editor-mode-switch button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    if (mode === "source" || mode === "split") {
      this.textarea.focus();
    }
  }

  getMode(): EditorMode {
    return this._mode;
  }

  getValue(): string {
    return this.textarea.value;
  }

  setTextValue(value: string) {
    this.textarea.value = value;
    this.refresh();
  }

  setBody(value: string) {
    this.suppressChange = true;
    this.setTextValue(value);
    this.suppressChange = false;
  }

  insertText(text: string) {
    this.textarea.focus();
    setTextValueWith(this, this.getValue() + (this.getValue().endsWith("\n") ? "" : "\n") + text + "\n");
  }

  insertMarkdown(md: string) {
    this.insertText(md);
  }

  insertAtCursor(text: string) {
    this.textarea.focus();
    const start = this.textarea.selectionStart ?? this.textarea.value.length;
    const end = this.textarea.selectionEnd ?? this.textarea.value.length;
    this.textarea.setRangeText(text, start, end, "end");
    this.textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  insertAssetMarkdown(relPath: string) {
    this.previewAssetCache.delete(relPath.replace(/^\.\//, ""));
    const markdown = assetMarkdown(relPath);
    if (markdown) this.insertAtCursor(markdown);
  }

  private tocHtml(headings: Heading[]): string {
    if (headings.length < 3) return "";
    const items = headings
      .filter((h) => h.level >= 2 && h.level <= 3)
      .map(
        (h) =>
          `<li class="toc-l${h.level}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`,
      )
      .join("");
    if (!items) return "";
    return `<nav class="toc" aria-label="Table of contents"><span class="toc-title">On this page</span><ol>${items}</ol></nav>`;
  }

  private updateStats() {
    const md = this.getValue().trim();
    const words = md ? md.split(/\s+/).length : 0;
    const minutes = Math.max(1, Math.round(words / 200));
    this.stats.textContent = `${words} words · ${minutes} min read`;
  }

  refresh() {
    const md = this.getValue();
    const { html, headings } = markdownToHtmlDetailed(md);
    this.preview.innerHTML = `${this.tocHtml(headings)}<div class="editor-prose">${html}</div>`;
    void this.hydratePreviewAssets();
    this.updateStats();
  }

  private async hydratePreviewAssets() {
    if (!this.hooks.resolveAsset) return;
    const generation = ++this.previewGeneration;
    const media = Array.from(this.preview.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img[src], video[src]"));
    await Promise.all(media.map(async (node) => {
      const src = node.getAttribute("src") || "";
      const normalized = src.replace(/^\.\//, "");
      if (!normalized.startsWith("assets/")) return;
      let pending = this.previewAssetCache.get(normalized);
      if (!pending) {
        pending = this.hooks.resolveAsset!(normalized).catch(() => null);
        this.previewAssetCache.set(normalized, pending);
      }
      const resolved = await pending;
      if (resolved && generation === this.previewGeneration && node.isConnected) {
        node.src = resolved;
      }
    }));
  }

  setStatus(text: string) {
    this.autosaveHint.textContent = text;
  }

  destroy() {
    if (this.focusMode) document.body.classList.remove("editor-focus-active");
    this.root.remove();
  }
}

function setTextValueWith(ed: Editor, value: string) {
  const ta = ed.getElement().querySelector(".editor-source") as HTMLTextAreaElement;
  ta.value = value;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
