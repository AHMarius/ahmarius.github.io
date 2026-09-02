import { ContentNode, PostDoc } from "./api";
import { Editor } from "./editor";
import "./app.css";

type View =
  | { kind: "pages" }
  | { kind: "allposts" }
  | { kind: "page"; slug: string }
  | { kind: "post"; page: string; slug: string }
  | { kind: "settings" };

const state = {
  view: { kind: "pages" } as View,
  tree: [] as ContentNode[],
  posts: [] as any[],
  prefs: {} as any,
  editor: null as Editor | null,
  editorSave: undefined as (() => Promise<any>) | undefined,
  editorDirty: false,
  status: "Idle" as string,
  saving: false as boolean,
  editorKey: "" as string,
  autosaveTimer: 0 as any,
};

const $ = (sel: string, root: HTMLElement | Document = document): any =>
  root.querySelector(sel);
const $$ = (sel: string, root: HTMLElement | Document = document): any[] =>
  Array.from(root.querySelectorAll(sel));
const el = (tag: string, cls = "", text = "") => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function humanDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `${days} days ago`;
  return iso;
}

function setStatus(text: string) {
  state.status = text;
  const s = $("#topbar-status");
  if (s) s.textContent = text;
  state.editor?.setStatus(state.editorDirty ? "Unsaved changes" : text);
}

// ---------- Fire Tauri or fall back for browser dev ----------
type InvokeFn = (cmd: string, args?: any) => Promise<any>;
let invokeImpl: InvokeFn | null = null;
async function call(cmd: string, args?: any): Promise<any> {
  if (!invokeImpl) {
    invokeImpl = (await import("@tauri-apps/api/core")).invoke as InvokeFn;
  }
  return invokeImpl(cmd, args);
}

const cell = (fn: () => Promise<any>) => fn().catch((e) => {
  setStatus(String(e.message || e));
  return null;
});

// ---------- Autosave + crash recovery ----------
function recoveryKey(page: string, slug: string): string {
  return slug ? `post:${page}/${slug}` : `draft:${page}`;
}

function scheduleAutosave() {
  if (!state.editorKey || !state.editor) return;
  window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(async () => {
    await cell(() =>
      call("save_recovery", { key: state.editorKey, content: state.editor!.getValue() }),
    );
  }, 1200);
}

async function checkRecovery(page: string, slug: string) {
  const key = recoveryKey(page, slug);
  if (!key) return;
  const saved = await cell(() => call("load_recovery", { key }));
  if (saved == null) return;
  // Only offer recovery if it differs from what's on disk.
  if (state.editor && saved === state.editor.getValue()) return;
  const host = $("#pe-recovery");
  if (!host) return;
  host.innerHTML = "";
  const bar = el("div", "recovery-bar");
  bar.innerHTML = `
    <strong>Recovered draft available</strong>
    <span class="muted">An unsaved draft was found for this post.</span>
    <span class="recovery-actions">
      <button id="rec-restore" class="btn primary">Restore</button>
      <button id="rec-discard" class="btn ghost">Discard</button>
    </span>`;
  host.appendChild(bar);
  $("#rec-restore")!.addEventListener("click", () => {
    state.editor!.setBody(saved);
    state.editorDirty = true;
    state.editor!.setStatus("Restored unsaved draft");
    bar.remove();
  });
  $("#rec-discard")!.addEventListener("click", async () => {
    await cell(() => call("clear_recovery", { key }));
    bar.remove();
  });
}

// ---------- Boot ----------
async function boot() {
  const prefs = await cell(() => call("get_prefs"));
  state.prefs = prefs || {};
  if (prefs?.theme) {
    document.documentElement.dataset.theme = prefs.theme;
  } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  }
  applyThemeToggle(document.documentElement.dataset.theme || "dark");
  await refreshTree();
}

async function refreshTree() {
  const tree = await cell(() => call("scan_content"));
  if (tree) {
    state.tree = tree;
    renderSidebar();
  }
}

