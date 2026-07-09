// script.js
// Handles navigation between the different sections of the CV website.

document.addEventListener("DOMContentLoaded", () => {
    const buttons = {
        projects: document.getElementById("btn-projects"),
                          cv: document.getElementById("btn-cv"),
                          about: document.getElementById("btn-about"),
    };

    buttons.projects.addEventListener("click", () => {
        goToSection("projects");
    });

    buttons.cv.addEventListener("click", () => {
        goToSection("cv");
    });

    buttons.about.addEventListener("click", () => {
        goToSection("about");
    });
});

function goToSection(section) {
    switch (section) {
        case "projects":
            window.location.href = "projects.html";
            break;

        case "cv":
            window.location.href = "cv.html";
            break;

        case "about":
            window.location.href = "about.html";
            break;

        default:
            console.warn(`Unknown section: ${section}`);
    }
}
/* ==========================================================================
 *  script.js
 *  Powers projects.html:
 *    1. Hamburger menu toggle
 *    2. Link buttons (data-url) that open in a new tab, replacing raw <a> links
 *    3. Auto-populated image galleries, read from a per-project folder
 *  ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initHamburgerMenu();
    initLinkButtons();
    initGalleries();
});

/* ------------------------------------------------------------------------
 *  1. Hamburger menu
 *  ------------------------------------------------------------------------ */
function initHamburgerMenu() {
    const btn = document.getElementById("hamburger-btn");
    const menu = document.getElementById("mobile-menu");
    if (!btn || !menu) return;

    btn.addEventListener("click", () => {
        const isOpen = !menu.hidden;

        if (isOpen) {
            menu.hidden = true;
            btn.setAttribute("aria-expanded", "false");
            btn.classList.remove("is-open");
        } else {
            menu.hidden = false;
            btn.setAttribute("aria-expanded", "true");
            btn.classList.add("is-open");
        }
    });

    // Close menu when a link inside it is clicked (nice on mobile)
    menu.addEventListener("click", (e) => {
        if (e.target.tagName === "A") {
            menu.hidden = true;
            btn.setAttribute("aria-expanded", "false");
            btn.classList.remove("is-open");
        }
    });
}

/* ------------------------------------------------------------------------
 *  2. Link buttons — every <button class="link-btn" data-url="..."> opens
 *     its target in a new tab, same behaviour the old <a target="_blank">
 *     links had, just rendered as buttons instead of inline links.
 *  ------------------------------------------------------------------------ */
function initLinkButtons() {
    document.querySelectorAll(".link-btn[data-url]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const url = btn.getAttribute("data-url");
            if (url) window.open(url, "_blank", "noopener,noreferrer");
        });
    });
}

/* ------------------------------------------------------------------------
 *  3. Galleries
 *  ------------------------------------------------------------------------
 *  Each <article class="project-card"> carries a data-gallery-folder
 *  attribute pointing at a folder of images, e.g. "images/snek".
 *  Inside that folder, a card looks for an "manifest.json" file first
 *  (a simple JSON array of filenames) and falls back to parsing a
 *  directory listing if the folder is served with autoindex enabled
 *  (e.g. `python -m http.server`).
 *
 *  manifest.json example (place inside images/snek/manifest.json):
 *    ["screenshot1.jpg", "screenshot2.jpeg"]
 *
 *  This keeps things working whether or not the server exposes directory
 *  listings.
 *  ------------------------------------------------------------------------ */

const IMAGE_EXTENSIONS = ["jpg", "jpeg"];

function initGalleries() {
    document.querySelectorAll(".project-card[data-gallery-folder]").forEach((card) => {
        const folder = card.getAttribute("data-gallery-folder");
        const galleryEl = card.querySelector("[data-gallery]");
        if (!folder || !galleryEl) return;

        loadGalleryImages(folder, galleryEl);
    });
}

async function loadGalleryImages(folder, galleryEl) {
    const normalizedFolder = folder.endsWith("/") ? folder : folder + "/";

    // Try manifest.json first
    try {
        const manifestUrl = normalizedFolder + "manifest.json";
        const res = await fetch(manifestUrl);
        if (res.ok) {
            const filenames = await res.json();
            renderGallery(galleryEl, normalizedFolder, filenames);
            return;
        }
    } catch (err) {
        // no manifest, fall through to directory listing attempt
    }

    // Fallback: try to parse a directory listing (works with autoindex servers)
    try {
        const res = await fetch(normalizedFolder);
        if (!res.ok) throw new Error("Folder not accessible: " + normalizedFolder);

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const links = Array.from(doc.querySelectorAll("a"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => href && IMAGE_EXTENSIONS.some((ext) => href.toLowerCase().endsWith("." + ext)));

        if (links.length) {
            renderGallery(galleryEl, normalizedFolder, links);
        } else {
            markGalleryEmpty(galleryEl);
        }
    } catch (err) {
        markGalleryEmpty(galleryEl);
    }
}

function renderGallery(galleryEl, folder, filenames) {
    galleryEl.innerHTML = "";
    if (!filenames || !filenames.length) {
        markGalleryEmpty(galleryEl);
        return;
    }

    filenames.forEach((filename) => {
        const img = document.createElement("img");
        img.src = folder + filename;
        img.alt = filename;
        img.loading = "lazy";
        img.className = "gallery-image";
        galleryEl.appendChild(img);
    });
}

function markGalleryEmpty(galleryEl) {
    galleryEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "gallery-empty-note";
    note.textContent = "Images unavailable";
    galleryEl.appendChild(note);
}
