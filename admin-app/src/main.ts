import { ContentNode, PostDoc } from "./api";
import { Editor } from "./editor";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { checkSyncGateway, claimPhonePairing, createPhonePairing, listSyncFiles, readSyncFile, writeSyncFile, type SyncSession } from "./sync";
import "./app.css";

type View =
  | { kind: "dashboard" }
  | { kind: "sync" }
  | { kind: "pages" }
  | { kind: "projects" }
  | { kind: "allposts" }
  | { kind: "page"; slug: string }
  | { kind: "post"; page: string; slug: string }
  | { kind: "settings" };

const state = {
  view: { kind: "dashboard" } as View,
  tree: [] as ContentNode[],
  posts: [] as any[],
  projects: [] as any[],
  portfolioProjects: [] as any[],
  prefs: {} as any,
  editor: null as Editor | null,
  editorSave: undefined as (() => Promise<boolean>) | undefined,
  editorOriginalSlug: "" as string,
  editorAssetSlug: "" as string,
  editorDirty: false,
  status: "Idle" as string,
  saving: false as boolean,
  editorKey: "" as string,
  autosaveTimer: 0 as any,
  collapsed: new Set<string>(),
  syncSession: null as SyncSession | null,
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
const basename = (p: string) => String(p).split(/[\\/]/).pop() || String(p);
const pad2 = (n: number) => String(n).padStart(2, "0");

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

/** True while the post editor is on screen and usable (not a stale closure
 * left behind after navigating away). */
function editorActive(): boolean {
  return state.view.kind === "post" && Boolean($("#po-title")) && Boolean(state.editorSave);
}

/** Drop the editor bindings when leaving the post editor, so a later publish
 * / preview / Ctrl+S can't invoke a stale save closure against removed DOM. */
function resetEditorState() {
  state.editorSave = undefined;
  state.editorOriginalSlug = "";
  state.editorAssetSlug = "";
  state.editorDirty = false;
  state.editorKey = "";
  if (state.autosaveTimer) {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = 0;
  }
  newPostSessionId = "";
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

async function loadPortfolioProjects(): Promise<any[]> {
  try {
    return (await call("list_portfolio_projects")) || [];
  } catch {
    const response = await fetch("/projects.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the bundled projects database snapshot.");
    const projects = await response.json();
    return Array.isArray(projects) ? projects : [];
  }
}

async function loadPortfolioProject(slug: string): Promise<any> {
  try {
    return await call("read_portfolio_project", { slug });
  } catch {
    if (!state.portfolioProjects.length) state.portfolioProjects = await loadPortfolioProjects();
    const project = state.portfolioProjects.find((item: any) => item.slug === slug);
    if (!project) throw new Error(`Portfolio project not found: ${slug}`);
    return project;
  }
}

const cell = (fn: () => Promise<any>) => fn().catch((e) => {
  setStatus(String(e.message || e));
  return null;
});

// ---------- GitHub web sign-in (device flow via `gh auth login --web`) ----------
let ghListeners: UnlistenFn[] = [];
let ghOnDone: (() => void) | null = null;

function stopGhListeners() {
  ghListeners.forEach((off) => {
    try {
      off();
    } catch {
      /* already released */
    }
  });
  ghListeners = [];
}

/** Ensure the `gh auth` credential helper is registered for HTTPS remotes. */
async function setupGitHub() {
  return await cell(() => call("github_auth_setup"));
}

/**
 * Render the interactive sign-in widget into `host`. Streams the one-time
 * device code + URL emitted by the backend and calls `onDone` after success.
 */
async function renderSignIn(host: HTMLElement, onDone: () => void) {
  stopGhListeners();
  ghOnDone = onDone;
  host.className = "auth-status loading";
  host.innerHTML = `<p class="muted">Starting GitHub sign-in… keep this window open.</p>`;
  try {
    await call("github_login");
  } catch (e) {
    host.className = "auth-status error";
    host.innerHTML = `<p class="error-text">Could not start GitHub sign-in: ${esc(String((e as any).message || e))}</p>`;
    return;
  }
  host.innerHTML = `
    <div class="gh-login">
      <p class="auth-desc muted">Complete the sign-in in the browser window that opens:</p>
      <div class="gh-code muted">Waiting for one-time code…</div>
      <p class="gh-url"><a href="https://github.com/login/device" target="_blank" rel="noopener">https://github.com/login/device</a></p>
      <p class="muted gh-hint">Waiting for authentication…</p>
    </div>
  `;
  const codeBox = host.querySelector<HTMLElement>(".gh-code")!;
  const link = host.querySelector<HTMLAnchorElement>(".gh-url a")!;
  const hint = host.querySelector<HTMLElement>(".gh-hint")!;

  ghListeners.push(
    await listen("github-login-code", (e: any) => {
      const p = e.payload || {};
      if (p.code) {
        codeBox.textContent = p.code;
        codeBox.classList.add("gh-code-ready");
        codeBox.classList.remove("muted");
        if (hint) hint.textContent = "Enter this code on the GitHub page (it may already be filled in).";
      }
      if (p.url && link) {
        link.href = p.url;
        link.textContent = p.url;
      }
    }),
  );
  ghListeners.push(
    await listen("github-login-url", (e: any) => {
      const url = e?.payload?.url;
      if (url && link) {
        link.href = url;
        link.textContent = url;
      }
    }),
  );
  ghListeners.push(
    await listen("github-login-done", async (e: any) => {
      const p = e.payload || {};
      if (p.ok) {
        host.className = "auth-status ok";
        host.innerHTML = `<p class="success-text">Signed in to GitHub as <strong>${esc(p.login || "you")}</strong> ✓</p>`;
        await setupGitHub();
        const done = ghOnDone;
        stopGhListeners();
        done?.();
      } else {
        host.className = "auth-status error";
        host.innerHTML = `<p class="error-text">GitHub sign-in was cancelled or failed. Try again.</p>`;
        stopGhListeners();
      }
    }),
  );
  ghListeners.push(
    await listen("github-login-error", (e: any) => {
      host.className = "auth-status error";
      host.innerHTML = `<p class="error-text">${esc(String(e?.payload || "GitHub sign-in error"))}</p>`;
      stopGhListeners();
    }),
  );
}

// ---------- Autosave + crash recovery ----------
let newPostSessionId = "";
let pendingClearKeys: string[] = [];

function sessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Key is unique per editor session: existing posts get post:page/slug and
// unsaved new posts get draft:page:sessionId so two "+ New Post" editors
// never overwrite each other's autosave slot.
function recoveryKey(page: string, slug: string): string {
  return slug ? `post:${page}/${slug}` : `draft:${page}:${newPostSessionId}`;
}

function scheduleAutosave() {
  if (!state.editorKey || !state.editor) return;
  window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(async () => {
    await cell(() =>
      call("save_recovery", {
        key: state.editorKey,
        content: state.editor!.getValue(),
        metadata: recoveryMetadata(),
      }),
    );
  }, 1200);
}

function recoveryMetadata() {
  const value = (id: string) => (($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? "");
  const featured = $("#po-featured") as HTMLInputElement | null;
  return {
    title: value("#po-title"), slug: value("#po-slug"), status: value("#po-status"), date: value("#po-date"),
    subtitle: value("#po-subtitle"), cover: value("#po-cover"), excerpt: value("#po-excerpt"), tags: value("#po-tags"),
    technologies: value("#po-tech"), project: value("#po-project"), series: value("#po-series"), part: value("#po-part"),
    featured: Boolean(featured?.checked),
  };
}

function restoreRecoveryMetadata(metadata: any) {
  if (!metadata || typeof metadata !== "object") return;
  const set = (id: string, value: any) => {
    const node = $(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (node && value != null) node.value = String(value);
  };
  set("#po-title", metadata.title); set("#po-slug", metadata.slug); set("#po-status", metadata.status);
  set("#po-date", metadata.date); set("#po-subtitle", metadata.subtitle); set("#po-cover", metadata.cover);
  set("#po-excerpt", metadata.excerpt); set("#po-tags", metadata.tags); set("#po-tech", metadata.technologies);
  set("#po-project", metadata.project); set("#po-series", metadata.series); set("#po-part", metadata.part);
  const featured = $("#po-featured") as HTMLInputElement | null;
  if (featured && typeof metadata.featured === "boolean") featured.checked = metadata.featured;
  updateSeriesChip();
}

async function checkRecovery(page: string, slug: string) {
  const key = recoveryKey(page, slug);
  if (!key) return;
  const saved = await cell(() => call("load_recovery", { key }));
  if (saved == null) return;
  // Only offer recovery if it differs from what's on disk.
  const content = typeof saved === "string" ? saved : saved?.content;
  if (typeof content !== "string") return;
  if (state.editor && content === state.editor.getValue()) return;
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
    state.editor!.setBody(content);
    restoreRecoveryMetadata(typeof saved === "string" ? null : saved.metadata);
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
  // Best-effort auto-connect: register the gh credential helper so future
  // `git push` over HTTPS picks up the stored GitHub token.
  (async () => {
    try {
      await call("github_auth_setup");
    } catch {
      /* gh not installed / not authed; the Settings panel offers sign-in */
    }
  })();
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
        <button data-nav="dashboard">Dashboard</button>
        <button data-nav="sync">Phone Sync</button>
        <button data-nav="pages">Pages</button>
        <button data-nav="projects">Projects</button>
        <button data-nav="allposts">All Posts</button>
        <button data-nav="newpost">+ New Post</button>
        <button data-nav="newpostpdf">PDF</button>
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
    const collapsed = state.collapsed.has(node.id);
    const item = el("div", "tree-item");
    item.innerHTML = `
      <div class="tree-row" data-id="${esc(node.id)}">
        <span class="tree-caret" data-caret="${esc(node.id)}" title="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "▸" : "▾"}</span>
        <span class="tree-label">📁 ${esc(node.name)}</span>
      </div>
      <div class="tree-children${collapsed ? "" : " open"}">
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
  treeEl.querySelectorAll(".tree-caret").forEach((c: any) => {
    c.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      const id = (c as HTMLElement).dataset.caret!;
      if (state.collapsed.has(id)) state.collapsed.delete(id);
      else state.collapsed.add(id);
      renderSidebar();
    });
  });
}

// ---------- Views ----------
const viewContent = () => $("#view-content")!;

function showPagesView() {
  resetEditorState();
  state.view = { kind: "pages" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "Pages"));
  const grid = el("div", "cards-grid");
  state.tree.forEach((node) => {
    const card = el("article", "card page-card-c");
    card.innerHTML = `
      <div class="card-head"><span class="card-avatar"></span><h3>${esc(node.name)}${node.type_ === "page" && node.children.length === 0 ? "" : ""}${isDevlogPage(node) ? ' <span class="pill devlog">devlog</span>' : ""}</h3></div>
      <p class="card-desc">${esc(String(node.children.length))} posts</p>
      <div class="card-actions">
        <button data-open-page="${esc(node.slug)}" class="btn">Open</button>
        <button data-edit-page="${esc(node.slug)}" class="btn">Edit</button>
        <button data-del-page="${esc(node.slug)}" class="btn danger">Delete</button>
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
  grid.querySelectorAll("[data-del-page]").forEach((b) =>
    b.addEventListener("click", () => {
      const slug = (b as HTMLElement).dataset["del-page"]!;
      deletePage(slug);
    }),
  );
  void maybeShowRecoveryNotice(v);
}

function isDevlogPage(node: ContentNode) {
  return node.kind === "devlog";
}

// ---------- Remote phone sync editor ----------
function syncGatewayUrl(): string {
  return String(state.prefs?.settings?.sync_gateway_url || "").trim();
}

function showSyncView() {
  resetEditorState();
  state.view = { kind: "sync" };
  const v = viewContent();
  const gateway = syncGatewayUrl();
  if (!gateway || !state.syncSession) {
    v.innerHTML = `
      <h1 class="page-title">Phone Sync</h1>
      <div class="card sync-card">
        <h2>Pair this session</h2>
        <p class="muted">On your laptop, open Settings → Phone sync and create a one-time pairing code. The code expires in 10 minutes and no GitHub token is stored on this device.</p>
        <label>Sync gateway URL <input id="sync-gateway" value="${esc(gateway)}" placeholder="https://content-sync.example.workers.dev" /></label>
        <label>Pairing code <input id="sync-code" autocomplete="one-time-code" placeholder="ABC123…" /></label>
        <div class="card-actions"><button id="sync-connect" class="btn primary">Pair and open editor</button></div>
        <p id="sync-message" class="muted"></p>
      </div>`;
    $("#sync-connect", v)!.addEventListener("click", async () => {
      const url = ($("#sync-gateway", v) as HTMLInputElement).value.trim();
      const code = ($("#sync-code", v) as HTMLInputElement).value.trim();
      const message = $("#sync-message", v) as HTMLElement;
      try {
        state.syncSession = await claimPhonePairing(url, code);
        state.prefs = { ...state.prefs, settings: { ...state.prefs?.settings, sync_gateway_url: url } };
        await call("set_prefs", { prefs: state.prefs });
        showSyncView();
      } catch (error) {
        message.textContent = String((error as any).message || error);
        message.className = "error-text";
      }
    });
    return;
  }
  v.innerHTML = `<h1 class="page-title">Phone Sync</h1><p class="muted">Loading canonical content files…</p>`;
  void cell(async () => {
    const editable = (await listSyncFiles(gateway, state.syncSession!.token))
      .filter((file) => /\.(?:md|ya?ml|json)$/i.test(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (state.view.kind !== "sync") return;
    v.innerHTML = `
      <h1 class="page-title">Phone Sync <button id="sync-disconnect" class="btn">End session</button></h1>
      <p class="muted">Edits commit directly to the configured GitHub branch. A conflicting remote edit is never overwritten silently.</p>
      <div class="sync-editor-layout">
        <div class="sync-file-list">${editable.map((file) => `<button class="sync-file" data-sync-file="${esc(file.path)}">${esc(file.path.replace(/^content\//, ""))}</button>`).join("") || '<p class="muted">No editable content found.</p>'}</div>
        <div id="sync-document" class="sync-document"><p class="muted">Choose a content file to edit.</p></div>
      </div>`;
    $("#sync-disconnect", v)!.addEventListener("click", () => {
      state.syncSession = null;
      showSyncView();
    });
    $$('[data-sync-file]', v).forEach((button) => {
      button.addEventListener("click", () => void openSyncFile((button as HTMLElement).dataset.syncFile!));
    });
  });
}

async function openSyncFile(path: string) {
  const host = $("#sync-document") as HTMLElement | null;
  if (!host || !state.syncSession) return;
  host.innerHTML = `<p class="muted">Loading ${esc(path)}…</p>`;
  try {
    const doc = await readSyncFile(syncGatewayUrl(), state.syncSession.token, path);
    host.innerHTML = `<label class="sync-file-title">${esc(path)}<textarea id="sync-body" rows="24" spellcheck="true"></textarea></label><div class="card-actions"><button id="sync-save" class="btn primary">Save to GitHub</button></div><p id="sync-save-msg" class="muted"></p>`;
    const body = $("#sync-body", host) as HTMLTextAreaElement;
    body.value = doc.content;
    $("#sync-save", host)!.addEventListener("click", async () => {
      const message = $("#sync-save-msg", host) as HTMLElement;
      try {
        const saved = await writeSyncFile(syncGatewayUrl(), state.syncSession!.token, path, doc.sha, body.value);
        doc.sha = saved.sha;
        message.textContent = "Saved to GitHub. Pages will publish after the workflow completes.";
        message.className = "success-text";
      } catch (error) {
        message.textContent = String((error as any).message || error);
        message.className = "error-text";
      }
    });
  } catch (error) {
    host.innerHTML = `<p class="error-text">${esc(String((error as any).message || error))}</p>`;
  }
}

// ---------- Dashboard ----------
function showDashboard() {
  resetEditorState();
  state.view = { kind: "dashboard" };
  const v = viewContent();
  v.innerHTML = `<h1 class="page-title">Dashboard</h1><p class="muted">Loading your content workspace…</p>`;
  void cell(async () => {
    const [posts, git, recoveries, trash] = await Promise.all([
      call("list_posts").catch(() => []),
      call("git_status").catch(() => null),
      call("list_recovery").catch(() => []),
      call("list_trash").catch(() => []),
    ]);
    if (state.view.kind !== "dashboard") return;
    state.posts = posts || [];
    const total = state.posts.length;
    const published = state.posts.filter((post: any) => post.status === "published").length;
    const drafts = total - published;
    const changed = [
      ...(git?.unstaged || []),
      ...(git?.untracked || []).map((path: string) => ({ path, status: "added" })),
    ];
    const deleted = (git?.unstaged || []).filter((file: any) => file.status === "deleted").length;
    v.innerHTML = `
      <h1 class="page-title">Dashboard</h1>
      <div class="dashboard-stats">
        <article class="card dashboard-stat"><span class="muted">Posts</span><strong>${total}</strong><span>${published} published · ${drafts} draft${drafts === 1 ? "" : "s"}</span></article>
        <article class="card dashboard-stat"><span class="muted">Pages</span><strong>${state.tree.length}</strong><span>Organize writing hubs</span></article>
        <article class="card dashboard-stat"><span class="muted">Changes ready</span><strong>${changed.length}</strong><span>${deleted ? `${deleted} deletion${deleted === 1 ? "" : "s"} included` : "Nothing deleted"}</span></article>
        <article class="card dashboard-stat"><span class="muted">Safety net</span><strong>${recoveries.length + trash.length}</strong><span>${recoveries.length} draft recovery · ${trash.length} deleted item${trash.length === 1 ? "" : "s"}</span></article>
      </div>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><h2>Next actions</h2></div>
        <div class="card-actions">
          <button id="dash-new-post" class="btn primary">+ New post</button>
          <button id="dash-all-posts" class="btn">Review posts</button>
          <button id="dash-publish" class="btn publish">Publish changes</button>
          ${recoveries.length ? '<button id="dash-recovery" class="btn">Recover drafts</button>' : ""}
        </div>
        <p class="muted dashboard-sync">${git ? `Branch ${esc(git.branch)} · ${git.ahead || 0} ahead · ${git.behind || 0} behind` : "Git status is unavailable. Check the repository path in Settings."}</p>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><h2>Unpublished changes</h2><span class="muted">Only content and generated site output are staged when you publish.</span></div>
        <div class="rows">${changed.length
          ? changed.slice(0, 12).map((file: any) => `<div class="row"><div class="row-main"><strong>${esc(file.path)}</strong><span class="pill ${esc(file.status)}">${esc(file.status)}</span></div></div>`).join("")
          : '<div class="empty-state compact"><h3>Everything is up to date</h3><p>Save an edit or create a post to prepare your next publish.</p></div>'
        }${changed.length > 12 ? `<p class="muted">${changed.length - 12} more change(s) will be reviewed when you publish.</p>` : ""}</div>
      </section>
      <section class="dashboard-section">
        <div class="dashboard-section-head"><h2>Recently deleted</h2><span class="muted">Restore before publishing if you removed something by mistake.</span></div>
        <div id="dash-trash" class="rows">${trash.length
          ? trash.slice(0, 8).map((item: any) => `<div class="row"><div class="row-main"><strong>${esc(item.name)}</strong><span class="pill archived">${esc(item.kind)}</span><span class="muted">${esc(item.deleted_at)}</span></div><div class="row-actions"><button class="btn" data-restore-trash="${esc(item.id)}">Restore</button></div></div>`).join("")
          : '<div class="empty-state compact"><h3>No deleted items</h3><p>Deleted content stays here until you empty the trash.</p></div>'
        }</div>${trash.length ? '<div class="card-actions dashboard-trash-actions"><button id="dash-empty-trash" class="btn danger">Empty trash</button></div>' : ""}
      </section>`;
    $("#dash-new-post", v)!.addEventListener("click", () => openPostEditor(promptPageForPost(), null));
    $("#dash-all-posts", v)!.addEventListener("click", showAllPostsView);
    $("#dash-publish", v)!.addEventListener("click", openPublish);
    $("#dash-recovery", v)?.addEventListener("click", openRecoveryDashboard);
    $("#dash-empty-trash", v)?.addEventListener("click", async () => {
      if (!(await confirmDialog("Empty deleted items?", "This permanently removes all items in the dashboard trash. Published site files are not changed until you publish.", "Empty trash"))) return;
      try {
        await call("empty_trash");
        setStatus("Deleted items permanently removed from the dashboard trash");
        showDashboard();
      } catch (error) {
        setStatus(`Could not empty trash: ${String((error as any).message || error)}`);
      }
    });
    $$('[data-restore-trash]', v).forEach((button) => {
      button.addEventListener("click", async () => {
        const id = (button as HTMLElement).dataset.restoreTrash!;
        try {
          await call("restore_deleted", { id });
          setStatus("Deleted content restored");
          await refreshTree();
          showDashboard();
        } catch (error) {
          setStatus(`Could not restore content: ${String((error as any).message || error)}`);
        }
      });
    });
  });
}

// ---------- Projects ----------
async function refreshProjects() {
  state.projects = (await call("list_projects")) || [];
  return state.projects;
}

function statusPill(status: string) {
  return status && status !== "active"
    ? `<span class="pill ${esc(status)}">${esc(status)}</span>`
    : "";
}

// ---------- Cover picker (projects / pages / posts) ----------

function coverRepoRel(raw: string): string {
  // Posts store the published URL (assets/posts/<page>/<slug>/cover.png) but
  // the file itself lives in the post assets dir inside content/.
  const m = raw.match(/^assets\/posts\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (m) return `content/pages/${m[1]}/posts/${m[2]}/assets/${m[3]}`;
  return raw;
}

async function showCoverPreview(input: HTMLInputElement, preview: HTMLImageElement) {
  const val = (input.value || "").trim();
  if (!val) {
    preview.hidden = true;
    return;
  }
  try {
    const src = await cell(() => call("read_repo_file", { relPath: coverRepoRel(val) }));
    if (!src) {
      preview.hidden = true;
      return;
    }
    preview.src = String(src);
    preview.hidden = false;
  } catch {
    preview.hidden = true;
  }
}

function wireCoverField(
  scope: HTMLElement,
  inputId: string,
  previewId: string,
  resolveTarget: () => { page: string; slug: string },
) {
  const input = $("#" + inputId, scope) as HTMLInputElement;
  const preview = $("#" + previewId, scope) as HTMLImageElement;
  input.addEventListener("input", () => void showCoverPreview(input, preview));
  scope.querySelectorAll("[data-pick-cover]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const picked = await cell(() =>
        call("pick_file", {
          filterName: "Images",
          filterExts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"],
        }),
      );
      if (!picked) return;
      try {
        const target = resolveTarget();
        const res: any = await cell(() =>
          call("import_cover", {
            kind: (btn as HTMLElement).dataset.kind,
            pageSlug: target.page,
            postSlug: target.slug,
            sourcePath: picked,
          }),
        );
        input.value = res.public_path;
        await showCoverPreview(input, preview);
      } catch (err) {
        setStatus(String((err as any).message || err));
      }
    });
  });
}

function showProjectsView() {
  resetEditorState();
  state.view = { kind: "projects" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "Projects"));
  const addBtn = el("button", "btn primary", "+ New Project");
  addBtn.addEventListener("click", () => openProjectEditor(null));
  v.appendChild(addBtn);

  cell(async () => {
    const portfolioProjects = await loadPortfolioProjects();
    state.portfolioProjects = portfolioProjects;
    const portfolioHeading = el("h2", "section-title", "Portfolio projects (database)");
    v.appendChild(portfolioHeading);
    const portfolioGrid = el("div", "cards-grid portfolio-project-grid");
    portfolioProjects.forEach((p: any) => {
      const card = el("article", "card page-card-c");
      card.innerHTML = `
        <div class="card-head"><span class="card-avatar"></span><h3>${esc(p.name)}${statusPill(String(p.status || "").toLowerCase())}</h3></div>
        <p class="muted small">${esc(p.date_label || "")} · ${(p.tags || []).map((tag: string) => esc(tag)).join(" · ")}</p>
        <p class="card-desc">${esc(p.description || "")}</p>
        <div class="card-actions"><button data-open-portfolio-project="${esc(p.slug)}" class="btn">Open database record</button></div>`;
      portfolioGrid.appendChild(card);
    });
    v.appendChild(portfolioGrid);
    portfolioGrid.querySelectorAll("[data-open-portfolio-project]").forEach((button) =>
      button.addEventListener("click", () =>
        showPortfolioProject((button as HTMLElement).dataset["open-portfolio-project"]!),
      ),
    );

    v.appendChild(el("h2", "section-title", "Devlog project groups"));
    const projects = await refreshProjects();
    const grid = el("div", "cards-grid");
    state.projects.forEach((p: any) => {
      const card = el("article", "card page-card-c");
      card.innerHTML = `
        <div class="card-head"><span class="card-avatar"></span><h3>${esc(p.name)}${statusPill(p.status)}</h3></div>
        ${p.cover ? `<div class="card-cover" data-project-cover="${esc(p.slug)}"></div>` : ""}
        <p class="card-desc">${esc(p.description || "")}</p>
        <p class="muted small">
          ${p.repo_url ? `<a href="${esc(p.repo_url)}" target="_blank" rel="noopener">repo ↗</a> ` : ""}
          ${p.live_url ? `<a href="${esc(p.live_url)}" target="_blank" rel="noopener">live ↗</a>` : ""}
        </p>
        <p class="muted small">${Number(p.post_count) || 0} devlog entr${p.post_count === 1 ? "y" : "ies"}</p>
        <div class="card-actions">
          <button data-open-project="${esc(p.slug)}" class="btn">Open</button>
          <button data-edit-project="${esc(p.slug)}" class="btn">Edit</button>
          <button data-del-project="${esc(p.slug)}" class="btn danger">Delete</button>
        </div>
      `;
      grid.appendChild(card);
    });
    if (!projects.length) {
      v.appendChild(
        emptyState(
          "No projects yet.",
          "Create a project to group devlog entries under one name, repo and status.",
        ),
      );
    }
    v.appendChild(grid);
    grid.querySelectorAll("[data-project-cover]").forEach((node) => {
      const slug = (node as HTMLElement).dataset["project-cover"]!;
      const pr = state.projects.find((p2: any) => p2.slug === slug);
      const raw = pr?.cover;
      if (!raw) return;
      cell(async () => {
        try {
          const src = await call("read_repo_file", { relPath: coverRepoRel(raw) });
          if (src && document.contains(node)) {
            node.innerHTML = `<img src="${esc(String(src))}" alt="cover" />`;
          }
        } catch {}
      });
    });
    grid.querySelectorAll("[data-open-project]").forEach((b) =>
      b.addEventListener("click", () =>
        showProjectView((b as HTMLElement).dataset["open-project"]!),
      ),
    );
    grid.querySelectorAll("[data-edit-project]").forEach((b) =>
      b.addEventListener("click", () =>
        openProjectEditor((b as HTMLElement).dataset["edit-project"]!),
      ),
    );
    grid.querySelectorAll("[data-del-project]").forEach((b) =>
      b.addEventListener("click", () => {
        const slug = (b as HTMLElement).dataset["del-project"]!;
        if (confirm(`Delete project "${slug}"? Posts keep their project label.`)) {
          cell(async () => {
            await call("delete_project", { slug });
            showProjectsView();
          });
        }
      }),
    );
  });
}

function showPortfolioProject(slug: string) {
  resetEditorState();
  state.view = { kind: "page", slug };
  const v = viewContent();
  v.innerHTML = "";
  cell(async () => {
    const project = await loadPortfolioProject(slug);
    if (!project) return;
    const back = el("button", "btn", "← All projects");
    back.addEventListener("click", showProjectsView);
    v.appendChild(back);
    const preview = el("div", "portfolio-database-preview");
    // article_html comes from the repository-owned SQLite catalog. Rendering
    // the lossless record keeps long descriptions and feature lists intact.
    preview.innerHTML = project.article_html;
    v.appendChild(preview);
    preview.querySelectorAll(".link-btn[data-url]").forEach((button) => {
      button.addEventListener("click", () => {
        const url = (button as HTMLElement).dataset["url"];
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      });
    });
    const folder = String(project.gallery_folder || "");
    const gallery = preview.querySelector("[data-gallery]") as HTMLElement | null;
    if (folder && gallery) {
      try {
        const manifestUrl = String(await call("read_repo_file", { relPath: `${folder}/manifest.json` }));
        const encoded = manifestUrl.split(",", 2)[1] || "";
        const files = JSON.parse(atob(encoded));
        gallery.innerHTML = "";
        for (const file of files) {
          const src = await call("read_repo_file", { relPath: `${folder}/${file}` });
          const image = document.createElement("img");
          image.src = String(src);
          image.alt = `${project.name} screenshot`;
          gallery.appendChild(image);
        }
      } catch {
        gallery.textContent = "Gallery unavailable.";
      }
    }
  });
}

function showProjectView(slug: string) {
  resetEditorState();
  state.view = { kind: "page", slug };
  const v = viewContent();
  v.innerHTML = "";
  cell(async () => {
    const doc = await call("read_project", { slug });
    if (!doc) return;
    v.appendChild(el("h1", "page-title", doc.name || slug));
    if (doc.cover) {
      const cover = el("div", "card-cover detail");
      v.appendChild(cover);
      try {
        const src = await call("read_repo_file", { relPath: coverRepoRel(doc.cover) });
        if (src) cover.innerHTML = `<img src="${esc(String(src))}" alt="cover" />`;
      } catch {}
    }
    if (doc.description) v.appendChild(el("p", "muted", doc.description));
    if (doc.repo_url || doc.live_url) {
      const links = el("p", "muted small");
      links.innerHTML =
        (doc.repo_url
          ? `<a href="${esc(doc.repo_url)}" target="_blank" rel="noopener">repo ↗</a> `
          : "") +
        (doc.live_url
          ? `<a href="${esc(doc.live_url)}" target="_blank" rel="noopener">live ↗</a>`
          : "");
      v.appendChild(links);
    }
    const actions = el("div", "card-actions");
    const editBtn = el("button", "btn", "Edit");
    const delBtn = el("button", "btn danger", "Delete");
    actions.append(editBtn, delBtn);
    v.appendChild(actions);
    editBtn.addEventListener("click", () => openProjectEditor(slug));
    delBtn.addEventListener("click", () => {
      if (confirm(`Delete project "${slug}"?`)) {
        cell(async () => {
          await call("delete_project", { slug });
          showProjectsView();
        });
      }
    });
    const posts = await call("list_posts");
    const mine = (posts || []).filter((p: any) => p.project === slug);
    const list = el("div", "rows");
    mine.forEach((p: any) => {
      const row = el("div", "row");
      row.innerHTML = `<div class="row-main"><strong>${esc(p.title)}</strong><span class="pill ${esc(p.status)}">${esc(p.status)}</span></div>
        <div class="row-meta">${esc(humanDate(p.updated_date))}</div>
        <div class="row-actions"><button data-open="${esc(p.slug)}" data-page="${esc(p.page)}" class="btn">Open</button></div>`;
      list.appendChild(row);
    });
    if (!mine.length) {
      list.appendChild(
        emptyState(
          "No devlog entries linked to this project yet.",
          "Open a post and choose this project from the Project dropdown.",
        ),
      );
    }
    v.appendChild(list);
    list.querySelectorAll("[data-open]").forEach((b) => {
      b.addEventListener("click", () =>
        showPostView(
          (b as HTMLElement).dataset["page"]!,
          (b as HTMLElement).dataset["open"]!,
        ),
      );
    });
  });
}

function openProjectEditor(slug?: string | null) {
  resetEditorState();
  state.view = { kind: "page", slug: slug || "" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", slug ? "Edit Project" : "New Project"));
  const form = el("form", "prop-form");
  form.innerHTML = `
    <label>Name <input id="pr-name" required /></label>
    <label>Slug <input id="pr-slug" placeholder="auto from name" /></label>
    <label>Repo URL <input id="pr-repo-url" placeholder="https://github.com/you/your-repo" /></label>
    <label>Live URL <input id="pr-live-url" placeholder="https://…" /></label>
    <label>Status
      <select id="pr-status"><option value="active">active</option><option value="paused">paused</option><option value="archived">archived</option></select>
    </label>
    <label>Description <textarea id="pr-desc" rows="3"></textarea></label>
    <div class="cover-field">
      <div class="cover-field-row"><label>Cover <input id="pr-cover" placeholder="content/projects/…/cover.jpg or empty" /></label><button data-pick-cover data-kind="project" class="btn" type="button">Choose…</button></div>
      <img id="pr-cover-preview" class="cover-preview" hidden alt="cover" />
    </div>
    <button id="pr-save" class="btn primary">Save</button>
  `;
  v.appendChild(form);
  wireCoverField(
    v,
    "pr-cover",
    "pr-cover-preview",
    () => ({
      page: "",
      slug:
        ($("#pr-slug") as HTMLInputElement).value.trim() ||
        slugify(($("#pr-name") as HTMLInputElement).value.trim()),
    }),
  );
  if (slug) {
    cell(async () => {
      const doc = await call("read_project", { slug });
      ($("#pr-name") as HTMLInputElement).value = doc?.name || "";
      ($("#pr-slug") as HTMLInputElement).value = doc?.slug || "";
      ($("#pr-slug") as HTMLInputElement).readOnly = true;
      ($("#pr-repo-url") as HTMLInputElement).value = doc?.repo_url || "";
      ($("#pr-live-url") as HTMLInputElement).value = doc?.live_url || "";
      ($("#pr-status") as HTMLSelectElement).value = doc?.status || "active";
      ($("#pr-desc") as HTMLTextAreaElement).value = doc?.description || "";
      ($("#pr-cover") as HTMLInputElement).value = doc?.cover || "";
      await showCoverPreview(
        $("#pr-cover") as HTMLInputElement,
        $("#pr-cover-preview") as HTMLImageElement,
      );
    });
  }
  $("#pr-save")!.addEventListener("click", async (e: Event) => {
    e.preventDefault();
    const name = ($("#pr-name") as HTMLInputElement).value.trim();
    const project = {
      name,
      slug: ($("#pr-slug") as HTMLInputElement).value.trim() || slugify(name),
      repo_url: ($("#pr-repo-url") as HTMLInputElement).value.trim(),
      live_url: ($("#pr-live-url") as HTMLInputElement).value.trim(),
      status: ($("#pr-status") as HTMLSelectElement).value,
      description: ($("#pr-desc") as HTMLTextAreaElement).value.trim(),
      cover: ($("#pr-cover") as HTMLInputElement).value.trim(),
    };
    try {
      if (slug) await call("update_project", { project });
      else await call("create_project", { project });
      await refreshProjects();
      showProjectsView();
    } catch (err) {
      setStatus(String((err as any).message || err));
    }
  });
}

// ---------- All Posts (filter/sort + heatmap + on-this-day) ----------
const ap = { q: "", status: "", page: "", tag: "", sort: "updated-desc" };

function showAllPostsView() {
  resetEditorState();
  state.view = { kind: "allposts" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "All Posts"));
  const tools = el("div", "ap-tools");
  tools.innerHTML = `
    <input id="ap-search" type="search" placeholder="Search…" />
    <select id="ap-status"></select>
    <select id="ap-page"></select>
    <select id="ap-tag"></select>
    <select id="ap-sort">
      <option value="updated-desc">Updated (newest)</option>
      <option value="updated-asc">Updated (oldest)</option>
      <option value="date-desc">Date (newest)</option>
      <option value="title">Title A–Z</option>
    </select>
  `;
  v.appendChild(tools);
  const heat = el("div", "heat-panel");
  heat.innerHTML = `<h3 class="heat-title">Writing activity</h3><div id="ap-heatmap" class="heatmap"></div>`;
  v.appendChild(heat);
  const otd = el("div", "otd-panel");
  otd.innerHTML = `<h3 class="heat-title">On this day</h3><div id="ap-ontoday"></div>`;
  v.appendChild(otd);
  const rowsWrap = el("div", "");
  rowsWrap.id = "ap-rows";
  v.appendChild(rowsWrap);

  cell(async () => {
    const posts = await call("list_posts");
    state.posts = posts || [];
    apPopulateSelects();
    renderAllPosts();
  });

  ($("#ap-search", v) as HTMLInputElement).addEventListener("input", (e: Event) => {
    ap.q = ((e.target as HTMLInputElement).value || "").trim().toLowerCase();
    renderAllPosts();
  });
  for (const sel of ["#ap-status", "#ap-page", "#ap-tag", "#ap-sort"]) {
    ($(sel, v) as HTMLSelectElement).addEventListener("change", (e: Event) => {
      const field = (sel.replace("#ap-", "") as "status") || "status";
      ap[field as keyof typeof ap] = (e.target as HTMLSelectElement).value as never;
      renderAllPosts();
    });
  }
}

function apPopulateSelects() {
  const statuses = Array.from(new Set(state.posts.map((p: any) => p.status).filter(Boolean))).sort();
  const pages = Array.from(new Set(state.posts.map((p: any) => p.page).filter(Boolean))).sort();
  const tags = Array.from(new Set(state.posts.flatMap((p: any) => p.tags || []))).sort();
  const fill = (sel: string, allLabel: string, values: string[]) => {
    const s = $(sel) as HTMLSelectElement;
    if (!s) return;
    s.innerHTML = `<option value="">${allLabel}</option>${values
      .map((x) => `<option value="${esc(x)}">${esc(x)}</option>`)
      .join("")}`;
    s.value = ap[sel.replace("#ap-", "") as keyof typeof ap] as string || "";
  };
  fill("#ap-status", "All statuses", statuses);
  fill("#ap-page", "All pages", pages);
  fill("#ap-tag", "All tags", tags);
  const sortSel = $("#ap-sort") as HTMLSelectElement;
  if (sortSel) sortSel.value = ap.sort;
}

function renderAllPosts() {
  const filtered = apSort(apFilter(state.posts));
  renderHeatmap();
  renderOnThisDay();
  const wrap = $("#ap-rows");
  if (!wrap) return;
  wrap.innerHTML = "";
  const list = el("div", "rows");
  filtered.forEach((p: any) => {
    const seriesChip = p.series
      ? `<span class="pill series">${esc(p.series)}${p.part ? ` · #${p.part}` : ""}</span>`
      : "";
    const row = el("div", "row");
    row.innerHTML = `
      <div class="row-main"><strong>${esc(p.title)}</strong><span class="muted">${esc(p.page)}</span>
        <span class="pill ${esc(p.status)}">${esc(p.status)}</span>${p.featured ? '<span class="pill featured">★</span>' : ""}${seriesChip}</div>
      <div class="row-meta">${esc(humanDate(p.updated_date))}</div>
      <div class="row-actions">
        <button data-edit="${esc(p.page)}|${esc(p.slug)}" class="btn">Edit</button>
        <button data-del="${esc(p.page)}|${esc(p.slug)}" class="btn danger">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
  if (!filtered.length) list.appendChild(emptyState("No posts match", "Adjust the filters or create a new post."));
  wrap.appendChild(list);
  list.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const [page, slug] = (b as HTMLElement).dataset["edit"]!.split("|");
      showPostView(page, slug);
    });
  });
  list.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => {
      const [page, slug] = (b as HTMLElement).dataset["del"]!.split("|");
      deletePost(page, slug);
    });
  });
}

function apFilter(list: any[]) {
  return list.filter((p: any) => {
    if (ap.status && p.status !== ap.status) return false;
    if (ap.page && p.page !== ap.page) return false;
    if (ap.tag && !(p.tags || []).includes(ap.tag)) return false;
    if (ap.q) {
      const hay = `${p.title} ${p.excerpt || ""} ${(p.tags || []).join(" ")} ${p.series || ""} ${p.project || ""}`.toLowerCase();
      if (!hay.includes(ap.q)) return false;
    }
    return true;
  });
}

function apSort(list: any[]) {
  const sorted = [...list];
  if (ap.sort === "title") {
    sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  } else if (ap.sort === "updated-asc") {
    sorted.sort((a, b) => (a.updated_date || a.date || "").localeCompare(b.updated_date || b.date || ""));
  } else if (ap.sort === "date-desc") {
    sorted.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  } else {
    sorted.sort((a, b) => String(b.updated_date || b.date || "").localeCompare(String(a.updated_date || a.date || "")));
  }
  return sorted;
}

function renderHeatmap() {
  const host = $("#ap-heatmap");
  if (!host) return;
  const counts: Record<string, number> = {};
  for (const p of state.posts) {
    const d = p.updated_date || p.date;
    if (d) counts[d] = (counts[d] || 0) + 1;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cell = 12;
  const gap = 3;
  const weeks = 16;
  const svgW = weeks * (cell + gap) + 12;
  const svgH = 7 * (cell + gap) + 12;
  const max = Math.max(1, ...Object.values(counts));
  let rects = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const c = counts[key] || 0;
    const ratio = c / max;
    const level = c === 0 ? 0 : ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : 3;
    const col = weeks - 1 - Math.floor(i / 7);
    const row = d.getDay();
    rects += `<rect x="${col * (cell + gap) + 6}" y="${row * (cell + gap) + 6}" width="${cell}" height="${cell}" rx="3" class="heat heat-${level}" data-count="${c}"/>`;
  }
  host.innerHTML = `
    <svg width="${svgW}" height="${svgH}" aria-label="Posting activity over the last ${weeks * 7} days" role="img">${rects}</svg>
    <span class="heat-legend muted">Less <span class="heat heat-1"></span><span class="heat heat-2"></span><span class="heat heat-3"></span> More</span>`;
}

function renderOnThisDay() {
  const host = $("#ap-ontoday");
  if (!host) return;
  const now = new Date();
  const mmdd = now.getMonth() * 100 + now.getDate();
  const hits = state.posts
    .filter((p: any) => {
      const d = new Date(p.date || p.updated_date || "");
      if (Number.isNaN(d.getTime())) return false;
      return d.getMonth() * 100 + d.getDate() === mmdd && d.getFullYear() < now.getFullYear();
    })
    .sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));
  host.innerHTML = "";
  if (!hits.length) {
    host.innerHTML = `<p class="muted">No posts from this day in past years.</p>`;
    return;
  }
  const list = el("ul", "otd-list");
  hits.forEach((p: any) => {
    const year = new Date(p.date || p.updated_date || "").getFullYear() || "?";
    const li = el("li", "otd-item");
    li.innerHTML = `
      <span class="otd-year">${esc(String(year))}</span>
      <span class="otd-title">${esc(p.title)}</span>
      <button data-edit="${esc(p.page)}|${esc(p.slug)}" class="btn small">Edit</button>`;
    list.appendChild(li);
  });
  host.appendChild(list);
  list.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const [page, slug] = (b as HTMLElement).dataset["edit"]!.split("|");
      showPostView(page, slug);
    });
  });
}

