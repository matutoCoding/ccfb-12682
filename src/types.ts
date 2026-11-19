// ============ 数据模型 ============

export type NozzleType = 'direct' | 'swing' | 'running' | 'curtain';

export interface NozzleTypeDef {
  type: NozzleType;
  name: string;
  /** DMX 通道占用定义 */
  dmxChannels: string[];
  defaults: {
    caliber: number;    // 口径 mm
    pressure: number;   // 扬程 m
    swingAngle: number; // 摇摆角度 °
    swingPeriod: number;// 摇摆周期 s
  };
}

export const NOZZLE_TYPES: Record<NozzleType, NozzleTypeDef> = {
  direct: {
    type: 'direct', name: '直喷',
    dmxChannels: ['开关', '调压'],
    defaults: { caliber: 12, pressure: 8, swingAngle: 0, swingPeriod: 4 },
  },
  swing: {
    type: 'swing', name: '摇摆',
    dmxChannels: ['开关', '调压', '摇摆速度', '摇摆角度'],
    defaults: { caliber: 10, pressure: 6, swingAngle: 30, swingPeriod: 4 },
  },
  running: {
    type: 'running', name: '跑泉',
    dmxChannels: ['开关', '调压', '跑动速度'],
    defaults: { caliber: 8, pressure: 4, swingAngle: 0, swingPeriod: 1.2 },
  },
  curtain: {
    type: 'curtain', name: '水幕',
    dmxChannels: ['开关', '调压'],
    defaults: { caliber: 20, pressure: 3, swingAngle: 60, swingPeriod: 6 },
  },
};

export interface Nozzle {
  id: string;
  type: NozzleType;
  name: string;
  x: number;          // 平面坐标 m
  y: number;
  rotation: number;   // 朝向 ° (摇摆轴/水幕走向)
  caliber: number;    // mm
  pressure: number;   // 扬程 m
  swingAngle: number; // °
  swingPeriod: number;// s
  circuitId: string | null;
  pumpId: string | null;
  dmxStart: number;   // 1..512
}

export interface Pump {
  id: string;
  name: string;
  x: number;
  y: number;
  power: number;   // 额定功率 kW
  flow: number;    // 额定流量 m³/h
}

export interface Circuit {
  id: string;
  name: string;
  color: string;
}

export type TrackKind = 'water' | 'light';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  targetIds: string[]; // 喷头 id 列表
}

export type ClipRamp = 'const' | 'up' | 'down' | 'pulse';

export interface Clip {
  id: string;
  trackId: string;
  start: number;    // s
  duration: number; // s
  intensity: number; // 0..1 (水型轨: 压力比例)
  color: string;     // 灯光轨颜色 #rrggbb
  ramp: ClipRamp;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  nozzles: Nozzle[];
  pumps: Pump[];
  circuits: Circuit[];
  tracks: Track[];
  clips: Clip[];
  beats: number[];      // 节拍点时间 s
  bpm: number | null;
  audioName: string | null;
  duration: number;     // 编排总时长 s
  settings: {
    wind: number;       // 风速 m/s
    windDir: number;    // 风向 °
    poolW: number;      // 水池长 m
    poolH: number;      // 水池宽 m
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newProject(name: string): Project {
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nozzles: [], pumps: [], circuits: [], tracks: [], clips: [],
    beats: [], bpm: null, audioName: null, duration: 180,
    settings: { wind: 0, windDir: 0, poolW: 40, poolH: 20 },
  };
}

export function newNozzle(type: NozzleType, x: number, y: number, dmxStart: number): Nozzle {
  const def = NOZZLE_TYPES[type];
  return {
    id: uid(), type, name: def.name, x, y, rotation: 0,
    caliber: def.defaults.caliber,
    pressure: def.defaults.pressure,
    swingAngle: def.defaults.swingAngle,
    swingPeriod: def.defaults.swingPeriod,
    circuitId: null, pumpId: null, dmxStart,
  };
}

/** 喷头占用 DMX 通道数 */
export function dmxFootprint(n: Nozzle): number {
  return NOZZLE_TYPES[n.type].dmxChannels.length;
}
