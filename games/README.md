# Browser game builds

The Games page supports self-hosted browser builds under this directory.

Expected structure:

    games/
      snek/
        index.html
        ...
      pong/
        index.html
        ...
      keyboardhero/
        index.html
        ...
      towerrr/
        index.html
        ...
      chim/
        index.html
        ...
      racing/
        index.html
        ...
      ironhalo/
        index.html
        ...

The generic `game-player.html?game=<slug>` route checks whether
`games/<slug>/index.html` exists. If it does, it loads it in the branded player.
Otherwise it provides the project's external release link.

C++:
Compile a web target using Emscripten. SDL is supported by Emscripten and
portable C/C++ code can be compiled to WebAssembly.

Unity:
Build for Web/WebGL, then copy the generated web build into
`games/<slug>/`.

Java:
For Java desktop applications that are compatible with a browser runtime,
CheerpJ can execute JAR applications in-browser using WebAssembly.

This repository intentionally does not contain fabricated game builds.
Add the real builds when available.
