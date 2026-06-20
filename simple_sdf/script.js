// ─── Canvas & WebGL ──────────────────────────────────────────────
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2');

if (!gl) {
  document.body.innerHTML = `
        <div style="color:#fff;font:18px/1.6 system-ui;text-align:center;padding:3rem;">
          <strong>WebGL 2.0 not supported</strong><br />
          Please use a modern browser.
        </div>
      `;
  throw new Error('WebGL 2.0 not available');
}

// ─── Resize ──────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  gl.viewport(0, 0, w, h);
  // update resolution display
  document.getElementById('resolution').textContent = `${w}×${h}`;
}
window.addEventListener('resize', resize);
resize();

// ─── Mouse / Orbit ──────────────────────────────────────────────
let mouse = { x: 0, y: 0, down: false, lx: 0, ly: 0 };
let orbit = { theta: 0, phi: 0.35 };
let isDragging = false;

canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
  isDragging = true;
  mouse.lx = e.clientX;
  mouse.ly = e.clientY;
  canvas.style.cursor = 'grabbing';
});
window.addEventListener('mouseup', () => {
  mouse.down = false;
  isDragging = false;
  canvas.style.cursor = 'crosshair';
});
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = canvas.height - e.clientY;
  if (isDragging) {
    const dx = e.clientX - mouse.lx;
    const dy = e.clientY - mouse.ly;
    orbit.theta += dx * 0.005;
    orbit.phi = Math.max(-1.2, Math.min(1.2, orbit.phi + dy * 0.005));
    mouse.lx = e.clientX;
    mouse.ly = e.clientY;
  }
});

let touchId = null;
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  if (touchId === null) {
    touchId = t.identifier;
    mouse.lx = t.clientX;
    mouse.ly = t.clientY;
    isDragging = true;
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) {
      const dx = t.clientX - mouse.lx;
      const dy = t.clientY - mouse.ly;
      orbit.theta += dx * 0.005;
      orbit.phi = Math.max(-1.2, Math.min(1.2, orbit.phi + dy * 0.005));
      mouse.lx = t.clientX;
      mouse.ly = t.clientY;
      mouse.x = t.clientX;
      mouse.y = canvas.height - t.clientY;
    }
  }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === touchId) {
      touchId = null;
      isDragging = false;
    }
  }
}, { passive: true });