// ---------- App shell ----------
const app = $("#app")!;
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img src="/icons/icon.png" class="brand-icon" alt="" />
        <span class="brand-name">AH Marius Content Studio</span>
      </div>
      <nav class="topnav2">
        <button data-nav="pages">Pages</button>
        <button data-nav="allposts">All Posts</button>
        <button data-nav="newpost">+ New Post</button>
      </nav>
      <div class="topbar-right">
        <span id="topbar-status" class="status-pill">Idle</span>
        <button id="preview-btn" class="btn">Preview</button>
        <button id="save-btn" class="btn primary">Save Draft</button>
        <button id="publish-btn" class="btn publish">Publish</button>
        <button id="settings-btn" class="btn ghost" title="Settings">⚙</button>
      </div>
    </header>
    <div class="app-body">
      <aside class="sidebar">
        <div class="sidebar-search"><input id="global-search" type="search" placeholder="Search…" /></div>
        <div id="sidebar-tree" class="sidebar-tree"></div>
        <div class="sidebar-foot">
          <button id="new-page-btn" class="btn block">+ New Page</button>
        </div>
      </aside>
      <main class="content">
        <div id="view-content"></div>
      </main>
    </div>
  </div>
`;

function renderSidebar() {
  const treeEl = $("#sidebar-tree")!;
  treeEl.innerHTML = "";
  state.tree.forEach((node) => {
    const item = el("div", "tree-item");
    item.innerHTML = `
      <div class="tree-row" data-id="${esc(node.id)}">
        <span class="tree-caret">▾</span>
        <span class="tree-label">📁 ${esc(node.name)}</span>
      </div>
      <div class="tree-children">
        ${node.children
          .map(
            (c) =>
              `<div class="tree-post" data-id="${esc(c.id)}"><span class="tree-dot">${c.status === "published" ? "●" : "○"}</span> ${esc(c.name)}</div>`,
          )
          .join("")}
      </div>
    `;
    treeEl.appendChild(item);
  });
  treeEl.querySelectorAll(".tree-row").forEach((r: any) => {
    r.addEventListener("click", () => {
      const slug = (r as HTMLElement).dataset.id;
      showPageView(slug!);
    });
  });
  treeEl.querySelectorAll(".tree-post").forEach((r: any) => {
    r.addEventListener("click", () => {
      const [page, slug] = (r as HTMLElement).dataset.id!.split(":");
      showPostView(page, slug);
    });
  });

  const children = $$(".tree-children", treeEl);
  children.forEach((c) => c.classList.add("open"));
}

// ---------- Views ----------
const viewContent = () => $("#view-content")!;

function showPagesView() {
  state.view = { kind: "pages" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "Pages"));
  const grid = el("div", "cards-grid");
  state.tree.forEach((node) => {
    const card = el("article", "card page-card-c");
    card.innerHTML = `
      <div class="card-head"><span class="card-avatar"></span><h3>${esc(node.name)}</h3></div>
      <p class="card-desc">${esc(String(node.children.length))} posts</p>
      <div class="card-actions">
        <button data-open-page="${esc(node.slug)}" class="btn">Open</button>
        <button data-edit-page="${esc(node.slug)}" class="btn">Edit</button>
      </div>
    `;
    grid.appendChild(card);
  });
  const empty = el("div", "empty-state");
  empty.innerHTML = `<h3>No pages yet</h3><p>Create a project or topic page to start organizing your writing.</p>`;
  if (!state.tree.length) v.appendChild(empty);
  v.appendChild(grid);
  grid.querySelectorAll("[data-open-page]").forEach((b) =>
    b.addEventListener("click", () => showPageView((b as HTMLElement).dataset["open-page"]!)),
  );
  grid.querySelectorAll("[data-edit-page]").forEach((b) =>
    b.addEventListener("click", () => openPageEditor((b as HTMLElement).dataset["edit-page"]!)),
  );
}

function showAllPostsView() {
  state.view = { kind: "allposts" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "All Posts"));
  cell(async () => {
    const posts = await call("list_posts");
    state.posts = posts || [];
    const list = el("div", "rows");
    posts!.forEach((p: any) => {
      const row = el("div", "row");
      row.innerHTML = `
        <div class="row-main"><strong>${esc(p.title)}</strong><span class="muted">${esc(p.page)}</span>
          <span class="pill ${esc(p.status)}">${esc(p.status)}</span></div>
        <div class="row-meta">${esc(humanDate(p.updated_date))}</div>
        <div class="row-actions">
          <button data-edit="${esc(p.page)}|${esc(p.slug)}" class="btn">Edit</button>
        </div>
      `;
      list.appendChild(row);
    });
    if (!posts!.length) list.appendChild(emptyState("No posts yet", "Create a post to get started."));
    v.appendChild(list);
    list.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => {
        const [page, slug] = (b as HTMLElement).dataset["edit"]!.split("|");
        showPostView(page, slug);
      });
    });
  });
}

function emptyState(title: string, sub: string) {
  const e = el("div", "empty-state");
  e.innerHTML = `<h3>${esc(title)}</h3><p>${esc(sub)}</p>`;
  return e;
}

async function showPageView(slug: string) {
  state.view = { kind: "page", slug };
  const v = viewContent();
  v.innerHTML = "";
  await cell(async () => {
    const doc = await call("read_page", { slug });
    if (!doc) return;
    v.appendChild(el("h1", "page-title", doc.name || slug));
    if (doc.description) v.appendChild(el("p", "muted", doc.description));
    const actions = el("div", "card-actions");
    const newPost = el("button", "btn primary", "+ New Post");
    const newSub = el("button", "btn", "+ New Sub-page");
    const editPage = el("button", "btn", "Edit Page");
    actions.append(newPost, newSub, editPage);
    v.appendChild(actions);
    newPost.addEventListener("click", () => openPostEditor(slug, null));
    newSub.addEventListener("click", () => openPageEditor(null, slug));
    editPage.addEventListener("click", () => openPageEditor(slug));
    const posts = await call("list_posts");
    const mine = (posts || []).filter((p: any) => p.page === slug);
    const list = el("div", "rows");
    mine.forEach((p: any) => {
      const row = el("div", "row");
      row.innerHTML = `<div class="row-main"><strong>${esc(p.title)}</strong><span class="pill ${esc(p.status)}">${esc(p.status)}</span></div>
        <div class="row-meta">${esc(humanDate(p.updated_date))}</div>
        <div class="row-actions"><button data-edit="${esc(p.slug)}" class="btn">Edit</button></div>`;
      list.appendChild(row);
    });
    if (!mine.length) list.appendChild(emptyState("This page has no posts yet.", "Create your first post."));
    v.appendChild(list);
    list.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => showPostView(slug, (b as HTMLElement).dataset["edit"]!));
    });
  });
}

// ---------- Page Editor ----------
function openPageEditor(slug?: string | null, parent?: string | null) {
  state.editor?.setStatus(state.status);
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", slug ? `Edit Page` : "New Page"));
  const form = el("form", "prop-form");
  form.innerHTML = `
    <label>Name <input id="pe-name" required /></label>
    <label>Slug <input id="pe-slug" placeholder="auto from name" /></label>
    <label>Description <textarea id="pe-desc" rows="3"></textarea></label>
    <label>Cover path <input id="pe-cover" placeholder="cover.jpg" /></label>
    <label>Parent ${parent != null ? `<span class="muted">(${parent})</span>` : ""}<input id="pe-parent" value="${esc(parent || "")}" placeholder="parent slug or empty" /></label>
    <button id="pe-save" class="btn primary">Save</button>
  `;
  v.appendChild(form);
  if (slug) {
    cell(async () => {
      const doc = await call("read_page", { slug });
      ($("#pe-name") as HTMLInputElement).value = doc?.name || "";
      ($("#pe-slug") as HTMLInputElement).value = doc?.slug || "";
      ($("#pe-desc") as HTMLTextAreaElement).value = doc?.description || "";
      ($("#pe-cover") as HTMLInputElement).value = doc?.cover || "";
      ($("#pe-parent") as HTMLInputElement).value = doc?.parent || parent || "";
    });
  } else if (parent) {
    ($("#pe-parent") as HTMLInputElement).value = parent;
  }
  $("#pe-save")!.addEventListener("click", async (e: Event) => {
    e.preventDefault();
    const name = ($("#pe-name") as HTMLInputElement).value.trim();
    let sl = ($("#pe-slug") as HTMLInputElement).value.trim() || slugify(name);
    const parentVal = ($("#pe-parent") as HTMLInputElement).value.trim() || null;
    await cell(() =>
      call(slug ? "update_page" : "create_page", {
        page: {
          name,
          slug: sl,
          description: ($("#pe-desc") as HTMLTextAreaElement).value,
          cover: ($("#pe-cover") as HTMLInputElement).value,
          parent: parentVal,
          order: null,
        },
      }),
    );
    setStatus(slug ? `Saved page ${sl}` : `Created page ${sl}`);
    await refreshTree();
    if (slug) showPageView(sl);
    else showPagesView();
  });
  if (slug) {
    ($("#pe-name") as HTMLInputElement).addEventListener("input", () => {
      // keep slug auto if untouched
    });
  }
}

// ---------- Post Editor ----------
const openEditor = () => {
  const e = new Editor(() => {
    state.editorDirty = true;
    state.editor?.setStatus("Unsaved changes");
    scheduleAutosave();
  });
  state.editor = e;
  return e;
};

function openPostEditor(page: string, post: PostDoc | null) {
  state.view = { kind: post ? "post" : "post", page, slug: post?.slug || "" };
  state.editorKey = recoveryKey(page, post?.slug || "");
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", post ? "Edit Post" : "New Post"));
  const recoveryHost = el("div", "");
  recoveryHost.id = "pe-recovery";
  v.appendChild(recoveryHost);
  const meta = el("div", "props-panel");
  meta.innerHTML = `
    <div class="prop-grid">
      <label>Title <input id="po-title" required /></label>
      <label>Slug <input id="po-slug" /></label>
      <label>Status <select id="po-status"><option>draft</option><option>published</option><option>archived</option></select></label>
      <label>Page <input id="po-page" value="${esc(page)}" readonly /></label>
      <label>Date <input id="po-date" type="date" /></label>
      <label>Subtitle <input id="po-subtitle" /></label>
    </div>
    <label>Excerpt <textarea id="po-excerpt" rows="2" placeholder="Short summary…"></textarea></label>
    <div class="chip-editors">
      <div><label>Tags</label><input id="po-tags" placeholder="comma separated" /></div>
      <div><label>Technologies</label><input id="po-tech" placeholder="comma separated" /></div>
      <div><label>Project</label><input id="po-project" /></div>
    </div>
  `;
  v.append(meta, openEditor().getElement());
  if (post) {
    ($("#po-title") as HTMLInputElement).value = post.title;
    ($("#po-slug") as HTMLInputElement).value = post.slug;
    ($("#po-status") as HTMLSelectElement).value = post.status;
    ($("#po-date") as HTMLInputElement).value = post.date;
    ($("#po-subtitle") as HTMLInputElement).value = post.subtitle || "";
    ($("#po-excerpt") as HTMLTextAreaElement).value = post.excerpt || "";
    ($("#po-tags") as HTMLInputElement).value = (post.tags || []).join(", ");
    ($("#po-tech") as HTMLInputElement).value = (post.technologies || []).join(", ");
    ($("#po-project") as HTMLInputElement).value = post.project || "";
    state.editor!.setBody(post.body);
  } else {
    ($("#po-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
    ($("#po-status") as HTMLSelectElement).value = prefsDefaultStatus();
  }
  bindPostSave(page);
  state.editorDirty = false;
  state.editor?.setStatus("Saved");
  checkRecovery(page, post?.slug || "");
}

function prefsDefaultStatus() {
  return state.prefs?.default_status || "draft";
}

function bindPostSave(page: string) {
  const save = async () => {
    if (state.saving) return;
    state.saving = true;
    const meta = {
      title: ($("#po-title") as HTMLInputElement).value.trim(),
      slug: ($("#po-slug") as HTMLInputElement).value.trim(),
      date: ($("#po-date") as HTMLInputElement).value,
      updated_date: new Date().toISOString().slice(0, 10),
      status: ($("#po-status") as HTMLSelectElement).value,
      excerpt: ($("#po-excerpt") as HTMLTextAreaElement).value,
      featured: false,
      page,
      project: ($("#po-project") as HTMLInputElement).value.trim(),
      subtitle: ($("#po-subtitle") as HTMLInputElement).value.trim(),
      cover: "",
      tags: splitChips(($("#po-tags") as HTMLInputElement).value),
      technologies: splitChips(($("#po-tech") as HTMLInputElement).value),
    };
    try {
      const savedSlug = await call("write_post", { input: { page_slug: page, meta, body: state.editor!.getValue() } });
      // Success: clear autosave recovery for this post, then switch the draft key
      // from the placeholder to the real slug so later autosaves are keyed correctly.
      const oldKey = state.editorKey;
      state.editorKey = recoveryKey(page, String(savedSlug || meta.slug));
      await cell(() => call("clear_recovery", { key: oldKey }));
      setStatus(`Saved draft: ${meta.title}`);
      await refreshTree();
    } catch (e) {
      setStatus(String((e as any).message || e));
    } finally {
      state.saving = false;
      state.editorDirty = false;
      state.editor?.setStatus("Saved");
    }
  };
  state.editorSave = save;
  $("#save-btn")!.onclick = () => cell(save);
  $("#preview-btn")!.onclick = () => cell(() => doPreview());
}

function splitChips(v: string) {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

async function showPostView(page: string, slug: string) {
  const doc = await cell(() => call("read_post", { pageSlug: page, postSlug: slug }));
  if (!doc) return;
  openPostEditor(page, doc);
}

async function doPreview() {
  await cell(async () => {
    if (state.editorSave) await state.editorSave();
    await call("build_site");
    setStatus("Build complete — preview ready (not published)");
  });
}

// ---------- Publish ----------
function openPublish() {
  const overlay = el("div", "overlay");
  overlay.innerHTML = `
    <div class="modal">
      <h2>Publish changes</h2>
      <div id="publish-body" class="publish-body"><p class="muted">Checking repository state…</p></div>
      <div class="modal-actions">
        <button id="pub-cancel" class="btn">Cancel</button>
        <button id="pub-go" class="btn publish">Publish</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const body = $("#publish-body", overlay)!;
  $("#pub-cancel", overlay)!.onclick = () => overlay.remove();

  cell(async () => {
    let st;
    try {
      st = await call("git_status");
    } catch (e) {
      body.innerHTML = `<p class="error-text">Could not read Git status: ${esc(String((e as any).message || e))}</p>
        <p class="muted">Open Settings to set or verify the repository path.</p>`;
      return;
    }
    if (!st) {
      body.innerHTML = `<p class="error-text">Could not read Git status. Open Settings to set the repository path.</p>`;
      return;
    }
    const auth = await cell(() => call("git_auth_status"));
    if (auth && !auth.authenticated) {
      body.innerHTML = `<p class="error-text">Not signed in to GitHub.</p>
        <p class="muted">${auth.gh_installed ? "Run <code>gh auth login</code> in a terminal, then try again." : "GitHub CLI (<code>gh</code>) not installed — configure Git credentials for the remote."}</p>
        ${auth.error ? `<pre class="diffbox">${esc(String(auth.error).slice(0, 200))}</pre>` : ""}
        <div class="modal-actions"><button id="pub-cancel2" class="btn">Close</button></div>`;
      $("#pub-cancel2", overlay)!.onclick = () => overlay.remove();
      return;
    }
    const staged = st.staged.map((f: any) => `${f.path}`).join("<br>");
    const unstaged = st.unstaged.map((f: any) => `${f.path}`).join("<br>");
    const unrel = st.unrelated_modified.length
      ? `<p class="muted">Unrelated working changes (will not be touched):<br>${st.unrelated_modified.map(esc).join("<br>")}</p>`
      : "";
    body.innerHTML = `
      <p>Branch: <strong>${esc(st.branch)}</strong>${st.ahead ? ` (${st.ahead} ahead)` : ""}${st.behind ? ` (${st.behind} behind)` : ""}</p>
      <h4>Staged</h4><pre class="diffbox">${staged || "(nothing staged yet)"}</pre>
      <h4>Unstaged content changes</h4><pre class="diffbox">${unstaged || "(none)"}</pre>
      ${unrel}
      <label>Commit message<input id="pub-msg" value="Update portfolio content" /></label>
      <p class="muted">Will run the build, then stage only content/pages/assets/devlog/dist paths.</p>
    `;
    $("#pub-go", overlay)!.onclick = async () => {
      $("#pub-go", overlay)!.disabled = true;
      body.innerHTML = `<p class="muted">Building site…</p>`;
      try {
        const built = await call("build_site");
        if (!built?.success) {
          body.innerHTML = `<p class="error-text">Build failed.</p><pre class="diffbox">${esc(built?.output)}</pre>`;
          return;
        }
        body.innerHTML = `<p class="muted">Reviewing changed files…</p>`;
        const status2 = await call("git_status");
        const paths = new Set<string>();
        (status2.unstaged || []).forEach((f: any) => {
          if (/^(content\/|pages\/|pages\.html|devlog\/|devlog\.html|assets\/dist)/.test(f.path)) paths.add(f.path);
        });
        (status2.staged || []).forEach((f: any) => paths.add(f.path));
        (status2.untracked || []).forEach((p: any) => {
          if (/^(content\/|pages\/|pages\.html|devlog\/|devlog\.html|assets\/dist)/.test(p)) paths.add(p);
        });
        body.innerHTML = `<p class="muted">Staging ${paths.size} file(s)…</p>`;
        await call("git_stage_paths", { paths: Array.from(paths) });
        const msg = ($("#pub-msg", overlay) as HTMLInputElement)?.value || "Update portfolio content";
        const commitHash = await call("git_commit", { message: msg });
        body.innerHTML = `<p class="muted">Pushing…</p>`;
        const push = await call("git_push", { branch: status2.branch });
        body.innerHTML = `
          <p class="success-text">Published ✓</p>
          <p>Commit: <code>${esc(commitHash || "?")}</code> on <strong>${esc(status2.branch)}</strong></p>
          <p>Pushed file(s): <code>${paths.size}</code></p>
          <p class="muted">${esc(push || "")}</p>
        `;
        $("#pub-go", overlay)!.remove();
        setStatus("Published");
        await refreshTree();
      } catch (e) {
        body.innerHTML = `<p class="error-text">Something went wrong.</p><pre class="diffbox">${esc(String((e as any).message || e))}</pre>`;
      }
    };
  });
}

