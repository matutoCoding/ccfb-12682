import type { NozzleSpec, NozzleType, Project, CircuitGroup } from './types';
import { uid } from './id';

export const NOZZLE_LABELS: Record<NozzleType, string> = {
  straight: '直喷',
  swing: '摇摆',
  running: '跑泉',
  curtain: '水幕',
};

export const PATTERN_LABELS: Record<string, string> = {
  constant: '恒定',
  pulse: '脉冲',
  chase: '追逐(跑泉)',
  wave: '波浪',
  burst: '爆发',
};

export const DEFAULT_SPECS: Record<NozzleType, NozzleSpec> = {
  straight: { diameterMm: 15, pressureBar: 1.2, swingAngleDeg: 0, swingPeriodSec: 3, curtainWidth: 0 },
  swing: { diameterMm: 20, pressureBar: 1.0, swingAngleDeg: 25, swingPeriodSec: 3, curtainWidth: 0 },
  running: { diameterMm: 10, pressureBar: 0.8, swingAngleDeg: 0, swingPeriodSec: 2, curtainWidth: 0 },
  curtain: { diameterMm: 40, pressureBar: 2.0, swingAngleDeg: 0, swingPeriodSec: 4, curtainWidth: 6 },
};

/** 各设备 DMX 通道占用数 */
export const NOZZLE_DMX_FOOTPRINT: Record<NozzleType, number> = {
  straight: 1, // 阀门开度
  running: 1, // 阀门开度
  swing: 3, // 阀门 / 倾角 / 速度
  curtain: 2, // 阀门 / 幕宽
};

export const PUMP_DMX_FOOTPRINT = 1; // 变频转速
export const LIGHT_DMX_FOOTPRINT = 3; // RGB

export const GROUP_COLORS = ['#4e9eff', '#36c98f', '#f0a93b', '#e36079', '#9b7ee6', '#3cc6d4'];

export function newGroup(name: string, colorIndex: number): CircuitGroup {
  return { id: uid('grp'), name, color: GROUP_COLORS[colorIndex % GROUP_COLORS.length] };
}

