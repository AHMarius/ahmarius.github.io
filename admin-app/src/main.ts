import { ContentNode, PostDoc } from "./api";
import { Editor } from "./editor";
import "./app.css";

type View =
  | { kind: "pages" }
  | { kind: "projects" }
  | { kind: "allposts" }
  | { kind: "page"; slug: string }
  | { kind: "post"; page: string; slug: string }
  | { kind: "settings" };

const state = {
  view: { kind: "pages" } as View,
  tree: [] as ContentNode[],
  posts: [] as any[],
  projects: [] as any[],
  prefs: {} as any,
  editor: null as Editor | null,
  editorSave: undefined as (() => Promise<any>) | undefined,
  editorDirty: false,
  status: "Idle" as string,
  saving: false as boolean,
  editorKey: "" as string,
  autosaveTimer: 0 as any,
  collapsed: new Set<string>(),
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

function showProjectsView() {
  state.view = { kind: "projects" };
  const v = viewContent();
  v.innerHTML = "";
  v.appendChild(el("h1", "page-title", "Projects"));
  const addBtn = el("button", "btn primary", "+ New Project");
  addBtn.addEventListener("click", () => openProjectEditor(null));
  v.appendChild(addBtn);

  cell(async () => {
    const projects = await refreshProjects();
    const grid = el("div", "cards-grid");
    state.projects.forEach((p: any) => {
      const card = el("article", "card page-card-c");
      card.innerHTML = `
        <div class="card-head"><span class="card-avatar"></span><h3>${esc(p.name)}${statusPill(p.status)}</h3></div>
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

function showProjectView(slug: string) {
  state.view = { kind: "page", slug };
  const v = viewContent();
  v.innerHTML = "";
  cell(async () => {
    const doc = await call("read_project", { slug });
    if (!doc) return;
    v.appendChild(el("h1", "page-title", doc.name || slug));
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
    <button id="pr-save" class="btn primary">Save</button>
  `;
  v.appendChild(form);
  if (slug) {
    cell(async () => {
      const doc = await call("read_project", { slug });
      ($("#pr-name") as HTMLInputElement).value = doc?.name || "";
      ($("#pr-slug") as HTMLInputElement).value = doc?.slug || "";
      ($("#pr-repo-url") as HTMLInputElement).value = doc?.repo_url || "";
      ($("#pr-live-url") as HTMLInputElement).value = doc?.live_url || "";
      ($("#pr-status") as HTMLSelectElement).value = doc?.status || "active";
      ($("#pr-desc") as HTMLTextAreaElement).value = doc?.description || "";
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
  await cell(async () => {
    await call("delete_page", { slug });
  });
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
  await cell(async () => {
    await call("delete_post", { pageSlug: page, postSlug: slug });
  });
  setStatus(`Deleted post ${slug}`);
  await refreshTree();
  if (state.view.kind === "page" && state.view.slug === page) showPageView(page);
  else if (state.view.kind === "post" && state.view.page === page) showPageView(page);
  else if (state.view.kind === "allposts") showAllPostsView();
  else showPagesView();
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
    <label>Cover path <input id="pe-cover" placeholder="cover.jpg" /></label>
    <label>Kind
      <select id="pe-kind"><option value="page">Regular page</option><option value="devlog">Devlog</option></select>
    </label>
    <label>Devlog repo (pull commits from) <input id="pe-devlog-repo" placeholder="/abs/path/to/project-repo" /></label>
    <label>Order <input id="pe-order" type="number" placeholder="100" /></label>
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
    await cell(() =>
      call(slug ? "update_page" : "create_page", {
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
      }),
    );
    setStatus(slug ? `Saved page ${sl}` : `Created page ${sl}`);
    await refreshTree();
    if (slug) showPageView(sl);
    else showPagesView();
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
  return (input?.value || "").trim() || "new-post";
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
      postSlug: targetSlugFor(),
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
      postSlug: targetSlugFor(),
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
    call("capture_screenshot", { pageSlug: page, postSlug: targetSlugFor() }),
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
      <label class="check-label">Featured <input id="po-featured" type="checkbox" /></label>
      <label>Cover path <input id="po-cover" placeholder="cover.jpg" /></label>
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
    if (state.saving) return;
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
      const savedSlug = await call("write_post", { input: { page_slug: page, meta, body: state.editor!.getValue() } });
      // Success: clear autosave recovery for this post, then switch the draft key
      // from the placeholder to the real slug so later autosaves are keyed correctly.
      const oldKey = state.editorKey;
      state.editorKey = recoveryKey(page, String(savedSlug || meta.slug));
      await cell(() => call("clear_recovery", { key: oldKey }));
      for (const k of pendingClearKeys) {
        await cell(() => call("clear_recovery", { key: k }));
      }
      pendingClearKeys = [];
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
      if (state.editorSave) void cell(state.editorSave);
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
    const lastCommit = await cell(() => call("git_last_commit"));
    const diffText = await cell(() => call("git_diff", { staged: false }));
    const buildInfo = await cell(() => call("latest_site_build"));
    body.innerHTML = `
      <p>Branch: <strong>${esc(st.branch)}</strong>${st.ahead ? ` (${st.ahead} ahead)` : ""}${st.behind ? ` (${st.behind} behind)` : ""}</p>
      ${lastCommit ? `<p class="muted">Last commit: <code>${esc(lastCommit)}</code></p>` : ""}
      ${buildInfo ? `<p class="muted">Last build: ${esc(buildInfo.generated_at || "unknown")} · ${buildInfo.devlog_posts} post pages · ${buildInfo.archive_folders.join(", ")} § feed: ${buildInfo.feed_generated ? "yes" : "no"} · sitemap: ${buildInfo.sitemap_generated ? "yes" : "no"}</p>` : ""}
      <h4>Staged</h4><pre class="diffbox">${staged || "(nothing staged yet)"}</pre>
      <h4>Unstaged content changes</h4><pre class="diffbox">${unstaged || "(none)"}</pre>
      ${diffText ? `<details class="diff-details"><summary>View working-tree diff</summary><pre class="diffbox diff-big">${esc(diffText)}</pre></details>` : ""}
      ${unrel}
      <label>Commit message<input id="pub-msg" value="Update portfolio content" /></label>
      <p class="muted">Will lint posts, run the publish build, stage content/assets, commit, push, and fire any configured deploy hook.</p>
    `;
    $("#pub-go", overlay)!.onclick = async () => {
      $("#pub-go", overlay)!.disabled = true;
      body.innerHTML = `<p class="muted">Linting posts…</p>`;
      try {
        const lint = await cell(() => call("lint_posts"));
        if (lint && lint.errors_count > 0) {
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
        const paths = new Set<string>();
        (status2.unstaged || []).forEach((f: any) => {
          if (/^(content\/|devlog\/|devlog\.html|assets\/dist|pages\.html|pages\/|feed\.xml|atom\.xml|sitemap\.xml|robots\.txt|search-index\.json)/.test(f.path)) paths.add(f.path);
        });
        (status2.staged || []).forEach((f: any) => paths.add(f.path));
        (status2.untracked || []).forEach((p: any) => {
          if (/^(content\/|devlog\/|devlog\.html|assets\/dist|pages\.html|pages\/|feed\.xml|atom\.xml|sitemap\.xml|robots\.txt|search-index\.json)/.test(p)) paths.add(p);
        });
        body.innerHTML = `<p class="muted">Staging ${paths.size} file(s)…</p>`;
        await call("git_stage_paths", { paths: Array.from(paths) });
        const msg = ($("#pub-msg", overlay) as HTMLInputElement)?.value || "Update portfolio content";
        const commitHash = await call("git_commit", { message: msg });
        body.innerHTML = `<p class="muted">Pushing…</p>`;
        const push = await call("git_push", { branch: status2.branch });
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
        body.innerHTML = `<p class="error-text">Something went wrong.</p><pre class="diffbox">${esc(String((e as any).message || e))}</pre>`;
        $("#pub-go", overlay)!.remove();
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
      const content = await cell(() => call("load_recovery", { key }));
      if (content == null) return;
      overlayFor(list)?.remove();
      await restoreFromKey(key, content);
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

async function restoreFromKey(key: string, content: string) {
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
  state.editor!.setBody(content);
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
  `;
  v.appendChild(form);
  ($("#set-theme") as HTMLSelectElement).value = state.prefs?.theme || "system";
  ($("#set-status") as HTMLSelectElement).value = state.prefs?.default_status || "draft";
  ($("#set-publish-mode") as HTMLSelectElement).value = state.prefs?.publish_mode || "publish";
  ($("#set-syndicate") as HTMLSelectElement).value = state.prefs?.settings?.syndicate_via || "none";
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
  $("#auth-refresh")!.onclick = renderAuthStatus;
  $("#set-recover")!.onclick = openRecoveryDashboard;
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
      },
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
  showPagesView();
  wireTop();
  installShortcuts();
  installGlobalDrop();
  installTauriDrop();
});