document.addEventListener("DOMContentLoaded", () => {
  // Build the on-page table of contents (>=3 headings) client-side so the
  // site builds as plain Jekyll with no custom plugins (GitHub Pages-safe).
  const article = document.querySelector(".devlog-article, .page-body");
  if (article) {
    const headings = [...article.querySelectorAll("h2, h3")];
    if (headings.length >= 3) {
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
});