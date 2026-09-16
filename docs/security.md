# Security

Security posture for `ahmarius.github.io` and the Admin App (`admin-app/`).

## The deployed site

The published site is **fully static** (GitHub Pages). There is no server-side
code, no database, no cookies, and no user-submitted form handling.

- **No secrets** are ever committed. The repository contains no API keys,
  tokens, or credentials.
- **Dependencies.** A tiny set of pinned `devDependencies`
  (`gray-matter`, `marked`, `katex`) — runtime is zero-dep.
- **Draft safety.** Content whose `status` is `draft` is never emitted by the
  publish build. `scripts/check-leaks.mjs` fails CI if a draft slug appears in
  any published artifact (`devlog/`, `pages/`, `search-index.json`,
  `feed.xml`, `sitemap.xml`).
- **Third-party widgets** (analytics, comments) are configured at the site
  level via `assets/js/script.js` or `_studio-config` equivalents; none embed
  remote executable scripts into the head during publish.

## The Admin App (Tauri, `admin-app/`)

The Admin App is a local-only desktop tool. It manages the site repository and
publishes through the local Git CLI.

### CSP

The webview enforces a strict Content-Security-Policy in
`src-tauri/tauri.conf.json`:

```
default-src 'self' ipc: http://ipc.localhost;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' data: blob: https:;
frame-src https://www.youtube-nocookie.com https://player.vimeo.com;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost https:;
object-src 'none'; base-uri 'self'; form-action 'self'
```

Notes:

- `script-src 'self'` — no inline JS, no remote scripts. The only inline
  content in `index.html` is a tiny `<style>` block (hence
  `style-src 'unsafe-inline'`).
- `img-src data:` — the app previews cover art by reading files from the repo
  and returning them as base64 `data:` URIs (`read_repo_file`).
- `media-src` and `frame-src` allow post video preview. Frames are restricted
  to privacy-enhanced YouTube and Vimeo players; arbitrary remote frames and
  scripts remain blocked. Post-local media is returned through the constrained
  `read_post_asset` command as a data URI (with a 15 MiB preview limit).
- The Tauri IPC (`invoke`) uses the `ipc:`/`http://ipc.localhost` scheme, so it
  is allowed in `default-src`/`connect-src`.
- Outbound connections are HTTPS-only so the desktop and Android Phone Sync
  editor can reach its configured gateway without permitting clear-text
  internet traffic. The sync client separately rejects non-HTTPS URLs except
  localhost during development.

### Capabilities / OS shell access

`src-tauri/capabilities/default.json` limits the window to:

- `core:default`, `dialog:default`, `opener:default`
- `shell:allow-open` (opening the GitHub device-flow URL in the external
  browser)
- `fs:scope` with `{ "path": "**" }` — required because the app edits an
  arbitrary user-chosen repository location.

There is **no** `shell:allow-execute`. The app never spawns arbitrary user
input as a command; the only processes it runs are fixed tool invocations
(`git`, `gh`, `npm`, `pandoc`) with repository paths validated by
`resolve_in_repo` (rejects absolute paths, `..`, and symlink escapes).

### Secrets handling

- **No tokens are stored by the app.** GitHub authentication delegates to the
  system `gh` CLI, which stores credentials in the OS keyring (never in the
  repo or the app's own files).
- `Preferences` (`repo_path`, theme, window state, umami/giscus/deploy-hook
  URLs) are written to the user's config directory
  (`~/.config/ahmarius-content-studio/prefs.json`) — **not** inside the repo.
  Deploy-hook / analytics values are public configuration, not secrets.
- Repository content edited by the app is committed by the user/publisher via
  Git; no credentials are embedded in content.

### File & path safety

- Every path from the UI is validated with `resolve_in_repo` before any
  read/write; symlink escapes are rejected.
- Slug validation (`ensure_safe_slug`) rejects `.`/`..`, path separators,
  and non-`[a-z0-9_-]` characters, so post/page slugs cannot climb out of the
  content tree.
- Imported files are written under the post's own `assets/` directory.

### Recovery / autosave

- Editor recovery snapshots are stored under the app config dir, never inside
  the repository.
- Recovery data is plain text Markdown; treat the config dir as private to the
  current OS user.

## Publishing

GitHub Actions is not used. Content Studio builds and validates locally, pushes
canonical source to `main`, and pushes only the sanitized `dist/` snapshot
to `gh-pages`. Deployment uses a disposable clone so it cannot switch, clean,
or overwrite the source checkout. The publish command rejects non-fast-forward
updates to `main`, unexpected private paths in `dist/`, and symlinks in the
public snapshot. It also refuses to deploy when an uncommitted content file,
build input, generated page, or public asset could make the snapshot differ
from the source commit. The user reviews the post-build allowlist and diff
before the commit is created.

## Threat model / non-goals

- **Not** a multi-user service: no auth surface, no remote API of our own.
- Malicious repository content: the site renders Markdown client-side; the
  published output is static HTML generated from that Markdown. We do not
  promise sanitization against *every conceivable* Markdown payload — see
  `docs/content-management.md` for the supported subset.
- The Admin App is a repository-editing tool; standard caution applies: only
  open repositories you trust, since the app will run `git`/`gh`/`npm`
  operations against the configured path.
