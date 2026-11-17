import type { Project } from './types';
import { NOZZLE_LABELS } from './defaults';
import { channelText } from './dmx';
import { jetHeight, nozzleFlowLmin, nozzleHydraulicPowerKw } from './physics';
import { pumpLoads } from './validation';

function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: (string | number)[][]): string {
  // UTF-8 BOM，Excel 直接打开不乱码
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/** 设备清单 CSV（喷头 / 水泵 / 灯光 + 泵负载汇总） */
export function buildEquipmentCsv(project: Project): string {
  const rows: (string | number)[][] = [];
  rows.push(['== 喷头清单 ==']);
  rows.push(['编号', '名称', '类型', 'X(m)', 'Y(m)', '口径(mm)', '压力(bar)', '喷高(m)', '流量(L/min)', '水功率(kW)', '回路', '水泵', 'DMX通道', '绑定灯具']);
  project.nozzles.forEach((n, i) => {
    const g = project.groups.find((x) => x.id === n.groupId)?.name ?? '';
    const pump = project.pumps.find((x) => x.id === n.pumpId)?.name ?? '';
    const light = project.lights.find((x) => x.id === n.lightId)?.name ?? '';
    rows.push([
      i + 1, n.name, NOZZLE_LABELS[n.type], n.x.toFixed(2), n.y.toFixed(2),
      n.spec.diameterMm, n.spec.pressureBar, jetHeight(n.spec).toFixed(2),
      nozzleFlowLmin(n.spec).toFixed(1), nozzleHydraulicPowerKw(n).toFixed(2),
      g, pump, channelText('nozzle', n), light,
    ]);
  });
  rows.push([]);
  rows.push(['== 水泵清单 ==']);
  rows.push(['编号', '名称', 'X(m)', 'Y(m)', '功率上限(kW)', '计算负载(kW)', '负载率', '带动喷头数', 'DMX通道']);
  const loads = new Map(pumpLoads(project).map((l) => [l.pumpId, l]));
  project.pumps.forEach((p, i) => {
    const l = loads.get(p.id);
    rows.push([
      i + 1, p.name, p.x.toFixed(2), p.y.toFixed(2), p.powerLimitKw,
      l?.powerKw.toFixed(2) ?? '0', l ? `${Math.round(l.ratio * 100)}%` : '-',
      l?.nozzleCount ?? 0, channelText('pump', p),
    ]);
  });
  rows.push([]);
  rows.push(['== 灯具清单 ==']);
  rows.push(['编号', '名称', 'X(m)', 'Y(m)', 'DMX通道(RGB)']);
  project.lights.forEach((l, i) => {
    rows.push([i + 1, l.name, l.x.toFixed(2), l.y.toFixed(2), channelText('light', l)]);
  });
  rows.push([]);
  rows.push(['== 回路分组 ==']);
  rows.push(['分组', '颜色', '喷头数', '泵数']);
  for (const g of project.groups) {
    rows.push([
      g.name, g.color,
      project.nozzles.filter((n) => n.groupId === g.id).length,
      project.pumps.filter((p) => p.groupId === g.id).length,
    ]);
  }
  return csv(rows);
}
