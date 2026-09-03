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
---
```

Only posts whose `status` is `published` are shown publicly (Devlog and Pages).

The Admin App (in `admin-app/`) edits these files and publishes through the
canonical build (`npm run build`) followed by `git add`/`git commit`/`git push`.

The legacy `admin/` browser app and the `content/devlog/` directory are kept
only as a compatibility shim for older content; new posts should always be
created under `content/pages/`.
