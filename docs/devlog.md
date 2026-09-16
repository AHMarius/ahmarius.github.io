# Devlog architecture

The public Devlog is a static site generated from the **same canonical content
that the Admin App writes**: Markdown posts with YAML frontmatter stored under

```text
content/pages/<page-slug>/posts/<post-slug>.md
```

- The Devlog aggregates **all published posts across every page** in
  `content/pages/**/posts/*.md` (e.g. `fluid-dynamics`, `projects`, `game`, …).
- `devlog.html` is the public landing page (root level).
- `devlog/index.html` is a nested copy used when the site is served from
  `/devlog/`.
- Individual posts are generated into `devlog/<slug>.html`.
- Draft/unpublished posts never appear in the public Devlog.
- Future-dated `publishAt` posts remain private in both Devlog and Page-hub
  output until their date.
- Styling is shared with the portfolio using `assets/css/style.css` and
  `assets/css/devlog.css`.
- Filters are powered by `assets/js/devlog.js`.

## Build

The canonical build lives at `scripts/build-site.mjs` (`npm run build`), which:

1. Copies KaTeX assets.
2. Runs `scripts/build-devlog.mjs` (aggregates published posts from
   `content/pages` and renders `devlog.html` + `devlog/*.html`).
3. Runs `scripts/build-pages.mjs` (renders the Pages hierarchy under
   `pages.html` + `pages/*.html`).
4. Recreates generated tag, technology, and project archive directories, so
   deleted or renamed metadata cannot leave stale public archive URLs.
5. In publish mode, creates an allowlisted `dist/` snapshot for `gh-pages`.

Both the Devlog and the Pages system consume the same post parser and same
content source, so a post published from the Admin App appears automatically
on the Devlog with no manual copying.

The build tests create their own temporary content page and remove it at suite
exit. Tests therefore do not rely on—or restore—any real post, and deleting the
last user page cannot make the Publish preflight fail.

## Legacy `content/devlog/`

`scripts/build-devlog.mjs` still reads any Markdown files left under the old
`content/devlog/` directory as a compatibility shim, but all new content should
be created under `content/pages/<page>/posts/`. The legacy location is not a
second source of truth for the Admin App.
