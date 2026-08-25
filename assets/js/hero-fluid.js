(() => {
  "use strict";

  const canvas = document.getElementById("hero-fluid");

  if (!canvas) {
    return;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /*
   * ================================================================
   * PERSISTENT LIQUID STRANDS
   * ================================================================
   *
   * Architecture:
   *
   *   CURSOR
   *      ↓
   *   inject force
   *      ↓
   *   persistent displacement texture
   *      ↓
   *   advection
   *      ↓
   *   diffusion
   *      ↓
   *   very slow decay
   *      ↓
   *   deform infinite strands
   *
   * The important difference from the earlier versions is that the
   * cursor disturbance is now stored in GPU memory between frames.
   *
   * A stroke therefore has a real history.
   */

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });

  if (!gl) {
    console.error("WebGL2 is required for the persistent hero-fluid effect.");

    canvas.hidden = false;
    canvas.style.display = "block";
    canvas.style.background =
      "linear-gradient(135deg, #18252d 0%, #263b43 45%, #4a3e35 100%)";

    return;
  }

  /*
   * Use floating-point state when available, but do not make the
   * decorative background disappear on browsers without the optional
   * render-target extension.
   */
  const floatColorBufferExtension = gl.getExtension("EXT_color_buffer_float");
  const stateInternalFormat = floatColorBufferExtension ? gl.RGBA16F : gl.RGBA8;
  const stateType = floatColorBufferExtension
    ? gl.HALF_FLOAT
    : gl.UNSIGNED_BYTE;

  /*
   * ================================================================
   * SIMULATION SETTINGS
   * ================================================================
   *
   * The simulation is deliberately lower resolution than the screen.
   * The final result is still rendered at native canvas resolution.
   *
   * 320x180 is enough for a broad fluid deformation field and keeps
   * the simulation extremely cheap on the GPU.
   */

  const SIMULATION_WIDTH = 320;
  const SIMULATION_HEIGHT = 180;

  /*
   * Persistent-memory parameters.
   *
   * The decay is intentionally tiny.
   *
   * 0.9975 per frame ≈ very long visual memory.
   *
   * Diffusion spreads old marks instead of deleting them.
   */
  const PERSISTENCE = 0.9975;
  const DIFFUSION = 0.042;
  const ADVECTION = 0.82;

  /*
   * Cursor force.
   */
  const CURSOR_FORCE = 1.8;
  const CURSOR_RADIUS = 0.12;

  /*
   * ================================================================
   * COMMON VERTEX SHADER
   * ================================================================
   */

  const fullscreenVertexSource = `#version 300 es

    in vec2 a_position;

    out vec2 v_uv;

    void main() {
      v_uv =
        a_position *
        0.5 +
        0.5;

      gl_Position =
        vec4(
          a_position,
          0.0,
          1.0
        );
    }
  `;

  /*
   * ================================================================
   * SIMULATION FRAGMENT SHADER
   * ================================================================
   *
   * State texture:
   *
   *   R = horizontal displacement
   *   G = vertical displacement
   *
   * Each frame:
   *
   *   1. Backtrace through the velocity field.
   *   2. Sample previous displacement.
   *   3. Diffuse from neighbours.
   *   4. Apply very slow decay.
   *   5. Inject cursor force.
   *
   * This is what gives the interaction a persistent physical memory.
   */

  const simulationFragmentSource = `#version 300 es

    precision highp float;

    uniform sampler2D u_previous;

    uniform vec2 u_resolution;
    uniform vec2 u_texel;

    uniform float u_time;
    uniform float u_delta;

    uniform vec2 u_mouse;
    uniform vec2 u_mouseVelocity;

    uniform float u_mouseActive;
    uniform float u_mouseDown;

    out vec4 outColor;


    /*
     * --------------------------------------------------------------
     * Hash / noise
     * --------------------------------------------------------------
     */

    float hash21(vec2 p) {
      p =
        fract(
          p *
          vec2(
            123.34,
            456.21
          )
        );

      p +=
        dot(
          p,
          p + 45.32
        );

      return fract(
        p.x *
        p.y
      );
    }


    float noise(vec2 p) {
      vec2 i =
        floor(p);

      vec2 f =
        fract(p);

      f =
        f *
        f *
        (3.0 - 2.0 * f);

      float a =
        hash21(i);

      float b =
        hash21(
          i +
          vec2(
            1.0,
            0.0
          )
        );

      float c =
        hash21(
          i +
          vec2(
            0.0,
            1.0
          )
        );

      float d =
        hash21(
          i +
          vec2(
            1.0,
            1.0
          )
        );

      return mix(
        mix(
          a,
          b,
          f.x
        ),
        mix(
          c,
          d,
          f.x
        ),
        f.y
      );
    }


    /*
     * --------------------------------------------------------------
     * Procedural flow field
     * --------------------------------------------------------------
     *
     * This continuously moves the persistent cursor deformation.
     * It is deliberately smooth and directional.
     */

    vec2 flowField(vec2 uv) {

      float n1 =
        noise(
          uv *
          2.2 +
          vec2(
            u_time * 0.025,
            -u_time * 0.018
          )
        ) -
        0.5;

      float n2 =
        noise(
          uv *
          4.4 +
          vec2(
            13.2,
            7.7
          ) +
          vec2(
            -u_time * 0.018,
            u_time * 0.014
          )
        ) -
        0.5;


      /*
       * Base direction.
       */
      vec2 velocity =
        vec2(
          0.62,
          0.62
        );


      /*
       * Slow sinuous variation.
       */
      velocity.x +=
        sin(
          uv.y * 7.0 +
          u_time * 0.25
        ) *
        0.28;

      velocity.y +=
        cos(
          uv.x * 5.0 -
          u_time * 0.21
        ) *
        0.22;


      velocity +=
        vec2(
          n1,
          n2
        ) *
        0.42;


      /*
       * Normalize to a stable flow speed.
       */
      float speed =
        length(
          velocity
        );

      return
        velocity /
        max(
          speed,
          0.0001
        ) *
        0.0015;
    }


    /*
     * --------------------------------------------------------------
     * Sample displacement
     * --------------------------------------------------------------
     */

    vec2 sampleDisplacement(
      vec2 uv
    ) {
      return
        texture(
          u_previous,
          fract(uv)
        ).rg;
    }


    /*
     * --------------------------------------------------------------
     * Main simulation
     * --------------------------------------------------------------
     */

    void main() {

      vec2 uv =
        gl_FragCoord.xy /
        u_resolution;


      /*
       * ------------------------------------------------------------
       * ADVECTION
       * ------------------------------------------------------------
       *
       * Backtrace through the continuous flow field.
       *
       * fract() is intentional:
       *
       * the simulation wraps around the canvas.
       *
       * Therefore deformation that exits one side continues from
       * the opposite side instead of hitting a wall.
       */

      vec2 flow =
        flowField(
          uv
        );

      vec2 backtraceUV =
        uv -
        flow *
        ${ADVECTION} *
        (
          u_delta *
          60.0
        );


      vec2 advected =
        sampleDisplacement(
          backtraceUV
        );


      /*
       * ------------------------------------------------------------
       * DIFFUSION
       * ------------------------------------------------------------
       *
       * Spread the displacement into nearby cells.
       *
       * This prevents old cursor marks from looking frozen.
       */

      vec2 north =
        sampleDisplacement(
          uv +
          vec2(
            0.0,
            u_texel.y
          )
        );

      vec2 south =
        sampleDisplacement(
          uv -
          vec2(
            0.0,
            u_texel.y
          )
        );

      vec2 east =
        sampleDisplacement(
          uv +
          vec2(
            u_texel.x,
            0.0
          )
        );

      vec2 west =
        sampleDisplacement(
          uv -
          vec2(
            u_texel.x,
            0.0
          )
        );


      vec2 diffused =
        (
          north +
          south +
          east +
          west
        ) *
        0.25;


      advected =
        mix(
          advected,
          diffused,
          ${DIFFUSION}
        );


      /*
       * ------------------------------------------------------------
       * VERY SLOW PERSISTENCE / DECAY
       * ------------------------------------------------------------
       *
       * The displacement remains traceable for a very long time.
       */

      advected *=
        pow(
          ${PERSISTENCE},
          u_delta *
          60.0
        );


      /*
       * ------------------------------------------------------------
       * CURSOR INJECTION
       * ------------------------------------------------------------
       */

      if (
        u_mouseActive >
        0.5
      ) {

        vec2 delta =
          uv -
          u_mouse;


        /*
         * Account for screen aspect ratio.
         */
        float aspect =
          u_resolution.x /
          u_resolution.y;

        delta.x *=
          aspect;


        float distanceToMouse =
          length(
            delta
          );


        /*
         * Broad soft brush.
         */
        float brush =
          exp(
            -(
              distanceToMouse *
              distanceToMouse
            ) /
            (
              ${CURSOR_RADIUS} *
              ${CURSOR_RADIUS}
            )
          );


        /*
         * Cursor velocity.
         */
        vec2 velocity =
          u_mouseVelocity;


        float velocityLength =
          length(
            velocity
          );


        vec2 direction =
          velocityLength >
          0.00005
            ? velocity /
              velocityLength
            : vec2(
                0.0,
                0.0
              );


        /*
         * Mouse movement generates a sideways displacement.
         *
         * This makes the strands visibly move rather than just
         * brightening underneath the pointer.
         */
        vec2 perpendicular =
          vec2(
            -direction.y,
             direction.x
          );


        /*
         * Strong force when dragging.
         */
        float force =
          ${CURSOR_FORCE};


        if (
          u_mouseDown >
          0.5
        ) {
          force *=
            1.7;
        }


        /*
         * Movement force.
         */
        force *=
          1.0 +
          min(
            velocityLength *
            150.0,
            3.0
          );


        /*
         * Direct movement.
         */
        advected +=
          direction *
          brush *
          force *
          0.011;


        /*
         * Sideways liquid displacement.
         */
        advected +=
          perpendicular *
          brush *
          force *
          0.008;


        /*
         * Radial pressure.
         *
         * Gives the cursor a physical "mass".
         */
        vec2 radial =
          normalize(
            delta +
            vec2(
              0.00001
            )
          );


        advected +=
          radial *
          brush *
          force *
          0.005;
      }


      /*
       * ------------------------------------------------------------
       * Clamp state
       * ------------------------------------------------------------
       */

      advected =
        clamp(
          advected,
          vec2(
            -1.5
          ),
          vec2(
            1.5
          )
        );


      outColor =
        vec4(
          advected,
          0.0,
          1.0
        );
    }
  `;

  /*
   * ================================================================
   * DISPLAY SHADER
   * ================================================================
   *
   * The persistent displacement field is used to deform the
   * mathematical strand coordinate.
   *
   * The strands themselves are infinite: only the viewport is finite.
   */

  const displayFragmentSource = `#version 300 es

    precision highp float;

    uniform sampler2D u_state;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_dark;

    in vec2 v_uv;

    out vec4 outColor;


    /*
     * --------------------------------------------------------------
     * Hash / noise
     * --------------------------------------------------------------
     */

    float hash21(vec2 p) {

      p =
        fract(
          p *
          vec2(
            123.34,
            456.21
          )
        );

      p +=
        dot(
          p,
          p + 45.32
        );

      return fract(
        p.x *
        p.y
      );
    }


    float noise(vec2 p) {

      vec2 i =
        floor(p);

      vec2 f =
        fract(p);

      f =
        f *
        f *
        (3.0 - 2.0 * f);

      float a =
        hash21(i);

      float b =
        hash21(
          i +
          vec2(
            1.0,
            0.0
          )
        );

      float c =
        hash21(
          i +
          vec2(
            0.0,
            1.0
          )
        );

      float d =
        hash21(
          i +
          vec2(
            1.0,
            1.0
          )
        );

      return mix(
        mix(
          a,
          b,
          f.x
        ),
        mix(
          c,
          d,
          f.x
        ),
        f.y
      );
    }


    float fbm(vec2 p) {

      float value = 0.0;

      value +=
        noise(p) *
        0.5;

      p *=
        2.0;

      value +=
        noise(p) *
        0.25;

      p *=
        2.0;

      value +=
        noise(p) *
        0.125;

      p *=
        2.0;

      value +=
        noise(p) *
        0.0625;

      return value;
    }


    /*
     * --------------------------------------------------------------
     * Main
     * --------------------------------------------------------------
     */

    void main() {

      vec2 uv =
        v_uv;


      /*
       * Aspect-correct world coordinates.
       */
      float aspect =
        u_resolution.x /
        u_resolution.y;


      vec2 p =
        uv;

      p.x *=
        aspect;

      /*
       * Carry the visible wave field diagonally from lower-left to
       * upper-right. This is separate from cursor displacement, so the
       * waves keep moving even while the pointer is idle.
       */
      p -=
        vec2(
          0.055,
          0.055
        ) *
        u_time;


      /*
       * ------------------------------------------------------------
       * Persistent cursor field
       * ------------------------------------------------------------
       */

      vec2 displacement =
        texture(
          u_state,
          uv
        ).rg;


      /*
       * The persistent displacement is deliberately amplified
       * before being applied to the strands.
       *
       * This makes old cursor traces clearly visible.
       */
      vec2 displacedP =
        p +
        displacement *
        vec2(
          0.65,
          0.95
        );


      /*
       * ------------------------------------------------------------
       * INFINITE STRAND COORDINATES
       * ------------------------------------------------------------
       */

      vec2 tangent =
        normalize(
          vec2(
            0.34,
            1.0
          )
        );


      vec2 normal =
        vec2(
          -tangent.y,
           tangent.x
        );


      /*
       * Infinite longitudinal coordinate.
       */
      float s =
        dot(
          displacedP,
          tangent
        ) *
        15.0;


      /*
       * Infinite strand coordinate.
       */
      float n =
        dot(
          displacedP,
          normal
        ) *
        9.0;


      /*
       * ------------------------------------------------------------
       * NATURAL STRAND CURVATURE
       * ------------------------------------------------------------
       */

      float broadCurve =
        sin(
          s * 0.095 -
          u_time * 0.12
        ) *
        0.62;


      float mediumCurve =
        sin(
          s * 0.21 +
          u_time * 0.075
        ) *
        0.24;


      float longCurve =
        sin(
          s * 0.045 -
          u_time * 0.055
        ) *
        0.82;


      n +=
        broadCurve +
        mediumCurve +
        longCurve;


      /*
       * ------------------------------------------------------------
       * CONTINUOUS WAVES TRAVELING ALONG THE STRANDS
       * ------------------------------------------------------------
       */

      float slowWave =
        sin(
          s * 0.30 -
          u_time * 0.45
        ) *
        0.32;


      float mediumWave =
        sin(
          s * 0.73 -
          u_time * 1.05
        ) *
        0.19;


      float fastWave =
        sin(
          s * 1.60 -
          u_time * 1.85
        ) *
        0.08;


      /*
       * Nested wave.
       */
      float nestedWave =
        sin(
          s * 0.13 -
          u_time * 0.17 +
          sin(
            s * 0.31 -
            u_time * 0.28
          ) *
          1.8
        ) *
        0.29;


      n +=
        slowWave +
        mediumWave +
        fastWave +
        nestedWave;


      /*
       * ------------------------------------------------------------
       * FINE STRAND STRUCTURE
       * ------------------------------------------------------------
       */

      float broad =
        sin(
          n *
          3.14159265 *
          0.72
        );


      float fine1 =
        sin(
          n *
          3.14159265 *
          2.35
        );


      float fine2 =
        sin(
          n *
          3.14159265 *
          5.2 +
          0.45
        );


      float fine3 =
        sin(
          n *
          3.14159265 *
          10.4 -
          0.7
        );


      /*
       * Layer the bands.
       */
      float surface =
        broad *
          0.58 +
        fine1 *
          0.27 +
        fine2 *
          0.115 +
        fine3 *
          0.05;


      /*
       * Smooth material response.
       */
      surface =
        clamp(
          surface *
          1.70,
          -1.0,
          1.0
        );


      /*
       * ------------------------------------------------------------
       * FINE MATERIAL GRAIN
       * ------------------------------------------------------------
       */

      float grain =
        fbm(
          displacedP *
          8.0 +
          vec2(
            u_time * 0.012,
            -u_time * 0.009
          )
        ) -
        0.5;


      /*
       * ------------------------------------------------------------
       * LARGE-SCALE LIGHTING
       * ------------------------------------------------------------
       */

      float light =
        sin(
          s * 0.17 -
          u_time * 0.13
        ) *
        0.045;


      /*
       * ------------------------------------------------------------
       * FINAL VALUE
       * ------------------------------------------------------------
       */

      float value =
        0.50 +
        surface *
          0.115 +
        grain *
          0.021 +
        light;


      /*
       * Very subtle depth based on deformation magnitude.
       */
      float deformationAmount =
        length(
          displacement
        );


      value +=
        deformationAmount *
        0.012;


      /*
       * Restrained two-material palette: cool water and warm oil.
       * The alternating bands stay close to the site's neutral surfaces.
       */
      float material =
        smoothstep(
          -0.35,
          0.35,
          sin(
            n *
            3.14159265 *
            0.72
          )
        );

      vec3 lightWater =
        mix(
          vec3(0.18, 0.20, 0.20),
          vec3(0.48, 0.50, 0.48),
          clamp(value * 1.25, 0.0, 1.0)
        );

      vec3 lightOil =
        mix(
          vec3(0.16, 0.15, 0.13),
          vec3(0.40, 0.37, 0.31),
          clamp(value * 1.15, 0.0, 1.0)
        );

      vec3 darkWater =
        mix(
          vec3(0.12, 0.16, 0.18),
          vec3(0.34, 0.42, 0.44),
          clamp(value * 1.25, 0.0, 1.0)
        );

      vec3 darkOil =
        mix(
          vec3(0.13, 0.12, 0.11),
          vec3(0.32, 0.29, 0.24),
          clamp(value * 1.15, 0.0, 1.0)
        );

      vec3 color =
        mix(
          mix(lightOil, darkOil, u_dark),
          mix(lightWater, darkWater, u_dark),
          material
        );

      float sheen =
        smoothstep(
          0.58,
          0.95,
          abs(surface)
        ) *
        0.075;

      color +=
        vec3(
          sheen
        );

      float vignette =
        1.0 -
        smoothstep(
          0.28,
          0.86,
          distance(
            uv,
            vec2(0.5)
          )
        ) *
        0.18;

      outColor =
        vec4(
          color *
          vignette,
          1.0
        );
    }
  `;

  /*
   * ================================================================
   * SHADER HELPERS
   * ================================================================
   */

  function compileShader(type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);

    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));

      gl.deleteShader(shader);

      return null;
    }

    return shader;
  }

  function createProgram(vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);

    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);

    gl.attachShader(program, fragmentShader);

    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));

      return null;
    }

    return program;
  }

  /*
   * ================================================================
   * PROGRAMS
   * ================================================================
   */

  const simulationProgram = createProgram(
    fullscreenVertexSource,
    simulationFragmentSource,
  );

  const displayProgram = createProgram(
    fullscreenVertexSource,
    displayFragmentSource,
  );

  if (!simulationProgram || !displayProgram) {
    console.error("Unable to create fluid shader programs.");

    return;
  }

  /*
   * ================================================================
   * FULLSCREEN GEOMETRY
   * ================================================================
   */

  const fullscreenVertices = new Float32Array([
    -1, -1,

    1, -1,

    -1, 1,

    -1, 1,

    1, -1,

    1, 1,
  ]);

  const fullscreenBuffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenBuffer);

  gl.bufferData(gl.ARRAY_BUFFER, fullscreenVertices, gl.STATIC_DRAW);

  /*
   * ================================================================
   * ATTRIBUTE BINDINGS
   * ================================================================
   */

  const simulationPosition = gl.getAttribLocation(
    simulationProgram,
    "a_position",
  );

  const displayPosition = gl.getAttribLocation(displayProgram, "a_position");

  /*
   * ================================================================
   * UNIFORMS — SIMULATION
   * ================================================================
   */

  const simulationUniforms = {
    previous: gl.getUniformLocation(simulationProgram, "u_previous"),

    resolution: gl.getUniformLocation(simulationProgram, "u_resolution"),

    texel: gl.getUniformLocation(simulationProgram, "u_texel"),

    time: gl.getUniformLocation(simulationProgram, "u_time"),

    delta: gl.getUniformLocation(simulationProgram, "u_delta"),

    mouse: gl.getUniformLocation(simulationProgram, "u_mouse"),

    mouseVelocity: gl.getUniformLocation(simulationProgram, "u_mouseVelocity"),

    mouseActive: gl.getUniformLocation(simulationProgram, "u_mouseActive"),

    mouseDown: gl.getUniformLocation(simulationProgram, "u_mouseDown"),
  };

  /*
   * ================================================================
   * UNIFORMS — DISPLAY
   * ================================================================
   */

  const displayUniforms = {
    state: gl.getUniformLocation(displayProgram, "u_state"),

    resolution: gl.getUniformLocation(displayProgram, "u_resolution"),

    time: gl.getUniformLocation(displayProgram, "u_time"),

    dark: gl.getUniformLocation(displayProgram, "u_dark"),
  };

  /*
   * ================================================================
   * PERSISTENT STATE TEXTURES
   * ================================================================
   */

  function createStateTexture() {
    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    /*
     * REPEAT is important:
     *
     * The state itself wraps around the simulation domain, meaning
     * the liquid does not encounter an artificial edge.
     */
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      stateInternalFormat,
      SIMULATION_WIDTH,
      SIMULATION_HEIGHT,
      0,
      gl.RGBA,
      stateType,
      null,
    );

    gl.bindTexture(gl.TEXTURE_2D, null);

    return texture;
  }

  function createStateFramebuffer(texture) {
    const framebuffer = gl.createFramebuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Fluid framebuffer is incomplete:", status);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return framebuffer;
  }

  const stateTextureA = createStateTexture();

  const stateTextureB = createStateTexture();

  const stateFramebufferA = createStateFramebuffer(stateTextureA);

  const stateFramebufferB = createStateFramebuffer(stateTextureB);

  /*
   * ================================================================
   * CLEAR INITIAL STATE
   * ================================================================
   */

  function clearState(framebuffer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    gl.viewport(0, 0, SIMULATION_WIDTH, SIMULATION_HEIGHT);

    gl.clearColor(0, 0, 0, 1);

    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  clearState(stateFramebufferA);

  clearState(stateFramebufferB);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  /*
   * ================================================================
   * POINTER STATE
   * ================================================================
   */

  const pointer = {
    x: 0.5,
    y: 0.5,

    targetX: 0.5,
    targetY: 0.5,

    vx: 0,
    vy: 0,

    targetVx: 0,
    targetVy: 0,

    active: false,
    down: false,
  };

  function updatePointer(event) {
    const x = event.clientX / Math.max(1, window.innerWidth);

    const y = 1 - event.clientY / Math.max(1, window.innerHeight);

    const dx = x - pointer.targetX;

    const dy = y - pointer.targetY;

    pointer.targetX = x;

    pointer.targetY = y;

    pointer.targetVx = dx;

    pointer.targetVy = dy;

    pointer.active = true;
  }

  function pointerDown() {
    pointer.down = true;
  }

  function pointerUp() {
    pointer.down = false;
  }

  function pointerLeave() {
    pointer.active = false;

    pointer.down = false;
  }

  window.addEventListener("pointermove", updatePointer, {
    passive: true,
  });

  window.addEventListener("pointerdown", pointerDown, {
    passive: true,
  });

  window.addEventListener("pointerup", pointerUp, {
    passive: true,
  });

  window.addEventListener("pointercancel", pointerUp, {
    passive: true,
  });

  window.addEventListener("pointerleave", pointerLeave, {
    passive: true,
  });

  /*
   * ================================================================
   * CANVAS RESIZE
   * ================================================================
   */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    const displayWidth = window.innerWidth;

    const displayHeight = window.innerHeight;

    canvas.width = Math.max(1, Math.floor(displayWidth * dpr));

    canvas.height = Math.max(1, Math.floor(displayHeight * dpr));

    canvas.style.width = `${displayWidth}px`;

    canvas.style.height = `${displayHeight}px`;

    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener("resize", resize, {
    passive: true,
  });

  /*
   * ================================================================
   * SIMULATION STATE
   * ================================================================
   */

  let readTexture = stateTextureA;

  let writeFramebuffer = stateFramebufferB;

  let lastTime = performance.now() * 0.001;

  /*
   * ================================================================
   * RENDER HELPERS
   * ================================================================
   */

  function bindFullscreen(program, position) {
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenBuffer);

    gl.enableVertexAttribArray(position);

    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  /*
   * ================================================================
   * SIMULATION STEP
   * ================================================================
   */

  function simulate(time, delta) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFramebuffer);

    gl.viewport(0, 0, SIMULATION_WIDTH, SIMULATION_HEIGHT);

    bindFullscreen(simulationProgram, simulationPosition);

    /*
     * Previous state.
     */
    gl.activeTexture(gl.TEXTURE0);

    gl.bindTexture(gl.TEXTURE_2D, readTexture);

    gl.uniform1i(simulationUniforms.previous, 0);

    gl.uniform2f(
      simulationUniforms.resolution,
      SIMULATION_WIDTH,
      SIMULATION_HEIGHT,
    );

    gl.uniform2f(
      simulationUniforms.texel,
      1 / SIMULATION_WIDTH,
      1 / SIMULATION_HEIGHT,
    );

    gl.uniform1f(simulationUniforms.time, time);

    gl.uniform1f(simulationUniforms.delta, Math.min(delta, 0.033));

    /*
     * Smooth pointer.
     */
    pointer.x += (pointer.targetX - pointer.x) * 0.085;

    pointer.y += (pointer.targetY - pointer.y) * 0.085;

    pointer.vx += (pointer.targetVx - pointer.vx) * 0.16;

    pointer.vy += (pointer.targetVy - pointer.vy) * 0.16;

    pointer.targetVx *= 0.92;

    pointer.targetVy *= 0.92;

    gl.uniform2f(simulationUniforms.mouse, pointer.x, pointer.y);

    gl.uniform2f(simulationUniforms.mouseVelocity, pointer.vx, pointer.vy);

    gl.uniform1f(simulationUniforms.mouseActive, pointer.active ? 1 : 0);

    gl.uniform1f(simulationUniforms.mouseDown, pointer.down ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    /*
     * --------------------------------------------------------------
     * Swap buffers.
     * --------------------------------------------------------------
     */

    const oldRead = readTexture;

    readTexture = getTextureForFramebuffer(writeFramebuffer);

    writeFramebuffer = getFramebufferForTexture(oldRead);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /*
   * We need the reverse mapping for ping-pong buffers.
   */

  function getTextureForFramebuffer(framebuffer) {
    if (framebuffer === stateFramebufferA) {
      return stateTextureA;
    }

    return stateTextureB;
  }

  function getFramebufferForTexture(texture) {
    if (texture === stateTextureA) {
      return stateFramebufferA;
    }

    return stateFramebufferB;
  }

  /*
   * ================================================================
   * DISPLAY
   * ================================================================
   */

  function renderDisplay(time) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, canvas.width, canvas.height);

    bindFullscreen(displayProgram, displayPosition);

    gl.activeTexture(gl.TEXTURE0);

    gl.bindTexture(gl.TEXTURE_2D, readTexture);

    gl.uniform1i(displayUniforms.state, 0);

    gl.uniform2f(displayUniforms.resolution, canvas.width, canvas.height);

    gl.uniform1f(displayUniforms.time, time);
    gl.uniform1f(
      displayUniforms.dark,
      document.documentElement.dataset.theme === "dark" ? 1 : 0,
    );

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /*
   * ================================================================
   * ANIMATION
   * ================================================================
   */

  function animate(now) {
    const time = now * 0.001;

    const delta = Math.min(time - lastTime, 0.033);

    lastTime = time;

    /*
     * Keep simulation running even when the pointer is idle.
     *
     * That is what lets old traces continue drifting around the
     * viewport for a long time.
     */
    if (!reduceMotion.matches) {
      simulate(time, delta);
    }

    renderDisplay(time);

    if (!reduceMotion.matches) {
      requestAnimationFrame(animate);
    }
  }

  /*
   * ================================================================
   * INITIALIZATION
   * ================================================================
   */

  canvas.hidden = false;

  canvas.style.display = "block";

  resize();

  /*
   * Draw the initial undeformed strands.
   */
  renderDisplay(0);

  if (reduceMotion.matches) {
    return;
  }

  requestAnimationFrame(animate);
})();
