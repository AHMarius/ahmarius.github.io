document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initHamburgerMenu();
    initLinkButtons();
    initGalleries();
    initProjectAvatars();
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
    gallery.innerHTML = "<p class=\"gallery-empty-note\">Images unavailable</p>";
}
function initProjectAvatars() {

    const root = getComputedStyle(document.documentElement);

    function solidColor(variable) {
        const value = root.getPropertyValue(variable).trim();

        // rgba(...) -> rgb(...)
        if (value.startsWith("rgba")) {
            const parts = value
                .replace("rgba(", "")
                .replace(")", "")
                .split(",");

            return `rgb(${parts[0].trim()}, ${parts[1].trim()}, ${parts[2].trim()})`;
        }

        return value;
    }

    const colors = {
        lang: solidColor("--tag-lang-bg"),
        tool: solidColor("--tag-tool-bg"),
        type: solidColor("--tag-type-bg"),
        concept: solidColor("--tag-concept-bg"),
        misc: solidColor("--tag-misc-bg")
    };

    const categories = {

        lang: [
            "tag-csharp","tag-java","tag-cpp",
            "tag-kotlin","tag-python","tag-vhdl"
        ],

        tool: [
            "tag-unity","tag-raylib","tag-sdl","tag-oracle",
            "tag-database","tag-sqlite","tag-android",
            "tag-mobile","tag-vivado","tag-fpga",
            "tag-basys3","tag-digital-logic",
            "tag-osm","tag-api","tag-db","tag-easybmp"
        ],

        type: [
            "tag-singleplayer","tag-multiplayer","tag-team",
            "tag-server-client","tag-server","tag-game",
            "tag-game-engine","tag-game-dev","tag-oop",
            "tag-design-patterns","tag-scene-management",
            "tag-save-system","tag-shaders","tag-cli",
            "tag-ipc","tag-parallel",
            "tag-database-application"
        ],

        concept: [
            "tag-physics","tag-2d","tag-collisions",
            "tag-graphics","tag-simulation","tag-ai",
            "tag-aco","tag-genetic","tag-graphs",
            "tag-optimization","tag-routing",
            "tag-research","tag-fluid-dynamics",
            "tag-graphing","tag-uml",
            "tag-software-engineering","tag-erasmus"
        ]
    };

    document.querySelectorAll(".project-card").forEach(card => {

        const counts = {
            lang: 0,
            tool: 0,
            type: 0,
            concept: 0,
            misc: 0
        };

        card.querySelectorAll(".tag-bubble").forEach(tag => {

            let matched = false;

            for (const category in categories) {

                if (categories[category].some(cls => tag.classList.contains(cls))) {
                    counts[category]++;
                    matched = true;
                    break;
                }
            }

            if (!matched)
                counts.misc++;
        });

        const total = Object.values(counts).reduce((a,b)=>a+b,0);

        if (total === 0)
            return;

        let angle = 0;
        const slices = [];

        Object.entries(counts).forEach(([category,count]) => {

            if (count === 0)
                return;

            const start = angle;
            angle += (count / total) * 360;

            slices.push(
                `${colors[category]} ${start}deg ${angle}deg`
            );

        });

        const avatar = card.querySelector(".card-avatar");

        if (!avatar)
            return;

        avatar.style.background = `conic-gradient(${slices.join(",")})`;

        avatar.style.border = "2px solid rgba(255,255,255,.35)";
        avatar.style.boxShadow =
            "0 4px 12px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.25)";
    });

}