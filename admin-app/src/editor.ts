import { markdownToHtml } from "./markdown";

export type EditorMode = "visual" | "source";

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

export class Editor {
  private textarea: HTMLTextAreaElement;
  private preview: HTMLDivElement;
  private visualPane: HTMLDivElement;
  private root: HTMLElement;
  private _mode: EditorMode = "visual";
  private onChange: () => void;
  private autosaveHint: HTMLElement;
  private suppressChange = false;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    this.root = document.createElement("div");
    this.root.className = "editor-root";
    this.root.innerHTML = `
      <div class="editor-toolbar">
        ${this.toolbarHtml()}
      </div>
      <div class="editor-body">
        <div class="editor-visual" contenteditable="true" spellcheck="false"></div>
        <textarea class="editor-source" spellcheck="false" placeholder="Write Markdown here…"></textarea>
        <div class="editor-preview"></div>
      </div>
      <div class="editor-statusbar">
        <span class="editor-mode-switch">
          <button data-mode="visual">Visual</button>
          <button data-mode="source">Markdown</button>
        </span>
        <span class="editor-hint"></span>
      </div>
    `;
    this.textarea = this.root.querySelector(".editor-source")!;
    this.preview = this.root.querySelector(".editor-preview")!;
    this.visualPane = this.root.querySelector(".editor-visual")!;
    this.autosaveHint = this.root.querySelector(".editor-hint")!;

    this.bindToolbar();
    this.bindEvents();
    this.setMode("visual");
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
        this.setTextValue(v.slice(0, lineStart) + nl + v.slice(endIdx));
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
        this.promptLink("Image path / filename", (url) => wrap("![", `](${url})`));
        break;
      case "Video":
        this.promptLink("Video path / embed URL", (url) => {
          const md = /\.(mp4|webm|ogg|ogv)(\?|$)/i.test(url)
            ? `<video src="${url}" controls></video>`
            : `![video](${url})`;
          const v = this.getValue();
          setTextValueWith(this, v + (v.endsWith("\n") ? "" : "\n") + "\n" + md + "\n");
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
    this.refresh();
    this.onChange();
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
        b.addEventListener("click", () => this.setMode((b.dataset.mode as EditorMode) || "visual"));
      });
  }

  private bindEvents() {
    this.textarea.addEventListener("input", () => {
      this.refresh();
      if (!this.suppressChange) this.onChange();
    });
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.target as HTMLTextAreaElement;
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        this.refresh();
        this.onChange();
      }
    });
  }

  setMode(mode: EditorMode) {
    this._mode = mode;
    this.root.classList.toggle("mode-source", mode === "source");
    this.root
      .querySelectorAll<HTMLButtonElement>(".editor-mode-switch button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    if (mode === "source") {
      this.textarea.style.display = "";
      this.visualPane.style.display = "none";
      this.preview.style.display = "none";
      this.textarea.focus();
    } else {
      this.textarea.style.display = "none";
      this.preview.style.display = "";
      this.visualPane.style.display = "none";
      this.renderVisual();
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

  private renderVisual() {
    const html = markdownToHtml(this.getValue());
    this.visualPane.innerHTML = `<div class="editor-prose">${html}</div>`;
  }

  refresh() {
    this.renderVisual();
    this.preview.innerHTML = `<div class="editor-prose">${markdownToHtml(this.getValue())}</div>`;
  }

  setStatus(text: string) {
    this.autosaveHint.textContent = text;
  }

  destroy() {
    this.root.remove();
  }
}

function setTextValueWith(ed: Editor, value: string) {
  const ta = ed.getElement().querySelector(".editor-source") as HTMLTextAreaElement;
  ta.value = value;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