export function newProject(name = '未命名工程'): Project {
  const group = newGroup('主回路', 0);
  const now = Date.now();
  return {
    id: uid('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    version: 1,
    bpm: 120,
    windSpeed: 0,
    windDirDeg: 0,
    poolW: 24,
    poolH: 14,
    groups: [group],
    nozzles: [],
    pumps: [],
    lights: [],
    waterClips: [],
    lightClips: [],
    beats: [],
    audio: null,
  };
}

/** 生成一个带示例布局和编排的工程，便于快速体验 */
export function newDemoProject(): Project {
  const p = newProject('示例工程 · 广场音乐喷泉');
  const g = p.groups[0];
  // 两排直喷 + 一组跑泉 + 两个摇摆 + 一道水幕 + 两台泵 + 四盏灯
  for (let i = 0; i < 8; i++) {
    p.nozzles.push({
      id: uid('nz'),
      type: 'straight',
      name: `直喷 ${i + 1}`,
      x: -8 + i * 2.3,
      y: -3,
      rotationDeg: 0,
      spec: { ...DEFAULT_SPECS.straight },
      groupId: g.id,
      pumpId: null,
      dmxStart: 1 + i,
      lightId: null,
    });
  }
  for (let i = 0; i < 6; i++) {
    p.nozzles.push({
      id: uid('nz'),
      type: 'running',
      name: `跑泉 ${i + 1}`,
      x: -6 + i * 2.4,
      y: 1.5,
      rotationDeg: 90,
      spec: { ...DEFAULT_SPECS.running },
      groupId: g.id,
      pumpId: null,
      dmxStart: 20 + i,
      lightId: null,
    });
  }
  p.nozzles.push(
    {
      id: uid('nz'),
      type: 'swing',
      name: '摇摆 左',
      x: -7,
      y: 4.5,
      rotationDeg: 0,
      spec: { ...DEFAULT_SPECS.swing },
      groupId: g.id,
      pumpId: null,
      dmxStart: 40,
      lightId: null,
    },
    {
      id: uid('nz'),
      type: 'swing',
      name: '摇摆 右',
      x: 7,
      y: 4.5,
      rotationDeg: 180,
      spec: { ...DEFAULT_SPECS.swing },
      groupId: g.id,
      pumpId: null,
      dmxStart: 43,
      lightId: null,
    },
    {
      id: uid('nz'),
      type: 'curtain',
      name: '主水幕',
      x: 0,
      y: 6,
      rotationDeg: 90,
      spec: { ...DEFAULT_SPECS.curtain },
      groupId: g.id,
      pumpId: null,
      dmxStart: 46,
      lightId: null,
    },
  );
  p.pumps.push(
    { id: uid('pump'), name: '1# 泵', x: -10.5, y: -6, powerLimitKw: 15, groupId: g.id, dmxStart: 60 },
    { id: uid('pump'), name: '2# 泵', x: 10.5, y: -6, powerLimitKw: 15, groupId: g.id, dmxStart: 61 },
  );
  for (let i = 0; i < 4; i++) {
    p.lights.push({
      id: uid('lt'),
      name: `染色灯 ${i + 1}`,
      x: -9 + i * 6,
      y: -5.5,
      dmxStart: 70 + i * 3,
    });
  }
  // 全部喷头先挂 1# 泵，灯就近绑定
  for (const n of p.nozzles) {
    n.pumpId = p.pumps[0].id;
    let best = p.lights[0];
    let bestD = Infinity;
    for (const l of p.lights) {
      const d = (l.x - n.x) ** 2 + (l.y - n.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    n.lightId = best.id;
  }
  // 示例编排（32 秒）
  const straights = p.nozzles.filter((n) => n.type === 'straight').map((n) => n.id);
  const runners = p.nozzles.filter((n) => n.type === 'running').map((n) => n.id);
  const swings = p.nozzles.filter((n) => n.type === 'swing').map((n) => n.id);
  const curtain = p.nozzles.filter((n) => n.type === 'curtain').map((n) => n.id);
  p.waterClips.push(
    { id: uid('clip'), trackId: g.id, targetIds: straights, startSec: 0, durationSec: 16, pattern: 'wave', level01: 0.9, pulseCount: 4, chaseStepSec: 0.25, waveFreq: 0.5 },
    { id: uid('clip'), trackId: g.id, targetIds: runners, startSec: 2, durationSec: 20, pattern: 'chase', level01: 1, pulseCount: 0, chaseStepSec: 0.22, waveFreq: 0 },
    { id: uid('clip'), trackId: g.id, targetIds: swings, startSec: 4, durationSec: 24, pattern: 'constant', level01: 0.85, pulseCount: 0, chaseStepSec: 0, waveFreq: 0 },
    { id: uid('clip'), trackId: g.id, targetIds: curtain, startSec: 8, durationSec: 20, pattern: 'pulse', level01: 1, pulseCount: 4, chaseStepSec: 0, waveFreq: 0 },
    { id: uid('clip'), trackId: g.id, targetIds: straights, startSec: 18, durationSec: 14, pattern: 'burst', level01: 1, pulseCount: 0, chaseStepSec: 0, waveFreq: 0 },
  );
  p.lightClips.push(
    { id: uid('lc'), lightIds: p.lights.map((l) => l.id), startSec: 0, durationSec: 32, color: [0.2, 0.5, 1], intensity: 1, pulse: false, pulseHz: 1 },
    { id: uid('lc'), lightIds: [p.lights[0].id, p.lights[1].id], startSec: 8, durationSec: 12, color: [1, 0.3, 0.2], intensity: 1, pulse: true, pulseHz: 2 },
    { id: uid('lc'), lightIds: [p.lights[2].id, p.lights[3].id], startSec: 16, durationSec: 12, color: [0.9, 0.2, 1], intensity: 1, pulse: true, pulseHz: 2 },
  );
  // 按 120BPM 预铺节拍点
  for (let t = 0.5; t < 32; t += 60 / p.bpm) {
    p.beats.push({ id: uid('beat'), timeSec: Number(t.toFixed(3)) });
  }
  return p;
}
