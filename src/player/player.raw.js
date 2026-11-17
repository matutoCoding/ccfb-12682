/**
 * Fountain Studio 独立播放器 / 渲染引擎（零依赖原生 JS + WebGL2）
 *
 * 重要：本文件同时被 (1) 编辑器 3D 预演页 (2) 导出的单文件分享 HTML 使用，
 * 以保证两边画面与节奏完全一致。不要引入任何 import，分享导出时整体内联。
 * 物理常数需与 src/core/physics.ts 保持同步。
 *
 * @typedef {import('./player').ProjectLike} ProjectLike
 */

const GRAVITY = 9.81;
const ORIFICE_CD = 0.62;
const JET_EFFICIENCY = 0.85;
const JET_SEGMENTS = 16;
const CURTAIN_STREAMS = 9;
const MAX_JET_VERTS = 120000;

/* ---------------- 小工具 ---------------- */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg2rad = (d) => (d * Math.PI) / 180;

function jetHeightOf(spec) {
  return JET_EFFICIENCY * spec.pressureBar * 10;
}

/* ---------------- 时间线求值 ---------------- */

function patternLevel(clip, localT, idx, total) {
  const d = Math.max(0.001, clip.durationSec);
  const u = clamp(localT / d, 0, 1);
  const L = clip.level01 ?? 1;
  switch (clip.pattern) {
    case 'constant':
      return L;
    case 'pulse': {
      const k = Math.floor(u * (clip.pulseCount || 1) * 2);
      return k % 2 === 0 ? L : 0;
    }
    case 'chase': {
      const step = Math.max(0.05, clip.chaseStepSec || 0.25);
      const slot = Math.floor(localT / step) % Math.max(1, total);
      return slot === idx ? L : 0;
    }
    case 'wave': {
      const f = clip.waveFreq || 0.5;
      return L * (0.5 + 0.5 * Math.sin(2 * Math.PI * (f * localT - idx / Math.max(1, total))));
    }
    case 'burst':
      return L * Math.exp(-3.5 * u);
    default:
      return L;
  }
}

/**
 * 计算某一时刻全部喷头 / 灯光状态。
 * out 可传入复用对象避免每帧分配（长播放不掉帧的关键之一）。
 * @param {ProjectLike} project
 * @param {number} timeSec
 * @param {string[]} overrideIds 试喷喷头 id（恒满开度，忽略时间线）
 * @param {any} [out]
 */
export function evaluateFrame(project, timeSec, overrideIds, out) {
  const nozzles = project.nozzles;
  const lights = project.lights || [];
  if (!out || out.nozzles.length !== nozzles.length || out.lights.length !== lights.length) {
    out = {
      nozzles: nozzles.map(() => ({ level: 0, tiltAngleDeg: 0, tiltAxisX: 0, tiltAxisZ: 0 })),
      lights: lights.map(() => ({ r: 0, g: 0, b: 0, intensity: 0 })),
    };
  }
  const override = new Set(overrideIds || []);
  for (let i = 0; i < nozzles.length; i++) {
    const nz = nozzles[i];
    let level = 0;
    for (const clip of project.waterClips) {
      if (timeSec < clip.startSec || timeSec > clip.startSec + clip.durationSec) continue;
      const idx = clip.targetIds.indexOf(nz.id);
      if (idx < 0) continue;
      const v = patternLevel(clip, timeSec - clip.startSec, idx, clip.targetIds.length);
      if (v > level) level = v;
    }
    if (override.has(nz.id)) level = 1;
    const st = out.nozzles[i];
    st.level = level;
    if (nz.type === 'swing' && level > 0.001) {
      const a = nz.spec.swingAngleDeg || 0;
      st.tiltAngleDeg = Math.sin((2 * Math.PI * timeSec) / Math.max(0.1, nz.spec.swingPeriodSec)) * a;
      const rot = deg2rad(nz.rotationDeg || 0);
      st.tiltAxisX = Math.sin(rot);
      st.tiltAxisZ = Math.cos(rot);
    } else {
      st.tiltAngleDeg = 0;
      st.tiltAxisX = 0;
      st.tiltAxisZ = 0;
    }
  }
  for (let i = 0; i < lights.length; i++) {
    const lc = lights[i];
    const st = out.lights[i];
    st.r = 0.15;
    st.g = 0.25;
    st.b = 0.4;
    st.intensity = 0.25;
    for (const clip of project.lightClips) {
      if (timeSec < clip.startSec || timeSec > clip.startSec + clip.durationSec) continue;
      if (clip.lightIds.indexOf(lc.id) < 0) continue;
      let inten = clip.intensity ?? 1;
      if (clip.pulse) inten *= 0.5 + 0.5 * Math.sin(2 * Math.PI * (clip.pulseHz || 1) * timeSec);
      st.r = clip.color[0];
      st.g = clip.color[1];
      st.b = clip.color[2];
      st.intensity = inten;
    }
  }
  return out;
}

