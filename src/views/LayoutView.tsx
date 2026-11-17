import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../core/store';
import { DEFAULT_SPECS, NOZZLE_LABELS, NOZZLE_DMX_FOOTPRINT, LIGHT_DMX_FOOTPRINT, PUMP_DMX_FOOTPRINT } from '../core/defaults';
import type { DeviceKind, Issue, NozzleType, PlacedNozzle } from '../core/types';
import { validateProject } from '../core/validation';
import { uid } from '../core/id';
import { nextFreeChannel } from '../core/dmx';

interface Transform { scale: number; ox: number; oy: number }

const PALETTE: { kind: DeviceKind; type?: NozzleType; label: string; color: string }[] = [
  { kind: 'nozzle', type: 'straight', label: '直喷喷头', color: '#5ab0ff' },
  { kind: 'nozzle', type: 'swing', label: '摇摆喷头', color: '#c68bff' },
  { kind: 'nozzle', type: 'running', label: '跑泉喷头', color: '#36c98f' },
  { kind: 'nozzle', type: 'curtain', label: '水幕喷头', color: '#f0a93b' },
  { kind: 'pump', label: '水泵', color: '#9aa7bd' },
  { kind: 'light', label: '染色灯', color: '#ffe08a' },
];

export default function LayoutView() {
  const project = useStudio((s) => s.current)!;
  const selectedIds = useStudio((s) => s.selectedIds);
  const select = useStudio((s) => s.select);
  const toggleSelect = useStudio((s) => s.toggleSelect);
  const mutate = useStudio((s) => s.mutate);
  const removeDevices = useStudio((s) => s.removeDevices);
  const addGroup = useStudio((s) => s.addGroup);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Transform>({ scale: 34, ox: 0, oy: 0 });
  const dragRef = useRef<any>(null);
  const [, force] = useState(0);
  const [showIssues, setShowIssues] = useState(true);

  const issues: Issue[] = useMemo(() => validateProject(project), [project]);
  const issueDeviceSet = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) for (const id of i.deviceIds) {
      const arr = m.get(id) ?? [];
      arr.push(i);
      m.set(id, arr);
    }
    return m;
  }, [issues]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const tr = trRef.current;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - tr.ox) / tr.scale, y: (sy - tr.oy) / tr.scale };
  }, []);

  const centerTransform = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const tr = trRef.current;
    // 留边距给设备名称和工具栏
    tr.scale = Math.min((c.clientWidth - 160) / project.poolW, (c.clientHeight - 140) / project.poolH);
    // 世界原点(水池中心)对齐画布中心
    tr.ox = c.clientWidth / 2;
    tr.oy = c.clientHeight / 2;
  }, [project.poolW, project.poolH]);

  // 绘制
  useEffect(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const tr = trRef.current;
      ctx.fillStyle = '#0b1320';
      ctx.fillRect(0, 0, w, h);
      const X = (x: number) => tr.ox + x * tr.scale;
      const Y = (y: number) => tr.oy + y * tr.scale;

      // 网格（1m）
      ctx.strokeStyle = 'rgba(60,90,130,0.25)';
      ctx.lineWidth = 1;
      const x0 = Math.floor(-tr.ox / tr.scale) - 1;
      const x1 = x0 + Math.ceil(w / tr.scale) + 2;
      const y0 = Math.floor(-tr.oy / tr.scale) - 1;
      const y1 = y0 + Math.ceil(h / tr.scale) + 2;
      ctx.beginPath();
      for (let gx = x0; gx <= x1; gx++) { ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); }
      for (let gy = y0; gy <= y1; gy++) { ctx.moveTo(0, Y(gy)); ctx.lineTo(w, Y(gy)); }
      ctx.stroke();

      // 水池
      ctx.fillStyle = 'rgba(28,74,110,0.55)';
      ctx.strokeStyle = '#3d6fa4';
      ctx.lineWidth = 2;
      ctx.fillRect(X(-project.poolW / 2), Y(-project.poolH / 2), project.poolW * tr.scale, project.poolH * tr.scale);
      ctx.strokeRect(X(-project.poolW / 2), Y(-project.poolH / 2), project.poolW * tr.scale, project.poolH * tr.scale);

      // 分组连线（喷头到泵）
      for (const n of project.nozzles) {
        if (!n.pumpId) continue;
        const pump = project.pumps.find((p) => p.id === n.pumpId);
        if (!pump) continue;
        const g = project.groups.find((gg) => gg.id === n.groupId);
        ctx.strokeStyle = (g?.color ?? '#445') + '55';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(n.x), Y(n.y));
        ctx.lineTo(X(pump.x), Y(pump.y));
        ctx.stroke();
      }

      const sel = new Set(selectedIds);
      // 设备
      for (const n of project.nozzles) drawNozzle(ctx, n, X, Y, tr, sel.has(n.id), issueDeviceSet.get(n.id));
      for (const p of project.pumps) {
        const bad = issueDeviceSet.get(p.id);
        ctx.save();
        ctx.translate(X(p.x), Y(p.y));
        ctx.fillStyle = bad?.some((i) => i.severity === 'error') ? '#e36079' : '#6b7889';
        ctx.strokeStyle = sel.has(p.id) ? '#fff' : '#aab6c6';
        ctx.lineWidth = sel.has(p.id) ? 2 : 1;
        ctx.fillRect(-7, -7, 14, 14);
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.fillStyle = '#cfd9e6';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('泵', 0, -11);
        ctx.restore();
      }
      for (const l of project.lights) {
        ctx.save();
        ctx.translate(X(l.x), Y(l.y));
        ctx.fillStyle = '#ffd24d';
        ctx.strokeStyle = sel.has(l.id) ? '#fff' : '#c9a23e';
        ctx.lineWidth = sel.has(l.id) ? 2 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 框选矩形
      const d = dragRef.current;
      if (d?.mode === 'box') {
        ctx.strokeStyle = '#4e9eff';
        ctx.fillStyle = 'rgba(78,158,255,0.12)';
        ctx.lineWidth = 1;
        const rx = Math.min(d.x0, d.x1), ry = Math.min(d.y0, d.y1);
        ctx.fillRect(rx, ry, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        ctx.strokeRect(rx, ry, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [project, selectedIds, issueDeviceSet]);

  useEffect(() => { centerTransform(); }, [centerTransform]);

  const hitTest = (wx: number, wy: number): string | null => {
    const r = 0.55;
    for (let i = project.nozzles.length - 1; i >= 0; i--) {
      const n = project.nozzles[i];
      if (Math.abs(n.x - wx) < r && Math.abs(n.y - wy) < r) return n.id;
    }
    for (const p of project.pumps) if (Math.abs(p.x - wx) < 0.7 && Math.abs(p.y - wy) < 0.7) return p.id;
    for (const l of project.lights) if (Math.hypot(l.x - wx, l.y - wy) < 0.7) return l.id;
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    c.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitTest(w.x, w.y);
    if (e.button === 1 || e.button === 2) {
      dragRef.current = { mode: 'pan', x: e.clientX, y: e.clientY, ox: trRef.current.ox, oy: trRef.current.oy };
      return;
    }
    if (hit) {
      if (e.shiftKey) {
        toggleSelect(hit);
      } else {
        if (!selectedIds.includes(hit)) select([hit]);
        const ids = e.shiftKey ? [...selectedIds, hit] : useStudio.getState().selectedIds;
        const starts = ids.map((id) => {
          const d = findDevice(project, id)!;
          return { id, x: d.x, y: d.y };
        });
        dragRef.current = { mode: 'move', x: e.clientX, y: e.clientY, starts };
      }
    } else {
      select([]);
      dragRef.current = { mode: 'box', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      trRef.current.ox = d.ox + (e.clientX - d.x);
      trRef.current.oy = d.oy + (e.clientY - d.y);
    } else if (d.mode === 'move') {
      const w0 = toWorld(d.x, d.y);
      const w1 = toWorld(e.clientX, e.clientY);
      const dx = w1.x - w0.x, dy = w1.y - w0.y;
      mutate((p) => {
        for (const st of d.starts) {
          const dev = findDevice(p, st.id);
          if (dev) { dev.x = st.x + dx; dev.y = st.y + dy; }
        }
      });
    } else if (d.mode === 'box') {
      d.x1 = e.clientX; d.y1 = e.clientY;
      force((n) => n + 1);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.mode === 'box') {
      const a = toWorld(d.x0, d.y0);
      const b = toWorld(d.x1, d.y1);
      const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
      if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) return;
      const ids = [
        ...project.nozzles, ...project.pumps, ...project.lights,
      ].filter((dev) => dev.x >= minX && dev.x <= maxX && dev.y >= minY && dev.y <= maxY).map((dev) => dev.id);
      select(ids);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const tr = trRef.current;
    const before = toWorld(e.clientX, e.clientY);
    const k = e.deltaY > 0 ? 0.9 : 1.1;
    tr.scale = Math.max(8, Math.min(120, tr.scale * k));
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    tr.ox = sx - before.x * tr.scale;
    tr.oy = sy - before.y * tr.scale;
  };

  // 从素材库拖入
  const onPaletteDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const item = PALETTE.find((p) => p.label === data);
    if (!item) return;
    const w = toWorld(e.clientX, e.clientY);
    const x = Number(w.x.toFixed(2)), y = Number(w.y.toFixed(2));
    if (item.kind === 'pump') useStudio.getState().addPump(x, y);
    else if (item.kind === 'light') useStudio.getState().addLight(x, y);
    else useStudio.getState().addNozzle({ type: item.type!, x, y });
  };

  // 工具栏操作
  const selectedDevices = selectedIds.map((id) => findDevice(project, id)).filter(Boolean) as any[];
  const align = (mode: 'l' | 'r' | 't' | 'b' | 'h' | 'v') => {
    if (selectedDevices.length < 2) return;
    const xs = selectedDevices.map((d) => d.x), ys = selectedDevices.map((d) => d.y);
    mutate((p) => {
      for (const id of selectedIds) {
        const d = findDevice(p, id);
        if (!d) continue;
        if (mode === 'l') d.x = Math.min(...xs);
        if (mode === 'r') d.x = Math.max(...xs);
        if (mode === 't') d.y = Math.min(...ys);
        if (mode === 'b') d.y = Math.max(...ys);
        if (mode === 'h') d.y = ys.reduce((a, b) => a + b, 0) / ys.length;
        if (mode === 'v') d.x = xs.reduce((a, b) => a + b, 0) / xs.length;
      }
    });
  };

  const duplicateRow = () => {
    if (!selectedDevices.length) return;
    const step = Number(prompt('复制间距（米，沿 X 方向）', '3'));
    if (!isFinite(step)) return;
    const copies = Number(prompt('复制排数', '1'));
    if (!isFinite(copies)) return;
    mutate((p) => {
      const srcIds = [...selectedIds];
      for (let row = 1; row <= copies; row++) {
        for (const sid of srcIds) {
          const src = findDevice(p, sid);
          if (!src) continue;
          if ('spec' in src) {
            p.nozzles.push({ ...structuredClone(src as PlacedNozzle), id: uid('nz'), x: src.x + step * row, name: `${src.name} 副本${row}` });
          } else if ('powerLimitKw' in src) {
            p.pumps.push({ ...structuredClone(src as typeof p.pumps[number]), id: uid('pump'), x: src.x + step * row, name: `${src.name} 副本${row}` });
          } else {
            p.lights.push({ ...structuredClone(src as typeof p.lights[number]), id: uid('lt'), x: src.x + step * row, name: `${src.name} 副本${row}` });
          }
        }
      }
    });
  };

  const selNozzle = selectedDevices.find((d) => 'spec' in d) as PlacedNozzle | undefined;

  return (
    <div className="view">
      <aside className="sidebar">
        <h4>设备库（拖入平面）</h4>
        {PALETTE.map((item) => (
          <div
            key={item.label}
            className="palette-item"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', item.label)}
          >
            <span className="dot" style={{ background: item.color }} />
            {item.label}
            {item.type && <small>{NOZZLE_LABELS[item.type]}</small>}
          </div>
        ))}

        <h4>回路分组</h4>
        {project.groups.map((g) => (
          <div key={g.id} className="prop-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="dot" style={{ width: 11, height: 11, borderRadius: '50%', background: g.color, display: 'inline-block' }} />
              {g.name}
            </span>
            <input
              type="color"
              value={g.color}
              onChange={(e) => mutate((p) => { const gg = p.groups.find((x) => x.id === g.id); if (gg) gg.color = e.target.value; })}
            />
          </div>
        ))}
        <button className="btn small" style={{ width: '100%' }} onClick={() => { const n = prompt('分组名称', `回路 ${project.groups.length + 1}`); if (n) addGroup(n); }}>
          ＋ 新建分组
        </button>

        {selNozzle && (
          <>
            <h4>喷头参数 · {selNozzle.name}</h4>
            <PropEditor />
          </>
        )}
      </aside>

      <div className="stage">
        <div className="layout-toolbar">
          <span className="chip">已选 {selectedIds.length} 项</span>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('l')}>左对齐</button>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('r')}>右对齐</button>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('t')}>顶对齐</button>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('b')}>底对齐</button>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('h')}>水平均布</button>
          <button className="btn small" disabled={selectedDevices.length < 2} onClick={() => align('v')}>垂直均布</button>
          <button className="btn small" disabled={!selectedIds.length} onClick={duplicateRow}>整排复制</button>
          <button className="btn danger small" disabled={!selectedIds.length} onClick={() => removeDevices(selectedIds)}>删除</button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn small" onClick={centerTransform}>居中视图</button>
          <button className={`btn small ${showIssues ? 'primary' : ''}`} onClick={() => setShowIssues((v) => !v)}>
            校验标记 {issues.length ? `(${issues.length})` : ''}
          </button>
        </div>
        <div className="layout-wrap" ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={onPaletteDrop}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
            style={{ touchAction: 'none' }}
          />
          {showIssues && issues.length > 0 && (
            <div className="issue-banner">
              <h5>自动检查（{issues.filter((i) => i.severity === 'error').length} 错误 / {issues.filter((i) => i.severity === 'warning').length} 警告）</h5>
              {issues.slice(0, 30).map((i) => (
                <div
                  key={i.id}
                  className={`issue-row ${i.severity}`}
                  onClick={() => { select(i.deviceIds); }}
                  title="点击定位设备"
                >
                  [{i.kind === 'dmx-conflict' ? 'DMX' : i.kind === 'pump-overload' ? '泵功率' : '干涉'}] {i.message}
                </div>
              ))}
              {issues.length > 30 && <div className="proj-meta">其余 {issues.length - 30} 条见设备表…</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function findDevice(p: ReturnType<typeof useStudio.getState>['current'], id: string) {
  if (!p) return undefined;
  return p.nozzles.find((d) => d.id === id) ?? p.pumps.find((d) => d.id === id) ?? p.lights.find((d) => d.id === id);
}

function drawNozzle(
  ctx: CanvasRenderingContext2D,
  n: PlacedNozzle,
  X: (v: number) => number,
  Y: (v: number) => number,
  tr: Transform,
  selected: boolean,
  devIssues?: Issue[],
) {
  const g = useStudio.getState().current?.groups.find((gg) => gg.id === n.groupId);
  const color = g?.color ?? '#5ab0ff';
  const hasError = devIssues?.some((i) => i.severity === 'error');
  const hasWarn = devIssues?.some((i) => i.severity === 'warning');
  ctx.save();
  ctx.translate(X(n.x), Y(n.y));
  // 朝向
  const rot = ((n.rotationDeg || 0) * Math.PI) / 180;
  ctx.rotate(-rot);
  const r = Math.max(7, tr.scale * 0.42);
  if (n.type === 'curtain') {
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? '#fff' : '#0b1320';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.fillRect(-r, -r * 0.5, r * 2, r);
    ctx.strokeRect(-r, -r * 0.5, r * 2, r);
  } else {
    ctx.beginPath();
    if (n.type === 'swing') {
      ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath();
    } else if (n.type === 'running') {
      ctx.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    } else {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = selected ? '#fff' : '#0b1320';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    // 朝向小箭头
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -r - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
  ctx.restore();
  // 问题红圈
  if (hasError || hasWarn) {
    ctx.beginPath();
    ctx.arc(X(n.x), Y(n.y), r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = hasError ? '#e36079' : '#f0a93b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = '#b9c9dc';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(n.name, X(n.x), Y(n.y) + r + 13);
}

/** 选中喷头的属性编辑面板 */
function PropEditor() {
  const project = useStudio((s) => s.current)!;
  const selectedIds = useStudio((s) => s.selectedIds);
  const mutate = useStudio((s) => s.mutate);
  const n = project.nozzles.find((x) => selectedIds.includes(x.id));
  if (!n) return null;
  const set = (patch: Partial<PlacedNozzle>) => mutate((p) => {
    const t = p.nozzles.find((x) => x.id === n.id);
    if (t) Object.assign(t, patch);
  });
  const setSpec = (patch: Partial<PlacedNozzle['spec']>) => mutate((p) => {
    const t = p.nozzles.find((x) => x.id === n.id);
    if (t) Object.assign(t.spec, patch);
  });
  const freeCh = (kind: DeviceKind) => {
    const fp = kind === 'nozzle' ? NOZZLE_DMX_FOOTPRINT[n.type] : kind === 'pump' ? PUMP_DMX_FOOTPRINT : LIGHT_DMX_FOOTPRINT;
    set({ dmxStart: nextFreeChannel(project, fp) } as any);
  };
  return (
    <div>
      <div className="prop-row"><label>名称</label><input value={n.name} onChange={(e) => set({ name: e.target.value })} style={{ width: 130 }} /></div>
      <div className="prop-row"><label>X (m)</label><input type="number" step={0.1} value={n.x} onChange={(e) => set({ x: +e.target.value })} /></div>
      <div className="prop-row"><label>Y (m)</label><input type="number" step={0.1} value={n.y} onChange={(e) => set({ y: +e.target.value })} /></div>
      <div className="prop-row"><label>朝向(°)</label><input type="number" step={5} value={n.rotationDeg} onChange={(e) => set({ rotationDeg: +e.target.value })} /></div>
      <div className="prop-section" />
      <div className="prop-row"><label>口径(mm)</label><input type="number" step={0.5} value={n.spec.diameterMm} onChange={(e) => setSpec({ diameterMm: +e.target.value })} /></div>
      <div className="prop-row"><label>压力(bar)</label><input type="number" step={0.1} value={n.spec.pressureBar} onChange={(e) => setSpec({ pressureBar: +e.target.value })} /></div>
      {n.type === 'swing' && (
        <>
          <div className="prop-row"><label>摆角(°)</label><input type="number" step={1} value={n.spec.swingAngleDeg} onChange={(e) => setSpec({ swingAngleDeg: +e.target.value })} /></div>
          <div className="prop-row"><label>周期(s)</label><input type="number" step={0.1} value={n.spec.swingPeriodSec} onChange={(e) => setSpec({ swingPeriodSec: +e.target.value })} /></div>
        </>
      )}
      {n.type === 'curtain' && (
        <div className="prop-row"><label>幕宽(m)</label><input type="number" step={0.5} value={n.spec.curtainWidth} onChange={(e) => setSpec({ curtainWidth: +e.target.value })} /></div>
      )}
      <div className="prop-section" />
      <div className="prop-row">
        <label>回路</label>
        <select value={n.groupId ?? ''} onChange={(e) => set({ groupId: e.target.value || null })} style={{ width: 130 }}>
          <option value="">未分组</option>
          {project.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>水泵</label>
        <select value={n.pumpId ?? ''} onChange={(e) => set({ pumpId: e.target.value || null })} style={{ width: 130 }}>
          <option value="">未分配</option>
          {project.pumps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>染色灯</label>
        <select value={n.lightId ?? ''} onChange={(e) => set({ lightId: e.target.value || null })} style={{ width: 130 }}>
          <option value="">无</option>
          {project.lights.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>DMX 起始</label>
        <span style={{ display: 'flex', gap: 4 }}>
          <input type="number" min={1} max={512} value={n.dmxStart ?? ''} onChange={(e) => set({ dmxStart: e.target.value === '' ? null : +e.target.value })} />
          <button className="btn small" onClick={() => freeCh('nozzle')}>自动</button>
        </span>
      </div>
      <div className="prop-row" style={{ justifyContent: 'flex-start' }}>
        <button className="btn small" onClick={() => mutate((p) => { const t = p.nozzles.find((x) => x.id === n.id); if (t) t.spec = { ...DEFAULT_SPECS[n.type] }; })}>
          恢复默认参数
        </button>
      </div>
    </div>
  );
}
