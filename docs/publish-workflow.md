# Publishing workflow

Publishing is local and deterministic. GitHub Actions is not part of the
release path.

When **Publish** is pressed, Content Studio:

1. saves the open editor;
2. lints content, runs the test suite, and builds in `publish` mode locally;
3. verifies drafts did not leak into public output;
4. shows the final post-build path list and tracked diff for confirmation;
5. commits the selected canonical content and generated root files;
6. fast-forwards `origin/main` to that source commit; and
7. clones or creates `gh-pages` in a temporary directory, replaces it with
   the sanitized `dist/` snapshot, and pushes it.

The source checkout is never switched or cleaned during deployment. The public
branch contains `.nojekyll` plus static output only; it does not contain
`content/`, the Admin App, build scripts, dependencies, or drafts.

The deploy step also verifies that every source, generated page, and public
asset capable of influencing `dist/` is committed. This prevents a dirty
`index.html`, stylesheet, build script, or content file from reaching
`gh-pages` without a matching source commit on `main`. Unrelated private files
remain untouched.

## One-time GitHub Pages setting

In the repository's **Settings → Pages → Build and deployment**, select
**Deploy from a branch**, then choose **gh-pages** and **/(root)**. The old
GitHub Actions workflow has been removed.

Scheduled posts now require Content Studio to be opened and published after
their date. Phone Sync writes canonical source to `main`; it deliberately
does not build or deploy, so finish publication from the desktop app.

If source was pushed but snapshot deployment failed, press **Publish** again.
The app supports redeploying the current build without creating an empty
commit.
