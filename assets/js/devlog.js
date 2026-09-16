document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".devlog-grid");
  const cards = [...document.querySelectorAll(".devlog-card")];
  if (!grid || !cards.length) return;

  const controls = {
    search: document.querySelector("#devlog-search"),
    tag: document.querySelector("#devlog-tag"),
    tech: document.querySelector("#devlog-tech"),
    project: document.querySelector("#devlog-project"),
    status: document.querySelector("#devlog-status"),
    sort: document.querySelector("#devlog-sort"),
  };
  const emptyState = document.querySelector("#devlog-empty");
  const count = document.querySelector("#devlog-count");
  const reset = document.querySelector("#devlog-reset");
  const view = document.querySelector("#devlog-view");
  const params = new URLSearchParams(location.search);

  function setIfAvailable(control, value) {
    if (!control || !value) return;
    if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === value)) {
      control.value = value;
    }
  }

  setIfAvailable(controls.search, params.get("q"));
  setIfAvailable(controls.tag, params.get("tag"));
  setIfAvailable(controls.tech, params.get("tech"));
  setIfAvailable(controls.project, params.get("project"));
  setIfAvailable(controls.status, params.get("status"));
  setIfAvailable(controls.sort, params.get("sort"));

  const savedView = localStorage.getItem("devlog-view");
  if (savedView === "list") grid.classList.add("is-list");

  function updateViewButton() {
    if (!view) return;
    const list = grid.classList.contains("is-list");
    view.setAttribute("aria-pressed", String(list));
    view.innerHTML = list ? "▦ <span>Grid</span>" : "☷ <span>List</span>";
    view.title = list ? "Use card grid" : "Use compact list";
  }

  function compareCards(a, b) {
    const sort = controls.sort?.value || "newest";
    const dateA = Date.parse(a.dataset.date || "") || 0;
    const dateB = Date.parse(b.dataset.date || "") || 0;
    const minutesA = Number(a.dataset.minutes || 0);
    const minutesB = Number(b.dataset.minutes || 0);
    if (sort === "oldest") return dateA - dateB;
    if (sort === "shortest") return minutesA - minutesB || dateB - dateA;
    if (sort === "longest") return minutesB - minutesA || dateB - dateA;
    return dateB - dateA;
  }

  function syncUrl() {
    const next = new URL(location.href);
    const values = {
      q: controls.search?.value.trim() || "",
      tag: controls.tag?.value || "all",
      tech: controls.tech?.value || "all",
      project: controls.project?.value || "all",
      status: controls.status?.value || "all",
      sort: controls.sort?.value || "newest",
    };
    Object.entries(values).forEach(([key, value]) => {
      const defaultValue = key === "q" ? "" : key === "sort" ? "newest" : "all";
      if (value === defaultValue) next.searchParams.delete(key);
      else next.searchParams.set(key, value);
    });
    history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
  }

  function applyFilters() {
    const term = (controls.search?.value || "").trim().toLowerCase();
    const tagValue = controls.tag?.value || "all";
    const technologyValue = controls.tech?.value || "all";
    const projectValue = controls.project?.value || "all";
    const statusValue = controls.status?.value || "all";
    let visibleCount = 0;

    cards.sort(compareCards).forEach((card) => {
      const text = (card.dataset.search || "").toLowerCase();
      const tags = (card.dataset.tags || "").split(" ");
      const technologies = (card.dataset.technologies || "").split(" ");
      const visible =
        (!term || text.includes(term)) &&
        (tagValue === "all" || tags.includes(tagValue)) &&
        (technologyValue === "all" || technologies.includes(technologyValue)) &&
        (projectValue === "all" || card.dataset.project === projectValue) &&
        (statusValue === "all" || (card.dataset.status || "published") === statusValue);
      card.hidden = !visible;
      grid.appendChild(card);
      if (visible) visibleCount += 1;
    });

    if (count) count.textContent = `${visibleCount} of ${cards.length} ${cards.length === 1 ? "note" : "notes"}`;
    emptyState?.classList.toggle("is-visible", visibleCount === 0);
    reset?.toggleAttribute("disabled", visibleCount === cards.length && !term);
    syncUrl();
  }

  Object.values(controls).forEach((control) => {
    control?.addEventListener("input", applyFilters);
    control?.addEventListener("change", applyFilters);
  });

  reset?.addEventListener("click", () => {
    if (controls.search) controls.search.value = "";
    [controls.tag, controls.tech, controls.project, controls.status].forEach((control) => {
      if (control) control.value = "all";
    });
    if (controls.sort) controls.sort.value = "newest";
    applyFilters();
    controls.search?.focus();
  });

  view?.addEventListener("click", () => {
    grid.classList.toggle("is-list");
    localStorage.setItem("devlog-view", grid.classList.contains("is-list") ? "list" : "grid");
    updateViewButton();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) {
      event.preventDefault();
      controls.search?.focus();
    }
  });

  document.querySelectorAll(".devlog-share").forEach((button) => {
    button.addEventListener("click", async () => {
      const href = new URL(button.dataset.url || location.href, location.href).href;
      const title = button.closest(".devlog-card")?.querySelector("h3")?.textContent?.trim() || document.title;
      try {
        if (navigator.share) await navigator.share({ title, url: href });
        else await navigator.clipboard.writeText(href);
        const original = button.textContent;
        button.textContent = navigator.share ? "Shared" : "Copied";
        button.classList.add("is-copied");
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove("is-copied");
        }, 1400);
      } catch (error) {
        if (error?.name !== "AbortError") window.prompt("Copy this link:", href);
      }
    });
  });

  updateViewButton();
  applyFilters();
});