/* ---------------- 水柱几何 ---------------- */

/**
 * 采样单条水柱抛物线（世界水平位移 + 高度），风偏按经验加速度处理。
 * 返回 {hx, hz, up} 三个长度 JET_SEGMENTS+1 的数组视图（复用传入缓冲）。
 */
function sampleJetInto(buf, nozzle, level, tiltDeg, axisX, axisZ, windX, windZ) {
  const spec = nozzle.spec;
  const v0 = ORIFICE_CD * Math.sqrt((2 * spec.pressureBar * 1e5) / 1000) * clamp(level, 0, 1);
  const tilt = deg2rad(tiltDeg);
  const vx = v0 * Math.sin(tilt) * axisX;
  const vz = v0 * Math.sin(tilt) * axisZ;
  const vy = v0 * Math.cos(tilt);
  const disc = vy * vy + 2 * GRAVITY * 0.05;
  const tEnd = disc > 0 ? (vy + Math.sqrt(disc)) / GRAVITY : 0;
  const windK = 0.12;
  const ax = windK * windX;
  const az = windK * windZ;
  const n = JET_SEGMENTS + 1;
  for (let i = 0; i < n; i++) {
    const t = (tEnd * i) / JET_SEGMENTS;
    buf.hx[i] = vx * t + 0.5 * ax * t * t;
    buf.hz[i] = vz * t + 0.5 * az * t * t;
    buf.up[i] = Math.max(0, vy * t - 0.5 * GRAVITY * t * t);
  }
  return n;
}

/* ---------------- 4x4 矩阵（列主序） ---------------- */

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function mat4LookAt(eye, center, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -x[0] * eye[0] - x[1] * eye[1] - x[2] * eye[2];
  m[13] = -y[0] * eye[0] - y[1] * eye[1] - y[2] * eye[2];
  m[14] = -z[0] * eye[0] - z[1] * eye[1] - z[2] * eye[2];
  m[15] = 1;
  return m;
}