function slugify(s: string) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

function applyThemeToggle(theme: string) {
  document.documentElement.dataset.theme = theme;
  const btn = $("#settings-btn")!;
  btn.textContent = theme === "dark" ? "☾" : "☀";
}

// ---------- Settings ----------
function showSettings() {
  state.view = { kind: "settings" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "Settings"));
  const form = el("div", "prop-form");
  form.innerHTML = `
    <div class="auth-panel">
      <h3>GitHub sign-in</h3>
      <p class="auth-desc">Used to publish changes to <strong>ahmarius.github.io</strong>.
        The app uses the GitHub CLI (<code>gh</code>) that is already on your system to sign in automatically.</p>
      <div id="auth-status" class="auth-status loading">Checking GitHub connection…</div>
      <button id="auth-refresh" class="btn">Check again</button>
      <p class="muted auth-hint">If it says not signed in, run <code>gh auth login</code> in a terminal.</p>
    </div>
    <label>Repository path <input id="set-repo" value="${esc(state.prefs?.repo_path || "")}" placeholder="/path/to/ahmarius.github.io" /></label>
    <label>Theme
      <select id="set-theme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select>
    </label>
    <label>Default post status
      <select id="set-status"><option>draft</option><option>published</option></select>
    </label>
    <button id="set-save" class="btn primary">Save Settings</button>
    <p id="set-msg" class="muted"></p>
  `;
  v.appendChild(form);
  ($("#set-theme") as HTMLSelectElement).value = state.prefs?.theme || "system";
  ($("#set-status") as HTMLSelectElement).value = state.prefs?.default_status || "draft";
  renderAuthStatus();
  $("#auth-refresh")!.onclick = renderAuthStatus;
  $("#set-save")!.onclick = async () => {
    const repo = ($("#set-repo") as HTMLInputElement).value.trim();
    if (repo) {
      const check = await cell(() => call("check_repo", { repoPath: repo }));
      if (check && !check.is_repo) {
        ($("#set-msg") as HTMLElement).textContent = "Warning: folder is not a Git repository.";
        ($("#set-msg") as HTMLElement).className = "error-text";
      }
    }
    const prefs = {
      repo_path: repo || null,
      theme: ($("#set-theme") as HTMLSelectElement).value,
      default_status: ($("#set-status") as HTMLSelectElement).value,
    };
    state.prefs = prefs;
    await cell(() => call("set_prefs", { prefs }));
    applyThemeToggle(prefs.theme === "dark" ? "dark" : prefs.theme === "light" ? "light" : "dark");
    ($("#set-msg") as HTMLElement).textContent = "Saved.";
    await refreshTree();
  };
}

