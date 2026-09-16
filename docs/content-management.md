# Content management

Content lives under `content/pages/<page-slug>/posts/<post-slug>.md` and is
stored as Markdown with YAML frontmatter. Each page directory has a `page.yml`.

Example post:

```yaml
---
title: "Project note"
slug: "project-note"
date: "2026-08-25"
status: "published"
page: "fluid-dynamics"
project: "FluidDynamics"
technologies:
  - C++
  - Graphics
tags:
  - Optimization
publishAt: "2026-09-20"
comments: true
---
```

Only posts whose `status` is `published` are shown publicly (Devlog and Pages).
When `publishAt` is a future date, the post remains private in production
builds until that date. Because deployment is local, run **Publish** on or
after the date to put the newly eligible post online. Set `comments: false` to
disable the post's giscus thread.

The post editor includes a live editorial panel for word count, reading time,
metadata length, structure, tags, covers, and image alt text. Use
**Ctrl/Cmd+Shift+K** to open the command palette from anywhere in Content
Studio.

## Math and media

Live preview and generated pages use the same KaTeX conventions:

- inline: `$a^2+b^2=c^2$` or `\(a^2+b^2=c^2\)`;
- display: `$$…$$` or `\[…\]`, including multiline expressions;
- AMS-style display environments including `equation`, `align`, `gather`,
  `multline`, `split`, `cases`, and matrix variants;
- convenience macros `\RR`, `\NN`, `\ZZ`, `\QQ`, and `\CC`.

Math inside inline/fenced code stays literal, and ordinary currency such as
`$5 and $10` is not interpreted as an equation. KaTeX covers mathematical
LaTeX, not document-level TeX commands; an unsupported command is shown as a
visible math error without aborting the build.

Picking, pasting, or dropping media copies it into the post asset directory.
Imported MP4/WebM/Ogg files are inserted as responsive video rather than image
Markdown. The Video toolbar action also accepts direct HTTPS video URLs and
YouTube/Vimeo links; those become responsive embeds. Repository-hosted video
should remain small because Git and GitHub Pages are not video CDNs.

The Admin App (in `admin-app/`) edits these files and publishes through the
canonical local build followed by a source push to `main` and a static snapshot push to `gh-pages`. GitHub Actions is not used.

The legacy `admin/` browser app and the `content/devlog/` directory are kept
only as a compatibility shim for older content; new posts should always be
created under `content/pages/`.
