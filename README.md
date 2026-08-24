# ahmarius.github.io — games-enabled build

Built from the latest supplied site files.

Added:
- `games.html`: dedicated playable-games hub
- `game-player.html`: generic branded player route
- browser-build architecture for Unity/WebGL, C++/WebAssembly, and Java-in-browser
- Games navigation and Home/About CTAs
- `games/README.md` with build/deployment structure
- `.nojekyll` for static game-build publishing
- Games page in the sitemap

Important:
No game binaries were fabricated or altered. Existing browser releases are linked
to their published itch.io pages. A real self-hosted game build is loaded
automatically when `games/<slug>/index.html` exists.
