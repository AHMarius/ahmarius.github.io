# Build Prompt: Native "Docs-style" Admin App for ahmarius.github.io

Paste everything below to an AI coding assistant (e.g. Claude Code) as the task
specification. It assumes the assistant has access to the existing repository
described in the "Existing repo context" section.

---

## 0. Mission

Replace the current `admin/index.html` + `admin/server.mjs` (a local HTML
form that shells out to `scripts/build-devlog.mjs`) with a **real native
desktop application for Arch Linux** that works like a stripped-down
Google Docs for writing my portfolio's content: pages, sub-pages/folders,
and posts, with images, video embeds, LaTeX, PDF import, and a one-click
"Publish" button that commits and pushes to GitHub Pages.

This is a personal, local-only tool. It is not exposed to the internet and
does not need multi-user auth — but it should still be built like a real
product: stable, fast, good-looking, forgiving of mistakes, with autosave
and undo.

## 1. Existing repo context (read before writing code)

The site is a static GitHub Pages site at `https://ahmarius.github.io/`,
repo root layout (already exists, do not break it):

```
index.html, about.html, projects.html, games.html, devlog.html   ← public pages
assets/css/style.css, assets/css/devlog.css                      ← shared styling, CSS custom properties, light/dark theme via [data-theme]
assets/js/script.js, hero-fluid.js, devlog.js                    ← vanilla JS, no framework
assets/media/, assets/site/                                      ← images/favicon
content/devlog/                                                  ← markdown + YAML frontmatter, current "blog"
devlog/                                                           ← generated static devlog pages
scripts/build-devlog.mjs                                         ← node build script, content/devlog → devlog/*.html + devlog.html
admin/index.html, admin/server.mjs                                ← CURRENT admin app (to be replaced)
dist/                                                              ← full static build output (npm run build), deployed to Pages
docs/content-management.md, docs/devlog.md, docs/security.md      ← existing docs, keep in sync
package.json                                                      ← npm scripts: build, dev, preview, admin
```

Key existing conventions to preserve:
- Content lives as **Markdown with YAML frontmatter** under `content/`.
- The build step (`node scripts/build-devlog.mjs`, run via `npm run build`)
  turns Markdown into static HTML using the site's existing CSS
  (`assets/css/style.css`, `assets/css/devlog.css`), so generated pages look
  native to the site, not like a separate app.
- The admin **only writes files inside the repo and runs local build/git
  commands** — no secrets or tokens embedded in code; auth goes through the
  existing GitHub CLI (`gh`) / SSH setup already configured on my machine.
- Never use destructive git commands (`git reset --hard`, `git clean -fd`,
  force-push) anywhere in the app.
- The admin binds to nothing public — it is a desktop app, not a web server
  exposed on a network interface (if any local server is used internally for
  the editor UI, it must bind to `127.0.0.1` only, or better, use no server
  at all — see architecture options below).

## 2. What "Pages" means (the new content model)

Today there is only a flat Devlog. I want a general hierarchical content
system, generalized from the Devlog:

