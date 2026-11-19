// ============ 喷头布局页: 2D 平面图编辑器 ============
import { store } from '../store';
import { el } from '../ui';
import { Nozzle, NozzleType, NOZZLE_TYPES, Pump, uid, newNozzle, dmxFootprint } from '../types';
import { runAllChecks, CheckReport } from '../checks';
import { nozzlePower } from '../physics';

let cleanup: (() => void) | null = null;
export function destroyLayout() { cleanup?.(); cleanup = null; }

/** 试喷请求: 预演页读取 */
export const testSprayRequest: { nozzleId: string | null } = { nozzleId: null };

const TYPE_COLORS: Record<string, string> = {
  direct: '#4db8ff', swing: '#ffb84d', running: '#34d3a0', curtain: '#c58bff',
};

export function renderLayout(root: HTMLElement) {
  const p = store.current!;
  const page = el('div', { class: 'page' });

  // ---- 工具栏 ----
  const toolbar = el('div', { class: 'toolbar' });
  const alignBtns: [string, () => void][] = [
    ['← 左对齐', () => alignSel('left')], ['↔ 水平居中', () => alignSel('hcenter')],
    ['→ 右对齐', () => alignSel('right')], ['↑ 顶对齐', () => alignSel('top')],
    ['↕ 垂直居中', () => alignSel('vcenter')], ['↓ 底对齐', () => alignSel('bottom')],
  ];
  for (const [label, fn] of alignBtns) {
    const b = el('button', {}, label);
    b.onclick = fn;
    toolbar.append(b);
  }
  const btnRowCopy = el('button', {}, '▦ 整排复制');
  btnRowCopy.onclick = rowCopyDialog;
  const btnDel = el('button', { class: 'danger' }, '删除选中');
  btnDel.onclick = deleteSelected;
  toolbar.append(btnRowCopy, btnDel);
  toolbar.append(el('span', { class: 'spacer' }));
  const btnTest = el('button', { class: 'primary' }, '💦 试喷选中喷头');
  btnTest.onclick = () => {
    if (selected.size === 1) {
      testSprayRequest.nozzleId = [...selected][0];
      location.hash = '#/preview';
    } else alert('请先选中一个喷头');
  };
  toolbar.append(btnTest);

  // ---- 画布区 ----
  const wrap = el('div', { class: 'layout-wrap' });
  const canvasBox = el('div', { class: 'layout-canvas-box' });
  const canvas = el('canvas');
  canvasBox.append(canvas);
  const ctx = canvas.getContext('2d')!;

  // ---- 侧栏 ----
  const side = el('div', { class: 'side-panel' });

  // 喷头库
  const palettePanel = el('div', { class: 'panel' });
  palettePanel.append(el('div', { class: 'section-title' }, '喷头库(点击后在图上放置)'));
  const palette = el('div', { class: 'nozzle-palette' });
  let placeType: NozzleType | 'pump' | null = null;
  const paletteBtns: HTMLButtonElement[] = [];
  for (const t of Object.values(NOZZLE_TYPES)) {
    const b = el('button', {}, t.name);
    b.onclick = () => setPlaceType(t.type);
    paletteBtns.push(b);
    palette.append(b);
  }
  const bPump = el('button', {}, '水泵');
  bPump.onclick = () => setPlaceType('pump');
  paletteBtns.push(bPump);
  palette.append(bPump);
  palettePanel.append(palette);
  palettePanel.append(el('div', { class: 'hint' }, '拖拽移动 · 空白处拖拽框选 · 滚轮缩放 · 右键拖动平移'));
  side.append(palettePanel);

  function setPlaceType(t: NozzleType | 'pump' | null) {
    placeType = t;
    paletteBtns.forEach(b => b.classList.remove('active'));
    if (t) {
      const idx = t === 'pump' ? 4 : Object.keys(NOZZLE_TYPES).indexOf(t);
      paletteBtns[idx]?.classList.add('active');
    }
  }

  // 属性面板
  const propPanel = el('div', { class: 'panel' });
  side.append(propPanel);

  // 回路分组
  const circuitPanel = el('div', { class: 'panel' });
  side.append(circuitPanel);

  // 告警面板
  const warnPanel = el('div', { class: 'panel' });
  side.append(warnPanel);

  wrap.append(canvasBox, side);
  page.append(toolbar, wrap);
  root.append(page);

  // ---- 视图状态 ----
  let scale = 14;            // px per meter
  let ox = 60, oy = 40;      // 原点偏移 px
  const selected = new Set<string>(); // nozzle/pump id (pump id 前缀 'p:')
  let report: CheckReport = { dmx: [], interference: [], pumps: [] };

  function toWorld(px: number, py: number): [number, number] {
    return [(px - ox) / scale - p.settings.poolW / 2, (py - oy) / scale - p.settings.poolH / 2];
  }
  function toScreen(wx: number, wy: number): [number, number] {
    return [(wx + p.settings.poolW / 2) * scale + ox, (wy + p.settings.poolH / 2) * scale + oy];
  }

  let fitted = false;
  function resize() {
    const r = canvasBox.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (!fitted && r.width > 100) {
      // 首次: 水池自适应充满画布
      fitted = true;
      scale = Math.min((r.width - 160) / p.settings.poolW, (r.height - 120) / p.settings.poolH);
      scale = Math.min(80, Math.max(4, scale));
      ox = (r.width - p.settings.poolW * scale) / 2;
      oy = (r.height - p.settings.poolH * scale) / 2;
    }
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasBox);

  // ---- 绘制 ----
  function draw() {
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    // 水池
    const [x0, y0] = toScreen(-p.settings.poolW / 2, -p.settings.poolH / 2);
    const [x1, y1] = toScreen(p.settings.poolW / 2, p.settings.poolH / 2);
    ctx.fillStyle = '#101c2c';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = '#3a4f6e';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // 网格(2m)
    ctx.strokeStyle = 'rgba(60,80,110,0.25)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(-p.settings.poolW / 2); gx <= p.settings.poolW / 2; gx += 2) {
      const [sx] = toScreen(gx, 0);
      ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); ctx.stroke();
    }
    for (let gy = Math.ceil(-p.settings.poolH / 2); gy <= p.settings.poolH / 2; gy += 2) {
      const [, sy] = toScreen(0, gy);
      ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); ctx.stroke();
    }

    // 干涉连线
    ctx.strokeStyle = 'rgba(255,85,102,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const it of report.interference) {
      const a = p.nozzles.find(n => n.id === it.a);
      const b = p.nozzles.find(n => n.id === it.b);
      if (!a || !b) continue;
      const [ax, ay] = toScreen(a.x, a.y);
      const [bx, by] = toScreen(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.setLineDash([]);

    // 水泵
    for (const pump of p.pumps) {
      const [sx, sy] = toScreen(pump.x, pump.y);
      const overloaded = report.pumps.some(o => o.pumpId === pump.id);
      ctx.fillStyle = overloaded ? '#ff5566' : '#8ba0b8';
      ctx.beginPath();
      ctx.rect(sx - 8, sy - 8, 16, 16);
      ctx.fill();
      ctx.fillStyle = '#0e1420';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('泵', sx, sy);
      if (selected.has('p:' + pump.id)) {
        ctx.strokeStyle = '#2ea6ff'; ctx.lineWidth = 2;
        ctx.strokeRect(sx - 11, sy - 11, 22, 22);
      }
      // 泵与所属喷头连线
      ctx.strokeStyle = 'rgba(139,160,184,0.25)';
      ctx.lineWidth = 1;
      for (const n of p.nozzles) {
        if (n.pumpId !== pump.id) continue;
        const [nx, ny] = toScreen(n.x, n.y);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(nx, ny); ctx.stroke();
      }
      if (overloaded) {
        ctx.fillStyle = '#ff5566';
        ctx.font = '11px sans-serif';
        ctx.fillText('功率超限!', sx, sy - 16);
      }
    }

    // 喷头
    const interfered = new Set<string>();
    report.interference.forEach(i => { interfered.add(i.a); interfered.add(i.b); });
    const dmxBad = new Set<string>();
    report.dmx.forEach(c => c.nozzleIds.forEach(id => dmxBad.add(id)));

    for (const n of p.nozzles) {
      const [sx, sy] = toScreen(n.x, n.y);
      const circuit = p.circuits.find(c => c.id === n.circuitId);
      const color = circuit?.color ?? TYPE_COLORS[n.type];
      const bad = interfered.has(n.id) || dmxBad.has(n.id);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(n.rotation * Math.PI / 180);
      ctx.fillStyle = bad ? '#ff5566' : color;
      ctx.beginPath();
      if (n.type === 'direct') ctx.arc(0, 0, 5, 0, Math.PI * 2);
      else if (n.type === 'swing') { ctx.moveTo(0, -6); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); }
      else if (n.type === 'running') ctx.rect(-5, -5, 10, 10);
      else { ctx.moveTo(-7, 0); ctx.lineTo(0, -5); ctx.lineTo(7, 0); ctx.lineTo(0, 5); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
      if (selected.has(n.id)) {
        ctx.strokeStyle = '#2ea6ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
      }
      if (bad) {
        ctx.fillStyle = '#ff5566';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠', sx, sy - 12);
      }
    }

    // 框选矩形
    if (boxSel) {
      ctx.strokeStyle = '#2ea6ff';
      ctx.fillStyle = 'rgba(46,166,255,0.12)';
      ctx.fillRect(boxSel.x0, boxSel.y0, boxSel.x1 - boxSel.x0, boxSel.y1 - boxSel.y0);
      ctx.strokeRect(boxSel.x0, boxSel.y0, boxSel.x1 - boxSel.x0, boxSel.y1 - boxSel.y0);
    }
  }

  // ---- 交互 ----
  type DragMode = 'none' | 'move' | 'box' | 'pan';
  let mode: DragMode = 'none';
  let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let dragStart: [number, number] = [0, 0];
  let moved = false;
  let panStart: [number, number] = [0, 0];

  function hitTest(px: number, py: number): { kind: 'nozzle' | 'pump'; id: string } | null {
    for (let i = p.nozzles.length - 1; i >= 0; i--) {
      const [sx, sy] = toScreen(p.nozzles[i].x, p.nozzles[i].y);
      if (Math.hypot(px - sx, py - sy) < 10) return { kind: 'nozzle', id: p.nozzles[i].id };
    }
    for (const pump of p.pumps) {
      const [sx, sy] = toScreen(pump.x, pump.y);
      if (Math.abs(px - sx) < 10 && Math.abs(py - sy) < 10) return { kind: 'pump', id: pump.id };
    }
    return null;
  }

  function evPos(e: MouseEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  const onDown = (e: MouseEvent) => {
    const [px, py] = evPos(e);
    if (e.button === 2) { mode = 'pan'; panStart = [e.clientX, e.clientY]; return; }
    if (e.button !== 0) return;
    const [wx, wy] = toWorld(px, py);
    if (placeType) {
      // 放置设备
      if (placeType === 'pump') {
        store.update(pr => pr.pumps.push({
          id: uid(), name: `泵${pr.pumps.length + 1}`, x: wx, y: wy, power: 15, flow: 60,
        }));
      } else {
        const nextDmx = nextFreeDmx();
        store.update(pr => {
          const n = newNozzle(placeType as NozzleType, wx, wy, nextDmx);
          n.name = `${NOZZLE_TYPES[placeType as NozzleType].name}${pr.nozzles.length + 1}`;
          pr.nozzles.push(n);
        });
      }
      setPlaceType(null);
      refreshChecks();
      return;
    }
    const hit = hitTest(px, py);
    if (hit) {
      const key = hit.kind === 'pump' ? 'p:' + hit.id : hit.id;
      if (!selected.has(key)) {
        if (!e.shiftKey) selected.clear();
        selected.add(key);
      }
      mode = 'move';
      dragStart = [px, py];
      moved = false;
    } else {
      mode = 'box';
      boxSel = { x0: px, y0: py, x1: px, y1: py };
      if (!e.shiftKey) selected.clear();
    }
    refreshProps();
    draw();
  };

  const onMove = (e: MouseEvent) => {
    const [px, py] = evPos(e);
    if (mode === 'pan') {
      ox += e.clientX - panStart[0];
      oy += e.clientY - panStart[1];
      panStart = [e.clientX, e.clientY];
      draw();
    } else if (mode === 'move') {
      const dx = px - dragStart[0], dy = py - dragStart[1];
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      dragStart = [px, py];
      const [wdx, wdy] = [dx / scale, dy / scale];
      store.update(pr => {
        for (const key of selected) {
          if (key.startsWith('p:')) {
            const pump = pr.pumps.find(x => x.id === key.slice(2));
            if (pump) { pump.x += wdx; pump.y += wdy; }
          } else {
            const n = pr.nozzles.find(x => x.id === key);
            if (n) { n.x += wdx; n.y += wdy; }
          }
        }
      });
      draw();
    } else if (mode === 'box' && boxSel) {
      boxSel.x1 = px; boxSel.y1 = py;
      draw();
    }
  };

  const onUp = (e: MouseEvent) => {
    if (mode === 'box' && boxSel) {
      const [ax, bx] = [Math.min(boxSel.x0, boxSel.x1), Math.max(boxSel.x0, boxSel.x1)];
      const [ay, by] = [Math.min(boxSel.y0, boxSel.y1), Math.max(boxSel.y0, boxSel.y1)];
      for (const n of p.nozzles) {
        const [sx, sy] = toScreen(n.x, n.y);
        if (sx >= ax && sx <= bx && sy >= ay && sy <= by) selected.add(n.id);
      }
      for (const pump of p.pumps) {
        const [sx, sy] = toScreen(pump.x, pump.y);
        if (sx >= ax && sx <= bx && sy >= ay && sy <= by) selected.add('p:' + pump.id);
      }
      boxSel = null;
      refreshProps();
    }
    if (mode === 'move' && moved) refreshChecks();
    if (mode === 'move' && !moved && !e.shiftKey) {
      // 单击: 只保留命中项
      const [px, py] = evPos(e);
      const hit = hitTest(px, py);
      if (hit) {
        selected.clear();
        selected.add(hit.kind === 'pump' ? 'p:' + hit.id : hit.id);
        refreshProps();
      }
    }
    mode = 'none';
    draw();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [px, py] = evPos(e);
    const [wx, wy] = [(px - ox) / scale, (py - oy) / scale];
    scale = Math.min(80, Math.max(4, scale * (1 - e.deltaY * 0.001)));
    ox = px - wx * scale;
    oy = py - wy * scale;
    draw();
  };

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---- 操作 ----
  function nextFreeDmx(): number {
    const used = new Set<number>();
    for (const n of p.nozzles) {
      for (let c = n.dmxStart; c < n.dmxStart + dmxFootprint(n); c++) used.add(c);
    }
    for (let c = 1; c <= 512; c++) if (!used.has(c)) return c;
    return 1;
  }

  function alignSel(kind: string) {
    const ns = p.nozzles.filter(n => selected.has(n.id));
    if (ns.length < 2) return;
    store.update(() => {
      if (kind === 'left') { const v = Math.min(...ns.map(n => n.x)); ns.forEach(n => n.x = v); }
      if (kind === 'right') { const v = Math.max(...ns.map(n => n.x)); ns.forEach(n => n.x = v); }
      if (kind === 'top') { const v = Math.min(...ns.map(n => n.y)); ns.forEach(n => n.y = v); }
      if (kind === 'bottom') { const v = Math.max(...ns.map(n => n.y)); ns.forEach(n => n.y = v); }
      if (kind === 'hcenter') { const v = ns.reduce((s, n) => s + n.x, 0) / ns.length; ns.forEach(n => n.x = v); }
      if (kind === 'vcenter') { const v = ns.reduce((s, n) => s + n.y, 0) / ns.length; ns.forEach(n => n.y = v); }
    });
    refreshChecks();
    draw();
  }

  function rowCopyDialog() {
    const ns = p.nozzles.filter(n => selected.has(n.id));
    if (!ns.length) { alert('请先选中要复制的喷头'); return; }
    const count = parseInt(prompt('复制几排?', '1') || '0', 10);
    if (!count) return;
    const dx = parseFloat(prompt('每排 X 方向间距(米)?', '0') || '0');
    const dy = parseFloat(prompt('每排 Y 方向间距(米)?', '2') || '0');
    store.update(pr => {
      let dmx = nextFreeDmx();
      for (let k = 1; k <= count; k++) {
        for (const src of ns) {
          const copy: Nozzle = JSON.parse(JSON.stringify(src));
          copy.id = uid();
          copy.x = src.x + dx * k;
          copy.y = src.y + dy * k;
          copy.dmxStart = dmx;
          dmx += dmxFootprint(copy);
          copy.name = src.name + `-${k}`;
          pr.nozzles.push(copy);
        }
      }
    });
    refreshChecks();
    draw();
  }

  function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`删除选中的 ${selected.size} 个设备?`)) return;
    store.update(pr => {
      pr.nozzles = pr.nozzles.filter(n => !selected.has(n.id));
      pr.pumps = pr.pumps.filter(x => !selected.has('p:' + x.id));
      for (const t of pr.tracks) t.targetIds = t.targetIds.filter(id => !selected.has(id));
    });
    selected.clear();
    refreshProps();
    refreshChecks();
    draw();
  }

  // ---- 属性面板 ----
  function refreshProps() {
    propPanel.innerHTML = '';
    propPanel.append(el('div', { class: 'section-title' }, '属性'));
    const nozzleIds = [...selected].filter(k => !k.startsWith('p:'));
    const pumpIds = [...selected].filter(k => k.startsWith('p:')).map(k => k.slice(2));
    if (nozzleIds.length === 1 && !pumpIds.length) {
      const n = p.nozzles.find(x => x.id === nozzleIds[0])!;
      const rows: [string, keyof Nozzle, 'number' | 'text'][] = [
        ['名称', 'name', 'text'], ['口径mm', 'caliber', 'number'], ['扬程m', 'pressure', 'number'],
        ['摇摆角°', 'swingAngle', 'number'], ['周期s', 'swingPeriod', 'number'],
        ['朝向°', 'rotation', 'number'], ['DMX起始', 'dmxStart', 'number'],
      ];
      for (const [label, key, type] of rows) {
        const row = el('div', { class: 'prop-row' });
        row.append(el('label', {}, label));
        const inp = el('input', { type }) as HTMLInputElement;
        inp.value = String(n[key]);
        inp.onchange = () => {
          store.update(() => {
            (n as any)[key] = type === 'number' ? parseFloat(inp.value) || 0 : inp.value;
          });
          refreshChecks();
          draw();
        };
        row.append(inp);
        propPanel.append(row);
      }
      // 水泵归属
      const pumpRow = el('div', { class: 'prop-row' });
      pumpRow.append(el('label', {}, '所属水泵'));
      const sel = el('select') as HTMLSelectElement;
      sel.append(el('option', { value: '' }, '(未分配)'));
      for (const pump of p.pumps) sel.append(el('option', { value: pump.id }, pump.name));
      sel.value = n.pumpId ?? '';
      sel.onchange = () => { store.update(() => { n.pumpId = sel.value || null; }); refreshChecks(); draw(); };
      pumpRow.append(sel);
      propPanel.append(pumpRow);
      propPanel.append(el('div', { class: 'hint' },
        `单只功率约 ${nozzlePower(n).toFixed(2)} kW · 占用 DMX ${n.dmxStart}-${n.dmxStart + dmxFootprint(n) - 1}`));
    } else if (pumpIds.length === 1 && !nozzleIds.length) {
      const pump = p.pumps.find(x => x.id === pumpIds[0])!;
      for (const [label, key] of [['名称', 'name'], ['功率kW', 'power'], ['流量m³/h', 'flow']] as const) {
        const row = el('div', { class: 'prop-row' });
        row.append(el('label', {}, label));
        const inp = el('input', { type: key === 'name' ? 'text' : 'number' }) as HTMLInputElement;
        inp.value = String(pump[key]);
        inp.onchange = () => {
          store.update(() => {
            (pump as any)[key] = key === 'name' ? inp.value : parseFloat(inp.value) || 0;
          });
          refreshChecks();
          draw();
        };
        row.append(inp);
        propPanel.append(row);
      }
    } else if (selected.size > 1) {
      propPanel.append(el('div', { class: 'hint' }, `已选 ${selected.size} 个设备`));
    } else {
      propPanel.append(el('div', { class: 'hint' }, '未选中设备'));
    }
    refreshCircuits();
  }

  // ---- 回路分组 ----
  function refreshCircuits() {
    circuitPanel.innerHTML = '';
    circuitPanel.append(el('div', { class: 'section-title' }, '回路分组'));
    const btnAdd = el('button', {}, '＋ 新建回路');
    btnAdd.onclick = () => {
      const name = prompt('回路名称', `回路${p.circuits.length + 1}`);
      if (!name) return;
      const colors = ['#4db8ff', '#ffb84d', '#34d3a0', '#c58bff', '#ff7eb6', '#ffe066'];
      store.update(pr => pr.circuits.push({
        id: uid(), name, color: colors[pr.circuits.length % colors.length],
      }));
      refreshCircuits();
      draw();
    };
    circuitPanel.append(btnAdd);
    for (const c of p.circuits) {
      const row = el('div', { class: 'prop-row' });
      row.style.marginTop = '6px';
      const dot = el('span', {});
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0`;
      row.append(dot, el('span', { style: 'flex:1' }, `${c.name} (${p.nozzles.filter(n => n.circuitId === c.id).length})`));
      const bAssign = el('button', {}, '归入');
      bAssign.title = '把选中喷头归入此回路';
      bAssign.onclick = () => {
        store.update(() => {
          for (const n of p.nozzles) if (selected.has(n.id)) n.circuitId = c.id;
        });
        refreshCircuits();
        draw();
      };
      const bDel = el('button', { class: 'danger' }, '×');
      bDel.onclick = () => {
        store.update(pr => {
          pr.circuits = pr.circuits.filter(x => x.id !== c.id);
          pr.nozzles.forEach(n => { if (n.circuitId === c.id) n.circuitId = null; });
        });
        refreshCircuits();
        draw();
      };
      row.append(bAssign, bDel);
      circuitPanel.append(row);
    }
  }

  // ---- 检查 ----
  function refreshChecks() {
    report = runAllChecks(p);
    warnPanel.innerHTML = '';
    warnPanel.append(el('div', { class: 'section-title' }, '自动检查'));
    const items: string[] = [];
    report.dmx.forEach(c => items.push(`⛔ ${c.message}`));
    report.interference.forEach(i => {
      const a = p.nozzles.find(n => n.id === i.a)?.name;
      const b = p.nozzles.find(n => n.id === i.b)?.name;
      items.push(`⚠ 「${a}」与「${b}」水柱干涉(间距${i.minDist.toFixed(2)}m)`);
    });
    report.pumps.forEach(o => {
      const pump = p.pumps.find(x => x.id === o.pumpId);
      items.push(`⛔ 「${pump?.name}」功率超限: 需${o.required.toFixed(1)}kW / 额定${o.rated}kW`);
    });
    if (!items.length) warnPanel.append(el('div', { class: 'hint' }, '✓ 未发现问题'));
    for (const t of items.slice(0, 30)) {
      warnPanel.append(el('div', { class: t.startsWith('⛔') ? 'err-item' : 'warn-item' }, t));
    }
    draw();
  }

  // 键盘删除
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === document.body) {
      deleteSelected();
    }
    if (e.key === 'Escape') setPlaceType(null);
  };
  window.addEventListener('keydown', onKey);

  cleanup = () => {
    ro.disconnect();
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    store.flushSave();
  };

  refreshProps();
  refreshChecks();
  resize();
}
