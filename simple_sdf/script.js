import { Entities } from "./entities.js";

class Engine {
  constructor(userShaderCode) {
    this.userShaderCode = userShaderCode;

    this.canvas = document.querySelector('canvas');
    this.gl = this.canvas.getContext("webgl2");

    if (!this.gl) {
      document.body.innerHTML = `
        <div style="color:#fff;font:18px/1.6 system-ui;text-align:center;padding:3rem;">
          <strong>WebGL 2.0 not supported</strong><br />
          Please use a modern browser.
        </div>`;
      throw new Error('WebGL 2.0 not available');
    }

    this.resize();

    this.mouse = { x: 0, y: 0, down: false, lx: 0, ly: 0 };
    this.orbit = { theta: 0, phi: 0.35 };
    this.isDragging = false;

    this.canvas.addEventListener('mousedown', (e) => {
      this.mouse.down = true;
      this.isDragging = true;
      this.mouse.lx = e.clientX;
      this.mouse.ly = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
      this.isDragging = false;
      this.canvas.style.cursor = 'crosshair';
    });
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = this.canvas.height - e.clientY;
      if (this.isDragging) {
        const dx = e.clientX - this.mouse.lx;
        const dy = e.clientY - this.mouse.ly;
        this.orbit.theta += dx * 0.005;
        this.orbit.phi = Math.max(-1.2, Math.min(1.2, this.orbit.phi + dy * 0.005));
        this.mouse.lx = e.clientX;
        this.mouse.ly = e.clientY;
      }
    });

    this.touchId = null;
    this.canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (this.touchId === null) {
        this.touchId = t.identifier;
        this.mouse.lx = t.clientX;
        this.mouse.ly = t.clientY;
        this.isDragging = true;
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchId) {
          const dx = t.clientX - this.mouse.lx;
          const dy = t.clientY - this.mouse.ly;
          this.orbit.theta += dx * 0.005;
          this.orbit.phi = Math.max(-1.2, Math.min(1.2, this.orbit.phi + dy * 0.005));
          this.mouse.lx = t.clientX;
          this.mouse.ly = t.clientY;
          this.mouse.x = t.clientX;
          this.mouse.y = this.canvas.height - t.clientY;
        }
      }
    }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchId) {
          this.touchId = null;
          this.isDragging = false;
        }
      }
    }, { passive: true });

    this.entities = new Entities(128);

    this.initShaders();

    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.frameCount = 0;
    this.lastFpsUpdate = this.startTime;
    this.fps = 0;
    this.avgFrameTime = 0;
    this.frameTimeSum = 0;
    this.frameTimeCount = 0;

    this.fpsElement = document.getElementById('fps');
    this.frameTimeElement = document.getElementById('frametime');

    window.addEventListener('resize', () => {
      this.resize();
      this.gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    });
  }

  initShaders() {
    this.fragmentShaderSource = `#version 300 es
      precision highp float;

      uniform vec2  iResolution;
      uniform float iTime;
      uniform vec4  iMouse;
      uniform sampler2D iEntityTexture;
      uniform int iEntityCount;

      ${this.userShaderCode}

      out vec4 fragColor;
      void main() {
        mainImage(fragColor, gl_FragCoord.xy);
      }
    `;

    this.vsSource = `#version 300 es
      in vec2 aPos;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    this.vs = this.compileShader(this.vsSource, this.gl.VERTEX_SHADER);
    this.fs = this.compileShader(this.fragmentShaderSource, this.gl.FRAGMENT_SHADER);
    if (!this.vs || !this.fs) throw new Error('Shader compilation failed');

    this.program = this.createProgram(this.vs, this.fs);
    if (!this.program) throw new Error('Program link failed');

    this.gl.useProgram(this.program);

    this.uResolution = this.gl.getUniformLocation(this.program, 'iResolution');
    this.uTime = this.gl.getUniformLocation(this.program, 'iTime');
    this.uMouse = this.gl.getUniformLocation(this.program, 'iMouse');
    this.uEntityTexture = this.gl.createTexture();
    const loc = this.gl.getUniformLocation(this.program, "iEntityTexture");
    this.gl.uniform1i(loc, 0);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.uEntityCount = this.gl.getUniformLocation(this.program, "iEntityCount");

    // ─── Vertex data ────────────────────────────────────────────────
    this.vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.vertices, this.gl.STATIC_DRAW);

    this.aPos = this.gl.getAttribLocation(this.program, 'aPos');
    this.gl.enableVertexAttribArray(this.aPos);
    this.gl.vertexAttribPointer(this.aPos, 2, this.gl.FLOAT, false, 0, 0);
  }

  compileShader(src, type) {
    const s = this.gl.createShader(type);
    this.gl.shaderSource(s, src);
    this.gl.compileShader(s);
    if (!this.gl.getShaderParameter(s, this.gl.COMPILE_STATUS)) {
      console.error('Shader error:', this.gl.getShaderInfoLog(s));
      this.gl.deleteShader(s);
      return null;
    }
    return s;
  }

  createProgram(vs, fs) {
    const prog = this.gl.createProgram();
    this.gl.attachShader(prog, vs);
    this.gl.attachShader(prog, fs);
    this.gl.linkProgram(prog);
    if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
      console.error('Link error:', this.gl.getProgramInfoLog(prog));
      this.gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  updateEntityTexture() {
    const data = this.entities.toF32Array();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texSubImage2D(
      this.gl.TEXTURE_2D,
      0,                    // mip level
      0, 0,                 // x, y offset
      this.entities.maxEntities * 4, // width = entities * 4 texels
      1,                    // height = 1 row
      this.gl.RGBA,
      this.gl.FLOAT,
      data
    );
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.gl.viewport(0, 0, w, h);
    document.getElementById('resolution').textContent = `${w}×${h}`;
  }

  render() {
    const now = performance.now();

    const frameDelta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    const elapsed = (now - this.startTime) / 1000.0;

    this.frameCount++;
    this.frameTimeSum += frameDelta;
    this.frameTimeCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.avgFrameTime = this.frameTimeSum / this.frameTimeCount;
      this.frameCount = 0;
      this.frameTimeSum = 0;
      this.frameTimeCount = 0;
      this.lastFpsUpdate = now;

      this.fpsElement.textContent = this.fps;
      this.frameTimeElement.textContent = this.avgFrameTime.toFixed(1);
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const iMouseX = this.orbit.theta * 100.0;
    const iMouseY = (this.orbit.phi - 0.35) * 5000.0;

    this.gl.uniform2f(this.uResolution, w, h);
    this.gl.uniform1f(this.uTime, elapsed);
    this.gl.uniform4f(this.uMouse, this.iMouseX, this.iMouseY, 0.0, 0.0);

    this.gl.clearColor(0.02, 0.02, 0.04, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(this.render.bind(this));
  }
}

async function loadShader() {
  try {
    const response = await fetch('shader.c');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const userShaderCode = await response.text();
    console.log('Shader loaded, length:', userShaderCode.length);
    let engine = new Engine(userShaderCode);

    engine.entities.add(
      { x: 0, y: 2, z: 2 },            // position
      { r: 0.2, g: 0.8, b: 0.2 },      // green
      0.8,                             // radius
      0.3,                             // roughness
      0.2,                             // metallic
      0,                               // type: sphere
      1                                // flags: active
    );

    window.engine = engine;
    window.engine.render();
  } catch (error) {
    console.error('Failed to load shader:', error);
    document.body.innerHTML = `<pre style="color:#f88;padding:2rem;">Error loading shader.c\n${error}</pre>`;
  }
}

loadShader();