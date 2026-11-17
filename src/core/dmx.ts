import type { DeviceKind, Issue, LightFixture, PlacedNozzle, Project, Pump } from './types';
import { LIGHT_DMX_FOOTPRINT, NOZZLE_DMX_FOOTPRINT, PUMP_DMX_FOOTPRINT } from './defaults';
import { uid } from './id';

export interface DmxOccupant {
  kind: DeviceKind;
  id: string;
  name: string;
  start: number;
  end: number;
}

export function footprintOf(kind: DeviceKind, nozzle?: PlacedNozzle): number {
  if (kind === 'pump') return PUMP_DMX_FOOTPRINT;
  if (kind === 'light') return LIGHT_DMX_FOOTPRINT;
  return nozzle ? NOZZLE_DMX_FOOTPRINT[nozzle.type] : 1;
}

export function collectDmxOccupants(project: Project): DmxOccupant[] {
  const out: DmxOccupant[] = [];
  for (const n of project.nozzles) {
    if (n.dmxStart != null) {
      const fp = footprintOf('nozzle', n);
      out.push({ kind: 'nozzle', id: n.id, name: n.name, start: n.dmxStart, end: n.dmxStart + fp - 1 });
    }
  }
  for (const p of project.pumps) {
    if (p.dmxStart != null) {
      out.push({ kind: 'pump', id: p.id, name: p.name, start: p.dmxStart, end: p.dmxStart + PUMP_DMX_FOOTPRINT - 1 });
    }
  }
  for (const l of project.lights) {
    if (l.dmxStart != null) {
      out.push({ kind: 'light', id: l.id, name: l.name, start: l.dmxStart, end: l.dmxStart + LIGHT_DMX_FOOTPRINT - 1 });
    }
  }
  return out;
}

/** 找下一个空闲起始通道 */
export function nextFreeChannel(project: Project, footprint: number, after = 1): number {
  const occ = collectDmxOccupants(project).sort((a, b) => a.start - b.start);
  let ch = Math.max(1, after);
  for (const o of occ) {
    if (ch + footprint - 1 < o.start) break;
    ch = Math.max(ch, o.end + 1);
  }
  return ch <= 512 - footprint + 1 ? ch : 0;
}

/** DMX 通道冲突校验（含超出 512  universe） */
export function findDmxIssues(project: Project): Issue[] {
  const issues: Issue[] = [];
  const occ = collectDmxOccupants(project);
  for (const o of occ) {
    if (o.start < 1 || o.end > 512) {
      issues.push({
        id: uid('iss'),
        kind: 'dmx-conflict',
        severity: 'error',
        message: `${o.name} 通道范围 ${o.start}-${o.end} 超出 DMX512 上限 512`,
        deviceIds: [o.id],
        channels: [Math.max(1, o.start), Math.min(512, o.end)],
      });
    }
  }
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i];
      const b = occ[j];
      if (a.end >= b.start && b.end >= a.start) {
        const from = Math.max(a.start, b.start);
        const to = Math.min(a.end, b.end);
        const channels: number[] = [];
        for (let c = from; c <= to; c++) channels.push(c);
        issues.push({
          id: uid('iss'),
          kind: 'dmx-conflict',
          severity: 'error',
          message: `DMX 通道冲突：${a.name} 与 ${b.name} 占用通道 ${from}-${to}`,
          deviceIds: [a.id, b.id],
          channels,
        });
      }
    }
  }
  return issues;
}

/** 取设备在设备表中的通道描述 */
export function channelText(kind: DeviceKind, n: PlacedNozzle | Pump | LightFixture | null): string {
  if (!n || n.dmxStart == null) return '未分配';
  const fp = kind === 'nozzle' ? footprintOf('nozzle', n as PlacedNozzle) : footprintOf(kind);
  return `${n.dmxStart}–${n.dmxStart + fp - 1}`;
}