function emptyState(title: string, sub: string) {
  const e = el("div", "empty-state");
  e.innerHTML = `<h3>${esc(title)}</h3><p>${esc(sub)}</p>`;
  return e;
}

function confirmDialog(title: string, message: string, confirmLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", "overlay");
    overlay.innerHTML = `
      <div class="modal">
        <h2>${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button id="cf-cancel" class="btn">Cancel</button>
          <button id="cf-ok" class="btn danger">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    $("#cf-cancel", overlay)!.onclick = () => cleanup(false);
    $("#cf-ok", overlay)!.onclick = () => cleanup(true);
    overlay.addEventListener("click", (e: Event) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

async function deletePage(slug: string) {
  const yes = await confirmDialog(
    `Delete page "${slug}"?`,
    "This removes the page folder and all its posts from your content. This cannot be undone locally.",
  );
  if (!yes) return;
  try {
    await call("delete_page", { slug });
  } catch (error) {
    setStatus(`Could not delete page: ${String((error as any).message || error)}`);
    return;
  }
  setStatus(`Deleted page ${slug}`);
  await refreshTree();
  showPagesView();
}

async function deletePost(page: string, slug: string) {
  const yes = await confirmDialog(
    `Delete post "${slug}"?`,
    `This deletes the post from the "${page}" page. This cannot be undone locally.`,
  );
  if (!yes) return;
  try {
    await call("delete_post", { pageSlug: page, postSlug: slug });
  } catch (error) {
    setStatus(`Could not delete post: ${String((error as any).message || error)}`);
    return;
  }
  setStatus(`Deleted post ${slug}`);
  await refreshTree();
  if (state.view.kind === "page" && state.view.slug === page) showPageView(page);
  else if (state.view.kind === "post" && state.view.page === page) showPageView(page);
  else if (state.view.kind === "allposts") showAllPostsView();
  else showPagesView();
}

async function showPageView(slug: string) {
  resetEditorState();
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
    const delPage = el("button", "btn danger", "Delete Page");
    actions.append(newPost, newSub, editPage, delPage);
    v.appendChild(actions);
    newPost.addEventListener("click", () => openPostEditor(slug, null));
    newSub.addEventListener("click", () => openPageEditor(null, slug));
    editPage.addEventListener("click", () => openPageEditor(slug));
    delPage.addEventListener("click", () => deletePage(slug));
    const posts = await call("list_posts");
    const mine = (posts || []).filter((p: any) => p.page === slug);
    const list = el("div", "rows");
    mine.forEach((p: any) => {
      const seriesChip = p.series
        ? `<span class="pill series">${esc(p.series)}${p.part ? ` · #${p.part}` : ""}</span>`
        : "";
      const row = el("div", "row");
      row.innerHTML = `<div class="row-main"><strong>${esc(p.title)}</strong><span class="pill ${esc(p.status)}">${esc(p.status)}</span>${seriesChip}</div>
        <div class="row-meta">${esc(humanDate(p.updated_date))}</div>
        <div class="row-actions"><button data-edit="${esc(p.slug)}" class="btn">Edit</button>
        <button data-del="${esc(p.slug)}" class="btn danger">Delete</button></div>`;
      list.appendChild(row);
    });
    if (!mine.length) list.appendChild(emptyState("This page has no posts yet.", "Create your first post."));
    v.appendChild(list);
    list.querySelectorAll("[data-edit]").forEach((b) => {
      b.addEventListener("click", () => showPostView(slug, (b as HTMLElement).dataset["edit"]!));
    });
    list.querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", () => {
        deletePost(slug, (b as HTMLElement).dataset["del"]!);
      });
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
    <div class="cover-field">
      <div class="cover-field-row"><label>Cover <input id="pe-cover" placeholder="cover.jpg or assets/pages/…" /></label><button data-pick-cover data-kind="page" class="btn" type="button">Choose…</button></div>
      <img id="pe-cover-preview" class="cover-preview" hidden alt="cover" />
    </div>
    <label>Kind
      <select id="pe-kind"><option value="page">Regular page</option><option value="devlog">Devlog</option></select>
    </label>
    <label>Devlog repo (pull commits from) <input id="pe-devlog-repo" placeholder="/abs/path/to/project-repo" /></label>
    <label>Order <input id="pe-order" type="number" placeholder="100" /></label>
    <label>Parent ${parent != null ? `<span class="muted">(${parent})</span>` : ""}<input id="pe-parent" value="${esc(parent || "")}" placeholder="parent slug or empty" /></label>
    <button id="pe-save" class="btn primary">Save</button>
  `;
  v.appendChild(form);
  wireCoverField(
    v,
    "pe-cover",
    "pe-cover-preview",
    () => {
      const sl =
        ($("#pe-slug") as HTMLInputElement).value.trim() ||
        slugify(($("#pe-name") as HTMLInputElement).value.trim());
      return { page: sl, slug: sl };
    },
  );
  if (slug) {
    cell(async () => {
      const doc = await call("read_page", { slug });
      ($("#pe-name") as HTMLInputElement).value = doc?.name || "";
      ($("#pe-slug") as HTMLInputElement).value = doc?.slug || "";
      ($("#pe-slug") as HTMLInputElement).readOnly = true;
      ($("#pe-desc") as HTMLTextAreaElement).value = doc?.description || "";
      ($("#pe-cover") as HTMLInputElement).value = doc?.cover || "";
      await showCoverPreview(
        $("#pe-cover") as HTMLInputElement,
        $("#pe-cover-preview") as HTMLImageElement,
      );
      ($("#pe-kind") as HTMLSelectElement).value = doc?.kind || "page";
      ($("#pe-devlog-repo") as HTMLInputElement).value = doc?.devlog_repo || "";
      ($("#pe-order") as HTMLInputElement).value = doc?.order != null && doc?.order !== 100 ? String(doc.order) : "";
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
    const orderRaw = parseInt(($("#pe-order") as HTMLInputElement).value.trim(), 10);
    const orderVal = Number.isNaN(orderRaw) ? null : orderRaw;
    const kind = ($("#pe-kind") as HTMLSelectElement).value;
    const devlogRepo = ($("#pe-devlog-repo") as HTMLInputElement).value.trim();
    try {
      if (!name) throw new Error("Page name must not be empty.");
      await call(slug ? "update_page" : "create_page", {
        page: {
          name,
          slug: sl,
          description: ($("#pe-desc") as HTMLTextAreaElement).value,
          cover: ($("#pe-cover") as HTMLInputElement).value,
          parent: parentVal,
          order: orderVal,
          kind,
          devlog_repo: devlogRepo,
        },
      });
      setStatus(slug ? `Saved page ${sl}` : `Created page ${sl}`);
      await refreshTree();
      if (slug) showPageView(sl);
      else showPagesView();
    } catch (err) {
      setStatus(String((err as any).message || err));
    }
  });
}

// ---------- Post Editor ----------
const DEVLOG_TEMPLATE = `## What I did today


## Problems hit


## Next steps`;

const openEditor = (page: string) => {
  const e = new Editor(
    () => {
      state.editorDirty = true;
      state.editor?.setStatus("Unsaved changes");
      scheduleAutosave();
    },
    {
      pickImage: () => pickAndInsertImage(page),
      importPasted: (name, data) => importPastedImage(page, name, data),
    },
  );
  state.editor = e;
  return e;
};

function targetSlugFor(): string {
  const input = $("#po-slug") as HTMLInputElement;
  return (input?.value || "").trim() || `draft-${newPostSessionId || "new-post"}`;
}

async function pickAndInsertImage(page: string): Promise<string | null> {
  const path = await cell(() =>
    call("pick_file", {
      filterName: "Images & video",
      filterExts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "webm", "ogg", "ogv"],
    }),
  );
  if (!path) return null;
  return importFileIntoCurrent(page, path, false);
}

