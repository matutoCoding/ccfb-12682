// 喷泉编排系统核心数据模型

export type NozzleType = 'straight' | 'swing' | 'running' | 'curtain';
export type PatternType = 'constant' | 'pulse' | 'chase' | 'wave' | 'burst';
export type DeviceKind = 'nozzle' | 'pump' | 'light';

export interface NozzleSpec {
  /** 口径 mm */
  diameterMm: number;
  /** 工作压力 bar */
  pressureBar: number;
  /** 摇摆半角（度），仅摇摆喷头 */
  swingAngleDeg: number;
  /** 摇摆周期（秒） */
  swingPeriodSec: number;
  /** 水幕展开宽度（米），仅水幕 */
  curtainWidth: number;
}

export interface PlacedNozzle {
  id: string;
  type: NozzleType;
  name: string;
  /** 平面图坐标（米，水池中心为原点，y 向上为北） */
  x: number;
  y: number;
  /** 朝向（度），摆动轴 / 跑泉方向 / 水幕展开方向 */
  rotationDeg: number;
  spec: NozzleSpec;
  groupId: string | null;
  pumpId: string | null;
  /** DMX 起始通道（1-512），null 未分配 */
  dmxStart: number | null;
  /** 绑定的染色灯 id */
  lightId: string | null;
}

export interface Pump {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 功率上限 kW */
  powerLimitKw: number;
  groupId: string | null;
  dmxStart: number | null;
}

export interface CircuitGroup {
  id: string;
  name: string;
  color: string;
}

export interface LightFixture {
  id: string;
  name: string;
  x: number;
  y: number;
  dmxStart: number | null;
}

export interface WaterClip {
  id: string;
  /** 所属轨道：回路分组 id，未分组为 'ungrouped' */
  trackId: string;
  /** 目标喷头 id 列表 */
  targetIds: string[];
  startSec: number;
  durationSec: number;
  pattern: PatternType;
  /** 基础开度 0..1 */
  level01: number;
  /** pulse: 段内脉冲次数 */
  pulseCount: number;
  /** chase: 每级停留秒数 */
  chaseStepSec: number;
  /** wave: 频率 Hz */
  waveFreq: number;
  color?: string;
}

export interface LightClip {
  id: string;
  lightIds: string[];
  startSec: number;
  durationSec: number;
  /** RGB 0..1 */
  color: [number, number, number];
  intensity: number;
  pulse: boolean;
  pulseHz: number;
}

export interface BeatMarker {
  id: string;
  timeSec: number;
}

export interface AudioInfo {
  /** IndexedDB blobs 表主键 */
  blobId: string;
  name: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** 归一化波形峰值（0..1），约 1600 桶 */
  peaks: number[];
  bpm: number | null;
  blobSize: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  /** 工程 BPM，用于时间线吸附 */
  bpm: number;
  /** 风速 m/s（3D 预演风偏） */
  windSpeed: number;
  windDirDeg: number;
  /** 水池尺寸（米） */
  poolW: number;
  poolH: number;
  groups: CircuitGroup[];
  nozzles: PlacedNozzle[];
  pumps: Pump[];
  lights: LightFixture[];
  waterClips: WaterClip[];
  lightClips: LightClip[];
  beats: BeatMarker[];
  audio: AudioInfo | null;
}

/** 校验问题 */
export interface Issue {
  id: string;
  kind: 'dmx-conflict' | 'jet-interference' | 'pump-overload';
  severity: 'error' | 'warning';
  message: string;
  /** 关联设备 id，用于布局图高亮 */
  deviceIds: string[];
  /** 冲突的 DMX 通道（如有） */
  channels?: number[];
}

/** 单喷头实时状态（evaluateFrame 输出） */
export interface NozzleFrameState {
  level: number;
  tiltAngleDeg: number;
  tiltAxisX: number;
  tiltAxisZ: number;
}

export interface LightFrameState {
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface FrameState {
  nozzles: NozzleFrameState[];
  lights: LightFrameState[];
}

/** 工程导出文件格式（.fpj） */
export interface ProjectFile {
  format: 'fountain-project';
  fileVersion: 1;
  project: Project;
  /** 音频 base64（dataURI），无音频为 null */
  audioDataUri: string | null;
}
