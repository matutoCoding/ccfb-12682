// ============ 场景: 水池底 / 水面 / 喷头基座 ============
import { Mat4 } from './mat';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uVP;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 o;
void main() { o = vColor; }`;

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uVP: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject | null;
  private vbo: WebGLBuffer | null;
  private vertCount = 0;
  private capacity = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || '');
      return s;
    };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(this.prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    this.uVP = gl.getUniformLocation(this.prog, 'uVP');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }

  /** 每帧重建场景顶点(池底网格 + 喷头基座 + 水面), 数据量小, 开销可忽略 */
  build(poolW: number, poolH: number, nozzles: { x: number; y: number; color: [number, number, number]; glow: number }[]) {
    const v: number[] = [];
    const push = (x: number, y: number, z: number, r: number, g: number, b: number, a: number) => {
      v.push(x, y, z, r, g, b, a);
    };
    // 池底网格 (y=-0.5)
    const gy = -0.5;
    const nx = Math.round(poolW / 2), nz = Math.round(poolH / 2);
    for (let i = 0; i <= nx; i++) {
      const x = -poolW / 2 + (poolW * i) / nx;
      push(x, gy, -poolH / 2, 0.15, 0.22, 0.3, 1); push(x, gy, poolH / 2, 0.15, 0.22, 0.3, 1);
    }
    for (let i = 0; i <= nz; i++) {
      const z = -poolH / 2 + (poolH * i) / nz;
      push(-poolW / 2, gy, z, 0.15, 0.22, 0.3, 1); push(poolW / 2, gy, z, 0.15, 0.22, 0.3, 1);
    }
    // 池边框
    const hw = poolW / 2, hh = poolH / 2;
    const edge: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
    for (let i = 0; i < 4; i++) {
      push(edge[i][0], 0, edge[i][1], 0.4, 0.45, 0.5, 1);
      push(edge[i + 1][0], 0, edge[i + 1][1], 0.4, 0.45, 0.5, 1);
    }
    // 喷头基座: 小十字
    for (const n of nozzles) {
      const s = 0.25;
      const [r, g, b] = n.color;
      const glow = 0.4 + n.glow * 0.6;
      push(n.x - s, 0.01, n.y, r * glow, g * glow, b * glow, 1);
      push(n.x + s, 0.01, n.y, r * glow, g * glow, b * glow, 1);
      push(n.x, 0.01, n.y - s, r * glow, g * glow, b * glow, 1);
      push(n.x, 0.01, n.y + s, r * glow, g * glow, b * glow, 1);
    }
    const data = new Float32Array(v);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (data.length > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.capacity = data.length;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    this.vertCount = data.length / 7;
  }

  drawLines(vp: Mat4) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertCount);
    gl.bindVertexArray(null);
  }

  private waterVao: WebGLVertexArrayObject | null = null;
  private waterBuf: WebGLBuffer | null = null;
  private waterKey = '';

  /** 半透明水面(VAO 缓存, 池尺寸不变则不重建) */
  drawWater(vp: Mat4, poolW: number, poolH: number) {
    const gl = this.gl;
    const key = poolW + 'x' + poolH;
    if (!this.waterVao || this.waterKey !== key) {
      this.waterKey = key;
      if (this.waterVao) { gl.deleteVertexArray(this.waterVao); gl.deleteBuffer(this.waterBuf); }
      const hw = poolW / 2, hh = poolH / 2;
      const quad = new Float32Array([
        -hw, 0, -hh, 0.1, 0.3, 0.45, 0.45,
        hw, 0, -hh, 0.1, 0.3, 0.45, 0.45,
        hw, 0, hh, 0.12, 0.35, 0.5, 0.45,
        -hw, 0, -hh, 0.1, 0.3, 0.45, 0.45,
        hw, 0, hh, 0.12, 0.35, 0.5, 0.45,
        -hw, 0, hh, 0.1, 0.32, 0.46, 0.45,
      ]);
      this.waterVao = gl.createVertexArray();
      this.waterBuf = gl.createBuffer();
      gl.bindVertexArray(this.waterVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuf);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);
    }
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.bindVertexArray(this.waterVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}