// ─── Shader source (your exact code) ────────────────────────────
const userShaderCode = `
      #define MAX_STEPS 150
      #define MAX_DIST 50.
      #define SURF_DIST .001
      #define MAX_BOUNCES 3

      float GetDist(vec3 p) {
        vec3 s1Pos = vec3(-1.5, 0.0 + sin(iTime)*0.2, 0.0);
        float sphere1 = length(p - s1Pos) - 1.0;
        vec3 s2Pos = vec3(1.5, 0.0 + cos(iTime)*0.2, 0.0);
        float sphere2 = length(p - s2Pos) - 1.0;
        float floorPlane = p.y + 1.0;
        return min(min(sphere1, sphere2), floorPlane);
      }

      int GetMaterialID(vec3 p) {
        vec3 s1Pos = vec3(-1.5, 0.0 + sin(iTime)*0.2, 0.0);
        float sphere1 = length(p - s1Pos) - 1.0;
        vec3 s2Pos = vec3(1.5, 0.0 + cos(iTime)*0.2, 0.0);
        float sphere2 = length(p - s2Pos) - 1.0;
        float floorPlane = p.y + 1.0;
        float minDist = min(min(sphere1, sphere2), floorPlane);
        if (abs(minDist - sphere1) < 0.002) return 1;
        if (abs(minDist - sphere2) < 0.002) return 2;
        return 3;
      }

      float RayMarch(vec3 ro, vec3 rd, out int steps) {
        float dO = 0.0;
        steps = 0;
        for(int i=0; i<MAX_STEPS; i++) {
          steps = i;
          vec3 p = ro + rd * dO;
          float dS = GetDist(p);
          dO += dS;
          if(dO > MAX_DIST || abs(dS) < SURF_DIST) break;
        }
        return dO;
      }

      vec3 GetNormal(vec3 p) {
        float d = GetDist(p);
        vec2 e = vec2(.001, 0);
        vec3 n = d - vec3(
          GetDist(p-e.xyy),
          GetDist(p-e.yxy),
          GetDist(p-e.yyx)
        );
        return normalize(n);
      }

      float GetShadow(vec3 ro, vec3 rd, float minT, float maxT) {
        float res = 1.0;
        float t = minT;
        for(int i=0; i<40; i++) {
          float h = GetDist(ro + rd * t);
          if(h < SURF_DIST) return 0.0;
          res = min(res, 16.0 * h / t);
          t += h;
          if(t > maxT) break;
        }
        return res;
      }

      float GetAO(vec3 p, vec3 n) {
        float occ = 0.0;
        float sca = 1.0;
        for(int i=0; i<5; i++) {
          float hr = 0.01 + 0.12*float(i)/4.0;
          vec3 aopos = n * hr + p;
          float dd = GetDist(aopos);
          occ += -(dd-hr)*sca;
          sca *= 0.95;
        }
        return clamp(1.0 - 3.0*occ, 0.0, 1.0);
      }

      vec3 GetSkyColor(vec3 rd) {
        float horizon = max(0.0, dot(rd, vec3(0.0, 1.0, 0.0)));
        vec3 sky = mix(vec3(0.03, 0.05, 0.1), vec3(0.4, 0.6, 0.9), horizon);
        vec3 sunDir = normalize(vec3(4.0, 6.0, -3.0));
        float sun = pow(max(0.0, dot(rd, sunDir)), 128.0);
        sky += vec3(1.0, 0.9, 0.7) * sun * 2.0;
        return sky;
      }

      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

        float theta = iMouse.x / 100.0;
        float phi   = 0.35 + (iMouse.y / 5000.0);
        float dist  = 5.0;
        vec3  target = vec3(0.0, 0.0, 0.0);

        vec3 camPos = vec3(
          dist * sin(theta) * cos(phi),
          dist * sin(phi),
          dist * cos(theta) * cos(phi)
        );
        vec3 ro = camPos;
        vec3 f = normalize(target - ro);
        vec3 r = normalize(cross(vec3(0,1,0), f));
        vec3 u = cross(f, r);
        vec3 rd = normalize(f + uv.x * r + uv.y * u);

        vec3 mainLightDir = normalize(vec3(4.0, 6.0, -3.0));
        vec3 finalColor = vec3(0.0);
        vec3 throughput = vec3(1.0);

        for(int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
          int steps;
          float d = RayMarch(ro, rd, steps);

          if(d < MAX_DIST) {
            vec3 p = ro + rd * d;
            vec3 n = GetNormal(p);
            int matID = GetMaterialID(p);

            vec3 baseColor = vec3(1.0);
            float roughness = 0.1;
            float metallic = 0.0;

            if(matID == 1) {
              baseColor = vec3(0.9, 0.95, 1.0);
              roughness = 0.01;
              metallic = 0.9;
            } else if(matID == 2) {
              baseColor = vec3(1.0, 0.75, 0.3);
              roughness = 0.15;
              metallic = 0.85;
            } else if(matID == 3) {
              vec2 grid = floor(p.xz * 1.5);
              float checker = mod(grid.x + grid.y, 2.0);
              baseColor = mix(vec3(0.1), vec3(0.8), checker);
              roughness = 0.4;
              metallic = 0.0;
            }

            float shadow = GetShadow(p + n * SURF_DIST * 2.0, mainLightDir, 0.01, 10.0);
            float ao = GetAO(p, n);

            float dif = clamp(dot(n, mainLightDir), 0.0, 1.0) * shadow;
            vec3 viewDir = -rd;
            vec3 halfDir = normalize(mainLightDir + viewDir);
            float spec = pow(clamp(dot(n, halfDir), 0.0, 1.0), mix(128.0, 16.0, roughness)) * shadow;

            float fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 5.0);
            float reflectionStrength = mix(0.1, 1.0, fresnel) * (1.0 - roughness);
            if(metallic > 0.5) reflectionStrength = mix(0.5, 1.0, fresnel);

            vec3 ambient = vec3(0.04) * baseColor * ao;
            vec3 directLighting = (baseColor * dif + vec3(1.0, 0.9, 0.8) * spec * (1.0 - roughness));

            finalColor += throughput * mix(ambient + directLighting, vec3(0.0), reflectionStrength);

            throughput *= mix(baseColor, vec3(1.0), 1.0 - metallic) * reflectionStrength;
            ro = p + n * SURF_DIST * 2.0;
            rd = reflect(rd, n);

          } else {
            finalColor += throughput * GetSkyColor(rd);
            break;
          }
        }

        finalColor = pow(finalColor, vec3(1.0 / 2.2));
        fragColor = vec4(finalColor, 1.0);
      }
    `;