async function importFileIntoCurrent(page: string, path: string, insert: boolean): Promise<string | null> {
  const name = basename(path);
  const res = await cell(() =>
    call("import_asset", {
      pageSlug: page,
      postSlug: state.editorAssetSlug || targetSlugFor(),
      sourcePath: path,
      originalName: name,
    }),
  );
  if (res?.warning) setStatus(String(res.warning));
  if (insert) state.editor?.insertAssetMarkdown(res?.rel_path);
  return res?.rel_path || null;
}

async function importPastedImage(page: string, name: string, data: ArrayBuffer): Promise<string | null> {
  const bytes = Array.from(new Uint8Array(data));
  const res = await cell(() =>
    call("import_asset_bytes", {
      pageSlug: page,
      postSlug: state.editorAssetSlug || targetSlugFor(),
      fileName: name || "pasted-image.png",
      data: bytes,
    }),
  );
  return res?.rel_path || null;
}

async function takeScreenshot(page: string) {
  if (!page) {
    setStatus("Open a post first to attach a screenshot to it.");
    return;
  }
  const res = await cell(() =>
    call("capture_screenshot", { pageSlug: page, postSlug: state.editorAssetSlug || targetSlugFor() }),
  );
  if (res?.rel_path) {
    state.editor?.insertAssetMarkdown(res.rel_path);
    setStatus(`Screenshot saved: ${res.rel_path}`);
  }
}

