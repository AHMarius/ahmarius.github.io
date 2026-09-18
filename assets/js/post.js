document.addEventListener("DOMContentLoaded", () => {
  // Build the on-page table of contents (>=3 headings) client-side so the
  // site builds as plain Jekyll with no custom plugins (GitHub Pages-safe).
  const article = document.querySelector(".devlog-article, .page-body");
  if (article) {
    const headings = [...article.querySelectorAll("h2, h3")];
    headings.forEach((heading, index) => {
      if (heading.id) return;
      const base = (heading.textContent || "section")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `section-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (document.getElementById(id)) id = `${base}-${suffix++}`;
      heading.id = id;
    });
    if (headings.length >= 3 && !article.querySelector(".post-toc")) {
      const items = headings
        .map((heading) => {
          const level = heading.tagName === "H3" ? 3 : 2;
          return `<li class="post-toc-l${level}"><a href="#${heading.id}">${heading.textContent.trim()}</a></li>`;
        })
        .join("\n");
      const nav = document.createElement("nav");
      nav.className = "post-toc";
      nav.setAttribute("aria-label", "Table of contents");
      nav.innerHTML = `<span class="post-toc-title">On this page</span>\n<ul>${items}</ul>`;
      article.prepend(nav);
    }

    // Every section can be linked directly without cluttering the heading at
    // rest. This is especially handy when sharing a precise implementation
    // detail from a long devlog entry.
    headings.forEach((heading) => {
      if (!heading.id || heading.querySelector(".heading-anchor")) return;
      const anchor = document.createElement("a");
      anchor.className = "heading-anchor";
      anchor.href = `#${heading.id}`;
      anchor.setAttribute("aria-label", `Link to ${heading.textContent.trim()}`);
      anchor.textContent = "#";
      heading.appendChild(anchor);
    });
  }

  // Share buttons use the Web Share API when available, falling back to a
  // clipboard copy with a transient acknowledgement.
  document.querySelectorAll(".devlog-share").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = button.dataset.url || location.href;
      const href = new URL(url, location.href).href;
      const title = document.title || document.querySelector("h1")?.textContent || "";
      if (navigator.share) {
        try {
          await navigator.share({ title, url: href });
          return;
        } catch {
          // aborted/cancelled by the user
        }
      }
      try {
        await navigator.clipboard.writeText(href);
        const original = button.textContent;
        button.textContent = "Copied!";
        button.classList.add("is-copied");
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove("is-copied");
        }, 1600);
      } catch {
        window.prompt("Copy this link:", href);
      }
    });
  });

  document.querySelectorAll(".post-print").forEach((button) => {
    button.addEventListener("click", () => window.print());
  });

  // Scroll-spy for the on-page table of contents, highlighting the section
  // currently in view.
  const tocLinks = [...document.querySelectorAll(".post-toc a")];
  if (tocLinks.length) {
    const targets = tocLinks
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);
    let current = -1;
    const update = () => {
      const scrollY = window.scrollY;
      let active = -1;
      targets.forEach((target, idx) => {
        if (target.offsetTop - 160 <= scrollY) active = idx;
      });
      if (active !== current) {
        current = active;
        tocLinks.forEach((link, idx) => {
          link.classList.toggle("is-active", idx === active);
        });
      }
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
  }


  const progress = document.querySelector(".reading-progress span");

  let ticking = false;
  const updateReadingPosition = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (progress) progress.style.width = `${ratio * 100}%`;
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(updateReadingPosition);
      ticking = true;
    }
  }, { passive: true });
  updateReadingPosition();
});
