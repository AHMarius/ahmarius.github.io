# ahmarius.github.io

Static portfolio, hierarchical Pages/Devlog publishing system, and the native
AH Marius Content Studio used to edit it.

## Common commands

```sh
npm test                 # lint + site/build tests
npm run build -- --mode publish
npm run dev              # local static preview
npm run admin            # build/install if needed, then launch Content Studio
npm run admin:dev        # Tauri + Vite development mode
npm run admin:test       # frontend build + Rust test suite
```

Node.js/npm, Git, and Rust/Cargo are required for Content Studio development.
The launcher prints a clear error when one is missing. On Arch Linux, run
`./start.sh`; it builds the current Tauri binary into `bin/` and launches it.

## Content and generated output

- Canonical posts are Markdown with YAML frontmatter under
  `content/pages/<page>/posts/`.
- Pages and sub-pages each have a `page.yml`; nesting uses `subpages/`.
- `scripts/build-site.mjs` generates Devlog, Page hubs, feeds, search, social
  cards, project output, and the sanitized `dist/` snapshot.
- Preview builds may show drafts. Publish builds omit drafts and future
  scheduled posts, then run the draft-leak check.

The editor accepts inline and display KaTeX using `$…$`, `\(…\)`, `$$…$$`,
`\[…\]`, and common AMS display environments. Images and videos are stored as
post-local assets; direct video URLs plus YouTube/Vimeo embeds are supported.

## Publishing architecture

Content Studio is a local Tauri application, not a public admin server. Its
Publish flow saves the editor, lints, runs the complete test suite, performs a
production build, shows the post-build file list/diff, and stages only
allowlisted content and generated paths. It pushes that source commit to
`main`, then copies only `dist/` into a disposable `gh-pages` checkout.

Deployment refuses non-fast-forward source updates, private paths or symlinks
inside `dist/`, and snapshots influenced by uncommitted site inputs. It never
force-pushes, switches the source checkout, or cleans the working tree. GitHub
credentials remain in the system Git/GitHub CLI credential store.

See [content management](docs/content-management.md), [publishing](docs/publish-workflow.md),
and [security](docs/security.md) for operational details.
