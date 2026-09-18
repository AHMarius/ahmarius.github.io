# AH Marius Content Studio

Native Tauri editor for the Markdown content in this repository. It provides
the Pages/Sub-pages/Post tree, autosave recovery, metadata editing, live
Markdown/KaTeX preview, image and video import, PDF text import, project
management, linting, preview builds, and guarded GitHub Pages publishing.

## Run from the repository root

```sh
npm run admin       # build/install on demand and launch
npm run admin:dev   # Vite + Tauri development window
npm run admin:test  # TypeScript/Vite build and Rust tests
```

For a fresh Arch Linux development machine, install Git, Node.js/npm, Rust,
and the Tauri Linux prerequisites (WebKitGTK and the usual build tools). Then
run `npm install` in both the repository root and `admin-app/`.

`./start.sh` creates a release binary at
`admin-app/src-tauri/target/release/ahmarius-content-studio`, copies it to
`bin/ahmarius-content-studio`, and launches it. `--force` forces a rebuild;
`--version` prints the version expected from the current Git state.

The Tauri bundle also contains a `.desktop` entry and icons. A system-wide
bundle can be produced with:

```sh
cd admin-app
npm run tauri build
```

## Editor syntax

The source of truth is always Markdown. Live preview and the public site both
support:

- inline math: `$a^2$` and `\(a^2\)`;
- display math: multiline `$$…$$` and `\[…\]`;
- common KaTeX/AMS environments such as `equation`, `align`, `gather`,
  `multline`, `split`, `cases`, and matrices;
- convenience macros `\RR`, `\NN`, `\ZZ`, `\QQ`, and `\CC`;
- pasted/imported images, local MP4/WebM/Ogg video, direct HTTPS video, and
  privacy-enhanced YouTube or Vimeo embeds.

KaTeX intentionally implements mathematical LaTeX rather than the entire TeX
document language. Unsupported document-level commands remain visible as a
rendering error instead of breaking the editor or site build.

## Publish guarantees

Publish performs a local lint/test/production-build preflight and leak check,
then pauses on the final generated file list and diff. Only allowlisted content
and generated output are committed. Source is fast-forwarded to `main`; the
sanitized `dist/` tree is deployed separately to `gh-pages` from a disposable
checkout.

The deployer rejects dirty source or public assets that could make `gh-pages`
differ from the source commit. It also rejects draft leakage, unexpected
private paths, symlinks, non-fast-forward updates, and pre-existing staged
files. It never force-pushes or resets/cleans the working tree.