// ---------- Page metadata cache / devlog repo ----------
const pageDocCache: Record<string, any> = {};
async function pageDocFor(page: string): Promise<any | null> {
  if (!page) return null;
  if (pageDocCache[page]) return pageDocCache[page];
  const doc = await cell(() => call("read_page", { slug: page }));
  if (doc) pageDocCache[page] = doc;
  return doc;
}

async function currentPageDevlogRepo(page: string): Promise<string | null> {
  const doc = await pageDocFor(page);
  return (doc?.devlog_repo || state.prefs?.devlog_repo || "").trim() || null;
}

async function pullCommits(page: string) {
  const repoPath = await currentPageDevlogRepo(page);
  if (!repoPath) {
    setStatus("No project repo configured for commits. Set 'Devlog repo' on the page or in Settings.");
    return;
  }
  const commits = await cell(() => call("git_log", { repoPath, count: 15 }));
  if (!commits || !commits.length) {
    setStatus("No recent commits found in that repository.");
    return;
  }
  const bullets = commits.map((c: any) => `- \`${c.hash}\` ${c.date} — ${c.subject}`).join("\n");
  state.editor?.insertMarkdown(bullets);
  setStatus(`Pulled ${commits.length} commits into the post.`);
}

function updateSeriesChip() {
  const chip = $("#po-series-chip");
  if (!chip) return;
  const series = ($("#po-series") as HTMLInputElement).value.trim();
  const part = ($("#po-part") as HTMLInputElement).value.trim();
  chip.textContent = series ? (part ? `Part ${part} of ${series}` : series) : "";
}