async function renderAuthStatus() {
  const host = $("#auth-status");
  if (!host) return;
  host.className = "auth-status loading";
  host.textContent = "Checking GitHub connection…";
  await cell(async () => {
    const st = await call("git_auth_status");
    if (!st) {
      host.className = "auth-status error";
      host.innerHTML = "Could not check GitHub (no repository configured?).";
      return;
    }
    if (st.authenticated) {
      host.className = "auth-status ok";
      host.innerHTML = `Connected to GitHub as <strong>${esc(st.remote || "origin")}</strong> — ready to publish.`;
    } else {
      host.className = "auth-status error";
      host.innerHTML = `Not signed in to GitHub. ${st.gh_installed ? "Run <code>gh auth login</code> in a terminal." : "GitHub CLI (<code>gh</code>) not found — install it or configure Git credentials."}` +
        (st.error ? ` <span class="muted">(${esc(String(st.error).slice(0, 80))})</span>` : "");
    }
  });
}

// ---------- Wiring ----------
function wireTop() {
  $$(".topnav2 button").forEach((b) => {
    b.addEventListener("click", () => {
      const nav = (b as HTMLElement).dataset.nav;
      if (nav === "pages") showPagesView();
      else if (nav === "allposts") showAllPostsView();
      else if (nav === "newpost") {
        const page =
          prompt("Page slug to publish this post into (or leave empty for the first page):") ||
          state.tree[0]?.slug ||
          "";
        openPostEditor(page, null);
      }
    });
  });
  $("#new-page-btn")!.onclick = () => openPageEditor();
  $("#publish-btn")!.onclick = openPublish;
  $("#settings-btn")!.onclick = showSettings;
  $("#global-search")!.addEventListener("input", (e: Event) => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderSidebarFiltered(q);
  });
}

function renderSidebarFiltered(q: string) {
  renderSidebar();
  if (q) {
    $$(".tree-row, .tree-post").forEach((n) => {
      const ok = n.textContent!.toLowerCase().includes(q);
      (n as HTMLElement).style.display = ok ? "" : "none";
    });
  }
}

// ensure editorSave exists on state type
boot().then(() => {
  showPagesView();
  wireTop();
});
