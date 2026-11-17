import { useMemo } from 'react';
import { useStudio } from '../core/store';
import { downloadText } from '../player/share';
import { NOZZLE_LABELS, NOZZLE_DMX_FOOTPRINT } from '../core/defaults';
import { channelText, collectDmxOccupants } from '../core/dmx';
import { jetHeight, nozzleFlowLmin, nozzleHydraulicPowerKw } from '../core/physics';
import { pumpLoads, validateProject } from '../core/validation';
import { buildEquipmentCsv } from '../core/csv';

export default function EquipmentView() {
  const project = useStudio((s) => s.current)!;
  const mutate = useStudio((s) => s.mutate);
  const issues = useMemo(() => validateProject(project), [project]);
  const loads = useMemo(() => pumpLoads(project), [project]);
  const occupants = useMemo(() => collectDmxOccupants(project), [project]);

  const conflictChannels = useMemo(() => {
    const s = new Set<number>();
    for (const i of issues) if (i.kind === 'dmx-conflict' && i.channels) for (const c of i.channels) s.add(c);
    return s;
  }, [issues]);

  const deviceIssueMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) for (const id of i.deviceIds) {
      const arr = m.get(id) ?? [];
      arr.push(i.message);
      m.set(id, arr);
    }
    return m;
  }, [issues]);

  const rowClass = (id: string) => {
    const list = deviceIssueMap.get(id);
    if (!list) return '';
    return issues.find((i) => i.deviceIds.includes(id))?.severity === 'error' ? 'conflict' : 'warn';
  };

  return (
    <div className="equip-page">
      <div className="inline-fields" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>设备清单 · {project.name}</h2>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => downloadText(`${project.name}-设备清单.csv`, buildEquipmentCsv(project), 'text/csv')}>
          导出设备表（CSV / Excel）
        </button>
      </div>

      <h3>喷头（{project.nozzles.length}）</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>名称</th><th>类型</th><th>X/Y(m)</th><th>口径(mm)</th><th>压力(bar)</th>
              <th>喷高(m)</th><th>流量(L/min)</th><th>水功率(kW)</th><th>DMX 通道</th><th>占用</th><th>回路</th><th>水泵</th><th>问题</th>
            </tr>
          </thead>
          <tbody>
            {project.nozzles.map((n) => (
              <tr key={n.id} className={rowClass(n.id)}>
                <td>{n.name}</td>
                <td>{NOZZLE_LABELS[n.type]}</td>
                <td>{n.x.toFixed(1)} / {n.y.toFixed(1)}</td>
                <td>{n.spec.diameterMm}</td>
                <td>{n.spec.pressureBar}</td>
                <td>{jetHeight(n.spec).toFixed(1)}</td>
                <td>{nozzleFlowLmin(n.spec).toFixed(0)}</td>
                <td>{nozzleHydraulicPowerKw(n).toFixed(2)}</td>
                <td>
                  <input
                    type="number" min={1} max={512} style={{ width: 70 }}
                    value={n.dmxStart ?? ''}
                    onChange={(e) => mutate((p) => {
                      const t = p.nozzles.find((x) => x.id === n.id);
                      if (t) t.dmxStart = e.target.value === '' ? null : +e.target.value;
                    })}
                  />
                  <span style={{ marginLeft: 6, color: conflictChannels.size ? 'var(--muted)' : undefined }}>
                    {n.dmxStart != null ? `${n.dmxStart}–${n.dmxStart + NOZZLE_DMX_FOOTPRINT[n.type] - 1}` : '未分配'}
                  </span>
                </td>
                <td>{NOZZLE_DMX_FOOTPRINT[n.type]} ch</td>
                <td>{project.groups.find((g) => g.id === n.groupId)?.name ?? '—'}</td>
                <td>{project.pumps.find((p) => p.id === n.pumpId)?.name ?? '—'}</td>
                <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{(deviceIssueMap.get(n.id) ?? []).join('；') || '—'}</td>
              </tr>
            ))}
            {!project.nozzles.length && <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--muted)' }}>还没有喷头</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>水泵（{project.pumps.length}）</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>名称</th><th>X/Y(m)</th><th>功率上限(kW)</th><th>计算负载(kW)</th><th>负载率</th><th>带动喷头</th><th>DMX</th><th>问题</th></tr>
          </thead>
          <tbody>
            {project.pumps.map((p) => {
              const l = loads.find((x) => x.pumpId === p.id)!;
              return (
                <tr key={p.id} className={rowClass(p.id)}>
                  <td>{p.name}</td>
                  <td>{p.x.toFixed(1)} / {p.y.toFixed(1)}</td>
                  <td>
                    <input type="number" min={1} style={{ width: 80 }} value={p.powerLimitKw}
                      onChange={(e) => mutate((pp) => { const t = pp.pumps.find((x) => x.id === p.id); if (t) t.powerLimitKw = +e.target.value; })} />
                  </td>
                  <td>{l.powerKw.toFixed(2)}</td>
                  <td style={{ color: l.ratio > 1 ? 'var(--danger)' : l.ratio > 0.85 ? 'var(--warn)' : undefined }}>
                    {Math.round(l.ratio * 100)}%
                  </td>
                  <td>{l.nozzleCount}</td>
                  <td>{channelText('pump', p)}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{(deviceIssueMap.get(p.id) ?? []).join('；') || '—'}</td>
                </tr>
              );
            })}
            {!project.pumps.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)' }}>还没有水泵</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>染色灯（{project.lights.length}）</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>名称</th><th>X/Y(m)</th><th>DMX 起始通道</th><th>通道范围(RGB)</th><th>问题</th></tr>
          </thead>
          <tbody>
            {project.lights.map((l) => (
              <tr key={l.id} className={rowClass(l.id)}>
                <td>{l.name}</td>
                <td>{l.x.toFixed(1)} / {l.y.toFixed(1)}</td>
                <td>
                  <input type="number" min={1} max={510} style={{ width: 70 }} value={l.dmxStart ?? ''}
                    onChange={(e) => mutate((p) => { const t = p.lights.find((x) => x.id === l.id); if (t) t.dmxStart = e.target.value === '' ? null : +e.target.value; })} />
                </td>
                <td>{channelText('light', l)}</td>
                <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{(deviceIssueMap.get(l.id) ?? []).join('；') || '—'}</td>
              </tr>
            ))}
            {!project.lights.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>还没有灯具</td></tr>}
          </tbody>
        </table>
      </div>

      <h3>DMX512 通道映射（共 {occupants.length} 台设备，冲突通道红色标出）</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>设备</th><th>类型</th><th>起始</th><th>结束</th><th>通道占用</th></tr></thead>
          <tbody>
            {occupants.sort((a, b) => a.start - b.start).map((o, i) => {
              const bad = Array.from({ length: o.end - o.start + 1 }, (_, k) => o.start + k).some((c) => conflictChannels.has(c));
              return (
                <tr key={i} className={bad ? 'conflict' : ''}>
                  <td>{o.name}</td><td>{o.kind}</td><td>{o.start}</td><td>{o.end}</td>
                  <td>
                    {Array.from({ length: o.end - o.start + 1 }, (_, k) => o.start + k).map((c) => (
                      <span key={c} style={{
                        display: 'inline-block', minWidth: 26, textAlign: 'center', margin: 1,
                        padding: '1px 4px', borderRadius: 4,
                        background: conflictChannels.has(c) ? 'var(--danger)' : 'var(--panel-2)',
                        color: conflictChannels.has(c) ? '#fff' : 'var(--muted)',
                      }}>{c}</span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