// ─── Full fragment shader ────────────────────────────────────────
const fragmentShaderSource = `#version 300 es
      precision highp float;

      uniform vec2  iResolution;
      uniform float iTime;
      uniform vec4  iMouse;

      ${userShaderCode}

      out vec4 fragColor;
      void main() {
        mainImage(fragColor, gl_FragCoord.xy);
      }
    `;

// ─── Vertex Shader ──────────────────────────────────────────────
const vsSource = `#version 300 es
      in vec2 aPos;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;

// ─── Compile helpers ────────────────────────────────────────────
function compileShader(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ─── Compile ────────────────────────────────────────────────────
const vs = compileShader(vsSource, gl.VERTEX_SHADER);
const fs = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
if (!vs || !fs) throw new Error('Shader compilation failed');

const program = createProgram(vs, fs);
if (!program) throw new Error('Program link failed');

gl.useProgram(program);

const uResolution = gl.getUniformLocation(program, 'iResolution');
const uTime = gl.getUniformLocation(program, 'iTime');
const uMouse = gl.getUniformLocation(program, 'iMouse');

// ─── Vertex data ────────────────────────────────────────────────
const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

const aPos = gl.getAttribLocation(program, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

// ─── Performance tracking ──────────────────────────────────────
let startTime = performance.now();
let frameCount = 0;
let lastFpsUpdate = startTime;
let fps = 0;
let avgFrameTime = 0;
let frameTimeSum = 0;
let frameTimeCount = 0;

const fpsElement = document.getElementById('fps');
const frameTimeElement = document.getElementById('frametime');

// ─── Render loop ────────────────────────────────────────────────
function render() {
  const now = performance.now();
  const delta = now - startTime; // time since last frame
  startTime = now;

  // FPS counter
  frameCount++;
  frameTimeSum += delta;
  frameTimeCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = frameCount;
    avgFrameTime = frameTimeSum / frameTimeCount;
    frameCount = 0;
    frameTimeSum = 0;
    frameTimeCount = 0;
    lastFpsUpdate = now;

    fpsElement.textContent = fps;
    frameTimeElement.textContent = avgFrameTime.toFixed(1);
  }

  // Shader uniforms
  const w = canvas.width;
  const h = canvas.height;
  const iMouseX = orbit.theta * 100.0;
  const iMouseY = (orbit.phi - 0.35) * 5000.0;

  gl.uniform2f(uResolution, w, h);
  gl.uniform1f(uTime, (now - performance.timing?.navigationStart || 0) / 1000); // fallback
  gl.uniform4f(uMouse, iMouseX, iMouseY, 0.0, 0.0);

  gl.clearColor(0.02, 0.02, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  requestAnimationFrame(render);
}

render();

// ─── Resize handler ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  resize();
  gl.uniform2f(uResolution, canvas.width, canvas.height);
});
