// ============ 自动检查: DMX 通道冲突 / 水柱交叉干涉 / 泵功率超限 ============
import { Project, Nozzle, dmxFootprint } from './types';
import { sampleTrajectory, windVector, nozzlePower, nozzleFlow } from './physics';

export interface DmxConflict {
  nozzleIds: string[];
  channel: number;
  message: string;
}

/** DMX 通道占用冲突检测 */
export function checkDmx(p: Project): DmxConflict[] {
  const owner = new Map<number, string>(); // channel -> nozzleId
  const conflicts: DmxConflict[] = [];
  const reported = new Set<string>();
  for (const n of p.nozzles) {
    const fp = dmxFootprint(n);
    if (n.dmxStart < 1 || n.dmxStart + fp - 1 > 512) {
      conflicts.push({
        nozzleIds: [n.id], channel: n.dmxStart,
        message: `${n.name}: 通道 ${n.dmxStart}-${n.dmxStart + fp - 1} 超出 1-512 范围`,
      });
      continue;
    }
    for (let c = n.dmxStart; c < n.dmxStart + fp; c++) {
      const prev = owner.get(c);
      if (prev && prev !== n.id) {
        const key = [prev, n.id, c].join('|');
        if (!reported.has(key)) {
          reported.add(key);
          const a = p.nozzles.find(x => x.id === prev);
          conflicts.push({
            nozzleIds: [prev, n.id], channel: c,
            message: `通道 ${c} 被「${a?.name}」和「${n.name}」同时占用`,
          });
        }
      } else {
        owner.set(c, n.id);
      }
    }
  }
  return conflicts;
}

export interface Interference {
  a: string; // nozzle id
  b: string;
  minDist: number;
}

/** 水柱交叉干涉: 采样每对喷头轨迹的最小间距, 小于阈值判定干涉 */
export function checkInterference(p: Project, threshold = 0.35): Interference[] {
  const wind = windVector(p.settings.wind, p.settings.windDir);
  const actives = p.nozzles.filter(n => n.type !== 'curtain');
  // 每喷头最大水平射程 ≈ v²/g = 2·扬程, 加摇摆余量
  const reach = (n: { pressure: number }) => 2 * n.pressure + 1;
  const traj = new Map<string, { x: number; y: number; z: number }[]>();
  const phases = [0, 1.1, 2.2, 3.3, 4.4];
  for (const n of actives) {
    const all: { x: number; y: number; z: number }[] = [];
    for (const t of phases) all.push(...sampleTrajectory(n, t, 1, wind, 12));
    traj.set(n.id, all);
  }
  const result: Interference[] = [];
  const th2 = threshold * threshold;
  for (let i = 0; i < actives.length; i++) {
    for (let j = i + 1; j < actives.length; j++) {
      const na = actives[i], nb = actives[j];
      // 快速剔除: 水平距离超过两者射程之和不可能相交
      const dx0 = na.x - nb.x, dz0 = na.y - nb.y;
      const maxR = reach(na) + reach(nb);
      if (dx0 * dx0 + dz0 * dz0 > maxR * maxR) continue;
      const A = traj.get(na.id)!, B = traj.get(nb.id)!;
      let min2 = Infinity;
      for (const a of A) {
        if (a.y < 0.3) continue; // 近水面不算
        for (const b of B) {
          if (b.y < 0.3) continue;
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < min2) min2 = d2;
        }
      }
      if (min2 < th2) result.push({ a: na.id, b: nb.id, minDist: Math.sqrt(min2) });
    }
  }
  return result;
}

export interface PumpOverload {
  pumpId: string;
  required: number; // kW
  rated: number;
  nozzles: string[];
}

/** 泵功率超限检查 */
export function checkPumps(p: Project): PumpOverload[] {
  const out: PumpOverload[] = [];
  for (const pump of p.pumps) {
    const members = p.nozzles.filter(n => n.pumpId === pump.id);
    if (!members.length) continue;
    const required = members.reduce((s, n) => s + nozzlePower(n), 0);
    if (required > pump.power) {
      out.push({ pumpId: pump.id, required, rated: pump.power, nozzles: members.map(m => m.id) });
    }
  }
  return out;
}

export interface CheckReport {
  dmx: DmxConflict[];
  interference: Interference[];
  pumps: PumpOverload[];
}

export function runAllChecks(p: Project): CheckReport {
  return {
    dmx: checkDmx(p),
    interference: checkInterference(p),
    pumps: checkPumps(p),
  };
}

/** 设备清单行(给采购) */
export interface BomRow {
  名称: string; 类别: string; 规格: string; 数量: number; 单位: string; 备注: string;
}

export function buildBom(p: Project): BomRow[] {
  const rows: BomRow[] = [];
  const groups = new Map<string, { n: Nozzle; count: number }>();
  for (const n of p.nozzles) {
    const key = `${n.type}|${n.caliber}|${n.pressure}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { n, count: 1 });
  }
  const typeName = { direct: '直喷喷头', swing: '摇摆喷头', running: '跑泉喷头', curtain: '水幕喷头' } as const;
  for (const { n, count } of groups.values()) {
    rows.push({
      名称: typeName[n.type], 类别: '喷头',
      规格: `口径${n.caliber}mm / 扬程${n.pressure}m`,
      数量: count, 单位: '只',
      备注: `单只流量${nozzleFlow(n).toFixed(2)}m³/h, 功率${nozzlePower(n).toFixed(2)}kW`,
    });
    rows.push({
      名称: 'LED水下灯', 类别: '灯光', 规格: 'DMX512 RGB',
      数量: count, 单位: '只', 备注: '随喷头配套',
    });
  }
  for (const pump of p.pumps) {
    rows.push({
      名称: pump.name || '潜水泵', 类别: '水泵',
      规格: `${pump.power}kW / ${pump.flow}m³/h`,
      数量: 1, 单位: '台', 备注: '',
    });
  }
  rows.push({
    名称: 'DMX512 控制线', 类别: '控制', 规格: '屏蔽双绞',
    数量: Math.ceil(p.nozzles.length / 32) || 1, 单位: '回路', 备注: '每回路≤32负载',
  });
  return rows;
}
