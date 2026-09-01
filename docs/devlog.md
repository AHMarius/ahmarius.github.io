# Devlog architecture

The public Devlog is a static page built from Markdown files in `content/devlog/`.

- `devlog.html` is the public landing page.
- Individual posts are generated into `devlog/*.html`.
- Styling is shared with the portfolio using `assets/css/style.css` and `assets/css/devlog.css`.
- Filters are powered by `assets/js/devlog.js`.
