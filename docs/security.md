# Security boundary

The public website remains static and has no direct filesystem or repository access.

- GitHub Pages serves static files only.
- The local admin binds to `127.0.0.1`.
- The admin writes repository content and runs local build commands.
- Publishing operations are scoped to the Devlog content directory and never use destructive Git commands.
- Secrets are not embedded in site code or scripts.