function openPostEditor(page: string, post: PostDoc | null) {
  state.view = { kind: "post", page, slug: post?.slug || "" };
  newPostSessionId = post ? "" : sessionId();
  state.editorKey = recoveryKey(page, post?.slug || "");
  state.editorOriginalSlug = post?.slug || "";
  state.editorAssetSlug = post?.slug || `draft-${newPostSessionId}`;
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
      <label>Status <select id="po-status"><option>draft</option><option>published</option></select></label>
      <label>Page <input id="po-page" value="${esc(page)}" readonly /></label>
      <label>Date <input id="po-date" type="date" /></label>
      <label>Subtitle <input id="po-subtitle" /></label>
      <label class="check-label">Featured <input id="po-featured" type="checkbox" /></label>
    </div>
    <div class="cover-field">
      <div class="cover-field-row"><label>Cover <input id="po-cover" placeholder="auto or assets/posts/…" /></label><button data-pick-cover data-kind="post" class="btn" type="button">Choose…</button></div>
      <img id="po-cover-preview" class="cover-preview" hidden alt="cover" />
    </div>
    <label>Excerpt <textarea id="po-excerpt" rows="2" placeholder="Short summary…"></textarea></label>
    <div class="chip-editors">
      <div><label>Tags</label><input id="po-tags" placeholder="comma separated" /></div>
      <div><label>Technologies</label><input id="po-tech" placeholder="comma separated" /></div>
      <div><label>Project</label><select id="po-project"><option value=""></option></select></div>
      <div><label>Series</label><input id="po-series" placeholder="devlog arc, e.g. GPU port" /></div>
      <div><label>Part</label><input id="po-part" type="number" min="0" placeholder="1" /></div>
    </div>
    <div class="post-tools">
      <button id="surf-ai-btn" class="btn" title="Suggest title/excerpt/tags/tech from the article body">✦ Suggest metadata</button>
      <button id="export-btn" class="btn" title="Export this post to PDF/DOCX via pandoc">⬇ Export</button>
      <button id="pull-commits-btn" class="btn" title="Pull commits from the configured devlog repo">⎇ Pull commits</button>
      <button id="shot-btn" class="btn" title="Capture a screenshot and insert it (Ctrl+Shift+X)">📷 Screenshot</button>
      <span id="po-series-chip" class="series-chip muted"></span>
    </div>
  `;
  v.append(meta, openEditor(page).getElement());
  wireCoverField(
    v,
    "po-cover",
    "po-cover-preview",
    () => ({
      page,
      slug: state.editorAssetSlug || targetSlugFor(),
    }),
  );
  if (post) {
    ($("#po-title") as HTMLInputElement).value = post.title;
    ($("#po-slug") as HTMLInputElement).value = post.slug;
    ($("#po-status") as HTMLSelectElement).value = post.status;
    ($("#po-date") as HTMLInputElement).value = post.date;
    ($("#po-subtitle") as HTMLInputElement).value = post.subtitle || "";
    ($("#po-excerpt") as HTMLTextAreaElement).value = post.excerpt || "";
    ($("#po-tags") as HTMLInputElement).value = (post.tags || []).join(", ");
    ($("#po-tech") as HTMLInputElement).value = (post.technologies || []).join(", ");
    ($("#po-project") as HTMLSelectElement).value = post.project || "";
    ($("#po-featured") as HTMLInputElement).checked = Boolean(post.featured);
    ($("#po-cover") as HTMLInputElement).value = post.cover || "";
    ($("#po-series") as HTMLInputElement).value = post.series || "";
    ($("#po-part") as HTMLInputElement).value = post.part ? String(post.part) : "";
    state.editor!.setBody(post.body);
    void showCoverPreview(
      $("#po-cover") as HTMLInputElement,
      $("#po-cover-preview") as HTMLImageElement,
    );
  } else {
    ($("#po-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
    ($("#po-status") as HTMLSelectElement).value = prefsDefaultStatus();
    // Devlog pages open with a ready-made skeleton so new entries start faster.
    void pageDocFor(page).then((doc) => {
      if (doc?.kind === "devlog" && !state.editor!.getValue().trim()) {
        state.editor!.setBody(DEVLOG_TEMPLATE);
        state.editor?.setStatus("Devlog template ready");
      }
    });
  }
  bindPostSave(page);
  populateProjectSelect();
  state.editorDirty = false;
  state.editor?.setStatus("Saved");
  checkRecovery(page, post?.slug || "");
  updateSeriesChip();
  $("#po-series")!.addEventListener("input", updateSeriesChip);
  $("#po-part")!.addEventListener("input", updateSeriesChip);
  $$(".props-panel input, .props-panel textarea, .props-panel select", v).forEach((field) => {
    field.addEventListener("input", () => {
      state.editorDirty = true;
      state.editor?.setStatus("Unsaved changes");
      scheduleAutosave();
    });
    field.addEventListener("change", () => {
      state.editorDirty = true;
      state.editor?.setStatus("Unsaved changes");
      scheduleAutosave();
    });
  });
  $("#shot-btn")!.onclick = () => cell(() => takeScreenshot(page));
  $("#pull-commits-btn")!.onclick = () => cell(() => pullCommits(page));
  $("#export-btn")!.onclick = () => cell(async () => {
    const title = ($("#po-title") as HTMLInputElement).value.trim();
    const slug = ($("#po-slug") as HTMLInputElement).value.trim() || slugify(title) || "untitled";
    const exp = await call("export_post", { pageSlug: page, postSlug: slug });
    if (!exp?.ok) {
      setStatus(exp?.detail || "Export failed.");
      return;
    }
    setStatus(`Exported → ${exp.out_path || "unknown path"}`);
  });
  $("#surf-ai-btn")!.onclick = () => cell(async () => {
    const body = state.editor!.getValue();
    const currentTitle = ($("#po-title") as HTMLInputElement).value.trim();
    const ai = await call("suggest_metadata", { body, currentTitle });
    if (!ai) return;
    if (ai.title && !currentTitle) ($("#po-title") as HTMLInputElement).value = ai.title;
    if ($("#po-excerpt") as HTMLTextAreaElement) {
      ($("#po-excerpt") as HTMLTextAreaElement).value = ai.excerpt || ($("#po-excerpt") as HTMLTextAreaElement).value;
    }
    if (ai.tags?.length) ($("#po-tags") as HTMLInputElement).value = ai.tags.join(", ");
    if (ai.technologies?.length) ($("#po-tech") as HTMLInputElement).value = ai.technologies.join(", ");
    state.editor?.setStatus("Suggested metadata applied — review before saving");
    setStatus("Metadata suggested");
  });
}

function prefsDefaultStatus() {
  return state.prefs?.default_status || "draft";
}

function populateProjectSelect() {
  const sel = $("#po-project") as HTMLSelectElement;
  if (!sel) return;
  const current = sel.value;
  cell(async () => {
    const projects = await refreshProjects();
    const names = projects.map((p: any) => p.slug);
    if (current && !names.includes(current)) {
      names.unshift(current);
    }
    sel.innerHTML = `<option value=""></option>${names
      .map((s: string) => `<option value="${esc(s)}">${esc(s)}</option>`)
      .join("")}`;
    sel.value = current;
  });
}

function bindPostSave(page: string) {
  const save = async () => {
    if (state.saving) return false;
    if (!editorActive()) return false;
    state.saving = true;
    const meta = {
      title: ($("#po-title") as HTMLInputElement).value.trim(),
      slug: ($("#po-slug") as HTMLInputElement).value.trim(),
      date: ($("#po-date") as HTMLInputElement).value,
      updated_date: new Date().toISOString().slice(0, 10),
      status: ($("#po-status") as HTMLSelectElement).value,
      excerpt: ($("#po-excerpt") as HTMLTextAreaElement).value,
      featured: ($("#po-featured") as HTMLInputElement).checked,
      page,
      project: ($("#po-project") as HTMLSelectElement).value.trim(),
      subtitle: ($("#po-subtitle") as HTMLInputElement).value.trim(),
      cover: ($("#po-cover") as HTMLInputElement).value.trim(),
      series: ($("#po-series") as HTMLInputElement).value.trim(),
      part: Number(($("#po-part") as HTMLInputElement).value.trim()) || 0,
      tags: splitChips(($("#po-tags") as HTMLInputElement).value),
      technologies: splitChips(($("#po-tech") as HTMLInputElement).value),
    };
    try {
      if (!meta.title) throw new Error("Post title must not be empty.");
      const savedSlug = await call("write_post", { input: {
        page_slug: page, original_slug: state.editorOriginalSlug,
        draft_asset_slug: state.editorOriginalSlug ? "" : (state.editorAssetSlug || targetSlugFor()), meta, body: state.editor!.getValue(),
      } });
      // Success: clear autosave recovery for this post, then switch the draft key
      // from the placeholder to the real slug so later autosaves are keyed correctly.
      const oldKey = state.editorKey;
      const assetFrom = state.editorAssetSlug || targetSlugFor();
      state.editorKey = recoveryKey(page, String(savedSlug || meta.slug));
      state.editorOriginalSlug = String(savedSlug || meta.slug);
      state.editorAssetSlug = String(savedSlug || meta.slug);
      await cell(() => call("clear_recovery", { key: oldKey }));
      for (const k of pendingClearKeys) {
        await cell(() => call("clear_recovery", { key: k }));
      }
      pendingClearKeys = [];
      const cover = $("#po-cover") as HTMLInputElement | null;
      if (cover) cover.value = meta.cover.replace(
        `assets/posts/${page}/${assetFrom}/`, `assets/posts/${page}/${savedSlug}/`,
      );
      state.editorDirty = false;
      setStatus(`Saved: ${meta.title}`);
      await refreshTree();
      state.editor?.setStatus("Saved");
      return true;
    } catch (e) {
      setStatus(String((e as any).message || e));
      state.editor?.setStatus("Save failed — changes remain unsaved");
      return false;
    } finally {
      state.saving = false;
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
    if (!editorActive()) return;
    if (state.editorSave && !(await state.editorSave())) return;
    const mode = state.prefs?.publish_mode === "publish" ? "publish" : "preview";
    if (mode === "publish") {
      // Publish-mode build: exact production output (drafts hidden).
      const built = await call("build_site", { mode: "publish" });
      if (!built?.success) throw new Error(`Build failed:\n${built?.output}`);
      const info = await cell(() => call("latest_site_build"));
      setStatus(`Publish-preview build ready — ${info?.devlog_posts ?? 0} post pages rendered`);
      return;
    }
    await call("build_site", { mode: "preview" });
    setStatus("Build complete — preview ready (not published)");
  });
}

// ---------- Global shortcuts ----------
function currentPostPage(): string {
  return state.view.kind === "post" ? state.view.page : "";
}

function installShortcuts() {
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      if (state.editorSave && editorActive()) void cell(state.editorSave);
      return;
    }
    if (mod && e.shiftKey && key === "p") {
      e.preventDefault();
      openPublish();
      return;
    }
    if (mod && e.shiftKey && key === "x") {
      e.preventDefault();
      void cell(() => takeScreenshot(currentPostPage()));
      return;
    }
    if (mod && state.editor) {
      if (key === "b") {
        e.preventDefault();
        state.editor.command("B");
      } else if (key === "i") {
        e.preventDefault();
        state.editor.command("I");
      } else if (key === "k") {
        e.preventDefault();
        state.editor.command("Link");
      }
    }
  });
}

// ---------- Global file drag & drop (OS + Tauri webview) ----------
function installGlobalDrop() {
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer?.files || [])) {
      const path = (file as any).path;
      if (typeof path === "string" && path) {
        handleExternalFile(path);
        return;
      }
    }
  });
}

function installTauriDrop() {
  import("@tauri-apps/api/webview")
    .then((m) =>
      m.getCurrentWebview().onDragDropEvent((event: any) => {
        if (event?.payload?.type === "drop") {
          const paths: string[] = (event.payload.paths as string[]) || [];
          if (paths.length) handleExternalFile(paths[0]);
        }
      }),
    )
    .catch(() => {
      /* not running inside Tauri — the HTML5 drop fallback is active */
    });
}

function handleExternalFile(path: string) {
  if (state.view.kind !== "post") {
    setStatus("Dropped a file — open a post to attach it as an asset.");
    return;
  }
  const page = state.view.page;
  void cell(async () => {
    const rel = await importFileIntoCurrent(page, path, true);
    if (rel) setStatus(`Attached ${basename(path)}`);
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
    if (state.editorSave && editorActive() && state.editorDirty && !(await state.editorSave())) {
      body.innerHTML = `<p class="error-text">Save the current editor changes before publishing.</p>`;
      return;
    }
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
    if (st.staged?.length) {
      body.innerHTML = `<p class="error-text">Publishing is blocked because the Git index already contains staged files.</p>
        <p class="muted">The studio only stages files it has just validated. Unstage these to continue (e.g. if a previous publish was interrupted):</p>
        <pre class="diffbox">${esc(st.staged.map((f: any) => f.path).join("\n"))}</pre>
        <div class="modal-actions">
          <button id="pub-unstage" class="btn">Unstage all</button>
          <button id="pub-cancel-staged" class="btn">Cancel</button>
        </div>`;
      $("#pub-cancel-staged", overlay)!.onclick = () => overlay.remove();
      $("#pub-unstage", overlay)!.onclick = async () => {
        try {
          await cell(() => call("git_unstage", { paths: [] }));
          body.innerHTML = `<p class="muted">Unstaged. Re-checking…</p>`;
          overlay.remove();
          openPublish();
        } catch (e) {
          body.innerHTML = `<p class="error-text">Could not unstage.</p><pre class="diffbox">${esc(String((e as any).message || e))}</pre>`;
        }
      };
      return;
    }
    const auth = await cell(() => call("git_auth_status"));
    if (auth && !auth.authenticated) {
      body.innerHTML = `<p class="error-text">Not signed in to GitHub.</p>
        <p class="muted">${auth.gh_installed ? "Use the button below to sign in in your browser (GitHub CLI device flow)." : "GitHub CLI (<code>gh</code>) not installed — install it or configure Git credentials for the remote."}</p>
        ${auth.error ? `<pre class="diffbox diff-big">${esc(String(auth.error).slice(0, 300))}</pre>` : ""}
        <div class="gh-signin-area" id="pub-signin">${auth.gh_installed ? `<button id="pub-signin-btn" class="btn" style="margin:0.5rem 0">Sign in with GitHub</button>` : ""}</div>
        <div class="modal-actions"><button id="pub-cancel2" class="btn">Close</button></div>`;
      $("#pub-cancel2", overlay)!.onclick = () => overlay.remove();
      if (auth.gh_installed) {
        $("#pub-signin-btn", overlay)!.onclick = () => {
          const host = $("#pub-signin", overlay)!;
          renderSignIn(host, () => {
            overlay.remove();
            openPublish();
          });
        };
      }
      return;
    }
    const staged = st.staged.map((f: any) => esc(String(f.path))).join("<br>");
    const unstaged = st.unstaged.map((f: any) => esc(String(f.path))).join("<br>");
    const unrel = st.unrelated_modified.length
      ? `<p class="muted">Unrelated working changes (will not be touched):<br>${st.unrelated_modified.map(esc).join("<br>")}</p>`
      : "";
    const lastCommit = await cell(() => call("git_last_commit"));
    const diffText = await cell(() => call("git_diff", { staged: false }));
    const buildInfo = await cell(() => call("latest_site_build"));
    const syncState =
      st.behind > 0 && st.ahead > 0
        ? `<p class="error-text">Branch is diverged: <strong>${st.ahead} ahead, ${st.behind} behind</strong> — push will be rejected (non-fast-forward).</p>`
        : st.behind > 0
          ? `<p class="error-text">Branch is <strong>${st.behind} behind</strong> remote — push will be rejected.</p>`
          : "";
    const deployBranchNotice = st.branch !== "main"
      ? `<p class="error-text">You are publishing <strong>${esc(st.branch)}</strong>, not <strong>main</strong>. The Pages workflow deploys only main, so this push will not update the live site until the branch is merged into main.</p>`
      : "";
    const pullBtn = syncState
      ? `<div class="modal-actions"><button id="pub-cancel3" class="btn">Cancel</button><button id="pub-pull" class="btn publish">Pull latest (rebase)</button></div>`
      : "";
    body.innerHTML = `
      <p>Branch: <strong>${esc(st.branch)}</strong>${st.ahead ? ` (${st.ahead} ahead)` : ""}${st.behind ? ` (${st.behind} behind)` : ""}</p>
      ${syncState}
      ${deployBranchNotice}
      ${pullBtn}
      ${lastCommit ? `<p class="muted">Last commit: <code>${esc(lastCommit)}</code></p>` : ""}
      ${buildInfo ? `<p class="muted">Last build: ${esc(buildInfo.generated_at || "unknown")} · ${buildInfo.devlog_posts} post pages · ${buildInfo.archive_folders.join(", ")} § feed: ${buildInfo.feed_generated ? "yes" : "no"} · sitemap: ${buildInfo.sitemap_generated ? "yes" : "no"}</p>` : ""}
      <h4>Staged</h4><pre class="diffbox">${staged || "(nothing staged yet)"}</pre>
      <h4>Unstaged content changes</h4><pre class="diffbox">${unstaged || "(none)"}</pre>
      ${diffText ? `<details class="diff-details"><summary>View working-tree diff</summary><pre class="diffbox diff-big">${esc(diffText)}</pre></details>` : ""}
      ${unrel}
      <label>Commit message<input id="pub-msg" value="Update portfolio content" /></label>
      <p class="muted">Will lint posts, run the publish build, stage additions, edits, and deletions in content and generated site output, commit, push, and fire any configured deploy hook.</p>
    `;
    $("#pub-cancel3", overlay)?.addEventListener("click", () => overlay.remove());
    $("#pub-pull", overlay)?.addEventListener("click", async () => {
      const pullBtn2 = $("#pub-pull", overlay)!;
      pullBtn2.disabled = true;
      pullBtn2.textContent = "Pulling…";
      try {
        const out = await cell(() => call("git_pull", { strategy: "rebase" }));
        body.innerHTML = `<p class="success-text">Pulled latest changes.</p><pre class="diffbox">${esc(String(out ?? "ok"))}</pre>
          <div class="modal-actions"><button id="pub-again" class="btn publish">Re-check</button></div>`;
        $("#pub-again", overlay)!.onclick = () => {
          overlay.remove();
          openPublish();
        };
      } catch (e) {
        body.innerHTML = `<p class="error-text">Pull failed.</p><pre class="diffbox">${esc(String((e as any).message ?? e ?? "unknown error"))}</pre><p class="muted">You may have uncommitted work or conflicts. Resolve in a terminal, then retry.</p>`;
        const retry = el("button", "btn publish", "Retry");
        retry.onclick = () => {
          overlay.remove();
          openPublish();
        };
        body.appendChild(retry);
      }
      return;
    });
    if (syncState) {
      const go = $("#pub-go", overlay)!;
      go.disabled = true;
      go.textContent = "Pull latest first";
    }
    $("#pub-go", overlay)!.onclick = async () => {
      $("#pub-go", overlay)!.disabled = true;
      body.innerHTML = `<p class="muted">Linting posts…</p>`;
      try {
        let lint;
        try {
          lint = await call("lint_posts");
        } catch (e) {
          body.innerHTML = `<p class="error-text">Lint failed to run — publish blocked.</p>
            <pre class="diffbox diff-big">${esc(String((e as any).message || e))}</pre>
            <p class="muted">Resolve the lint command error, then retry.</p>
            <div class="modal-actions"><button id="pub-close-lint" class="btn">Close</button></div>`;
          $("#pub-close-lint", overlay)!.onclick = () => overlay.remove();
          return;
        }
        if (!lint) {
          body.innerHTML = `<p class="error-text">Lint returned no result — publish blocked.</p>
            <div class="modal-actions"><button id="pub-close-lint" class="btn">Close</button></div>`;
          $("#pub-close-lint", overlay)!.onclick = () => overlay.remove();
          return;
        }
        if (lint.errors_count > 0) {
          body.innerHTML = `<p class="error-text">Lint blocked the publish (${lint.errors_count} error(s)).</p>
            <pre class="diffbox diff-big">${esc(lint.issues.filter((i: any) => i.severity === "error").map((i: any) => `${i.file}: ${i.message}`).join("\n"))}</pre>
            <p class="muted">Fix the issues above, or unpublish the offending posts, then retry.</p>
            <div class="modal-actions"><button id="pub-close-lint" class="btn">Close</button></div>`;
          $("#pub-close-lint", overlay)!.onclick = () => overlay.remove();
          return;
        }
        if (lint && lint.warnings_count > 0) {
          body.innerHTML = `<p class="muted">${lint.warnings_count} warning(s):</p>
            <pre class="diffbox">${esc(lint.issues.filter((i: any) => i.severity === "warning").map((i: any) => `${i.file}: ${i.message}`).join("\n"))}</pre>
            <p class="muted">Continuing anyway…</p>`;
        }
        body.innerHTML = (body.innerHTML || "") + `<p class="muted">Building site (publish mode)…</p>`;
        const built = await call("build_site", { mode: "publish" });
        if (!built?.success) {
          body.innerHTML = `<p class="error-text">Build failed.</p><pre class="diffbox">${esc(built?.output)}</pre>`;
          $("#pub-go", overlay)!.remove();
          return;
        }
        body.innerHTML = `<p class="muted">Reviewing changed files…</p>`;
        const status2 = await call("git_status");
        if (!status2) {
          body.innerHTML = `<p class="error-text">Could not read Git status after the build. Nothing was committed.</p>`;
          $("#pub-go", overlay)!.remove();
          return;
        }
        const paths = new Set<string>();
        const stagePat = /^(content\/|devlog\/|devlog\.html|assets\/(?:posts|pages|projects|og)\/|pages\.html|pages\/|feed\.xml|atom\.xml|sitemap\.xml|robots\.txt|search-index\.json|\.github\/workflows\/publish\.yml)/;
        (status2.unstaged || []).forEach((f: any) => {
          if (stagePat.test(f.path)) paths.add(f.path);
        });
        (status2.untracked || []).forEach((p: any) => {
          if (stagePat.test(p)) paths.add(p);
        });
        const deleted = (status2.unstaged || []).filter((f: any) => f.status === "deleted" && stagePat.test(f.path));
        body.innerHTML = `<p class="muted">Staging ${paths.size} file(s)${deleted.length ? `, including ${deleted.length} deletion${deleted.length === 1 ? "" : "s"}` : ""}…</p>`;
        const stagedPaths = Array.from(paths);
        await call("git_stage_paths", { paths: stagedPaths });
        if (paths.size === 0) {
          body.innerHTML = `<p class="muted">Nothing to stage — no content changes to publish.</p>
            <div class="modal-actions"><button id="pub-close-none" class="btn">Close</button></div>`;
          $("#pub-close-none", overlay)!.onclick = () => overlay.remove();
          $("#pub-go", overlay)!.remove();
          return;
        }
        const msg = ($("#pub-msg", overlay) as HTMLInputElement)?.value || "Update portfolio content";
        let commitHash = "";
        try {
          commitHash = await call("git_commit", { message: msg });
        } catch (e) {
          await unstageQuietly(stagedPaths);
          body.innerHTML = `<p class="error-text">Commit failed — nothing was published.</p>
            <pre class="diffbox diff-big">${esc(String((e as any).message || e))}</pre>
            <p class="muted">Your changes are still in the working tree (unstaged). Fix the error and retry.</p>
            <div class="modal-actions"><button id="pub-close-commit" class="btn">Close</button></div>`;
          $("#pub-close-commit", overlay)!.onclick = () => overlay.remove();
          $("#pub-go", overlay)!.remove();
          return;
        }
        body.innerHTML = `<p class="muted">Pushing…</p>`;
        let push = "";
        try {
          push = await call("git_push", { branch: status2.branch });
        } catch (e) {
          // Commit succeeded but push failed — do NOT unstage (it's already committed),
          // but make the failure clear so the user can retry from a terminal.
          body.innerHTML = `<p class="error-text">Commit succeeded but push failed.</p>
            <pre class="diffbox diff-big">${esc(String((e as any).message || e))}</pre>
            <p class="muted">The commit is local. Pull the latest changes or fix your credentials, then run <code>git push</code> in the repository.</p>
            <div class="modal-actions"><button id="pub-close-push" class="btn">Close</button></div>`;
          $("#pub-close-push", overlay)!.onclick = () => overlay.remove();
          $("#pub-go", overlay)!.remove();
          return;
        }
        let hookLine = "";
        try {
          const hook = await call("trigger_deploy_hook");
          hookLine = hook?.ok
            ? `<p class="muted">Deploy hook fired (HTTP ${esc(hook.status || 200)}). ${esc(hook.detail || "")}</p>`
            : `<p class="muted">Deploy hook failed (${esc(hook.detail || `HTTP ${hook.status}`)}) — the push may still deploy the site.</p>`;
        } catch {
          hookLine = `<p class="muted">No deploy hook configured. The GitHub push itself deploys via Pages/GitHub Actions.</p>`;
        }
        body.innerHTML = `
          <p class="success-text">Published ✓</p>
          <p>Commit: <code>${esc(commitHash || "?")}</code> on <strong>${esc(status2.branch)}</strong></p>
          <p>Pushed file(s): <code>${paths.size}</code></p>
          <p class="muted">${esc(push || "")}</p>
          ${hookLine}
        `;
        $("#pub-go", overlay)!.remove();
        setStatus("Published");
        await refreshTree();
      } catch (e) {
        const msg = String((e as any).message ?? e ?? "");
        body.innerHTML = `<p class="error-text">Something went wrong.</p><pre class="diffbox">${esc(msg.trim() ? msg : "An unknown error occurred during publishing.")}</pre>`;
        $("#pub-go", overlay)!.remove();
      }
    };
  });
}

function slugify(s: string) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

async function unstageQuietly(paths: string[]) {
  try {
    await call("git_unstage", { paths });
  } catch {
    /* best-effort: never let an unstage failure obscure the real error */
  }
}

function applyThemeToggle(theme: string) {
  document.documentElement.dataset.theme = theme;
  const btn = $("#settings-btn")!;
  btn.textContent = theme === "dark" ? "☾" : "☀";
}

// ---------- PDF to post ----------
function promptPageForPost(): string {
  const promptVal = window.prompt("Page slug to publish this post into (or leave empty for the first page):")?.trim();
  return promptVal || state.tree[0]?.slug || "";
}

async function newPostFromPdf() {
  const path = await cell(() => call("pick_file", { filterName: "PDF", filterExts: ["pdf"] }));
  if (!path) return;
  const pdf = await cell(() => call("import_pdf", { sourcePath: path }));
  if (!pdf) return;
  const page = promptPageForPost();
  openPostEditor(page, null);
  ($("#po-title") as HTMLInputElement).value = pdf.title || "Untitled";
  const lines = (pdf.text || "").trim().split("\n");
  state.editor!.setBody(lines.slice(0, 250).join("\n"));
  state.editor?.setStatus(`Imported PDF — review before saving`);
  setStatus(pdf.is_image_only
    ? `No extractable text in this PDF (${pdf.page_count ?? "?"} pages).`
    : `Imported PDF (${lines.length} lines)${pdf.page_count ? `, ${pdf.page_count} pages` : ""}`);
}

// ---------- Recovery dashboard ----------
function openRecoveryDashboard() {
  const overlay = el("div", "overlay");
  overlay.innerHTML = `
    <div class="modal recovery-modal">
      <h2>Recover drafts</h2>
      <div id="rec-list" class="rec-list"></div>
      <div class="modal-actions"><button id="rec-close" class="btn">Close</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
  $("#rec-close", overlay)!.onclick = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  void renderRecoveryList($("#rec-list", overlay));
}

