document.addEventListener("DOMContentLoaded", () => {
  const cards = [...document.querySelectorAll(".devlog-card")];
  if (!cards.length) return;

  const searchInput = document.querySelector("#devlog-search");
  const tagSelect = document.querySelector("#devlog-tag");
  const techSelect = document.querySelector("#devlog-tech");
  const projectSelect = document.querySelector("#devlog-project");
  const statusSelect = document.querySelector("#devlog-status");
  const emptyState = document.querySelector("#devlog-empty");

  function applyFilters() {
    const term = (searchInput?.value || "").trim().toLowerCase();
    const tagValue = tagSelect?.value || "all";
    const technologyValue = techSelect?.value || "all";
    const projectValue = projectSelect?.value || "all";
    const statusValue = statusSelect?.value || "all";

    let visibleCount = 0;

    cards.forEach((card) => {
      const text = (card.dataset.search || "").toLowerCase();
      const tags = (card.dataset.tags || "").split(" ");
      const technologies = (card.dataset.technologies || "").split(" ");
      const project = card.dataset.project || "";
      const status = card.dataset.status || "published";

      const matchesSearch = !term || text.includes(term);
      const matchesTag = tagValue === "all" || tags.includes(tagValue);
      const matchesTech = technologyValue === "all" || technologies.includes(technologyValue);
      const matchesProject = projectValue === "all" || project === projectValue;
      const matchesStatus = statusValue === "all" || status === statusValue;

      const visible = matchesSearch && matchesTag && matchesTech && matchesProject && matchesStatus;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (emptyState) {
      emptyState.classList.toggle("is-visible", visibleCount === 0);
    }
  }

  [searchInput, tagSelect, techSelect, projectSelect, statusSelect].forEach((control) => {
    if (control) {
      control.addEventListener("input", applyFilters);
      control.addEventListener("change", applyFilters);
    }
  });

  applyFilters();
});
