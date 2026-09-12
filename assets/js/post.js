document.addEventListener("DOMContentLoaded", () => {
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