# AH Marius Content Studio

Native Tauri editor for the canonical Markdown and YAML content in this repository.

## Requirements

- Node.js 22.12 or newer and npm
- Rust stable with Cargo
- Tauri's Linux system dependencies
- Git; GitHub CLI (`gh`) is recommended for browser sign-in
- Optional: `pdftotext` for PDF import, Pandoc for PDF/DOCX export, and a desktop screenshot utility

On Arch Linux, install the base toolchain with:

```sh
sudo pacman -S --needed base-devel git nodejs npm rust webkit2gtk-4.1 libappindicator-gtk3 librsvg
```

## Develop and test

```sh
cd admin-app
npm ci
npm test
cd src-tauri
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

`npm test` type-checks and produces the frontend bundle. Rust tests cover repository paths, content CRUD, hierarchy, trash/restore, Git staging/deployment, imports, exports, and lint behavior.

## Package and install

From the repository root:

```sh
./start.sh --install
```

This uses the lockfile, builds Tauri's configured bundles, installs the binary to `~/.local/bin`, and installs the desktop entry and icon under the XDG user data directory. Run `./start.sh` to rebuild when the app version changes and launch it. Set `AHMARIUS_BIN` to choose a different binary path.

## Troubleshooting

- If the repository is not detected, open Settings and select the repository root containing `package.json`, `content/`, and `assets/`.
- If publishing cannot authenticate, install `gh`, use **Sign in with GitHub**, and verify that `git remote -v` points at the expected repository.
- If a build fails, run `npm test` at the repository root first; Publish uses the same lint/build gate.
- If PDF import or export reports a missing program, install `poppler` (`pdftotext`) or `pandoc` respectively.
- Phone Sync requires a deployed gateway described in [`../sync-service/README.md`](../sync-service/README.md).
