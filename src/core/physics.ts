import type { NozzleSpec, PlacedNozzle } from './types';

export const GRAVITY = 9.81;
/** 孔流系数 */
const ORIFICE_CD = 0.62;
/** 喷高经验效率（压力→初速损失） */
const JET_EFFICIENCY = 0.85;
/** 水柱几何采样段数 */
export const JET_SEGMENTS = 16;

/** 喷口初速 m/s：v = Cd · sqrt(2P/ρ)，P = pressure*1e5 Pa */
export function nozzleVelocity(spec: NozzleSpec): number {
  const pPa = spec.pressureBar * 1e5;
  return ORIFICE_CD * Math.sqrt((2 * pPa) / 1000);
}

/** 满压喷高（米），托里拆利经验式 H ≈ η·P·10 */
export function jetHeight(spec: NozzleSpec): number {
  return JET_EFFICIENCY * spec.pressureBar * 10;
}

/** 单喷头流量 L/min：Q = Cd·A·sqrt(2P/ρ)·60000 */
export function nozzleFlowLmin(spec: NozzleSpec): number {
  const pPa = spec.pressureBar * 1e5;
  const area = Math.PI * (spec.diameterMm / 1000 / 2) ** 2;
  const v = ORIFICE_CD * Math.sqrt((2 * pPa) / 1000);
  return v * area * 60000;
}

/** 流量对应的水功率 kW：P_hyd = ρgQH，用喷高近似扬程 */
export function nozzleHydraulicPowerKw(n: PlacedNozzle): number {
  const qM3s = nozzleFlowLmin(n.spec) / 60000;
  const h = jetHeight(n.spec);
  return (1000 * GRAVITY * qM3s * h) / 1000;
}

export interface JetPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * 水柱抛物线采样（含风偏）。
 * 以喷头位置为原点，局部坐标：z 向上，+y 为喷头朝向（水平投影）。
 * level 0..1 线性影响初速；tiltDeg 为离竖直方向的倾角；wind 世界坐标风向量。
 */
export function sampleJet(
  nozzle: PlacedNozzle,
  level: number,
  tiltDeg: number,
  tiltAxisWorldX: number,
  tiltAxisWorldZ: number,
  windX: number,
  windZ: number,
): JetPoint[] {
  const spec = nozzle.spec;
  const v0 = ORIFICE_CD * Math.sqrt((2 * spec.pressureBar * 1e5) / 1000) * Math.max(0, level);
  const tilt = (tiltDeg * Math.PI) / 180;
  // 初速度分量（竖直 + 沿倾斜轴的水平分量）
  const vx = v0 * Math.sin(tilt) * tiltAxisWorldX;
  const vz = v0 * Math.sin(tilt) * tiltAxisWorldZ;
  const vy = v0 * Math.cos(tilt);
  // 落回水面的时间（二次方程解），封顶防大角度数值问题
  const disc = vy * vy + 2 * GRAVITY * 0.05;
  const tEnd = disc > 0 ? (vy + Math.sqrt(disc)) / GRAVITY : 0;
  const pts: JetPoint[] = [];
  // 风作用在水柱上的水平加速度（经验系数，给预演用）
  const windK = 0.12;
  const ax = windK * windX;
  const az = windK * windZ;
  for (let i = 0; i <= JET_SEGMENTS; i++) {
    const t = (tEnd * i) / JET_SEGMENTS;
    pts.push({
      x: vx * t + 0.5 * ax * t * t,
      y: vz * t + 0.5 * az * t * t,
      z: Math.max(0, vy * t - 0.5 * GRAVITY * t * t),
    });
  }
  return pts;
}

/** 水幕：沿展开方向一排细水柱，取中心水柱几何即可（宽度由渲染器扇面处理） */
export function curtainCenterJet(nozzle: PlacedNozzle, level: number, windX: number, windZ: number): JetPoint[] {
  return sampleJet(nozzle, level, 0, 0, 0, windX, windZ);
}

/** 两条平面线段的最近距离（用于干涉校验） */
export function segmentDistance2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const minPt = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
    const vx = qx - px;
    const vy = qy - py;
    const wx = rx - px;
    const wy = ry - py;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return { x: px, y: py };
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return { x: qx, y: qy };
    const t = c1 / c2;
    return { x: px + t * vx, y: py + t * vy };
  };
  const p1 = minPt(ax, ay, bx, by, cx, cy);
  const p2 = minPt(cx, cy, dx, dy, ax, ay);
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/** 风向量（世界坐标 m/s） */
export function windVector(speed: number, dirDeg: number): { x: number; z: number } {
  const r = (dirDeg * Math.PI) / 180;
  return { x: speed * Math.sin(r), z: speed * Math.cos(r) };
}