async function renderRecoveryList(list: HTMLElement) {
  const entries = await cell(() => call("list_recovery"));
  list.innerHTML = "";
  if (!entries || !entries.length) {
    list.innerHTML = `<p class="muted">No unsaved drafts found.</p>`;
    return;
  }
  entries.forEach((en: any) => {
    const row = el("div", "rec-row");
    row.innerHTML = `
      <div class="rec-main">
        <strong>${esc(en.key)}</strong>
        <span class="muted">${esc(en.saved_at)} · ${en.bytes} bytes</span>
        <pre class="rec-prelude">${esc(en.prelude)}</pre>
      </div>
      <div class="row-actions">
        <button data-rec-restore="${esc(en.key)}" class="btn">Restore</button>
        <button data-rec-discard="${esc(en.key)}" class="btn danger">Discard</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll("[data-rec-restore]").forEach((b) => {
    b.addEventListener("click", async () => {
      const key = (b as HTMLElement).dataset["rec-restore"]!;
      const snapshot = await cell(() => call("load_recovery", { key }));
      if (snapshot == null) return;
      overlayFor(list)?.remove();
      await restoreFromKey(key, snapshot);
    });
  });
  list.querySelectorAll("[data-rec-discard]").forEach((b) => {
    b.addEventListener("click", async () => {
      const key = (b as HTMLElement).dataset["rec-discard"]!;
      await cell(() => call("clear_recovery", { key }));
      await renderRecoveryList(list);
    });
  });
}

function overlayFor(inside: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = inside;
  while (node && !node.classList.contains("overlay")) node = node.parentElement;
  return node;
}

async function restoreFromKey(key: string, snapshot: any) {
  if (key.startsWith("post:")) {
    const [page, slug] = key.slice("post:".length).split("/");
    showPostView(page, slug);
    setStatus("Open post editor — click Restore to apply the recovered draft.");
    return;
  }
  // draft:<page>:<sessionId>
  const bits = key.split(":");
  const page = bits[1] || state.tree[0]?.slug || "";
  pendingClearKeys.push(key);
  openPostEditor(page, null);
  state.editor!.setBody(typeof snapshot === "string" ? snapshot : snapshot.content || "");
  restoreRecoveryMetadata(typeof snapshot === "string" ? null : snapshot.metadata);
  state.editorDirty = true;
  state.editor?.setStatus("Restored unsaved draft — save to keep it");
}

async function maybeShowRecoveryNotice(v: HTMLElement) {
  const entries = await cell(() => call("list_recovery"));
  if (!entries || !entries.length) return;
  const bar = el("div", "recovery-bar");
  bar.innerHTML = `
    <strong>${entries.length} unsaved draft${entries.length === 1 ? "" : "s"} available</strong>
    <span class="muted">Crash recovery found drafts that were never saved.</span>
    <span class="recovery-actions"><button id="rec-go" class="btn primary">Review drafts</button></span>
  `;
  v.prepend(bar);
  $("#rec-go", bar)!.onclick = () => openRecoveryDashboard();
}

// ---------- Settings ----------
function showSettings() {
  resetEditorState();
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
      <p class="muted auth-hint">Use the <strong>Sign in with GitHub</strong> button below to connect through your browser (device flow).</p>
      <p class="muted">Last commit: <code id="set-lastcommit">—</code></p>
      <div class="card-actions">
        <button id="set-recover" class="btn">Recover drafts…</button>
      </div>
    </div>
    <label>Repository path <input id="set-repo" value="${esc(state.prefs?.repo_path || "")}" placeholder="/path/to/ahmarius.github.io" /></label>
    <label>Devlog project repo (default for commit pull) <input id="set-devlog-repo" value="${esc(state.prefs?.devlog_repo || "")}" placeholder="/path/to/project-repo" /></label>
    <details class="settings-section">
      <summary>Publishing</summary>
      <label>Default publish mode
        <select id="set-publish-mode"><option value="publish">Publish (hide drafts, full site)</option><option value="preview">Preview (local, incl. drafts)</option></select>
      </label>
      <label>Deploy hook URL <input id="set-hook" value="${esc(state.prefs?.settings?.deploy_hook_url || "")}" placeholder="https://example.com/hooks/deploy" /></label>
      <label>Syndicate via
        <select id="set-syndicate"><option value="none">None</option><option value="mastodon">Mastodon</option><option value="bluesky">Bluesky</option></select>
      </label>
      <p class="muted">Deploy hook fires after a successful push and lets a CI service rebuild the live site.</p>
    </details>
    <details class="settings-section">
      <summary>Phone sync</summary>
      <label>Sync gateway URL <input id="set-sync-url" value="${esc(state.prefs?.settings?.sync_gateway_url || "")}" placeholder="https://content-sync.example.workers.dev" /></label>
      <p class="muted">Uses a GitHub App on the gateway. Your phone never receives a GitHub token or deploy secret.</p>
      <div class="card-actions"><button id="set-sync-check" class="btn">Check gateway</button><button id="set-sync-pair" class="btn">Create phone pairing…</button></div>
      <p id="set-sync-msg" class="muted"></p>
    </details>
    <details class="settings-section">
      <summary>Comments (giscus)</summary>
      <label>giscus repo ID <input id="set-gisc-repo" value="${esc(state.prefs?.settings?.giscus_repo_id || "")}" placeholder="e.g. R_kgDO…" /></label>
      <label>giscus category ID <input id="set-gisc-cat" value="${esc(state.prefs?.settings?.giscus_category_id || "")}" placeholder="e.g. DIC_kwDO…" /></label>
      <p class="muted">Leave empty to disable comments on post pages.</p>
    </details>
    <details class="settings-section">
      <summary>Analytics (Umami)</summary>
      <label>Umami server URL <input id="set-umami-url" value="${esc(state.prefs?.settings?.umami_url || "")}" placeholder="https://cloud.umami.is" /></label>
      <label>Umami website ID <input id="set-umami-id" value="${esc(state.prefs?.settings?.umami_website_id || "")}" placeholder="2797aa09-…" /></label>
      <div id="set-umami-status" class="muted"></div>
    </details>
    <label>Theme
      <select id="set-theme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select>
    </label>
    <label>Default post status
      <select id="set-status"><option>draft</option><option>published</option></select>
    </label>
    <button id="set-save" class="btn primary">Save Settings</button>
    <p id="set-msg" class="muted"></p>
    <p class="muted version-line">Content Studio <code id="set-version">…</code></p>
  `;
  v.appendChild(form);
  ($("#set-theme") as HTMLSelectElement).value = state.prefs?.theme || "system";
  ($("#set-status") as HTMLSelectElement).value = state.prefs?.default_status || "draft";
  ($("#set-publish-mode") as HTMLSelectElement).value = state.prefs?.publish_mode || "publish";
  ($("#set-syndicate") as HTMLSelectElement).value = state.prefs?.settings?.syndicate_via || "none";
  cell(async () => {
    const ver = await call("app_version");
    const vn = $("#set-version");
    if (vn) vn.textContent = String(ver ?? "unknown");
  });
  renderAuthStatus();
  cell(async () => {
    const info = await cell(() => call("analytics_summary"));
    const status = $("#set-umami-status");
    if (status) {
      status.textContent = info?.tracking_enabled
        ? `Tracking script: ${info.script_url} (id ${info.website_id})`
        : "Umami not configured — analytics script will not be injected.";
    }
  });
  cell(async () => {
    const hash = await cell(() => call("git_last_commit"));
    const h = $("#set-lastcommit");
    if (h) h.textContent = hash || "—";
  });
  $("#set-recover")!.onclick = openRecoveryDashboard;
  $("#set-sync-check")!.onclick = async () => {
    const message = $("#set-sync-msg") as HTMLElement;
    try {
      await checkSyncGateway(($("#set-sync-url") as HTMLInputElement).value);
      message.textContent = "Gateway is reachable.";
      message.className = "success-text";
    } catch (error) {
      message.textContent = String((error as any).message || error);
      message.className = "error-text";
    }
  };
  $("#set-sync-pair")!.onclick = async () => {
    const url = ($("#set-sync-url") as HTMLInputElement).value;
    const secret = window.prompt("Enter the sync admin secret. It is used once and is never saved on this device.", "") || "";
    if (!secret) return;
    const message = $("#set-sync-msg") as HTMLElement;
    try {
      const pairing = await createPhonePairing(url, secret);
      message.textContent = `Phone pairing code: ${pairing.code} (expires ${pairing.expires_at})`;
      message.className = "success-text";
    } catch (error) {
      message.textContent = String((error as any).message || error);
      message.className = "error-text";
    }
  };
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
      devlog_repo: ($("#set-devlog-repo") as HTMLInputElement).value.trim() || null,
      theme: ($("#set-theme") as HTMLSelectElement).value,
      default_status: ($("#set-status") as HTMLSelectElement).value,
      publish_mode: ($("#set-publish-mode") as HTMLSelectElement).value,
      settings: {
        deploy_hook_url: ($("#set-hook") as HTMLInputElement).value.trim() || null,
        syndicate_via: ($("#set-syndicate") as HTMLSelectElement).value || "none",
        giscus_repo_id: ($("#set-gisc-repo") as HTMLInputElement).value.trim() || null,
        giscus_category_id: ($("#set-gisc-cat") as HTMLInputElement).value.trim() || null,
        umami_url: ($("#set-umami-url") as HTMLInputElement).value.trim() || null,
        umami_website_id: ($("#set-umami-id") as HTMLInputElement).value.trim() || null,
        sync_gateway_url: ($("#set-sync-url") as HTMLInputElement).value.trim() || null,
      },
    };
    // Merge over current prefs so never-rendered fields (window state, editor
    // mode, sidebar width, …) are preserved locally and on disk.
    state.prefs = { ...state.prefs, ...prefs, settings: { ...state.prefs?.settings, ...prefs.settings } };
    await cell(() => call("set_prefs", { prefs }));
    applyThemeToggle(state.prefs.theme === "dark" ? "dark" : state.prefs.theme === "light" ? "light" : "dark");
    ($("#set-msg") as HTMLElement).textContent = "Saved.";
    await refreshTree();
  };
}

