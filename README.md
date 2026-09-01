# ahmarius.github.io

This repository keeps the public portfolio as a static GitHub Pages site and adds a separate Devlog system without breaking the original portfolio.

## Portfolio architecture

- `index.html` remains the public landing page for the original portfolio.
- The existing project, games, about, and contact content stays in the original static pages and assets.
- No React or SPA migration is required for the public site.

## Devlog architecture

- Public Devlog entry point: `devlog.html`
- Structured markdown content lives under `content/devlog/`
- Generated static pages are written under `devlog/`
- Styling is shared with the existing portfolio and extended through `assets/css/devlog.css`

## Admin architecture

- Local-only admin UI: `admin/index.html`
- Local Node backend: `admin/server.mjs`
- The admin writes real repository markdown files and runs `node scripts/build-devlog.mjs`
- The admin binds to `127.0.0.1` and is not exposed publicly

## Build process

- `npm run build` generates the static site and devlog pages into `dist/`
- `npm run dev` starts a local static preview on port 4173
- `npm run preview` serves the same static build locally
- `npm run admin` launches the localhost-only content management interface

## GitHub Pages deployment

- The existing Pages workflow remains the deployment mechanism.
- The public site continues to work as static files with no production backend.

## Safe publishing

- The admin determines the specific files to change and only stages relevant Devlog content.
- It does not use destructive Git commands such as `git reset --hard` or `git clean -fd`.
- Auth is resolved via the existing GitHub CLI/SSH setup, not through hardcoded tokens.

## Content notes

The initial Devlog posts are based on real project material already present in this repository, such as `FluidDynamics`, `IronHalo`, and the browser-game work in `games/`.
