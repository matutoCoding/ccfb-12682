// ============ 水柱粒子渲染器 ============
// 每喷头一次 drawArrays(TRIANGLES, 0, N*6), 粒子参数全部由 gl_VertexID 在顶点着色器推出,
// CPU 每帧只写 uniform —— 无逐帧分配, 长时间播放不掉帧。
import { Mat4 } from './mat';
import { Nozzle } from '../types';
import { G, jetVelocity } from '../physics';

const PARTICLES = 90; // 每喷头粒子数

const VS = `#version 300 es
precision highp float;

uniform mat4 uVP;
uniform vec3 uOrigin;
uniform vec3 uWind;        // 侧向加速度
uniform vec4 uParams;      // x: v0, y: swingAngle(rad), z: swingPeriod, w: type(0直喷1摇摆2跑泉3水幕)
uniform vec2 uRot;         // x: cos(rot), y: sin(rot)
uniform float uTime;
uniform float uIntensity;
uniform float uCaliber;    // m, 决定水柱粗细
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uReflect;    // 0 正常, 1 倒影

out float vFade;
out float vSeed;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  int vid = gl_VertexID;
  int pid = vid / 6;
  int corner = vid % 6;
  float seed = hash(float(pid) + 0.13);
  float seed2 = hash(float(pid) + 7.77);

  float v0 = uParams.x;
  float type = uParams.w;

  // 跑泉: 通断包络 —— 粒子按出生时间分段
  float period = max(uParams.z, 0.2);
  float flightT = 2.0 * v0 / ${G.toFixed(2)};  // 竖直上抛近似飞行时间
  flightT = min(flightT, 6.0);

  // 粒子年龄: 沿水柱均匀分布
  float streamPos = float(pid) / ${PARTICLES.toFixed(1)}; // 0..1
  float age = streamPos * flightT;

  // 跑泉: 按(出生时刻)在周期内位置决定是否发射
  float born = uTime - age;
  float on = 1.0;
  if (type > 1.5 && type < 2.5) {
    float ph = fract(born / period);
    on = ph < 0.55 ? 1.0 : 0.0;
  }

  // 出水方向
  vec3 dir = vec3(0.0, 1.0, 0.0);
  if (type > 0.5 && type < 1.5) {
    // 摇摆: 在垂直于 rotation 的平面内摆动, 相位按出生时刻
    float tilt = uParams.y * sin(6.2831853 * born / period);
    dir = normalize(vec3(sin(tilt) * uRot.x, cos(tilt), sin(tilt) * uRot.y));
  }
  if (type > 2.5) {
    // 水幕: 扇形展开, 粒子横向铺开
    float fan = (seed - 0.5) * uParams.y; // swingAngle 复用为扇形角
    dir = normalize(vec3(sin(fan) * uRot.x, cos(fan) * 1.2, sin(fan) * uRot.y));
  }

  // 初速度微扰, 让水柱有粗细层次
  float jitter = (seed2 - 0.5) * 0.06;
  vec3 vel = dir * v0 * (1.0 + jitter);
  vel.x += (seed - 0.5) * 0.15;
  vel.z += (seed2 - 0.5) * 0.15;

  vec3 pos = uOrigin + vel * age + vec3(0.0, -${(G / 2).toFixed(3)}, 0.0) * age * age
           + 0.5 * uWind * age * age;
  pos.y = max(pos.y, 0.0);

  // 头部粒子亮, 尾部渐隐; 关断段完全透明
  vFade = (1.0 - streamPos * 0.75) * on * uIntensity;
  vSeed = seed;

  if (uReflect > 0.5) pos.y = -pos.y;

  // 公告板: 随距离缩放的圆点
  float size = (uCaliber * 2.2 + age * 0.35) * (0.7 + 0.6 * seed2);
  vec2 cornerXY = vec2(corner == 1 || corner == 4 || corner == 5 ? 1.0 : -1.0,
                       corner >= 2 && corner <= 4 ? 1.0 : -1.0);
  vec3 world = pos + (uCamRight * cornerXY.x + uCamUp * cornerXY.y) * size * 0.5;

  gl_Position = uVP * vec4(world, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in float vFade;
in float vSeed;
uniform vec3 uColor;
uniform float uReflect;
out vec4 fragColor;
void main() {
  if (vFade < 0.004) discard;
  float a = vFade * (uReflect > 0.5 ? 0.18 : 0.75);
  // 水柱中心偏白, 整体带灯光染色(染色要看得出来的程度)
  vec3 col = mix(uColor * 1.15, vec3(1.0), 0.18 + 0.22 * vSeed);
  fragColor = vec4(col, a);
}`;

export interface JetState {
  intensity: number;   // 0..1
  color: [number, number, number];
}

export class JetRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private vao: WebGLVertexArrayObject | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = this.compile(VS, FS);
    for (const name of ['uVP', 'uOrigin', 'uWind', 'uParams', 'uRot', 'uTime', 'uIntensity',
      'uCaliber', 'uCamRight', 'uCamUp', 'uReflect', 'uColor']) {
      this.loc[name] = gl.getUniformLocation(this.prog, name);
    }
    this.vao = gl.createVertexArray();
  }

  private compile(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  draw(
    vp: Mat4, nozzle: Nozzle, state: JetState, time: number,
    wind: [number, number, number], camRight: number[], camUp: number[], reflect: boolean,
  ) {
    const gl = this.gl;
    const L = this.loc;
    const typeIdx = { direct: 0, swing: 1, running: 2, curtain: 3 }[nozzle.type];
    const v0 = jetVelocity(nozzle.pressure, Math.max(0.05, state.intensity))
      * (nozzle.type === 'curtain' ? 0.6 : 1);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(L.uVP, false, vp);
    gl.uniform3f(L.uOrigin, nozzle.x, 0, nozzle.y);
    gl.uniform3f(L.uWind, wind[0], wind[1], wind[2]);
    gl.uniform4f(L.uParams, v0, nozzle.swingAngle * Math.PI / 180,
      Math.max(0.2, nozzle.swingPeriod), typeIdx);
    const rot = nozzle.rotation * Math.PI / 180;
    gl.uniform2f(L.uRot, Math.cos(rot), Math.sin(rot));
    gl.uniform1f(L.uTime, time);
    gl.uniform1f(L.uIntensity, state.intensity);
    gl.uniform1f(L.uCaliber, nozzle.caliber / 1000);
    gl.uniform3f(L.uCamRight, camRight[0], camRight[1], camRight[2]);
    gl.uniform3f(L.uCamUp, camUp[0], camUp[1], camUp[2]);
    gl.uniform1f(L.uReflect, reflect ? 1 : 0);
    gl.uniform3f(L.uColor, state.color[0], state.color[1], state.color[2]);
    gl.drawArrays(gl.TRIANGLES, 0, PARTICLES * 6);
  }
}
