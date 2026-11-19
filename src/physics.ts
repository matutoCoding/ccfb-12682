// ============ 水柱抛物线物理(预览渲染与干涉检查共用) ============
import { Nozzle } from './types';

export const G = 9.81;

export interface Vec3 { x: number; y: number; z: number }

/** 出水初速度 m/s: v = sqrt(2gH), H 为扬程(米), intensity 为调压比例 */
export function jetVelocity(pressureHead: number, intensity = 1): number {
  return Math.sqrt(2 * G * Math.max(0.05, pressureHead * intensity));
}

/**
 * 喷头在 time 时刻的出水方向(单位向量)。
 * swing: 绕竖直轴进动式摇摆(绕自身竖轴摆,摆角 swingAngle,周期 swingPeriod)
 * curtain/running/direct: 固定竖直向上(跑泉靠通断形成跑动效果)
 */
export function jetDirection(n: Nozzle, time: number): Vec3 {
  if (n.type === 'swing') {
    const phase = (2 * Math.PI * time) / Math.max(0.2, n.swingPeriod);
    const tilt = (n.swingAngle * Math.PI / 180) * Math.sin(phase);
    const rot = n.rotation * Math.PI / 180;
    // 在垂直于 rotation 朝向的平面内摆动
    return {
      x: Math.sin(tilt) * Math.cos(rot),
      y: Math.cos(tilt),
      z: Math.sin(tilt) * Math.sin(rot),
    };
  }
  return { x: 0, y: 1, z: 0 };
}

/** 跑泉通断包络: 周期内前 55% 开, 其余关, 形成一段段跑动水柱 */
export function runningEnvelope(n: Nozzle, time: number): number {
  if (n.type !== 'running') return 1;
  const p = Math.max(0.2, n.swingPeriod);
  const phase = ((time % p) + p) % p;
  return phase / p < 0.55 ? 1 : 0;
}

/**
 * 采样一条水柱轨迹(用于干涉检查与 CPU 侧估算)。
 * 返回从出水口到落水的若干个点。
 */
export function sampleTrajectory(
  n: Nozzle, time: number, intensity: number, wind: Vec3, segments = 24,
): Vec3[] {
  const dir = jetDirection(n, time);
  const v0 = jetVelocity(n.pressure, intensity) * runningEnvelope(n, time);
  const pts: Vec3[] = [];
  if (v0 < 0.5) return pts;
  // 水幕压低、拉宽
  const spread = n.type === 'curtain' ? 0.5 : 1;
  const v = v0 * (n.type === 'curtain' ? 0.6 : 1);
  // 飞行时间: 回到 y=0
  const tFlight = (v * dir.y + Math.sqrt(v * v * dir.y * dir.y + 2 * G * 0)) / G;
  const T = Math.max(0.1, tFlight);
  for (let i = 0; i <= segments; i++) {
    const t = (T * i) / segments;
    pts.push({
      x: n.x + dir.x * v * t + 0.5 * wind.x * t * t * spread,
      y: Math.max(0, dir.y * v * t - 0.5 * G * t * t),
      z: n.y + dir.z * v * t + 0.5 * wind.z * t * t * spread,
    });
  }
  return pts;
}

/** 风速(m/s)与风向(°)转水平"等效加速度"向量 —— 简化风阻模型 */
export function windVector(windSpeed: number, windDirDeg: number): Vec3 {
  const a = windDirDeg * Math.PI / 180;
  const k = windSpeed * 0.35; // 经验系数: 风对水柱的侧向加速度
  return { x: Math.sin(a) * k, y: 0, z: Math.cos(a) * k };
}

/** 单喷头流量 m³/h: Q = A·v, A 按口径圆面积 */
export function nozzleFlow(n: Nozzle): number {
  const r = n.caliber / 2000; // mm -> m 半径
  const v = jetVelocity(n.pressure);
  return Math.PI * r * r * v * 3600;
}

/** 单喷头所需功率 kW: P = ρgQH / η, η 取 0.65 */
export function nozzlePower(n: Nozzle): number {
  const q = nozzleFlow(n) / 3600; // m³/s
  return (1000 * G * q * n.pressure) / 0.65 / 1000;
}