async function renderAuthStatus() {
  const host = $("#auth-status");
  if (!host) return;
  host.className = "auth-status loading";
  host.innerHTML = `<p class="muted">Checking GitHub connection…</p>`;
  await cell(async () => {
    const st = await call("git_auth_status");
    if (!st) {
      host.className = "auth-status error";
      host.innerHTML = "<p class=\"error-text\">Could not check GitHub (no repository configured?).</p>";
      return;
    }
    if (st.authenticated) {
      host.className = "auth-status ok";
      const who = st.gh_login
        ? `<strong>${esc(st.gh_login)}</strong>`
        : esc(st.remote || "origin");
      host.innerHTML = `Connected to GitHub as ${who} — ready to publish.
        <p class="muted">Auth: ${esc(st.method || "git-credential")}${st.remote ? ` · remote <code>${esc(st.remote)}</code>` : ""}</p>
        <p><button id="auth-signin" class="btn">Sign in as a different account</button> <button id="auth-refresh" class="btn">Check again</button></p>`;
    } else {
      host.className = "auth-status error";
      host.innerHTML = `Not signed in to GitHub. ${
        st.gh_installed
          ? "Sign in below — the app uses the GitHub CLI device flow."
          : "GitHub CLI (<code>gh</code>) not found — install it or configure Git credentials."
      }` +
        (st.error ? ` <span class="muted">(${esc(String(st.error).slice(0, 120))})</span>` : "") +
        (st.gh_installed
          ? `<p><button id="auth-signin" class="btn">Sign in with GitHub</button> <button id="auth-refresh" class="btn">Check again</button></p>`
          : `<p><button id="auth-refresh" class="btn">Check again</button></p>`);
    }
    $("#auth-signin")!.onclick = () => renderSignIn(host, renderAuthStatus);
    $("#auth-refresh")!.onclick = renderAuthStatus;
  });
}

// ---------- Wiring ----------
function wireTop() {
  $$(".topnav2 button").forEach((b) => {
    b.addEventListener("click", () => {
      const nav = (b as HTMLElement).dataset.nav;
      if (nav === "dashboard") showDashboard();
      else if (nav === "sync") showSyncView();
      else if (nav === "pages") showPagesView();
      else if (nav === "projects") showProjectsView();
      else if (nav === "allposts") showAllPostsView();
      else if (nav === "newpost") openPostEditor(promptPageForPost(), null);
      else if (nav === "newpostpdf") void cell(newPostFromPdf);
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

boot().then(() => {
  showDashboard();
  wireTop();
  installShortcuts();
  installGlobalDrop();
  installTauriDrop();
});
