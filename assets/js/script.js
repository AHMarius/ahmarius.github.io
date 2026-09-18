document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initHamburgerMenu();
  initThemeToggle();
  initLinkButtons();
  initGalleries();
  initProjectAvatars();
  initGitHubStats();
  initReducedMotionVideo();
  initActivePage();
  initProjectKeyboardControls();
  initProjectFilters();
  initCvAccessibility();
  initCopyEmail();
  initBackToTop();
  initScrollProgress();
  initRevealOnScroll();
  initLastUpdated();
  initSiteSearch();
});

/* ------------------------------------------------------------------------
 * Respect prefers-reduced-motion: pause the decorative background video
 * instead of forcing it to autoplay/loop for users who asked for less
 * motion.
 * ------------------------------------------------------------------------ */

function initReducedMotionVideo() {
  const video = document.getElementById("bgVideo");
  if (!video) return;

  const query = window.matchMedia("(prefers-reduced-motion: reduce)");

  function applyPreference(matches) {
    if (matches) {
      video.pause();
      video.removeAttribute("autoplay");
    } else if (video.paused) {
      video.play().catch(() => {});
    }
  }

  applyPreference(query.matches);
  query.addEventListener("change", (e) => applyPreference(e.matches));
}

/* ------------------------------------------------------------------------
 * Theme toggle
 * ------------------------------------------------------------------------ */

function initThemeToggle() {
  const storedTheme = localStorage.getItem("theme");
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  const theme = storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : systemTheme?.matches ? "dark" : "light";

  document.documentElement.dataset.theme = theme;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.setAttribute("aria-label", "Switch to dark theme");

  function updateButton(nextTheme) {
    const dark = nextTheme === "dark";

    button.textContent = dark ? "☀" : "☾";
    button.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme",
    );
    button.setAttribute("aria-pressed", String(dark));
    button.title = dark ? "Switch to light theme" : "Switch to dark theme";
  }

  updateButton(theme);
  document.body.appendChild(button);

  button.addEventListener("click", () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
    updateButton(nextTheme);
  });

  systemTheme?.addEventListener("change", (event) => {
    if (localStorage.getItem("theme")) return;
    const nextTheme = event.matches ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    updateButton(nextTheme);
  });
}

/* ------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------ */

function initNavigation() {
  const pages = {
    "btn-projects": "projects.html",
    "btn-cv": "cv.html",
    "btn-about": "about.html",
  };

  Object.entries(pages).forEach(([id, page]) => {
    const btn = document.getElementById(id);
    if (!btn) return;

    btn.addEventListener("click", () => {
      window.location.href = page;
    });
  });
}

/* ------------------------------------------------------------------------
 * Hamburger menu
 * ------------------------------------------------------------------------ */

function initHamburgerMenu() {
  const btn = document.getElementById("hamburger-btn");
  const menu = document.getElementById("mobile-menu");

  if (!btn || !menu) return;

  const close = (restoreFocus = false) => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("is-open");
    if (restoreFocus) btn.focus();
  };

  btn.addEventListener("click", () => {
    if (!menu.hidden) {
      close();
      return;
    }
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.classList.add("is-open");
  });

  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) close();
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !btn.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) close(true);
  });
}

/* ------------------------------------------------------------------------
 * Link buttons
 * ------------------------------------------------------------------------ */

