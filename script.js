document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initHamburgerMenu();
    initLinkButtons();
    initGalleries();
});

/* ------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------ */

function initNavigation() {
    const pages = {
        "btn-projects": "projects.html",
        "btn-cv": "cv.html",
        "btn-about": "about.html"
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
    document.querySelectorAll(".project-card[data-gallery-folder]").forEach((card) => {
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
        .map(a => a.getAttribute("href"))
        .filter(file =>
        file &&
        IMAGE_EXTENSIONS.some(ext =>
        file.toLowerCase().endsWith("." + ext)
        )
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

    files.forEach(file => {
        const img = document.createElement("img");
        img.src = folder + file;
        img.alt = file;
        img.loading = "lazy";
        img.className = "gallery-image";
        gallery.appendChild(img);
    });
}

function markGalleryEmpty(gallery) {
    gallery.innerHTML = "<p class=\"gallery-empty-note\">Images unavailable</p>";
}