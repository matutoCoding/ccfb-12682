import type { Issue, PlacedNozzle, Project } from './types';
import { findDmxIssues } from './dmx';
import { jetHeight, nozzleHydraulicPowerKw, segmentDistance2D } from './physics';
import { uid } from './id';

/** 水柱在水面的水平落点（无风、忽略风偏的保守几何，用于干涉预判） */
function jetLandOffset(n: PlacedNozzle): number {
  const h = jetHeight(n.spec);
  const tilt = ((n.type === 'swing' ? n.spec.swingAngleDeg : 0) * Math.PI) / 180;
  // v 竖直分量决定滞空时间，水平速度 ≈ sqrt(2gH)·sin(tilt)
  const v = Math.sqrt(2 * 9.81 * h);
  const vy = v * Math.cos(tilt);
  const vh = v * Math.sin(tilt);
  const t = 2 * vy / 9.81;
  return vh * t;
}

function jetPlanSegment(n: PlacedNozzle): { x1: number; y1: number; x2: number; y2: number } {
  const rot = ((n.rotationDeg || 0) * Math.PI) / 180;
  const dx = Math.sin(rot);
  const dy = Math.cos(rot);
  const land = jetLandOffset(n);
  return { x1: n.x, y1: n.y, x2: n.x + dx * land, y2: n.y + dy * land };
}

const INTERFERENCE_GAP_M = 0.6;

/** 水柱交叉干涉校验（平面图几何，两两检查） */
export function findInterferenceIssues(project: Project): Issue[] {
  const issues: Issue[] = [];
  const list = project.nozzles;
  const segs = new Map(list.map((n) => [n.id, jetPlanSegment(n)]));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const sa = segs.get(a.id)!;
      const sb = segs.get(b.id)!;
      let conflict = false;
      if (a.type === 'curtain' || b.type === 'curtain') {
        // 水幕宽度大，只要另一股水柱的根部落在幕宽范围内即判干涉
        const curtain = a.type === 'curtain' ? a : b;
        const other = a.type === 'curtain' ? b : a;
        const rot = ((curtain.rotationDeg || 0) * Math.PI) / 180;
        const ex = Math.sin(rot);
        const ey = Math.cos(rot);
        const proj = (other.x - curtain.x) * ex + (other.y - curtain.y) * ey;
        const perp = Math.abs(-(other.x - curtain.x) * ey + (other.y - curtain.y) * ex);
        conflict = Math.abs(proj) <= (curtain.spec.curtainWidth / 2 + 0.4) && perp < 1.2;
      } else {
        const dist = segmentDistance2D(sa.x1, sa.y1, sa.x2, sa.y2, sb.x1, sb.y1, sb.x2, sb.y2);
        conflict = dist < INTERFERENCE_GAP_M;
      }
      if (conflict) {
        issues.push({
          id: uid('iss'),
          kind: 'jet-interference',
          severity: 'warning',
          message: `水柱干涉：${a.name} 与 ${b.name} 的水柱平面轨迹间距小于 ${INTERFERENCE_GAP_M}m`,
          deviceIds: [a.id, b.id],
        });
      }
    }
  }
  return issues;
}

export interface PumpLoad {
  pumpId: string;
  powerKw: number;
  limitKw: number;
  ratio: number;
  nozzleCount: number;
}

/** 按当前喷头满开计算各泵负载（选型校验，含 1.25 安全系数） */
export function pumpLoads(project: Project): PumpLoad[] {
  return project.pumps.map((pump) => {
    const members = project.nozzles.filter((n) => n.pumpId === pump.id);
    const raw = members.reduce((s, n) => s + nozzleHydraulicPowerKw(n), 0);
    const powerKw = raw * 1.25;
    return {
      pumpId: pump.id,
      powerKw,
      limitKw: pump.powerLimitKw,
      ratio: pump.powerLimitKw > 0 ? powerKw / pump.powerLimitKw : 0,
      nozzleCount: members.length,
    };
  });
}

export function findPumpIssues(project: Project): Issue[] {
  const issues: Issue[] = [];
  for (const load of pumpLoads(project)) {
    const pump = project.pumps.find((p) => p.id === load.pumpId)!;
    if (load.ratio > 1) {
      issues.push({
        id: uid('iss'),
        kind: 'pump-overload',
        severity: 'error',
        message: `${pump.name} 功率超限：计算 ${load.powerKw.toFixed(2)}kW > 上限 ${load.limitKw}kW（${Math.round(load.ratio * 100)}%）`,
        deviceIds: [pump.id],
      });
    } else if (load.ratio > 0.85) {
      issues.push({
        id: uid('iss'),
        kind: 'pump-overload',
        severity: 'warning',
        message: `${pump.name} 负载偏高：${load.powerKw.toFixed(2)}kW 已达上限 ${Math.round(load.ratio * 100)}%`,
        deviceIds: [pump.id],
      });
    }
  }
  // 未挂泵的喷头
  const orphan = project.nozzles.filter((n) => !n.pumpId);
  if (orphan.length) {
    issues.push({
      id: uid('iss'),
      kind: 'pump-overload',
      severity: 'warning',
      message: `${orphan.length} 个喷头未分配水泵`,
      deviceIds: orphan.map((n) => n.id),
    });
  }
  return issues;
}

export function validateProject(project: Project): Issue[] {
  return [...findDmxIssues(project), ...findInterferenceIssues(project), ...findPumpIssues(project)];
}