function initLinkButtons() {
  document.querySelectorAll(".link-btn[data-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.url;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  });
}

/* ------------------------------------------------------------------------
 * Galleries
 * ------------------------------------------------------------------------ */

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"];

function initGalleries() {
  document
    .querySelectorAll(".project-card[data-gallery-folder]")
    .forEach((card) => {
      const folder = card.dataset.galleryFolder;
      const gallery = card.querySelector("[data-gallery]");

      if (!folder || !gallery) return;

      loadGalleryImages(folder, gallery);
    });
}

async function loadGalleryImages(folder, gallery) {
  const base = folder.endsWith("/") ? folder : folder + "/";

  try {
    const res = await fetch(base + "manifest.json");

    if (res.ok) {
      const files = await res.json();
      renderGallery(gallery, base, Array.isArray(files) ? files : []);
      return;
    }
  } catch {}
  markGalleryEmpty(gallery);
}

function renderGallery(gallery, folder, files) {
  gallery.innerHTML = "";

  if (!files || files.length === 0) {
    markGalleryEmpty(gallery);
    return;
  }

  let current = 0;

  gallery.classList.add("carousel");

  const viewport = document.createElement("div");
  viewport.className = "carousel-viewport";

  const img = document.createElement("img");
  img.className = "gallery-image";
  img.loading = "lazy";
  viewport.appendChild(img);

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "carousel-btn carousel-prev";
  prevBtn.setAttribute("aria-label", "Previous image");
  prevBtn.textContent = "\u2039";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "carousel-btn carousel-next";
  nextBtn.setAttribute("aria-label", "Next image");
  nextBtn.textContent = "\u203A";

  const counter = document.createElement("div");
  counter.className = "carousel-counter";

  const entries = files.map((entry) => typeof entry === "string" ? { src: entry, alt: "" } : entry)
    .filter((entry) => entry?.src && IMAGE_EXTENSIONS.some((ext) => entry.src.toLowerCase().endsWith("." + ext)));
  if (!entries.length) {
    markGalleryEmpty(gallery);
    return;
  }

  function show(index) {
    current = (index + entries.length) % entries.length;
    const entry = entries[current];
    img.src = folder + entry.src;
    const fallbackAlt = decodeURIComponent(entry.src).split("/").pop().replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    img.alt = entry.alt || `${fallbackAlt || "Project"} screenshot`;
    counter.textContent = `${current + 1} / ${entries.length}`;
  }

  prevBtn.addEventListener("click", () => show(current - 1));
  nextBtn.addEventListener("click", () => show(current + 1));

  if (entries.length > 1) gallery.appendChild(prevBtn);
  gallery.appendChild(viewport);
  if (entries.length > 1) {
    gallery.appendChild(nextBtn);
    gallery.appendChild(counter);
  }

  show(0);
}

function markGalleryEmpty(gallery) {
  gallery.innerHTML = '<p class="gallery-empty-note">Images unavailable</p>';
}
function initProjectAvatars() {
  const root = getComputedStyle(document.documentElement);

  function solidColor(variable) {
    const value = root.getPropertyValue(variable).trim();

    // rgba(...) -> rgb(...)
    if (value.startsWith("rgba")) {
      const parts = value.replace("rgba(", "").replace(")", "").split(",");

      return `rgb(${parts[0].trim()}, ${parts[1].trim()}, ${parts[2].trim()})`;
    }

    return value;
  }

  const colors = {
    lang: solidColor("--tag-lang-bg"),
    tool: solidColor("--tag-tool-bg"),
    type: solidColor("--tag-type-bg"),
    concept: solidColor("--tag-concept-bg"),
    misc: solidColor("--tag-misc-bg"),
  };

  const categories = {
    lang: [
      "tag-csharp",
      "tag-java",
      "tag-cpp",
      "tag-kotlin",
      "tag-python",
      "tag-vhdl",
    ],

    tool: [
      "tag-unity",
      "tag-raylib",
      "tag-sdl",
      "tag-oracle",
      "tag-database",
      "tag-sqlite",
      "tag-android",
      "tag-mobile",
      "tag-vivado",
      "tag-fpga",
      "tag-basys3",
      "tag-digital-logic",
      "tag-osm",
      "tag-api",
      "tag-db",
      "tag-easybmp",
    ],

    type: [
      "tag-singleplayer",
      "tag-multiplayer",
      "tag-team",
      "tag-server-client",
      "tag-server",
      "tag-game",
      "tag-game-engine",
      "tag-game-dev",
      "tag-oop",
      "tag-design-patterns",
      "tag-scene-management",
      "tag-save-system",
      "tag-shaders",
      "tag-cli",
      "tag-ipc",
      "tag-parallel",
      "tag-database-application",
    ],

    concept: [
      "tag-physics",
      "tag-2d",
      "tag-collisions",
      "tag-graphics",
      "tag-simulation",
      "tag-ai",
      "tag-aco",
      "tag-genetic",
      "tag-graphs",
      "tag-optimization",
      "tag-routing",
      "tag-research",
      "tag-fluid-dynamics",
      "tag-graphing",
      "tag-uml",
      "tag-software-engineering",
      "tag-erasmus",
    ],
  };

  document.querySelectorAll(".project-card").forEach((card) => {
    const counts = {
      lang: 0,
      tool: 0,
      type: 0,
      concept: 0,
      misc: 0,
    };

    card.querySelectorAll(".tag-bubble").forEach((tag) => {
      let matched = false;

      for (const category in categories) {
        if (categories[category].some((cls) => tag.classList.contains(cls))) {
          counts[category]++;
          matched = true;
          break;
        }
      }

      if (!matched) counts.misc++;
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (total === 0) return;

    let angle = 0;
    const slices = [];

    Object.entries(counts).forEach(([category, count]) => {
      if (count === 0) return;

      const start = angle;
      angle += (count / total) * 360;

      slices.push(`${colors[category]} ${start}deg ${angle}deg`);
    });

    const avatar = card.querySelector(".card-avatar");

    if (!avatar) return;

    avatar.style.background = `conic-gradient(${slices.join(",")})`;

    avatar.style.border = "2px solid rgba(255,255,255,.35)";
    avatar.style.boxShadow =
      "0 4px 12px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.25)";
  });
}

/* ------------------------------------------------------------------------
 * GitHub live stats (About page)
 *
 * Fetches public repo count via the GitHub REST API and renders it into
 * the "stat-live" card. Falls back to a friendly message on failure
 * (rate limit, network error, offline, wrong username, etc.) instead of
 * leaving the UI stuck on "loading…".
 *
 * ------------------------------------------------------------------------ */

async function initGitHubStats() {
  const countEl = document.getElementById("github-repo-count");
  const statusEl = document.getElementById("github-repo-status");

  if (!countEl || !statusEl) return;

  try {
    const res = await fetch("https://api.github.com/users/ahmarius");
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
    const data = await res.json();
    if (!Number.isInteger(data.public_repos)) throw new Error("GitHub response did not include public_repos");
    countEl.textContent = String(data.public_repos);
    statusEl.textContent = "live from GitHub";
  } catch {
    countEl.textContent = "20+";
    statusEl.textContent = "cached";
  }
}

/* ------------------------------------------------------------------------
 * Accessibility / active page indication
 *
 * Marks the current page's nav link with aria-current="page" so keyboard
 * and screen-reader users (and sighted users, via the active-link style
 * in the CSS) can always tell where they are in the site.
 * ------------------------------------------------------------------------ */

function initActivePage() {
  const current = (
    window.location.pathname.split("/").pop() || "index.html"
  ).toLowerCase();

  document
    .querySelectorAll("nav a[href], .mobile-menu a[href]")
    .forEach((link) => {
      const href = (link.getAttribute("href") || "")
        .split("/")
        .pop()
        .split("#")[0]
        .toLowerCase();

      if (!href || href.startsWith("http") || href.startsWith("mailto")) return;

      const isHome =
        (current === "" || current === "index.html") &&
        (href === "index.html" || href === "");
      const isMatch = href === current;

      if (isHome || isMatch) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
}

/* ------------------------------------------------------------------------
 * Keyboard support for project cards
 *
 * The cards already expand on hover/focus-within via CSS. This adds an
 * explicit keyboard toggle (Enter / Space) for users tabbing through the
 * feed without a pointer, plus proper button semantics and labelling.
 * ------------------------------------------------------------------------ */

function initProjectKeyboardControls() {
  document.querySelectorAll(".project-card").forEach((card) => {
    const title = card.querySelector(".project-title");
    const header = card.querySelector(".card-header");
    if (!title || !header || header.querySelector(".project-expand-toggle")) return;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "project-expand-toggle";
    toggle.textContent = "Expand";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `Expand project: ${title.textContent.trim()}`);
    toggle.addEventListener("click", () => {
      const open = card.classList.toggle("is-expanded");
      toggle.textContent = open ? "Collapse" : "Expand";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} project: ${title.textContent.trim()}`);
    });
    header.appendChild(toggle);
  });
}

/* ------------------------------------------------------------------------
 * Project search & status filter
 *
 * Injected as an isolated toolbar directly above the project feed. Does
 * not alter existing card markup — it only toggles the [hidden] attribute
 * on cards that no longer match, and announces the result count for
 * screen-reader users via a polite live region.
 * ------------------------------------------------------------------------ */

function initProjectFilters() {
  const feed = document.querySelector(".project-feed");
  if (!feed || !feed.querySelector(".project-card")) return;

  const toolbar = document.createElement("div");
  toolbar.className = "project-tools";
  toolbar.innerHTML = `
        <div class="project-tools-row">
            <label class="visually-hidden" for="project-search">Search projects or technologies</label>
            <input
                type="search"
                id="project-search"
                placeholder="Search projects or technologies…"
                aria-label="Search projects or technologies"
                autocomplete="off"
            >
            <label class="visually-hidden" for="project-status">Filter by status</label>
            <select id="project-status" aria-label="Filter projects by status">
                <option value="all">All statuses</option>
                <option value="finished">Finished</option>
                <option value="unfinished">Unfinished</option>
                <option value="ongoing">Ongoing</option>
                <option value="planning">On-Planning</option>
            </select>
        </div>
        <p class="project-tools-count" id="project-tools-count" aria-live="polite"></p>
    `;

  const firstCard = feed.querySelector(".project-card");
  feed.insertBefore(toolbar, firstCard);

  const search = toolbar.querySelector("#project-search");
  const status = toolbar.querySelector("#project-status");
  const countEl = toolbar.querySelector("#project-tools-count");
  const cards = Array.from(feed.querySelectorAll(".project-card"));
  const total = cards.length;

  const apply = () => {
    const query = search.value.trim().toLowerCase();
    const selectedStatus = status.value;

    let visible = 0;

    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      const matchesText = !query || text.includes(query);

      let matchesStatus = selectedStatus === "all";

      if (!matchesStatus) {
        matchesStatus = !!card.querySelector(`.badge-status-${selectedStatus}`);
      }

      const show = matchesText && matchesStatus;
      card.hidden = !show;
      if (show) visible++;
    });

    countEl.textContent =
      query || selectedStatus !== "all"
        ? `Showing ${visible} of ${total} projects`
        : "";
  };

  search.addEventListener("input", apply);
  status.addEventListener("change", apply);

  /* Support "?q=" and "#project-search-focus" style deep links */
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("q");
  if (initialQuery) {
    search.value = initialQuery;
    apply();
  }
}

/* Improve the existing CV modal without changing its visual design. */
function initCvAccessibility() {
  const modal = document.getElementById("cvModal");
  if (!modal) return;

  const getFocusable = () =>
    Array.from(
      modal.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled])",
      ),
    );

  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("active") || event.key !== "Tab") return;

    const elements = getFocusable();
    if (!elements.length) return;

    const first = elements[0];
    const last = elements[elements.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const observer = new MutationObserver(() => {
    document.body.classList.toggle(
      "cv-modal-open",
      modal.classList.contains("active"),
    );
  });

  observer.observe(modal, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/* ------------------------------------------------------------------------
 * Click-to-copy email button
 *
 * Looks for [data-copy-email] elements (added on the About/Contact
 * section) and copies the associated email to the clipboard, with a
 * small "Copied!" confirmation state.
 * ------------------------------------------------------------------------ */

function initCopyEmail() {
  document.querySelectorAll("[data-copy-email]").forEach((btn) => {
    const email = btn.dataset.copyEmail;
    if (!email) return;

    const originalLabel = btn.textContent;

    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(email);
      } catch {
        /* Clipboard API unavailable — fall back to a temporary input */
        const temp = document.createElement("input");
        temp.value = email;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }

      btn.textContent = "Copied!";
      btn.classList.add("is-copied");

      window.clearTimeout(btn._copyResetTimer);
      btn._copyResetTimer = window.setTimeout(() => {
        btn.textContent = originalLabel;
        btn.classList.remove("is-copied");
      }, 1800);
    });
  });
}

/* ------------------------------------------------------------------------
 * Back-to-top button
 *
 * Appears once the user has scrolled past the first viewport height.
 * Respects prefers-reduced-motion for the scroll behaviour.
 * ------------------------------------------------------------------------ */

function initBackToTop() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "back-to-top";
  btn.className = "back-to-top";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML = "&uarr;";
  document.body.appendChild(btn);

  const reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const toggle = () => {
    btn.classList.toggle("visible", window.scrollY > window.innerHeight * 0.6);
  };

  window.addEventListener("scroll", toggle, { passive: true });
  toggle();

  btn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  });
}

/* ------------------------------------------------------------------------
 * Scroll progress indicator
 *
 * A thin bar fixed under the navbar showing how far down the page the
 * reader has scrolled. Purely decorative/orientational, disabled for
 * users who prefer reduced motion (no animated width transition).
 * ------------------------------------------------------------------------ */

function initScrollProgress() {
  const bar = document.createElement("div");
  bar.id = "scroll-progress";
  bar.className = "scroll-progress";
  document.body.appendChild(bar);

  const update = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const scrollHeight =
      (doc.scrollHeight || document.body.scrollHeight) - doc.clientHeight;

    const ratio = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

/* ------------------------------------------------------------------------
 * Reveal-on-scroll for project cards / about blocks
 *
 * Adds a subtle fade/rise-in as sections enter the viewport. Skipped
 * entirely for prefers-reduced-motion so nothing animates for users who
 * asked for less motion.
 * ------------------------------------------------------------------------ */

function initRevealOnScroll() {
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  if (!("IntersectionObserver" in window)) return;

  const targets = document.querySelectorAll(
    ".project-card, .about-block, .focus-card",
  );
  if (!targets.length) return;

  targets.forEach((el) => el.classList.add("reveal-target"));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );

  targets.forEach((el) => observer.observe(el));
}

/* ------------------------------------------------------------------------
 * Games page helpers
 * ------------------------------------------------------------------------ */

function initGamesPage() {
  const cards = document.querySelectorAll("[data-game-card]");
  if (!cards.length) return;

  cards.forEach((card) => {
    const button = card.querySelector(".game-play-button");
    if (!button) return;

    button.addEventListener("click", () => {
      card.classList.add("game-card-visited");
    });
  });
}

document.addEventListener("DOMContentLoaded", initGamesPage);

/* ------------------------------------------------------------------------
 * Last updated stamp
 *
 * A small, muted "last updated at HH:MM on DD Mon YYYY" label pinned to
 * the bottom-right corner. It reads the page's real last-modified time via
 * document.lastModified, so the stamp stays current without manual
 * maintenance on every page that loads this script.
 * ------------------------------------------------------------------------ */

function initLastUpdated() {
  const parsed = new Date(document.lastModified || "");
  const date = Number.isNaN(parsed.getTime())
    ? new Date()
    : parsed;

  const pad = (value) => String(value).padStart(2, "0");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const stamp = document.createElement("span");
  stamp.id = "last-updated";
  stamp.textContent =
    `Last updated at ${pad(date.getHours())}:${pad(date.getMinutes())}` +
    ` on ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()}`;

  document.body.appendChild(stamp);
}

/* ------------------------------------------------------------------------
 * Site-wide search (JSON search index + overlay)
 * ------------------------------------------------------------------------ */

function initSiteSearch() {
  let button = document.getElementById("nav-search-btn");
  let overlay = document.getElementById("search-overlay");
  if (!button) {
    const menu = document.getElementById("mobile-menu") || document.querySelector(".mobile-menu");
    if (menu) {
      const item = document.createElement("li");
      item.innerHTML = '<button type="button" class="nav-search-btn" id="nav-search-btn" aria-haspopup="dialog" aria-expanded="false" data-index-url="search-index.json">Search</button>';
      menu.appendChild(item);
      button = item.querySelector("button");
    }
  }
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "search-overlay";
    overlay.className = "search-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Site search");
    overlay.innerHTML = `<div class="search-overlay-panel">
      <label for="search-input">Search the site</label>
      <input id="search-input" type="search" placeholder="Search posts, pages, and projects..." autocomplete="off" />
      <div id="search-results" class="search-results" role="listbox"></div>
      <button type="button" class="search-close" id="search-close">Close</button>
    </div>`;
    document.body.appendChild(overlay);
  }
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const closeBtn = document.getElementById("search-close");
  if (!button || !overlay || !input || !results) return;

  let index = null;
  let visibleHits = [];
  let activeHit = -1;
  let returnFocus = null;
  const indexUrl = button.dataset.indexUrl || "search-index.json";

  async function loadIndex() {
    if (index) return index;
    try {
      const res = await fetch(indexUrl);
      if (!res.ok) throw new Error(`Search index returned HTTP ${res.status}`);
      const data = await res.json();
      index = Array.isArray(data) ? data : [];
    } catch {
      index = [];
    }
    return index;
  }

  function open() {
    returnFocus = document.activeElement;
    overlay.hidden = false;
    button.setAttribute("aria-expanded", "true");
    input.value = "";
    results.innerHTML = '<p class="search-hint">Type to search posts, tags, and projects.</p>';
    visibleHits = [];
    activeHit = -1;
    window.setTimeout(() => input.focus(), 10);
  }

  function close({ restoreFocus = true } = {}) {
    overlay.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus && returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
    returnFocus = null;
  }

  function safeSearchUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin) return "#";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "#";
    }
  }

  function match(entry, term) {
    const haystack = [
      entry.title,
      entry.excerpt,
      entry.tags,
      entry.technologies,
      entry.project,
      entry.page,
      entry.kind,
    ].join(" ").toLowerCase();
    return term.split(/\s+/).every((word) => haystack.includes(word));
  }

  async function render(term) {
    if (term.length < 2) {
      visibleHits = [];
      activeHit = -1;
      results.innerHTML = '<p class="search-hint">Type at least 2 characters.</p>';
      return;
    }
    const entries = await loadIndex();
    const hits = entries.filter((e) => match(e, term)).slice(0, 12);
    visibleHits = hits;
    activeHit = hits.length ? 0 : -1;
    if (!hits.length) {
      results.innerHTML = '<p class="search-hint">No results.</p>';
      return;
    }
    results.innerHTML = hits
      .map(
        (e, index) => `<a href="${escapeHtml(safeSearchUrl(e.url))}" class="search-result${index === activeHit ? " is-active" : ""}" role="option" aria-selected="${index === activeHit}" data-search-hit="${index}">
          <span class="search-result-heading"><span class="search-kind">${escapeHtml(e.kind || "post")}</span><span class="search-result-title">${escapeHtml(e.title)}</span></span>
          <span class="search-result-excerpt">${escapeHtml(e.excerpt || "")}</span>
          <span class="search-result-meta">${escapeHtml(e.page || "")}${e.date ? " · " + escapeHtml(e.date) : ""}${e.project ? " · " + escapeHtml(e.project) : ""}</span>
        </a>`,
      )
      .join("");
  }

  function isVisible() {
    return !overlay.hidden;
  }

  button.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  input.addEventListener("input", () => render(input.value.trim().toLowerCase()));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowDown" && visibleHits.length) {
      event.preventDefault();
      activeHit = (activeHit + 1) % visibleHits.length;
      updateActiveResult();
    }
    if (event.key === "ArrowUp" && visibleHits.length) {
      event.preventDefault();
      activeHit = (activeHit - 1 + visibleHits.length) % visibleHits.length;
      updateActiveResult();
    }
    if (event.key === "Enter" && visibleHits[activeHit]) {
      event.preventDefault();
      const target = safeSearchUrl(visibleHits[activeHit].url);
      if (target !== "#") window.location.href = target;
    }
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isVisible()) close();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      isVisible() ? close() : open();
    }
    if (event.key === "Tab" && isVisible()) {
      const focusable = [input, ...overlay.querySelectorAll('a[href], button:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === "/" && !document.getElementById("devlog-search") && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
      event.preventDefault();
      if (!isVisible()) open();
    }
  });

  function updateActiveResult() {
    results.querySelectorAll("[data-search-hit]").forEach((result, index) => {
      const selected = index === activeHit;
      result.classList.toggle("is-active", selected);
      result.setAttribute("aria-selected", String(selected));
      if (selected) result.scrollIntoView({ block: "nearest" });
    });
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
