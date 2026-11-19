// ============ 设备表页: DMX 通道映射 + 冲突提示 + 设备清单导出 ============
import { store } from '../store';
import { el } from '../ui';
import { NOZZLE_TYPES, dmxFootprint } from '../types';
import { checkDmx, checkPumps, buildBom } from '../checks';
import { nozzleFlow, nozzlePower } from '../physics';
import { exportBomCsv, exportDmxCsv, exportShareFile, exportProject } from '../exporter';

export function renderEquipment(root: HTMLElement) {
  const p = store.current!;
  const page = el('div', { class: 'page' });

  const bar = el('div', { class: 'toolbar' });
  const btnBom = el('button', { class: 'primary' }, '📋 导出设备清单 CSV(给采购)');
  btnBom.onclick = () => exportBomCsv(p);
  const btnDmx = el('button', {}, '导出 DMX 通道表 CSV');
  btnDmx.onclick = () => exportDmxCsv(p);
  const btnProj = el('button', {}, '导出工程文件');
  btnProj.onclick = () => exportProject(p);
  const btnShare = el('button', {}, '📤 导出预演分享文件');
  btnShare.onclick = () => exportShareFile(p);
  bar.append(btnBom, btnDmx, btnProj, btnShare);
  page.append(bar);

  // ---- DMX 冲突汇总 ----
  const conflicts = checkDmx(p);
  const overloads = checkPumps(p);
  const alertBox = el('div', { class: 'panel' });
  if (conflicts.length || overloads.length) {
    alertBox.append(el('div', { class: 'section-title', style: 'color:var(--danger)' }, '⛔ 发现问题'));
    for (const c of conflicts) alertBox.append(el('div', { class: 'err-item' }, c.message));
    for (const o of overloads) {
      const pump = p.pumps.find(x => x.id === o.pumpId);
      alertBox.append(el('div', { class: 'err-item' },
        `「${pump?.name}」功率超限: 需 ${o.required.toFixed(1)}kW, 额定 ${o.rated}kW`));
    }
  } else {
    alertBox.append(el('div', { class: 'hint' }, '✓ DMX 通道无冲突, 泵功率未超限'));
  }
  page.append(alertBox);

  // ---- DMX 通道表 ----
  const conflictNozzles = new Set<string>();
  conflicts.forEach(c => c.nozzleIds.forEach(id => conflictNozzles.add(id)));

  const dmxPanel = el('div', { class: 'panel', style: 'overflow:auto' });
  dmxPanel.append(el('div', { class: 'section-title' }, `DMX512 通道映射(共 ${p.nozzles.length} 个喷头)`));
  const table = el('table', { class: 'data' });
  const thead = el('tr');
  for (const h of ['喷头', '类型', '回路', 'DMX起始', '占用', '通道范围', '通道明细', '水泵', '流量m³/h', '功率kW']) {
    thead.append(el('th', {}, h));
  }
  table.append(thead);
  const sorted = [...p.nozzles].sort((a, b) => a.dmxStart - b.dmxStart);
  for (const n of sorted) {
    const tr = el('tr');
    if (conflictNozzles.has(n.id)) tr.className = 'conflict';
    const fp = dmxFootprint(n);
    const circuit = p.circuits.find(c => c.id === n.circuitId)?.name ?? '-';
    const pump = p.pumps.find(x => x.id === n.pumpId)?.name ?? '-';
    const chNames = NOZZLE_TYPES[n.type].dmxChannels;
    tr.append(
      el('td', {}, n.name),
      el('td', {}, NOZZLE_TYPES[n.type].name),
      el('td', {}, circuit),
    );
    // DMX 起始通道可编辑
    const tdDmx = el('td');
    const inp = el('input', { type: 'number', min: '1', max: '512' }) as HTMLInputElement;
    inp.value = String(n.dmxStart);
    inp.onchange = () => {
      store.update(() => { n.dmxStart = Math.max(1, Math.min(512, parseInt(inp.value) || 1)); });
      refresh();
    };
    tdDmx.append(inp);
    tr.append(
      tdDmx,
      el('td', {}, String(fp)),
      el('td', {}, `${n.dmxStart} - ${n.dmxStart + fp - 1}`),
      el('td', {}, chNames.map((c, i) => `${n.dmxStart + i}:${c}`).join(' ')),
      el('td', {}, pump),
      el('td', {}, nozzleFlow(n).toFixed(2)),
      el('td', {}, nozzlePower(n).toFixed(2)),
    );
    table.append(tr);
  }
  dmxPanel.append(table);
  page.append(dmxPanel);

  // ---- 设备清单预览 ----
  const bomPanel = el('div', { class: 'panel', style: 'overflow:auto' });
  bomPanel.append(el('div', { class: 'section-title' }, '设备清单预览'));
  const bomTable = el('table', { class: 'data' });
  const bomHead = el('tr');
  for (const h of ['名称', '类别', '规格', '数量', '单位', '备注']) bomHead.append(el('th', {}, h));
  bomTable.append(bomHead);
  for (const r of buildBom(p)) {
    bomTable.append(el('tr', {},
      el('td', {}, r.名称), el('td', {}, r.类别), el('td', {}, r.规格),
      el('td', {}, String(r.数量)), el('td', {}, r.单位), el('td', {}, r.备注)));
  }
  bomPanel.append(bomTable);
  page.append(bomPanel);

  root.append(page);

  function refresh() {
    page.remove();
    renderEquipment(root);
  }
}