- A **Page** is a top-level content hub, e.g. "FluidDynamics", "IronHalo",
  "Traffic Optimisation Platform" — one per project or topic I want to write
  about long-term. A Page has:
  - a **name** (title)
  - a **description** (short summary, shown in the page's card/listing)
  - a **stylized cover photo**, styled consistently with the rest of the
    site (same treatment as the existing `.project-card` avatar / cover
    images — reuse the site's existing card visual language, not a new
    style)
  - an automatically tracked **"last updated"** value, derived from the
    newest post/subpage inside it (or its own edits), shown as a
    human-readable relative date ("Updated 3 days ago") plus exact date on
    hover
  - a listing of its **Posts** and **Sub-pages**, newest first
- A **Sub-page** is a Page nested inside another Page — same shape as a
  Page (name, description, cover photo, last-updated, its own posts/subpages)
  — i.e. Pages nest like folders, arbitrarily deep, but keep the default UI
  optimized for 1–2 levels of nesting (project → sub-project), since going
  deeper is rare.
- A **Post** is a single article/entry inside a Page or Sub-page. A Post has:
  - title, subtitle (optional), body content
  - one or more images, of *any* dimensions/aspect ratio (the editor must
    not force-crop; layout should handle arbitrary sizes gracefully, similar
    to how the existing devlog/project galleries lightbox handles images)
  - video embeds (local video files copied into the repo's asset tree, or
    embed by URL — support both; treat a video like an image-class block)
  - Markdown-formatted rich text: headings, subheadings, bold/italic,
    lists, blockquotes, code blocks, links, tables
  - LaTeX math, inline (`$...$`) and block (`$$...$$`), rendered with
    KaTeX (preferred for speed) at both edit-time (live preview) and in the
    generated static HTML
  - tags/technologies/status metadata compatible with the existing devlog
    frontmatter schema (`title, slug, date, status, project, technologies,
    tags`) so the current Devlog listing/filter UI keeps working, extended
    with a `page`/`parent` field for the new hierarchy
  - a publish status: `draft` / `published` (drafts never get built into
    `dist/` or committed content that's linked from the public nav)

### On-disk representation (proposal — adjust if you find something cleaner during implementation, but keep it Markdown+YAML based and keep pages/posts as separate discoverable files, not one giant JSON blob)

```
content/
  pages/
    fluid-dynamics/
      page.yml            # name, description, cover image path, order, parent (null)
      cover.jpg
      posts/
        2026-01-10-initial-solver.md
        2026-02-02-perf-notes.md
      subpages/
        gpu-port/
          page.yml
          cover.jpg
          posts/
            ...
  devlog/                 # keep existing top-level devlog as-is, or migrate
                           # it to be "just another Page" — your call, but
                           # document the decision and update docs/*.md
```

Each `*.md` post file keeps YAML frontmatter + Markdown body, exactly like
the current devlog posts, so the existing parser code in
`scripts/build-devlog.mjs` can be extended rather than rewritten from
scratch.

## 3. What the new admin app must do

### 3.1 Editing experience ("Docs-style")

- A **distraction-free rich Markdown editor**: WYSIWYG-leaning (bold shows
  bold, headings show as headings, LaTeX renders inline) but the underlying
  storage format is always plain Markdown + YAML frontmatter — never a
  proprietary format. Think Notion/Typora/Obsidian editing feel, not a raw
  textarea.
- Live LaTeX rendering (KaTeX) as I type `$...$` / `$$...$$`.
- Drag-and-drop or paste-to-insert images and videos directly into the
  document at the cursor position; the app copies the file into the
  correct per-post/per-page asset folder inside the repo and inserts the
  right Markdown/HTML reference automatically (no manual path typing).
  Support images of any resolution/aspect ratio without forced cropping.
- **PDF import**: let me pick a PDF and pull text (and embedded images,
  optionally) into a new post as a starting draft, so I can write from
  papers/reports/old certification docs. Perfect fidelity isn't required —
  reasonable text + image extraction is enough, with the result editable
  afterward.
- Autosave to a local draft on every change (debounced), so I never lose
  work, plus manual save.
- Full **undo/redo** history within a session.

### 3.2 Page/post management

- A sidebar/tree view of all Pages → Sub-pages → Posts (folder-like,
  collapsible), plus a flat "All posts" view sortable by last-updated.
- "New Page" flow: name, description, pick/crop a cover photo (apply the
  same visual treatment used elsewhere on the site — reuse existing CSS
  classes/tokens from `assets/css/style.css` where practical, or generate a
  processed image consistent with it), optional parent (to create it as a
  sub-page).
- "New Post" flow inside a selected Page/Sub-page: opens the rich editor
  with frontmatter fields (title, tags, technologies, status, date) plus
  the body editor.
- **Edit** existing pages and posts: browsing to any past post/page opens
  it in the same editor, fully editable, with an explicit "Edit" affordance
  in the list/tree view (not just click-to-open, so it's unambiguous —
  matches the requirement: "should have an edit button").
- Deleting/archiving a post or page should be reversible or at least
  confirmed with a clear warning (no silent data loss).
- "Last updated" per Page/Sub-page must be computed automatically from the
  most recent change within it (its own edits and any post/subpage inside
  it) — not something I set manually.

### 3.3 Publishing ("Post" button)

- A prominent **Publish** button that:
  1. Runs the existing/extended build step (`npm run build`, i.e.
     `scripts/build-devlog.mjs` generalized to also build the new Pages
     system) to regenerate the static HTML into `dist/` (and any relevant
     top-level generated pages, matching current behavior).
  2. Shows me a diff/summary of what changed (files added/modified) before
     committing, so I can sanity check.
  3. Runs `git add` scoped to the relevant content/build paths (never
     `git add -A` blindly), `git commit` with a sensible auto-generated
     message I can edit (e.g. "Update devlog: <post title>" / "Add page:
     <page name>"), and `git push` to the branch that drives GitHub Pages
     for `ahmarius.github.io`.
  4. Surfaces git errors clearly (merge conflicts, auth failures, nothing
     to commit) instead of failing silently.
  5. Never force-pushes, never resets, never touches unrelated
     files/history.
- A "Save draft only" action that saves to disk/git-tracked working files
  but does **not** commit/push — for work in progress.
- Clear indication in the UI of what's a local draft vs. what's been
  published/pushed.

### 3.4 Non-goals / constraints

- Keep it **not technology-heavy from the user's perspective**: no
  requirement to hand-write HTML, no exposed config files I need to edit
  to add a page — everything through the UI. (Implementation internals can
  of course use whatever's needed.)
- No user accounts/login system — this is a single-user local tool.
- No server exposed beyond localhost, if a local server is used internally
  at all.
- Must look and feel **professional**: consistent spacing/typography, a
  light and dark mode (nice-to-have, matching the site's own light/dark
  theme is a bonus), sensible empty states, keyboard shortcuts for
  save/bold/italic/etc., no visible crashes/raw stack traces in the UI.

## 4. Technology choice for the app itself

Pick ONE of these approaches for a native Arch Linux desktop app (in order
of my preference — use the first one that's practical, but you may
recommend a different concrete stack if you have a good reason, as long as
it's a real installable Linux desktop app and not another localhost HTML
page):

1. **Tauri (Rust backend + a modern web-based editor UI)** — smallest
   footprint, genuinely native window, great for Arch (packageable as an
   AppImage or plain binary + `.desktop` file), and lets you use a
   best-in-class JS rich-text/Markdown editor component (e.g. TipTap,
   Milkdown, or CodeMirror 6 with a Markdown + KaTeX + image/paste
   extension stack) inside the native shell, plus Rust for filesystem/git
   operations (via `git2` or shelling out to the system `git`).
2. **Python + PySide6/PyQt6**, using `QWebEngineView` to host the same kind
   of rich Markdown/LaTeX editor (or a Qt-native rich text widget if you
   prefer, though Markdown/LaTeX fidelity is easier via a web-based editor
   embedded in the Qt window) — good if I'll want to hack on it in Python
   later, and Python/Qt is well supported on Arch.
3. **Electron** only if 1 and 2 are rejected for a concrete reason — it's
   heavier, but acceptable if it gets a much better editor experience with
   less effort.

Whichever is chosen:
- Ship a proper `.desktop` entry + icon so it appears in the Arch app
  launcher like a normal application, plus a simple build/install script
  (or PKGBUILD if you want to go the extra mile) so `npm run admin` style
  invocation is replaced by a real installed app, while still keeping a
  `npm run admin` (or equivalent) dev-mode launch command for me to run
  from source during development.
- Persist app window size/position and last-opened page between launches.
- All git/filesystem operations run against the actual repo checkout on
  disk (the same one this app ships inside), operating on the real files
  under `content/`, `assets/`, `dist/`, exactly as `admin/server.mjs` does
  today, not a sandboxed copy.

## 5. Build system changes required

- Generalize `scripts/build-devlog.mjs` (or split into a shared content
  library + per-surface builders) so it can build:
  - the existing flat Devlog (backward compatible — don't break current
    URLs under `devlog/`) and
  - the new hierarchical Pages system, generating a page-index view and
    per-page/per-post static HTML using the site's existing CSS, with
    breadcrumbs reflecting the folder hierarchy (Page → Sub-page → Post).
- Add/extend a public entry point (e.g. link from the nav or from
  `projects.html`) so these new Pages are actually browsable on the live
  site, not just admin-only.
- Update `docs/content-management.md`, `docs/devlog.md`, and
  `docs/security.md` to describe the new Pages content model and the new
  admin app's architecture and security boundary (still local-only,
  still no destructive git ops, still no embedded secrets).
- Update `README.md`'s "Admin architecture" section to describe the new
  native app instead of `admin/index.html`/`admin/server.mjs`, and update
  `package.json` scripts accordingly (rename/replace the `admin` script as
  appropriate for how the new app is launched).

## 6. Deliverables checklist

- [ ] New native admin app source (in a new top-level folder, e.g.
      `admin-app/`), buildable/runnable on Arch Linux, with a README
      inside it covering install + dev instructions.
- [ ] Pages/Sub-pages/Posts content model implemented on disk under
      `content/pages/...` as specified (or a documented, equally clean
      alternative).
- [ ] Rich Markdown editor with LaTeX (KaTeX) live preview, drag/drop or
      paste image+video insertion (any size), PDF import to draft.
- [ ] Full CRUD: create/edit/delete for Pages, Sub-pages, and Posts, with
      an explicit Edit affordance and a way to browse older posts/pages.
- [ ] Automatic "last updated" computation per Page/Sub-page.
- [ ] Cover-photo handling styled consistently with the existing site's
      card visuals.
- [ ] Publish button that builds, shows a change summary, commits (scoped,
      editable message), and pushes via git, plus a separate "save draft
      without publishing" action.
- [ ] Extended/refactored build scripts producing static pages that match
      the current site's visual style, wired into the public nav.
- [ ] Updated docs (`README.md`, `docs/*.md`) and `package.json` scripts.
- [ ] No destructive git commands anywhere; no secrets in code; no network
      exposure beyond localhost (if any local server is used at all).

## 7. Open questions to resolve during implementation (use best judgment, but flag decisions made)

- Whether the existing flat `content/devlog/` becomes just another Page
  (recommended, for a single unified model) or stays a separate special
  case alongside the new Pages system.
- Exact video handling: store video files in-repo (simplest, works with
  GitHub Pages directly, but watch repo size) vs. requiring external
  hosting + embed URL for anything large. Propose a size threshold and
  document it.
- Cover photo generation: whether to auto-apply a consistent visual
  treatment (e.g. duotone/border/frame matching the site) programmatically,
  or just constrain aspect ratio/cropping in the UI and rely on the
  existing card CSS to make it look consistent.

---

# 8. IMPORTANT ARCHITECTURE UPDATE — TREAT THIS AS A REAL DESKTOP CONTENT STUDIO

The previous sections describe the desired system. The following requirements are mandatory clarifications for implementation.

Do **not** interpret this project as “make the existing admin page nicer”. The old `admin/index.html` + `admin/server.mjs` approach is being retired.

The target is a **real Linux desktop content-authoring application** that happens to edit a Git-backed Markdown website.

The application should feel closer to a small, polished combination of:

- Google Docs / Typora for writing,
- Obsidian for hierarchy and Markdown awareness,
- a lightweight CMS for Pages/Posts,
- and a Git GUI for publishing.

It should **not** feel like:

- a localhost website,
- a giant form,
- a raw Markdown textarea with a preview beside it,
- a generic Electron dashboard,
- or a developer-only control panel.

The user should be able to open the application from the Arch Linux application launcher and immediately understand how to create, organize, edit and publish content without knowing how the repository is implemented.

The public website remains the source of truth for presentation. The desktop application is the authoring tool.

---

# 9. CONCRETE TECHNOLOGY DECISION

Use this implementation unless the repository contains a hard blocker that makes it genuinely impractical:

**Tauri 2 + TypeScript frontend + Milkdown/ProseMirror-based editor + Rust native backend.**

Current Tauri documentation supports Linux distribution through formats including AppImage and AUR, which fits the Arch-first requirement. Milkdown is explicitly designed as a WYSIWYG Markdown editor and supports extensibility for math, tables, commands and clipboard workflows. citeturn621185search8turn621185search6

Do not introduce a separate web server for the admin application.

The Tauri window is the application. Native operations such as filesystem access, process execution and Git operations happen through Tauri commands in Rust.

Use the web UI only for the editor/interface layer inside the native window.

### 9.1 Why this split exists

The frontend should be responsible for:

- layout,
- editor interaction,
- menus/toolbars,
- page tree,
- dialogs,
- drag/drop UI,
- previews,
- status indicators,
- keyboard shortcuts,
- search and filtering.

The Rust side should be responsible for:

- reading/writing repository files,
- scanning the content tree,
- copying imported assets,
- PDF import orchestration,
- computing repository-safe paths,
- invoking build commands,
- obtaining Git status/diff information,
- staging specific paths,
- creating commits,
- pushing through the user's existing Git authentication,
- app configuration/persistence,
- filesystem watcher integration where useful.

Never expose arbitrary shell execution as a generic frontend command such as `run(commandString)`.

Expose narrowly scoped backend commands such as:

- `scan_content`
- `read_page`
- `write_page`
- `create_page`
- `delete_page`
- `read_post`
- `write_post`
- `create_post`
- `delete_post`
- `import_asset`
- `import_pdf`
- `build_site`
- `git_status`
- `git_diff_summary`
- `git_stage_paths`
- `git_commit`
- `git_push`

Validate every path in Rust and ensure it remains inside the repository root.

---

# 10. EDITOR REQUIREMENTS — THIS IS THE HEART OF THE APPLICATION

The editor is the most important component. Do not compromise the editing experience to make implementation easier.

## 10.1 Primary editor model

Use a visual, block-oriented, WYSIWYG Markdown editor.

It should render content approximately as the published page while editing it, but remain backed by Markdown serialization.

The user should be able to type naturally without seeing Markdown markers everywhere.

Examples:

- typing a heading produces a heading block;
- bold text visually appears bold;
- italic text visually appears italic;
- lists behave like lists;
- quotes behave like quote blocks;
- code blocks have code-block presentation;
- images are visible directly in the editor;
- videos are represented as media blocks;
- equations render as equations;
- links appear as links;
- tables behave as tables.

There must also be a **Markdown/source view** available for advanced editing and inspection.

The user can switch between:

`Visual` ↔ `Markdown`

without losing content.

The Markdown view is not the main editing mode.

## 10.2 Markdown must remain authoritative

The application must never require its own proprietary document format for normal content.

The persistent source of article content is:

`*.md + YAML frontmatter`

Do not make Tiptap/Milkdown JSON, SQLite, HTML snapshots, or another proprietary database the canonical content representation.

A local app-state database/cache is acceptable for things such as:

- UI preferences,
- recent documents,
- autosave metadata,
- window state,
- editor recovery snapshots,
- temporary import state,

but it must never replace the repository Markdown files as the canonical article/page data.

## 10.3 Round-trip requirement

Implement and test Markdown round-tripping.

For a supported document:

1. Load Markdown.
2. Parse it into the visual editor.
3. Edit it.
4. Serialize back to Markdown.
5. Reload the saved Markdown.
6. Verify that all supported semantic content is preserved.

Do not silently delete unsupported constructs during serialization.

If the parser encounters Markdown that the visual editor cannot represent safely, preserve it through a clearly marked raw/advanced block rather than destroying it.

Use the editor's current Markdown integration rather than inventing a home-grown regex parser. Tiptap also now has bidirectional Markdown support, but it is documented as beta; Milkdown is preferred here because Markdown is its core editing model. citeturn621185search3turn621185search6

## 10.4 Required formatting tools

Provide a professional toolbar and contextual formatting menu containing at least:

- paragraph
- heading 1
- heading 2
- heading 3
- heading 4
- bold
- italic
- underline
- strikethrough
- inline code
- code block
- ordered list
- unordered list
- task/check list if Markdown representation can be preserved cleanly
- blockquote
- horizontal rule
- link
- image
- video
- table
- inline math
- block math
- undo
- redo
- clear formatting

Do not clutter the interface with every tool at once.

Use a compact toolbar with grouped controls and an overflow menu where needed.

Support a slash-style command menu (`/heading`, `/image`, `/video`, `/table`, `/math`, etc.) as an optional productivity feature if the chosen editor stack supports it cleanly.

## 10.5 Keyboard shortcuts

At minimum:

- `Ctrl+S` — save draft
- `Ctrl+Shift+S` — save as / optional alternate action
- `Ctrl+B` — bold
- `Ctrl+I` — italic
- `Ctrl+U` — underline
- `Ctrl+Z` — undo
- `Ctrl+Shift+Z` — redo
- `Ctrl+K` — link
- `Ctrl+F` — find in document
- `Ctrl+Shift+P` — command/search palette if implemented

Never let application-level shortcuts break normal text editing behavior.

---

# 11. DOCUMENT STRUCTURE AND BLOCK SEMANTICS

The editor must understand content as actual semantic blocks rather than treating a document as one huge formatted string.

Support these block types:

1. Paragraph
2. H1–H4 heading
3. Ordered list
4. Unordered list
5. Check/task list where safely serializable
6. Blockquote
7. Code block
8. Image block
9. Video block
10. Table
11. Horizontal rule
12. Equation block
13. Raw Markdown / HTML fallback block where necessary

Every visual block must have a deterministic Markdown serialization.

Never serialize purely visual state that has no meaningful representation in the source file.

---

# 12. IMAGES — SERIOUS MEDIA HANDLING, NOT JUST MARKDOWN SYNTAX

Images are first-class content.

The user may:

- drag an image into the editor,
- paste an image from the clipboard,
- click Insert → Image,
- select an image file,
- replace an existing image,
- delete an image block,
- move an image block,
- add alt text,
- optionally add a caption.

Do **not** force all images into one fixed aspect ratio.

The public site must preserve arbitrary aspect ratios.

The editor should display large images responsively, with sensible maximum visual width while retaining their native aspect ratio.

Very large images should not make the editor unusable. Generate thumbnails/previews when useful, but never throw away the original unless the user explicitly requests optimization.

## 12.1 Asset paths

Prefer a per-post asset directory:

```text
content/pages/<page-slug>/posts/<post-slug>/
  post.md
  assets/
    image-001.png
    image-002.jpg
    diagram.svg
    video-001.mp4
```

or another equally clean deterministic structure.

The critical requirement is that media belongs clearly to the content item that uses it.

Do not dump all uploaded media into one global directory with meaningless filenames.

Generated Markdown references should be relative to the Markdown content item where practical.

## 12.2 Filename rules

Imported assets must be normalized to safe filenames while preserving recognizable names.

Example:

`My Screenshot (Final) 2026.png`

can become:

`my-screenshot-final-2026.png`

Do not overwrite an existing asset accidentally. Automatically add a deterministic suffix where necessary.

---

# 13. VIDEO SUPPORT

Video is a first-class media block, just like an image.

Support two types:

### Local video

A video selected from disk is copied into the repository and referenced by relative path.

Supported common formats may include:

- MP4
- WebM
- OGG

Do not claim every browser/device combination supports every codec. The generated HTML should use normal `<video controls>` semantics with sensible fallback behavior.

### External video

Allow URL-based embeds for services such as YouTube when the URL can be safely transformed into an embed.

Store the canonical URL in Markdown/frontmatter according to a documented representation.

Do not turn arbitrary remote HTML into unsanitized content.

## 13.1 Large video protection

The application must warn before copying a very large video into Git.

Use these defaults:

- under 25 MiB: normal import
- 25–100 MiB: prominent warning and explicit confirmation
- over 100 MiB: refuse normal Git import by default and explain that GitHub blocks regular Git objects over 100 MiB; offer external-hosting/embed workflow instead

These defaults are intentionally conservative because GitHub currently warns about large files and blocks files larger than 100 MiB; Git LFS is the documented mechanism for larger tracked files. GitHub Pages also recommends keeping the source repository around 1 GB or less and published sites at no more than 1 GB. citeturn652958search0turn652958search1

Do not silently configure Git LFS.

If Git LFS support is added later, it must be an explicit opt-in feature and must detect whether Git LFS is installed/configured.

---

# 14. LATEX / MATHEMATICS

Math support must be real, not simulated with escaped text.

Support:

- inline math: `$a^2+b^2=c^2$`
- block math: `$$\\int_0^1 x^2 dx$$`

Render equations with KaTeX in the editor and in generated static pages.

The source Markdown must retain the original LaTeX expression.

Do not convert equations into screenshots unless explicitly requested.

The editor should visually distinguish mathematics while editing but keep source fidelity.

Support common constructs including:

- superscripts/subscripts
- fractions
- roots
- sums/products
- integrals
- matrices
- Greek letters
- aligned equations where supported

The build system must include the necessary KaTeX assets locally so the public GitHub Pages site is not dependent on a runtime external CDN.

---

# 15. PDF IMPORT — A REAL “IMPORT INTO DRAFT” WORKFLOW

PDF import should be treated as an ingestion tool, not a fake file attachment.

When the user selects:

`Import PDF`

show an import dialog with:

- selected filename
- page count if detectable
- options for text extraction
- option to extract/render embedded images where practical
- option to insert the result into a new draft
- destination Page/Sub-page
- proposed post title

The default action should be:

`Create draft from PDF`

The process should:

1. Open the PDF.
2. Extract text in reading order as reasonably as possible.
3. Identify headings/paragraphs where practical.
4. Preserve page boundaries where useful.
5. Import useful images when extraction is reliable.
6. Create a new Draft Post.
7. Put the imported content into the visual editor.
8. Let the user edit everything before saving/publishing.

If exact PDF structure cannot be preserved, favor editable semantic content over visual fidelity.

For scanned/image-only PDFs, detect the lack of extractable text and present a clear message. Do not pretend extraction succeeded.

OCR should be optional, not a hard requirement, because OCR introduces quality/cost/accuracy tradeoffs.

---

# 16. PAGES SHOULD FEEL LIKE FOLDERS + DOCUMENT HUBS

This is a major product concept and must be visually obvious.

Think of Pages as folders that also have a public-facing identity.

Example:

```text
Projects
├── FluidDynamics
│   ├── Overview
│   ├── Solver Architecture
│   │   ├── Post: First Solver
│   │   └── Post: GPU Optimization
│   └── Post: Project Update
│
├── IronHalo
│   ├── Development
│   └── Post: New Combat System
│
└── Traffic Optimisation Platform
    ├── Algorithms
    ├── Server
    └── Post: ACO experiments
```

The desktop tree should make this hierarchy immediately understandable.

## 16.1 Page dashboard

Clicking a Page should not immediately throw the user into an article editor.

Instead, show a Page dashboard containing:

- cover image
- page title
- description
- last updated
- breadcrumb path
- child pages
- recent posts
- total post count
- total child-page count
- `New Post` button
- `New Sub-page` button
- `Edit Page` button

This makes every Page a real workspace.

## 16.2 Sub-pages

A sub-page is not a special second-class content type.

It has the same editable structure as a top-level Page.

Pages may nest to arbitrary depth in storage, but the UI should remain compact and readable.

Use disclosure/expand controls rather than an enormous permanently expanded tree.

---

# 17. PAGE COVER IMAGE / VISUAL IDENTITY

The cover image should visibly belong to the existing portfolio design language.

Do not invent an unrelated CMS card style.

The existing site uses:

- translucent cards,
- rounded corners,
- backdrop blur,
- subtle borders,
- restrained shadows,
- the site's CSS variables,
- the site's light/dark color system,
- circular avatar-like project imagery in the project card header.

Reuse those visual conventions when generating the public Page cards.

The current project-card styling should be studied directly from `assets/css/style.css` rather than approximated from this prompt.

The cover editor may provide:

- image selection,
- focal point selection,
- optional crop preview,
- reset crop,
- replace image.

However, **never destroy the source image simply to achieve the card crop**.

Store the original and use CSS/object-fit or a generated derived preview for presentation.

The public page should be able to display the same image elsewhere at its natural aspect ratio if needed.

---

# 18. AUTOMATIC “LAST UPDATED” MUST BE DATA-DERIVED

Do not make `lastUpdated` a manually maintained decorative field unless there is a genuine need for a page-specific editorial timestamp.

A Page's last-updated value is computed as:

```text
max(
  page metadata modification,
  own post modification dates,
  descendant page modification dates,
  descendant post modification dates
)
```

Use content metadata or filesystem modification information according to a documented and deterministic policy.

Prefer an explicit `updatedDate` in post frontmatter when the app edits the post, because Git filesystem timestamps are not stable across clones.

For Pages, derive the value while building from descendant content metadata rather than trusting the local filesystem timestamp as the public source of truth.

The UI may show:

`Updated 3 days ago`

and expose the exact date on hover/focus:

`2026-08-30`

The public HTML should contain a machine-readable exact date in a `<time datetime="...">` element where appropriate.

---

# 19. POST METADATA

Every Post editor should have a clean metadata panel, preferably collapsible.

Required:

- Title
- Slug
- Date
- Updated date (automatic by default)
- Status
- Page / parent location
- Excerpt/summary
- Tags
- Technologies
- Project
- Featured flag where compatible with existing behavior

Optional but useful:

- subtitle
- cover image
- read-time override
- external links

The user should interact with tag/technology lists as chips/tokens rather than manually writing YAML list syntax.

The application generates valid YAML automatically.

---

# 20. DRAFT / PUBLISHED / ARCHIVED STATES

The application needs a strong mental model for publication state.

### Draft

- editable
- saved locally/repository
- visible in admin
- not publicly listed
- not generated into public navigation
- not published by the public build unless explicitly required for preview-only output

### Published

- included in the public build
- visible on the public Page/Devlog surfaces
- eligible to be committed and pushed

### Archived

- retained in the repository
- visible in admin history
- not normally listed as current content
- reversible

Never interpret “delete” as “destroy everything immediately”.

For destructive deletion:

1. Show exactly what will be deleted.
2. Mention associated media files that may also be removed.
3. Require confirmation.
4. Provide an undo/recovery route where practical.

---

# 21. “ALL POSTS” VIEW AND HISTORY

The user explicitly needs to browse older posts and edit them.

Implement an `All Posts` view with:

- search
- sort by updated date
- sort by publication date
- filter by Page
- filter by status
- filter by tag
- filter by technology
- filter by project

Each row/card should expose:

- title
- Page
- last updated
- status
- tags
- explicit `Edit` button
- optional `Open` button for public preview if published

Do not require the user to remember where a post lives.

The history view should be optimized for finding old work quickly.

---

# 22. OPTIONAL BUT HIGHLY DESIRABLE: “PREVIEW PUBLIC SITE”

Add a `Preview` button for the current Page/Post.

The preferred implementation is:

1. save the draft,
2. run the local build,
3. open the generated local HTML in the system browser or an in-app preview,
4. make clear that this is not yet published to GitHub.

Do not make preview dependent on pushing to GitHub.

The editor should be able to show a publication-like rendering without modifying the public repository history.

---

# 23. PUBLISH PIPELINE — MAKE IT SAFE AND TRANSPARENT

The Publish button is not just `git add && git commit && git push`.

Treat it as a transaction-like workflow.

## Step A — Validate

Before build:

- validate required metadata
- validate slugs
- validate parent Page existence
- validate media references
- validate Markdown serialization
- validate supported status
- validate no path escapes

If validation fails, do not build or commit.

## Step B — Save

Write all affected Markdown/page metadata/assets to disk.

Ensure writes are atomic where practical:

`temporary file → fsync/close → rename`

Do not leave half-written Markdown if the application crashes.

## Step C — Build

Run the repository's build entry point.

Prefer:

`npm run build`

rather than hard-coding a second competing build implementation in the app.

The build system itself should eventually be decomposed into reusable functions so both CLI build and admin-triggered build use the same logic.

## Step D — Verify build

After build:

- verify expected HTML exists,
- verify generated references resolve,
- verify no build error,
- report warnings.

## Step E — Git status/diff preview

Show a clear review screen:

```text
Publish changes

Modified
  content/pages/fluid-dynamics/page.yml
  content/pages/fluid-dynamics/posts/gpu-optimization.md

Added
  content/pages/fluid-dynamics/posts/gpu-optimization/assets/chart.png
  dist/pages/fluid-dynamics/posts/gpu-optimization.html

Removed
  ...

Build: ✓

Commit message:
[ Update FluidDynamics: GPU optimization notes              ]

[Cancel]                         [Publish]
```

The exact file list must come from Git state, not guessed from UI state.

## Step F — Stage only intended paths

Never run:

`git add -A`

and never run:

`git add .`

unless the implementation proves that the entire repository is intentionally the exact publication boundary — and even then, the safer explicit path list is preferred.

Determine the changed files and stage only the approved content/build/public-site paths.

**Do not stage unrelated user changes already present in the working tree.**

This is extremely important because the repository may contain unrelated unfinished development work.

## Step G — Commit

Let the user review/edit the commit message.

Example defaults:

- `Add page: FluidDynamics`
- `Update page: FluidDynamics`
- `Add post: GPU optimization notes`
- `Update post: GPU optimization notes`
- `Update portfolio content`

Do not create commits with meaningless messages such as `update` or `changes`.

## Step H — Push

Push using the configured Git remote/branch.

Do not embed GitHub tokens.

Use the user's existing Git credential helper, SSH configuration, GitHub CLI, or configured remote authentication.

Do not invent another authentication mechanism.

## Step I — Report result

After push:

- show commit hash
- show branch
- show number of changed files
- show public URL if known
- clearly state whether build, commit and push succeeded

If push fails after a successful commit, clearly tell the user:

`Committed locally, but push failed.`

Never hide the state.

---

# 24. GIT SAFETY BOUNDARY — STRICT

The application must never execute:

- `git reset --hard`
- `git clean -fd`
- `git clean -fxd`
- `git push --force`
- `git push -f`
- history rewriting
- automatic rebase that changes unrelated work
- automatic stash/pop that can silently overwrite user work

Do not automatically resolve merge conflicts.

If the working tree is in a dangerous or ambiguous Git state, stop and explain it.

Before publishing, inspect:

- current branch
- remote
- ahead/behind state
- merge/rebase state
- existing uncommitted changes

If unrelated modified files exist, the Publish review must explicitly show that the application is leaving them untouched.

---

# 25. FILESYSTEM SAFETY BOUNDARY

Every path received from the frontend must be validated on the Rust/native side.

Normalize and canonicalize paths where appropriate.

Reject:

- absolute paths outside the repository
- `..` traversal
- symlink escapes where applicable
- writes outside approved content/assets/build directories

The app may read repository files needed for its purpose, but it should not silently scan the user's whole home directory.

For file pickers, the OS file picker is acceptable because the user explicitly selected the source file.

---

# 26. APPLICATION LAYOUT

The default window should feel like a professional desktop authoring tool.

Recommended layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  AH MARIUS CONTENT STUDIO                 Search     Save  Publish  │
├───────────────┬───────────────────────────────┬─────────────────────┤
│ CONTENT       │ DOCUMENT                      │ PROPERTIES          │
│               │                               │                     │
│ ▾ Pages       │  Page / Post breadcrumb       │ Title               │
│   Fluid...    │                               │ Subtitle            │
│     Posts     │  [visual editor]              │ Status              │
│     GPU Port  │                               │ Date                │
│   IronHalo    │  ...                          │ Tags                │
│   Traffic...  │                               │ Technologies        │
│               │                               │ Page                │
│ ▾ All Posts   │                               │                     │
│               │                               │                     │
│ + New Page    │                               │                     │
│ + New Post    │                               │                     │
└───────────────┴───────────────────────────────┴─────────────────────┘
```

Adjust proportions intelligently.

Do not make every field permanently visible.

Properties should be collapsible when writing.

The center editor should receive the majority of the window.

The content tree should remain narrow but usable.

The property panel should be resizable or collapsible.

---

# 27. TOP-LEVEL APP NAVIGATION

Use a small number of durable destinations:

- `Pages`
- `All Posts`
- `Drafts`
- `Recent`
- `Media` or contextual media browser if useful
- `Settings`

Avoid building a deep multi-screen enterprise CMS.

This is one person's writing tool.

The user should be able to reach any content within a few clicks.

---

# 28. SEARCH

Implement application-wide search.

Search should find:

- Page names
- Page descriptions
- Post titles
- Post body text
- tags
- technologies

Search results should show where the match occurs.

Example:

```text
GPU Optimization
FluidDynamics / GPU Port
Post
“…the CUDA kernel was optimized…”
```

Do not require Elasticsearch or another heavyweight search backend.

A local indexed/in-memory search over the Markdown content is sufficient.

---

# 29. AUTOSAVE AND CRASH RECOVERY

Autosave is mandatory.

Use a debounced save strategy so continuous typing does not cause excessive disk writes.

Autosave should distinguish:

`Saved`
`Saving…`
`Unsaved changes`
`Saved locally`
`Published`

If the app crashes or is force-closed, reopen the last recovery snapshot when possible.

On next launch, if an autosave snapshot is newer than the repository file, show:

`Recovered draft available`

with:

`Restore` / `Discard`

Do not overwrite the repository silently during recovery.

---

# 30. WINDOW/PREFERENCE PERSISTENCE

Persist:

- window size
- window position when valid
- maximized state
- theme
- sidebar width
- property panel width
- last opened Page/Post
- expanded/collapsed tree state if inexpensive
- last editor mode (visual/source) if sensible

Store application preferences outside the website's public content tree.

Do not pollute the repository with personal desktop UI state.

---

# 31. LIGHT/DARK THEME

The admin application should support light and dark modes.

Default intelligently from the desktop environment where possible, then allow manual override.

The visual language should echo the website:

- similar typography hierarchy,
- translucent surfaces,
- restrained borders,
- rounded corners,
- subtle depth,
- no excessive dashboard gradients,
- no oversized marketing-style widgets.

The admin UI should look polished independently but clearly related to `ahmarius.github.io`.

---

# 32. PUBLIC PAGE GENERATION

The public pages must remain static.

GitHub Pages is a static hosting environment; do not introduce a production backend. citeturn652958search5turn652958search7

Generate pages that can be served directly as static HTML/CSS/JS.

Recommended routes:

```text
pages.html
pages/<page-slug>/index.html
pages/<page-slug>/<post-slug>.html
```

For nesting:

```text
pages/fluid-dynamics/index.html
pages/fluid-dynamics/gpu-port/index.html
pages/fluid-dynamics/gpu-port/first-cuda-optimization.html
```

Exact route structure may differ, but it must be deterministic, human-readable, and GitHub Pages compatible.

Do not rely on client-side routing that requires a server rewrite fallback.

Every generated page must work on direct navigation.

---

# 33. PUBLIC PAGE UX

The public Page landing view should visually fit between the existing portfolio project-card language and the Devlog article system.

A Page card should show:

- cover image
- Page name
- description
- last updated
- number of posts
- number of sub-pages
- optional status/technology chips

Opening a Page shows:

- breadcrumb
- title
- cover
- description
- updated date
- child Page cards
- posts

A Post page shows:

- breadcrumb
- Page/Sub-page context
- title
- subtitle if present
- date / updated date
- tags/technologies
- article body
- media
- equations
- navigation to related/parent content

Do not visually duplicate the entire home page design.

Reuse existing styling tokens and components where sensible.

---

# 34. DEVLOG COMPATIBILITY STRATEGY

For the first implementation, **keep the existing flat `content/devlog/` model working**.

Do not force an immediate migration of all existing Devlog content into the new Pages hierarchy unless the repository contains enough existing content to prove migration is safe.

The builder should support:

```text
legacy flat Devlog
+
new hierarchical Pages system
```

This is intentionally additive.

If migration is implemented later, it should be a dedicated migration command, not an implicit side effect of opening the admin app.

The existing Devlog URLs must remain valid unless there is a deliberate migration plan with redirects.

---

# 35. BUILD SYSTEM REFACTORING

The current `scripts/build-devlog.mjs` contains a small hand-written Markdown renderer.

Do not extend that regex renderer indefinitely.

Replace the parsing/rendering core with a real Markdown parser/renderer that supports the required document grammar, while preserving existing output styling and behavior.

The build should be structured roughly as:

```text
scripts/
  content/
    frontmatter.mjs
    markdown.mjs
    pages.mjs
    posts.mjs
    paths.mjs
    metadata.mjs
  build-site.mjs
  build-devlog.mjs
```

The exact filenames are flexible.

The important requirement is separation between:

- parsing,
- content discovery,
- hierarchy building,
- Markdown/Math rendering,
- HTML templates,
- filesystem output.

Do not create one 1,500-line script with everything mixed together.

---

# 36. MARKDOWN FEATURES THE BUILDER MUST SUPPORT

At minimum:

- headings
- paragraphs
- emphasis
- strong
- underline where representable
- strike
- links
- inline code
- fenced code blocks
- ordered lists
- unordered lists
- task lists if supported
- blockquotes
- tables
- horizontal rules
- images
- local videos
- safe external embeds
- inline math
- block math
- escaped Markdown characters

Preserve raw HTML only if safely handled and intentionally supported.

Sanitize generated HTML appropriately.

Never allow Markdown content to inject arbitrary unsanitized scripts into generated public pages.

---

# 37. IMPORT/PASTE/DRAG-DROP BEHAVIOR

These workflows should feel natural:

### Paste image

User copies an image from a browser or screenshot tool → `Ctrl+V` in editor → asset is saved and an image block appears.

### Drag image

User drags a PNG/JPEG/SVG into editor → asset copied → block inserted.

### Drag video

User drags MP4/WebM into editor → confirmation if large → video block inserted.

### Paste Markdown

User pastes Markdown → preserve/parse Markdown instead of flattening everything into plain text.

### Paste rich text

User pastes normal rich text from another application → convert to the closest supported Markdown semantics.

### Paste URL

When a standalone supported video URL is pasted on an empty line, optionally convert it into a video embed block after user confirmation or using a predictable rule.

---

# 38. MEDIA MANAGEMENT / ORPHAN CLEANUP

The application should understand which assets belong to which documents.

When an image/video is removed from a post, do not immediately delete its source file from disk.

Instead:

- detect that it became orphaned,
- mark it for cleanup,
- optionally offer `Unused media` review.

Provide a cleanup view showing:

```text
Unused media

✓ old-chart.png
✓ screenshot-2026-04.png

[Delete selected] [Keep]
```

This prevents accidental permanent loss.

---

# 39. PUBLIC MEDIA PATH RULES

Generated pages must work from both:

- the repository root when viewed locally,
- GitHub Pages at `https://ahmarius.github.io/`.

Do not generate paths that only work under the localhost admin environment.

Always test relative paths from the generated page's actual directory depth.

This includes:

- CSS
- JS
- images
- video
- KaTeX assets
- favicon
- page links
- breadcrumbs

---

# 40. TESTING REQUIREMENTS — DO NOT STOP AT “IT BUILDS”

The AI implementing this must create meaningful automated tests and manual verification scripts.

At minimum test:

## Content tests

- parse frontmatter
- serialize frontmatter
- parse Markdown
- serialize Markdown
- round-trip Markdown
- detect invalid frontmatter
- detect duplicate slugs
- detect missing parents
- compute page last-updated

## Filesystem tests

- safe path validation
- asset import
- duplicate filename handling
- nested page creation
- page rename
- post rename
- deletion safeguards

## Build tests

- legacy Devlog still generates
- Page index generates
- nested Page generates
- Post generates
- draft does not appear publicly
- published content does appear
- image links resolve
- video links resolve
- equation rendering exists
- breadcrumb links resolve

## Git tests

Mock Git commands where necessary and verify:

- only intended paths are staged
- unrelated modified files are not staged
- no destructive command is ever generated
- commit message is passed correctly
- push errors are surfaced

## UI smoke tests

At minimum manually verify:

1. Create Page.
2. Add cover image.
3. Create Sub-page.
4. Create Post.
5. Type Markdown-style content visually.
6. Add image.
7. Add video.
8. Add LaTeX.
9. Import PDF.
10. Save draft.
11. Close and reopen.
12. Edit old post.
13. Build.
14. Review diff.
15. Publish.
16. Open generated public page.

---

# 41. PERFORMANCE REQUIREMENTS

The application must remain responsive with a realistic portfolio-sized content tree and large media files.

Do not load every full-resolution video/image into memory when opening the tree.

Use metadata/thumbnails where practical.

The sidebar should not parse every document body repeatedly just to render titles.

Maintain a lightweight content index in memory after scanning.

Large Markdown documents should still open without visible hangs.

Autosave must be debounced.

Builds should be asynchronous from the UI perspective with progress feedback.

The editor must not freeze while Git status or PDF extraction is occurring.

---

# 42. ERROR UX

Never show raw Rust panics, Node stack traces, JSON blobs, or shell transcripts as the primary user experience.

Translate failures into useful messages.

Example:

Bad:

`Error: spawn git ENOENT ...`

Good:

`Git could not be started. Make sure Git is installed and available in PATH.`

For advanced users, provide an expandable `Technical details` section containing the real error.

---

# 43. EMPTY STATES

The application must have intentional empty states.

Examples:

### No Pages

`No pages yet`

`Create a project/topic page to start organizing your writing.`

`+ New Page`

### No Posts

`This page has no posts yet.`

`+ New Post`

### No Search Results

`Nothing matched “CUDA kernel”`

Do not leave blank gray panels where a user cannot tell what to do.

---

# 44. SETTINGS

Keep settings deliberately small.

Useful settings:

- repository path
- theme: System / Light / Dark
- default author if ever needed
- default post status
- default Page
- media import behavior
- large-video warning threshold
- preview behavior

Do not create a complicated configuration language.

The repository path should be displayed clearly because all content operations act on the real checkout.

The app should detect whether the configured path is a Git repository and explain how to correct it if not.

---

# 45. FIRST-LAUNCH EXPERIENCE

On first launch:

1. Detect whether the app was launched from the repository.
2. If the repository root is known, use it.
3. Otherwise ask the user to select the repository folder.
4. Validate it by looking for expected files such as:
   - `package.json`
   - `content/`
   - `assets/`
5. Show a compact welcome screen.
6. Offer:
   - Open existing content
   - Create first Page

Do not force the user through an enterprise-style onboarding wizard.

---

# 46. INSTALLATION FOR ARCH LINUX

The repository must support running the admin application as a proper Linux app.

Provide at minimum:

```text
admin-app/
  README.md
  package.json
  src/
  src-tauri/
  icons/
```

Provide:

- Tauri development command
- production build command
- application icon
- `.desktop` integration
- packaged artifact instructions

Prefer providing an AUR/PKGBUILD-ready path if practical.

Do not require the user to launch a localhost URL manually.

Development mode may still be launched from the repository, for example:

`npm run admin:dev`

but it must open the native Tauri window.

Production mode should produce an installable Linux artifact.

---

# 47. UPDATE PACKAGE.JSON SCRIPTS

Replace the old:

```json
"admin": "node admin/server.mjs"
```

with native-app scripts appropriate to the chosen Tauri setup.

For example, conceptually:

```json
"admin": "tauri dev",
"admin:dev": "tauri dev",
"admin:build": "tauri build"
```

Use the actual commands required by the implemented project.

Do not leave dead scripts pointing at `admin/index.html` or `admin/server.mjs`.

---

# 48. REMOVE LEGACY ADMIN CODE AFTER MIGRATION

Once the native app is working and verified, remove the old admin implementation:

- `admin/index.html`
- `admin/server.mjs`

unless one of them is still intentionally used by another documented workflow.

Do not leave two competing admin systems around “just in case”.

Update documentation so there is one obvious supported admin workflow.

---

# 49. DOCUMENTATION MUST REFLECT REALITY

Update:

- `README.md`
- `docs/content-management.md`
- `docs/devlog.md`
- `docs/security.md`

Also add:

- `admin-app/README.md`
- optionally `docs/admin-app.md`

Document:

- content tree
- Page format
- Post format
- media handling
- video policy
- LaTeX
- PDF import
- draft/published lifecycle
- build command
- publishing flow
- Git safety rules
- local-only architecture
- installation on Arch Linux
- troubleshooting

Do not document features that do not actually exist.

---

# 50. REQUIRED FRONTMATTER SCHEMA

Define and document one canonical schema.

Example Page metadata:

```yaml
name: "FluidDynamics"
slug: "fluid-dynamics"
description: "Experiments in fluid simulation and solver development."
cover: "cover.jpg"
parent: null
order: 10
```

Example Post metadata:

```yaml
---
title: "GPU Optimization Notes"
slug: "gpu-optimization-notes"
date: "2026-09-02"
updatedDate: "2026-09-02"
status: "published"
page: "fluid-dynamics/gpu-port"
project: "FluidDynamics"
excerpt: "A record of the first GPU optimization pass."
featured: false
technologies:
  - C++
  - CUDA
tags:
  - Optimization
  - GPU
---
```

The exact schema can be refined during implementation, but it must be:

- documented,
- deterministic,
- backwards-compatible where necessary,
- easy for the app to generate,
- easy for humans to inspect.

---

# 51. SLUG AND PATH RULES

The app should generate safe URL slugs automatically from names.

Example:

`Traffic Optimisation Platform`

→

`traffic-optimisation-platform`

Allow manual editing of a slug.

When a slug changes:

1. warn that public URLs may change,
2. update generated files,
3. update internal references/breadcrumbs,
4. optionally generate a redirect if the project's static structure supports it.

Do not silently break links.

---

# 52. DO NOT MAKE TECHNOLOGY VISIBLE TO THE USER

Internally, the app may use:

- Rust
- Tauri
- TypeScript
- Milkdown
- ProseMirror
- KaTeX
- Markdown libraries
- PDF libraries

The user should mostly see:

`New Page`
`New Post`
`Edit`
`Save Draft`
`Preview`
`Publish`
`Import PDF`
`Insert Image`
`Insert Video`

Do not expose package names and implementation details unless the user opens technical diagnostics.

This is critical to achieving the “not technology-heavy” requirement.

---

# 53. FINAL IMPLEMENTATION PROCESS — FOLLOW THIS ORDER

Do not attempt to rewrite the entire repository in one uncontrolled step.

Implement in these phases.

## Phase 1 — Repository audit

Before modifying anything:

- inspect all existing build scripts,
- inspect existing Devlog Markdown,
- inspect existing CSS,
- inspect public project cards,
- inspect current admin behavior,
- inspect GitHub Pages deployment configuration,
- inspect package.json.

Produce a concise internal implementation map.

## Phase 2 — Content model

Implement:

- Page discovery
- nested Page discovery
- Post discovery
- metadata validation
- last-updated calculation
- filesystem layout

Write unit tests first.

## Phase 3 — Build engine

Refactor Markdown/building into reusable modules.

Keep the old Devlog working before introducing the new public Page surfaces.

## Phase 4 — Native shell

Create Tauri app skeleton.

Verify it opens as a real Linux desktop window.

Remove the assumption that a browser must be manually opened.

## Phase 5 — Basic CMS navigation

Implement:

- tree
- Page dashboard
- All Posts
- search
- New Page
- New Post
- Edit

## Phase 6 — Editor

Implement the visual Markdown editor with:

- formatting
- lists
- tables
- code
- math
- image
- video
- source view
- undo/redo

## Phase 7 — Import and media

Implement:

- paste image
- drag image
- local video
- external video
- PDF import
- orphan media detection

## Phase 8 — Save/recovery

Implement:

- autosave
- manual save
- crash recovery
- persistent UI state

## Phase 9 — Preview/build

Implement:

- build
- preview
- generated public Pages
- generated Post pages
- public navigation

## Phase 10 — Git publish workflow

Implement the complete:

validate → save → build → verify → diff → stage → commit → push

flow.

## Phase 11 — packaging/documentation

Implement:

- Arch packaging
- `.desktop`
- icon
- README
- docs updates
- package scripts

## Phase 12 — cleanup

Only after all tests pass:

- remove legacy admin files,
- remove dead code,
- remove obsolete localhost server logic,
- remove unused dependencies,
- verify clean startup from the packaged application.

---

# 54. ACCEPTANCE CRITERIA — THE IMPLEMENTATION IS NOT DONE UNTIL ALL ARE TRUE

The result is acceptable only if all of the following work in the actual repository.

### Desktop app

- [ ] Opens as a native Linux window.
- [ ] Appears in the Arch application environment when installed.
- [ ] No localhost URL is required for normal use.
- [ ] Window/theme/preferences persist.

### Content management

- [ ] Create Page.
- [ ] Edit Page.
- [ ] Delete/restore Page safely.
- [ ] Create nested Sub-page.
- [ ] Edit nested Sub-page.
- [ ] Create Post.
- [ ] Edit old Post.
- [ ] Browse all old Posts.
- [ ] Search all content.
- [ ] Automatic last-updated works.

### Editor

- [ ] Visual Markdown editing.
- [ ] Markdown source mode.
- [ ] Undo/redo.
- [ ] Autosave.
- [ ] Recovery after restart.
- [ ] Headings.
- [ ] Bold/italic/links/lists.
- [ ] Tables.
- [ ] Code blocks.
- [ ] Images.
- [ ] Videos.
- [ ] LaTeX.
- [ ] PDF import.

### Storage

- [ ] Pages are represented as separate discoverable files.
- [ ] Posts remain Markdown + YAML.
- [ ] Media is stored predictably.
- [ ] No proprietary format is canonical.

### Public site

- [ ] New Pages are publicly browsable.
- [ ] Nested Pages work.
- [ ] Posts work.
- [ ] Breadcrumbs work.
- [ ] Media works at all relevant path depths.
- [ ] Light/dark visual style matches existing site.
- [ ] Existing portfolio pages remain intact.
- [ ] Existing Devlog routes remain intact unless explicitly migrated with redirects.

### Publishing

- [ ] Build runs successfully.
- [ ] User sees a change summary before commit.
- [ ] Commit message is editable.
- [ ] Only intended paths are staged.
- [ ] Unrelated local work is untouched.
- [ ] Push uses existing auth.
- [ ] No destructive Git commands exist.
- [ ] Failed pushes are clearly reported.

### Quality

- [ ] Automated tests exist.
- [ ] No raw stack traces in normal UI.
- [ ] No hardcoded secrets.
- [ ] No network listener required for normal operation.
- [ ] Documentation matches implementation.
- [ ] Legacy admin code is removed after successful migration.

---

# 55. IMPORTANT IMPLEMENTATION ATTITUDE

Do not optimize for “minimum code that demonstrates the feature”.

Optimize for a tool that I could realistically use every week to maintain `ahmarius.github.io` for years.

Do not build a demo.

Do not stop once the editor can save one Markdown file.

Do not substitute:

- a textarea for a real editor,
- an iframe for a native application,
- a JSON database for Markdown,
- a generic file browser for a content tree,
- a raw Git button for a publishing workflow,
- or a fake Markdown renderer for a real parser.

The application should feel coherent from beginning to end:

**Open app → find Page → open Post → write visually → add media/math → autosave → preview → review diff → publish.**

That complete workflow is the product.

---

# 56. SOURCE OF TRUTH / REPOSITORY-SPECIFIC INSTRUCTION

The implementation assistant must study the actual repository before choosing filenames, selectors, CSS, metadata, routes, or migration behavior.

In particular, inspect:

- `assets/css/style.css`
- `assets/css/devlog.css`
- `assets/js/devlog.js`
- `assets/js/script.js`
- `projects.html`
- `devlog.html`
- `scripts/build-devlog.mjs`
- `docs/content-management.md`
- `docs/devlog.md`
- `docs/security.md`
- `README.md`
- `package.json`
- the entire current `admin/` implementation

Do not copy assumptions from this prompt over actual repository facts.

Where the prompt and repository disagree, preserve existing working behavior first and document the architectural decision before changing compatibility-sensitive behavior.

The public repository is:

`https://github.com/AHMarius/ahmarius.github.io`

The public site is:

`https://ahmarius.github.io/`

Use those URLs as reference points only. Do not hardcode credentials or authentication tokens.

---

# 57. REQUIRED FINAL REPORT FROM THE CODING AI

When the implementation is complete, report:

1. What architecture was chosen and why.
2. What files were added/removed/changed.
3. What the final content tree looks like.
4. How Markdown round-tripping works.
5. How images/videos are stored.
6. How PDF import works.
7. How LaTeX is rendered.
8. How Pages and Sub-pages are generated.
9. How legacy Devlog compatibility was preserved.
10. How Publish stages files safely.
11. What tests were run and their results.
12. How to run the desktop app in development.
13. How to build/install it on Arch Linux.
14. Any known limitations that remain.

Do not simply state “implemented successfully”.

Give evidence in the form of concrete commands/tests/results.

---

# 58. END GOAL

The final product should make maintaining the portfolio feel like writing in a small personal publishing application rather than editing a website repository.

I should be able to think:

> “I want to write something about FluidDynamics.”

and then simply:

> Open app → FluidDynamics → New Post → write → drag images → add equations → save → preview → Publish.

Likewise:

> “I want a new long-term project section.”

should become:

> New Page → name → description → cover image → create → start writing.

No hand-written HTML.

No manual YAML editing for normal use.

No localhost browser admin page.

No proprietary content database.

No unsafe Git shortcuts.

Just a professional, native Linux writing tool backed by the repository's Markdown and Git history.
