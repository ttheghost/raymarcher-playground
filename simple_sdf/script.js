import { Entities, EntityType } from "./entities.js";

const state = {
  entities: new Entities(128),
  engine: null,
  selectedId: -1,
};

class Engine {
  constructor(entities, canvas, userShaderCode) {
    this.userShaderCode = userShaderCode;

    this.canvas = canvas;
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
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.iCameraDist = Math.max(2, Math.min(20, this.iCameraDist + e.deltaY * 0.01));
    });
    this.iCameraDist = 5.0;

    this.entities = entities;

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
    const fragmentShaderSource = `#version 300 es
      precision highp float;

      uniform vec2      iResolution;
      uniform float     iTime;
      uniform vec4      iMouse;
      uniform float     iCameraDist;
      uniform sampler2D iEntityTexture;
      uniform int       iEntityCount;

      ${this.userShaderCode}

      out vec4 fragColor;
      void main() {
        mainImage(fragColor, gl_FragCoord.xy);
      }
    `;

    const vsSource = `#version 300 es
      in vec2 aPos;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

    const vs = this.compileShader(vsSource, this.gl.VERTEX_SHADER);
    const fs = this.compileShader(fragmentShaderSource, this.gl.FRAGMENT_SHADER);
    if (!vs || !fs) throw new Error('Shader compilation failed');

    this.program = this.createProgram(vs, fs);
    if (!this.program) throw new Error('Program link failed');

    this.gl.useProgram(this.program);

    this.uResolution = this.gl.getUniformLocation(this.program, 'iResolution');
    this.uTime = this.gl.getUniformLocation(this.program, 'iTime');
    this.uMouse = this.gl.getUniformLocation(this.program, 'iMouse');
    this.uCameraDist = this.gl.getUniformLocation(this.program, 'iCameraDist');
    this.uEntityCount = this.gl.getUniformLocation(this.program, "iEntityCount");

    this.texture = this.gl.createTexture();
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    const initialData = this.entities.toF32Array();
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA32F,
      this.entities.maxEntities * 4, // width
      1,                             // height
      0,
      this.gl.RGBA,
      this.gl.FLOAT,
      initialData
    );

    const loc = this.gl.getUniformLocation(this.program, "iEntityTexture");
    this.gl.uniform1i(loc, 0);

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
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
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
      fpsDisplay.textContent = this.fps;
      this.frameTimeElement.textContent = this.avgFrameTime.toFixed(1);
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
    const iMouseX = this.orbit.theta * 100.0;
    const iMouseY = (this.orbit.phi - 0.35) * 5000.0;

    this.gl.uniform2f(this.uResolution, w, h);
    this.gl.uniform1f(this.uTime, elapsed);
    this.gl.uniform4f(this.uMouse, iMouseX, iMouseY, 0.0, 0.0);
    this.gl.uniform1f(this.uCameraDist, this.iCameraDist);
    this.gl.uniform1i(this.uEntityCount, this.entities.count());

    this.gl.clearColor(0.02, 0.02, 0.04, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(this.render.bind(this));
  }
}

const canvas = document.getElementById('glcanvas');
const tbody = document.getElementById('entityTableBody');
const entityCountSpan = document.getElementById('entityCount');
const entityCountDisplay = document.getElementById('entityCountDisplay');
const fpsDisplay = document.getElementById('fpsDisplay');

function initDefaultScene() {
  const e = state.entities;

  // Chrome sphere (bobbing)
  e.add(
    { x: -1.5, y: 0.0, z: 0.0 },
    { r: 0.9, g: 0.95, b: 1.0 },
    1.0, 0.01, 0.9, 0, 1
  );

  // Gold sphere (bobbing)
  e.add(
    { x: 1.5, y: 0.0, z: 0.0 },
    { r: 1.0, g: 0.75, b: 0.3 },
    1.0, 0.15, 0.85, 0, 1
  );

  // Floor
  e.add(
    { x: 0.0, y: -1.0, z: 0.0 },
    { r: 0.8, g: 0.8, b: 0.8 },
    0.0, 0.4, 0.0, 2, 1
  );
}

function renderTable() {
  const entities = state.entities.entities;
  let html = '';

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e === null) continue;

    const isSelected = state.selectedId === i;
    const typeNames = ['Sphere', 'Box', 'Plane'];
    const colorHex = rgbToHex(e.baseColor.r, e.baseColor.g, e.baseColor.b);

    html += `
          <tr style="${isSelected ? 'background: #1a2a3a;' : ''}">
              <td style="color:#6a7a8a;">${i}</td>
              <td>
                  <select class="entity-select" data-id="${i}" data-field="type" onchange="updateEntity(this)">
                      ${typeNames.map((name, idx) =>
      `<option value="${idx}" ${idx === e.type ? 'selected' : ''}>${name}</option>`
    ).join('')}
                  </select>
              </td>
              <td>
                  <div style="display:flex;gap:2px;">
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.rotation.x.toFixed(2)}" 
                          data-id="${i}" data-field="rotX" onchange="updateEntity(this)" />
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.rotation.y.toFixed(2)}" 
                          data-id="${i}" data-field="rotY" onchange="updateEntity(this)" />
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.rotation.z.toFixed(2)}" 
                          data-id="${i}" data-field="rotZ" onchange="updateEntity(this)" />
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.rotation.w.toFixed(2)}" 
                          data-id="${i}" data-field="rotW" onchange="updateEntity(this)" />
                  </div>
              </td>
              <td>
                  <div style="display:flex;gap:2px;">
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.position.x.toFixed(2)}" 
                          data-id="${i}" data-field="posX" onchange="updateEntity(this)" />
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.position.y.toFixed(2)}" 
                          data-id="${i}" data-field="posY" onchange="updateEntity(this)" />
                      <input class="entity-input-sm" type="number" step="0.1" 
                          value="${e.position.z.toFixed(2)}" 
                          data-id="${i}" data-field="posZ" onchange="updateEntity(this)" />
                  </div>
              </td>
              <td>
                  <input class="color-picker" type="color" 
                      value="${colorHex}" 
                      data-id="${i}" data-field="color" onchange="updateEntity(this)" />
              </td>
              <td>
                  <input class="entity-input-sm" type="number" step="0.05" 
                      value="${e.radius.toFixed(2)}" 
                      data-id="${i}" data-field="radius" onchange="updateEntity(this)" />
              </td>
              <td>
                  <input class="entity-input-sm" type="number" step="0.05" min="0" max="1"
                      value="${e.roughness.toFixed(2)}" 
                      data-id="${i}" data-field="roughness" onchange="updateEntity(this)" />
              </td>
              <td>
                  <input class="entity-input-sm" type="number" step="0.05" min="0" max="1"
                      value="${e.metallic.toFixed(2)}" 
                      data-id="${i}" data-field="metallic" onchange="updateEntity(this)" />
              </td>
              <td>
                  <div class="row-actions">
                      <button class="btn btn-danger btn-small" onclick="removeEntity(${i})">✕</button>
                  </div>
              </td>
          </tr>
      `;
  }

  tbody.innerHTML = html;

  const count = state.entities.count();
  entityCountSpan.textContent = `${count} entities`;
  entityCountDisplay.textContent = count;
}

window.addEntity = function () {
  const rotX = parseFloat(document.getElementById('addrX').value) || 0;
  const rotY = parseFloat(document.getElementById('addrY').value) || 0;
  const rotZ = parseFloat(document.getElementById('addrZ').value) || 0;
  const rotW = parseFloat(document.getElementById('addrW').value) || 0;
  const posX = parseFloat(document.getElementById('addpX').value) || 0;
  const posY = parseFloat(document.getElementById('addpY').value) || 0;
  const posZ = parseFloat(document.getElementById('addpZ').value) || 0;
  const colorHex = document.getElementById('addColor').value;
  const rgb = hexToRgb(colorHex);
  const radius = parseFloat(document.getElementById('addRadius').value) || 0.5;
  const roughness = parseFloat(document.getElementById('addRoughness').value) || 0.1;
  const metallic = parseFloat(document.getElementById('addMetallic').value) || 0.5;
  const type = parseInt(document.getElementById('addType').value);

  state.entities.add(
    { x: rotX, y: rotY, z: rotZ, w: rotW },
    { x: posX, y: posY, z: posZ },
    { r: rgb.r, g: rgb.g, b: rgb.b },
    radius, roughness, metallic, type, 1
  );

  updateScene();
};

window.removeEntity = function (id) {
  state.entities.remove(id);
  updateScene();
};

window.updateEntity = function (element) {
  const id = parseInt(element.dataset.id);
  const field = element.dataset.field;
  const value = element.value;

  const entity = state.entities.get(id);
  if (!entity) return;

  switch (field) {
    case 'type':
      entity.type = parseInt(value);
      break;
    case 'rotX': entity.rotation.x = parseFloat(value); break;
    case 'rotY': entity.rotation.y = parseFloat(value); break;
    case 'rotZ': entity.rotation.z = parseFloat(value); break;
    case 'rotW': entity.rotation.w = parseFloat(value); break;
    case 'posX': entity.position.x = parseFloat(value); break;
    case 'posY': entity.position.y = parseFloat(value); break;
    case 'posZ': entity.position.z = parseFloat(value); break;
    case 'color': {
      const rgb = hexToRgb(value);
      entity.baseColor.r = rgb.r;
      entity.baseColor.g = rgb.g;
      entity.baseColor.b = rgb.b;
      break;
    }
    case 'radius': entity.radius = parseFloat(value); break;
    case 'roughness': entity.roughness = parseFloat(value); break;
    case 'metallic': entity.metallic = parseFloat(value); break;
  }

  updateScene();
};

function rgbToHex(r, g, b) {
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 1, g: 1, b: 1 };
}

function updateScene() {
  if (state.engine) {
    state.engine.entities = state.entities;
    state.engine.updateEntityTexture();
  }
  renderTable();
}

async function loadShader() {
  try {
    const response = await fetch('shader.c');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const userShaderCode = await response.text();
    console.log('Shader loaded, length:', userShaderCode.length);
    let engine = new Engine(state.entities, canvas, userShaderCode);

    engine.entities.add(
      { x: 0.0, y: 0.0, z: 0.0, w: 0.0 },// rotation (quaternion)
      { x: -1.5, y: 0.0, z: 0.0 },       // position
      { r: 0.9, g: 0.95, b: 1.0 },       // baseColor (chrome)
      1.0,                               // radius
      0.01,                              // roughness
      0.9,                               // metallic
      EntityType.SPHERE,                 // type: 0 = sphere
      1                                  // flags: active
    );
    engine.entities.add(
      { x: 0.0, y: 0.0, z: 0.0, w: 0.0 },// rotation (quaternion)
      { x: 1.5, y: 0.0, z: 0.0 },        // position
      { r: 1.0, g: 0.75, b: 0.3 },       // baseColor (gold)
      1.0,                               // radius
      0.15,                              // roughness
      0.85,                              // metallic
      EntityType.BOX,                 // type: 0 = sphere
      1                                  // flags: active
    );
    engine.entities.add(
      { x: 0.0, y: 0.0, z: 0.0, w: 0.0 },// rotation (quaternion)
      { x: 0.0, y: -1.0, z: 0.0 },       // position (floor plane)
      { r: 0, g: 0, b: 0 },        // baseColor
      0.0,                               // radius (unused for plane)
      0.4,                               // roughness
      0.0,                               // metallic
      EntityType.PLANE,                  // type: 2 = plane
      1                                  // flags: active
    );

    state.engine = engine;
    updateScene();
    state.engine.render();
  } catch (error) {
    console.error('Failed to load shader:', error);
    document.body.innerHTML = `<pre style="color:#f88;padding:2rem;">Error loading shader.c\n${error}</pre>`;
  }
}

window.updateScene = updateScene;

loadShader();