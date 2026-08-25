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
  const theme = storedTheme === "dark" ? "dark" : "light";

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

  btn.addEventListener("click", () => {
    const open = !menu.hidden;

    menu.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    btn.classList.toggle("is-open", !open);
  });

  menu.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.classList.remove("is-open");
    }
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

const IMAGE_EXTENSIONS = ["jpg", "jpeg"];

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
      renderGallery(gallery, base, files);
      return;
    }
  } catch {}

  try {
    const res = await fetch(base);

    if (!res.ok) throw new Error();

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    const files = Array.from(doc.querySelectorAll("a"))
      .map((a) => a.getAttribute("href"))
      .filter(
        (file) =>
          file &&
          IMAGE_EXTENSIONS.some((ext) =>
            file.toLowerCase().endsWith("." + ext),
          ),
      );

    renderGallery(gallery, base, files);
  } catch {
    markGalleryEmpty(gallery);
  }
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

  function show(index) {
    current = (index + files.length) % files.length;
    const file = files[current];
    img.src = folder + file;
    img.alt = file;
    counter.textContent = `${current + 1} / ${files.length}`;
  }

  prevBtn.addEventListener("click", () => show(current - 1));
  nextBtn.addEventListener("click", () => show(current + 1));

  gallery.appendChild(prevBtn);
  gallery.appendChild(viewport);
  gallery.appendChild(nextBtn);
  gallery.appendChild(counter);

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

  console.log("countEl:", countEl);
  console.log("statusEl:", statusEl);

  if (!countEl || !statusEl) {
    console.error("Elements not found.");
    return;
  }

  try {
    const res = await fetch("https://api.github.com/users/ahmarius");
    console.log("Status:", res.status);

    const data = await res.json();
    console.log("Response:", data);
    console.log("public_repos:", data.public_repos);

    countEl.textContent = data.public_repos;
    statusEl.textContent = "live from GitHub";
  } catch (err) {
    console.error("GitHub error:", err);

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
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", "false");

    const title = card.querySelector(".project-title");
    if (title) {
      card.setAttribute(
        "aria-label",
        `Expand project: ${title.textContent.trim()}`,
      );
    }

    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        const open = card.classList.toggle("keyboard-open");
        card.setAttribute("aria-expanded", String(open));
      }
    });
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