function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function mat4Scale(x, y, z) {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

function mat4RotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  const m = mat4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

/* ---------------- WebGL2 渲染器 ---------------- */

const VS_BASIC = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
void main(){ gl_Position = uMVP * vec4(aPos,1.0); }`;

const FS_BASIC = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main(){ outColor = uColor; }`;

const VS_INST = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aInstance; // x,z,rotation,scale
layout(location=2) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main(){
  float c=cos(aInstance.z), s=sin(aInstance.z);
  vec3 p = aPos * aInstance.w;
  vec3 r = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
  r.x += aInstance.x; r.z += aInstance.y;
  gl_Position = uViewProj * vec4(r,1.0);
  vColor = aColor.rgb;
}`;

const FS_INST = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main(){ outColor = vec4(vColor,1.0); }`;

const VS_WATER = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
uniform mat4 uMVP;
uniform float uTime;
out vec2 vUv;
void main(){
  vec3 p = aPos;
  p.y += 0.06 * sin(p.x*0.8 + uTime*1.4) * cos(p.z*0.7 + uTime*1.1);
  gl_Position = uMVP * vec4(p,1.0);
  vUv = aUv;
}`;

const FS_WATER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uTime;
out vec4 outColor;
void main(){
  float ripple = 0.5 + 0.5*sin(vUv.x*40.0 + uTime*2.0)*cos(vUv.y*34.0 - uTime*1.7);
  vec3 deep = vec3(0.02,0.10,0.18);
  vec3 shallow = vec3(0.08,0.32,0.45);
  vec3 col = mix(deep, shallow, ripple*0.5+0.25);
  outColor = vec4(col, 0.32);
}`;

const VS_JET = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uMVP;
uniform float uTint;
out vec4 vColor;
void main(){
  gl_Position = uMVP * vec4(aPos,1.0);
  vColor = vec4(aColor.rgb * uTint, aColor.a);
}`;

const FS_JET = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main(){ outColor = vColor; }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader 编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function makeMesh(gl, data, mode) {
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { vbo, count: data.length / 3, mode };
}

function coneMesh(radius, height, segments = 12) {
  const d = [0, height, 0];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    d.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const out = [];
  for (let i = 1; i <= segments; i++) out.push(0, i, i + 1);
  const idx = new Uint16Array(out);
  return { vertices: new Float32Array(d), indices: idx };
}

function boxMesh(w, h, d) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const v = new Float32Array([
    -hx,-hy,-hz, hx,-hy,-hz, hx,hy,-hz, -hx,hy,-hz,
    -hx,-hy,hz, hx,-hy,hz, hx,hy,hz, -hx,hy,hz,
  ]);
  const idx = new Uint16Array([
    0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,3,7, 0,7,4,
    1,5,6, 1,6,2, 3,2,6, 3,6,7, 0,4,5, 0,5,1,
  ]);
  return { vertices: v, indices: idx };
}

export class FountainRenderer {
  /** @param {HTMLCanvasElement} canvas @param {ProjectLike} project */
  constructor(canvas, project) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    // 兼容 StrictMode 双挂载：同一 canvas 旧上下文可能处于 lost 状态
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (gl.isContextLost() && loseExt) loseExt.restoreContext();
    this.gl = gl;
    this.canvas = canvas;
    this.progBasic = program(gl, VS_BASIC, FS_BASIC);
    this.progInst = program(gl, VS_INST, FS_INST);
    this.progWater = program(gl, VS_WATER, FS_WATER);
    this.progJet = program(gl, VS_JET, FS_JET);
    this.locBasic = { mvp: gl.getUniformLocation(this.progBasic, 'uMVP'), color: gl.getUniformLocation(this.progBasic, 'uColor') };
    this.locInst = { vp: gl.getUniformLocation(this.progInst, 'uViewProj') };
    this.locWater = { mvp: gl.getUniformLocation(this.progWater, 'uMVP'), time: gl.getUniformLocation(this.progWater, 'uTime') };
    this.locJet = { mvp: gl.getUniformLocation(this.progJet, 'uMVP'), tint: gl.getUniformLocation(this.progJet, 'uTint') };

    // 相机轨道参数
    this.yaw = Math.PI * 0.25;
    this.pitch = 0.62;
    this.distance = 34;
    this.target = [0, 1.5, 0];

    // 水柱动态缓冲（预分配，长播放零 GC）
    this.jetData = new Float32Array(MAX_JET_VERTS * 7); // pos3 + rgba4
    this.jetVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.jetVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.jetData.byteLength, gl.DYNAMIC_DRAW);
    this.jetVertCount = 0;
    this.sampleBuf = { hx: new Float32Array(JET_SEGMENTS + 1), hz: new Float32Array(JET_SEGMENTS + 1), up: new Float32Array(JET_SEGMENTS + 1) };
    this.frame = null;
    this.wind = { x: 0, z: 0 };
    this.time = 0;

    this._buildStatic();
    this.setProject(project);
    this._bindControls();
    this.resize();
  }

  _buildStatic() {
    const gl = this.gl;
    // 地面网格
    const grid = [];
    const R = 40;
    for (let i = -R; i <= R; i += 2) {
      grid.push(i, -0.02, -R, i, -0.02, R, -R, -0.02, i, R, -0.02, i);
    }
    this.meshGrid = makeMesh(gl, new Float32Array(grid), gl.LINES);

    // 单位圆锥（喷头底座）与立方体（泵/灯），含索引
    const cone = coneMesh(0.28, 0.55);
    this.cone = this._indexed(cone.vertices, cone.indices);
    const box = boxMesh(1, 1, 1);
    this.box = this._indexed(box.vertices, box.indices);

    // 实例缓冲
    this.instNozzle = { vbo: gl.createBuffer(), data: new Float32Array(0), count: 0, cap: 0 };
    this.instPump = { vbo: gl.createBuffer(), data: new Float32Array(0), count: 0, cap: 0 };
    this.instLight = { vbo: gl.createBuffer(), data: new Float32Array(0), count: 0, cap: 0 };
    this.vaoInst = gl.createVertexArray();

    // 水面
    const wv = [], uv = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = (i / N - 0.5), z0 = (j / N - 0.5);
        wv.push(0, 0, 0); uv.push(0, 0);
      }
    }
    // 用两个三角形拼整面（水波在 shader 里做）
    this.water = { vbo: gl.createBuffer(), uvbo: gl.createBuffer(), count: 6 };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.water.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.water.uvbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.waterVao = gl.createVertexArray();

    // 水柱 VAO
    this.jetVao = gl.createVertexArray();
    gl.bindVertexArray(this.jetVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.jetVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }

  _indexed(vertices, indices) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vboRef: vbo, iboRef: ibo, count: indices.length };
  }

  /** @param {ProjectLike} project */
  setProject(project) {
    this.project = project;
    const gl = this.gl;
    const writeInst = (slot, rows) => {
      const need = rows.length * 8;
      if (slot.cap < need) {
        slot.data = new Float32Array(Math.max(need, slot.cap * 2 || 64));
        slot.cap = slot.data.length;
        gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, slot.data.byteLength, gl.DYNAMIC_DRAW);
      }
      slot.data.set(rows.flat(), 0);
      slot.count = rows.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, slot.data.subarray(0, need));
    };
    const nzRows = project.nozzles.map((n) => {
      const scale = 0.7 + Math.min(1.2, n.spec.diameterMm / 25);
      const col = this._groupColor(n);
      return [n.x, n.y, deg2rad(n.rotationDeg || 0), scale, col[0], col[1], col[2], 1];
    });
    const pumpRows = project.pumps.map((p) => [p.x, p.y, 0, 0.9, 0.45, 0.45, 0.5, 1]);
    const lightRows = project.lights.map((l) => [l.x, l.y, 0, 0.5, 0.9, 0.85, 0.4, 1]);
    writeInst(this.instNozzle, nzRows);
    writeInst(this.instPump, pumpRows);
    writeInst(this.instLight, lightRows);
  }

  _groupColor(n) {
    const g = (this.project.groups || []).find((x) => x.id === n.groupId);
    if (!g) return [0.4, 0.6, 0.9];
    const h = g.color.replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }

  setFrame(frame, wind) {
    this.frame = frame;
    this.wind = wind || { x: 0, z: 0 };
  }

  resetCamera() {
    this.yaw = Math.PI * 0.25;
    this.pitch = 0.62;
    this.distance = 34;
    this.target = [0, 1.5, 0];
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  _bindControls() {
    const c = this.canvas;
    let mode = 0, lx = 0, ly = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      mode = e.button === 2 ? 2 : 1;
      lx = e.clientX; ly = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (mode === 1) {
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.006, 0.12, 1.45);
      } else {
        const s = this.distance * 0.0016;
        const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        this.target[0] -= right[0] * dx * s;
        this.target[2] -= right[2] * dx * s;
        this.target[1] = clamp(this.target[1] + dy * s, 0, 12);
      }
    });
    const up = () => { mode = 0; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.08), 6, 120);
    }, { passive: false });
  }

  _cameraMatrices() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * sp,
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
    const view = mat4LookAt(eye, this.target, [0, 1, 0]);
    const proj = mat4Perspective(Math.PI / 4, this.canvas.width / this.canvas.height, 0.1, 400);
    return { view, proj, vp: mat4Multiply(proj, view), eye };
  }

  /** 每帧更新水柱顶点（动态 VBO，subData 上传） */
  _updateJets() {
    const p = this.project;
    if (!this.frame) { this.jetVertCount = 0; return; }
    const data = this.jetData;
    let w = 0;
    const put = (wx, wy, wz, r, g, b, a) => {
      if (w + 7 > data.length) return;
      data[w++] = wx; data[w++] = wy; data[w++] = wz;
      data[w++] = r; data[w++] = g; data[w++] = b; data[w++] = a;
    };
    const viewRight = this._viewRight;
    for (let i = 0; i < p.nozzles.length; i++) {
      const nz = p.nozzles[i];
      const st = this.frame.nozzles[i];
      if (!st || st.level <= 0.01) continue;
      const tint = this._nozzleTint(nz, i);
      if (nz.type === 'curtain') {
        this._writeCurtain(nz, st, tint, viewRight, put);
      } else {
        this._writeRibbon(nz, st, tint, viewRight, put);
      }
    }
    this.jetVertCount = w / 7;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.jetVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, w));
  }

  _nozzleTint(nz, idx) {
    const base = [0.55, 0.78, 1.0];
    if (!nz.lightId) return { r: base[0], g: base[1], b: base[2] };
    const li = (this.project.lights || []).findIndex((l) => l.id === nz.lightId);
    if (li < 0 || !this.frame) return { r: base[0], g: base[1], b: base[2] };
    const ls = this.frame.lights[li];
    const k = clamp(ls.intensity, 0, 1.4);
    return {
      r: clamp(base[0] * 0.35 + ls.r * k, 0, 1.6),
      g: clamp(base[1] * 0.35 + ls.g * k, 0, 1.6),
      b: clamp(base[2] * 0.35 + ls.b * k, 0, 1.6),
    };
  }

  _writeRibbon(nz, st, tint, right, put) {
    const buf = this.sampleBuf;
    const n = sampleJetInto(buf, nz, st.level, st.tiltAngleDeg, st.tiltAxisX, st.tiltAxisZ, this.wind.x, this.wind.z);
    const baseR = 0.05 + (nz.spec.diameterMm / 1000) * 1.6;
    for (let i = 0; i < n - 1; i++) {
      const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
      const r0 = baseR * (1 - t0 * 0.85), r1 = baseR * (1 - t1 * 0.85);
      const a0 = 0.85 * (1 - t0 * 0.55), a1 = 0.85 * (1 - t1 * 0.55);
      const p0 = [nz.x + buf.hx[i], buf.up[i], nz.y + buf.hz[i]];
      const p1 = [nz.x + buf.hx[i + 1], buf.up[i + 1], nz.y + buf.hz[i + 1]];
      const q0 = [p0[0] + right[0] * r0, p0[1] + right[1] * r0, p0[2] + right[2] * r0];
      const q0b = [p0[0] - right[0] * r0, p0[1] - right[1] * r0, p0[2] - right[2] * r0];
      const q1 = [p1[0] + right[0] * r1, p1[1] + right[1] * r1, p1[2] + right[2] * r1];
      const q1b = [p1[0] - right[0] * r1, p1[1] - right[1] * r1, p1[2] - right[2] * r1];
      this._tri(q0, q0b, q1, tint, a0, a1, put);
      this._tri(q0b, q1b, q1, tint, a0, a1, put);
    }
  }

  _writeCurtain(nz, st, tint, right, put) {
    const rot = deg2rad(nz.rotationDeg || 0);
    const dir = [Math.sin(rot), Math.cos(rot)];
    const w = nz.spec.curtainWidth || 6;
    for (let s = 0; s < CURTAIN_STREAMS; s++) {
      const off = (s / (CURTAIN_STREAMS - 1) - 0.5) * w;
      const ox = dir[0] * off, oz = dir[1] * off;
      const fan = (off / (w / 2)) * 9;
      const fake = { ...nz, x: nz.x + ox, y: nz.y + oz };
      const st2 = { level: st.level, tiltAngleDeg: fan, tiltAxisX: dir[0], tiltAxisZ: dir[1] };
      const buf = this.sampleBuf;
      const n = sampleJetInto(buf, fake, st2.level, st2.tiltAngleDeg, st2.tiltAxisX, st2.tiltAxisZ, this.wind.x, this.wind.z);
      const baseR = 0.035;
      for (let i = 0; i < n - 1; i++) {
        const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
        const r0 = baseR * (1 - t0 * 0.8), r1 = baseR * (1 - t1 * 0.8);
        const p0 = [fake.x + buf.hx[i], buf.up[i], fake.y + buf.hz[i]];
        const p1 = [fake.x + buf.hx[i + 1], buf.up[i + 1], fake.y + buf.hz[i + 1]];
        const q0 = [p0[0] + right[0] * r0, p0[1] + right[1] * r0, p0[2] + right[2] * r0];
        const q0b = [p0[0] - right[0] * r0, p0[1] - right[1] * r0, p0[2] - right[2] * r0];
        const q1 = [p1[0] + right[0] * r1, p1[1] + right[1] * r1, p1[2] + right[2] * r1];
        const q1b = [p1[0] - right[0] * r1, p1[1] - right[1] * r1, p1[2] - right[2] * r1];
        const a0 = 0.7 * (1 - t0 * 0.5), a1 = 0.7 * (1 - t1 * 0.5);
        this._tri(q0, q0b, q1, tint, a0, a1, put);
        this._tri(q0b, q1b, q1, tint, a0, a1, put);
      }
    }
  }

  _tri(a, b, c, tint, aa, ab, put) {
    put(a[0], a[1], a[2], tint.r, tint.g, tint.b, aa);
    put(b[0], b[1], b[2], tint.r, tint.g, tint.b, aa);
    put(c[0], c[1], c[2], tint.r, tint.g, tint.b, ab);
  }

  _renderInst(mesh, slot, vp) {
    const gl = this.gl;
    gl.useProgram(this.progInst);
    gl.uniformMatrix4fv(this.locInst.vp, false, vp);
    gl.bindVertexArray(this.vaoInst);
    // 位置：单位网格
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vboRef);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    // 实例属性
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.vbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.iboRef);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, slot.count);
    gl.vertexAttribDivisor(1, 0);
    gl.vertexAttribDivisor(2, 0);
    gl.bindVertexArray(null);
  }

  render(timeMs) {
    const gl = this.gl;
    this.time = (timeMs || performance.now()) / 1000;
    this.resize();
    const { vp, view } = this._cameraMatrices();
    this._viewRight = [view[0], view[4], view[8]]; // 视图空间右向量在世界系
    const lr = Math.hypot(this._viewRight[0], this._viewRight[1], this._viewRight[2]) || 1;
    this._viewRight = [this._viewRight[0] / lr, this._viewRight[1] / lr, this._viewRight[2] / lr];

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.03, 0.05, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 不透明：网格
    gl.useProgram(this.progBasic);
    gl.uniformMatrix4fv(this.locBasic.mvp, false, vp);
    gl.uniform4f(this.locBasic.color, 0.18, 0.24, 0.32, 1);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshGrid.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(this.meshGrid.mode, 0, this.meshGrid.count);

    // 池边
    const p = this.project;
    const rim = mat4Multiply(vp, mat4Multiply(mat4Translate(0, 0.06, 0), mat4Scale(p.poolW + 0.6, 0.12, p.poolH + 0.6)));
    gl.uniformMatrix4fv(this.locBasic.mvp, false, rim);
    gl.uniform4f(this.locBasic.color, 0.32, 0.34, 0.38, 1);
    this._drawUnitBox();

    // 实例：喷头 / 泵 / 灯
    this._renderInst(this.cone, this.instNozzle, vp);
    this._renderInst(this.box, this.instPump, vp);
    this._renderInst(this.box, this.instLight, vp);

    // 动态水柱
    this._updateJets();

    // 倒影：镜像矩阵 y -> -y 后再画一遍水柱
    const mirror = mat4Scale(1, -1, 1);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (this.jetVertCount > 0) {
      gl.useProgram(this.progJet);
      gl.bindVertexArray(this.jetVao);
      gl.uniformMatrix4fv(this.locJet.mvp, false, mat4Multiply(vp, mirror));
      gl.uniform1f(this.locJet.tint, 0.35);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, this.jetVertCount);
    }

    // 水面
    gl.useProgram(this.progWater);
    const waterM = mat4Multiply(vp, mat4Scale(p.poolW, 1, p.poolH));
    gl.uniformMatrix4fv(this.locWater.mvp, false, waterM);
    gl.uniform1f(this.locWater.time, this.time);
    gl.bindVertexArray(this.waterVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.water.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.water.uvbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.water.count);

    // 真正的水柱（加色混合，发光感）
    if (this.jetVertCount > 0) {
      gl.useProgram(this.progJet);
      gl.bindVertexArray(this.jetVao);
      gl.uniformMatrix4fv(this.locJet.mvp, false, vp);
      gl.uniform1f(this.locJet.tint, 1);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, this.jetVertCount);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawUnitBox() {
    const gl = this.gl;
    if (!this._unitBoxReady) {
      const b = boxMesh(1, 1, 1);
      this._unitBoxVao = gl.createVertexArray();
      gl.bindVertexArray(this._unitBoxVao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, b.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.STATIC_DRAW);
      this._unitBoxCount = b.indices.length;
      gl.bindVertexArray(null);
      this._unitBoxReady = true;
    }
    gl.bindVertexArray(this._unitBoxVao);
    gl.drawElements(gl.TRIANGLES, this._unitBoxCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  dispose() {
    // 注意：不能 loseContext —— React StrictMode 双挂载时同一 canvas 会取回已丢失上下文。
    // 仅删除 GL 资源并复位画布尺寸，上下文留给浏览器回收。
    const gl = this.gl;
    const buffers = [this.jetVbo, this.meshGrid?.vbo, this.water?.vbo, this.water?.uvbo,
      this.instNozzle?.vbo, this.instPump?.vbo, this.instLight?.vbo];
    for (const b of buffers) if (b) try { gl.deleteBuffer(b); } catch {}
    this.jetVertCount = 0;
  }
}

/* ---------------- 独立分享播放器 ---------------- */

const PLAYER_CSS = `
.fs-wrap{position:fixed;inset:0;background:#070b13;color:#e8eef7;font-family:"Microsoft YaHei",system-ui,sans-serif;display:flex;flex-direction:column}
.fs-stage{flex:1;position:relative;min-height:0}
.fs-stage canvas{width:100%;height:100%;display:block;touch-action:none}
.fs-bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#0d1522;border-top:1px solid #1d2a3d}
.fs-btn{background:#1d3a66;color:#e8eef7;border:1px solid #2f5b96;border-radius:6px;padding:6px 14px;font-size:14px;cursor:pointer}
.fs-btn:hover{background:#274f88}
.fs-time{font-variant-numeric:tabular-nums;font-size:13px;color:#9fb4cc;min-width:110px}
.fs-seek{flex:1;height:6px;background:#1d2a3d;border-radius:3px;position:relative;cursor:pointer}
.fs-seek .fs-fill{position:absolute;left:0;top:0;bottom:0;background:#4e9eff;border-radius:3px}
.fs-title{font-size:14px;font-weight:600;padding:8px 16px;background:#0d1522}
.fs-hint{position:absolute;top:12px;right:12px;font-size:12px;color:#7d93ad;background:rgba(10,18,30,.7);padding:6px 10px;border-radius:6px}
.fs-fps{position:absolute;left:12px;top:12px;font-size:12px;color:#7d93ad;background:rgba(10,18,30,.7);padding:4px 8px;border-radius:6px;font-variant-numeric:tabular-nums}
.fs-loop{font-size:12px;color:#f0a93b}
`;

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), t = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

/**
 * 挂载独立播放器。data = { project, audioDataUri, loopStart?, loopEnd? }
 * @param {HTMLElement} root
 * @param {{project:ProjectLike,audioDataUri:string|null,loopStart?:number,loopEnd?:number}} data
 */
export function mountStandalone(root, data) {
  const project = data.project;
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = PLAYER_CSS;
  root.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'fs-wrap';
  wrap.innerHTML = `
    <div class="fs-title">${escapeHtml(project.name)} · 喷泉预演</div>
    <div class="fs-stage">
      <canvas></canvas>
      <div class="fs-hint">左键旋转 · 滚轮缩放 · 右键平移</div>
      <div class="fs-fps">-- FPS</div>
    </div>
    <div class="fs-bar">
      <button class="fs-btn fs-play">播放</button>
      <span class="fs-time">0:00.0 / ${fmt(project.audio ? project.audio.durationSec : 0)}</span>
      <div class="fs-seek"><div class="fs-fill" style="width:0%"></div></div>
      ${data.loopStart != null ? '<span class="fs-loop">循环段已启用</span>' : ''}
    </div>`;
  root.appendChild(wrap);
  const canvas = wrap.querySelector('canvas');
  const btn = wrap.querySelector('.fs-play');
  const timeEl = wrap.querySelector('.fs-time');
  const seek = wrap.querySelector('.fs-seek');
  const fill = wrap.querySelector('.fs-fill');
  const fpsEl = wrap.querySelector('.fs-fps');

  const renderer = new FountainRenderer(canvas, project);
  const duration = project.audio ? project.audio.durationSec : 32;
  const loopStart = data.loopStart ?? null;
  const loopEnd = data.loopEnd ?? null;
  const hasLoop = loopStart != null && loopEnd != null && loopEnd > loopStart;

  let actx = null, audioBuf = null, source = null;
  let playing = false, t0 = 0, posWhenPause = 0, perfBase = 0;
  let raf = 0, lastFpsT = performance.now(), frames = 0;
  const frameOut = { nozzles: [], lights: [] };

  async function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    if (data.audioDataUri) {
      const resp = await fetch(data.audioDataUri);
      const buf = await resp.arrayBuffer();
      audioBuf = await actx.decodeAudioData(buf);
    }
  }

  function startSource(offset) {
    source = actx.createBufferSource();
    source.buffer = audioBuf;
    if (hasLoop) {
      source.loop = true;
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
    }
    source.connect(actx.destination);
    source.onended = () => {
      if (source && !source.loop) {
        playing = false;
        posWhenPause = duration;
        btn.textContent = '播放';
      }
    };
    let at = offset;
    if (hasLoop) at = loopStart + ((offset - loopStart) % (loopEnd - loopStart));
    source.start(0, Math.min(Math.max(0, at), audioBuf.duration - 0.01));
    t0 = actx.currentTime - offset;
  }

  function currentTime(nowMs) {
    if (audioBuf) {
      if (!actx) return posWhenPause;
      if (playing) {
        let t = actx.currentTime - t0;
        if (hasLoop) t = loopStart + ((t - loopStart) % (loopEnd - loopStart));
        return Math.min(t, duration);
      }
      return posWhenPause;
    }
    // 无音频工程：rAF 性能时钟驱动
    if (playing) {
      let t = posWhenPause + (nowMs - perfBase) / 1000;
      if (hasLoop) t = loopStart + ((t - loopStart) % (loopEnd - loopStart));
      else if (t >= duration) {
        t = duration;
        playing = false;
        btn.textContent = '播放';
      }
      posWhenPause = t;
      perfBase = nowMs;
      return t;
    }
    return posWhenPause;
  }

  async function toggle() {
    await ensureAudio();
    if (actx.state === 'suspended') await actx.resume();
    if (playing) {
      posWhenPause = currentTime(performance.now());
      if (source) { source.onended = null; source.stop(); source = null; }
      playing = false;
      btn.textContent = '播放';
    } else {
      if (posWhenPause >= duration - 0.02) posWhenPause = hasLoop ? loopStart : 0;
      if (audioBuf) startSource(posWhenPause);
      perfBase = performance.now();
      playing = true;
      btn.textContent = '暂停';
    }
  }
  btn.addEventListener('click', toggle);

  seek.addEventListener('click', (e) => {
    const rect = seek.getBoundingClientRect();
    const t = clamp(((e.clientX - rect.left) / rect.width) * duration, 0, duration);
    posWhenPause = t;
    if (playing && audioBuf) {
      source.onended = null;
      source.stop();
      source = null;
      startSource(t);
    }
    perfBase = performance.now();
  });

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const t = currentTime(now);
    const windR = deg2rad(project.windDirDeg || 0);
    const wind = { x: (project.windSpeed || 0) * Math.sin(windR), z: (project.windSpeed || 0) * Math.cos(windR) };
    const st = evaluateFrame(project, t, [], frameOut);
    renderer.setFrame(st, wind);
    renderer.render(now);
    fill.style.width = `${(t / duration) * 100}%`;
    timeEl.textContent = `${fmt(t)} / ${fmt(duration)}`;
    frames++;
    if (now - lastFpsT >= 1000) {
      fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsT))} FPS`;
      frames = 0;
      lastFpsT = now;
    }
  }
  loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      if (source) try { source.stop(); } catch {}
      if (actx) actx.close();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
