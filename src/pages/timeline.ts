// ============ 曲目编排页: 波形 + 节拍 + 水型/灯光分轨时间线 ============
import { store, putAudio, getAudio } from '../store';
import { audio } from '../audio';
import { el, fmtTime } from '../ui';
import { Clip, Track, TrackKind, uid } from '../types';

let cleanup: (() => void) | null = null;
export function destroyTimeline() { cleanup?.(); cleanup = null; }

const RULER_H = 24, BEAT_H = 20, WAVE_H = 74, TRACK_H = 46, LABEL_W = 190;

export function renderTimeline(root: HTMLElement) {
  const p = store.current!;
  const page = el('div', { class: 'page' });

  // ---- 顶部: 音频导入 + 走带控制 ----
  const bar1 = el('div', { class: 'toolbar' });
  const btnAudio = el('button', {}, p.audioName ? `♪ ${p.audioName}` : '导入音乐(mp3)');
  const fileIn = el('input', { type: 'file', accept: 'audio/*', style: 'display:none' });
  fileIn.onchange = async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    await putAudio(p.id, buf);
    await audio.load(buf);
    store.update(pr => { pr.audioName = f.name; pr.duration = Math.ceil(audio.duration); });
    btnAudio.textContent = `♪ ${f.name}`;
    zoomFit();
    draw();
  };
  btnAudio.onclick = () => fileIn.click();

  const btnPlay = el('button', { class: 'primary' }, '▶ 播放');
  const btnStop = el('button', {}, '■ 停止');
  const timeLabel = el('span', { class: 'time', style: 'font-family:Consolas,monospace;color:var(--accent2)' }, '00:00.00');
  btnPlay.onclick = () => {
    if (audio.playing) { audio.pause(); btnPlay.textContent = '▶ 播放'; }
    else if (audio.buffer) { audio.play(); btnPlay.textContent = '⏸ 暂停'; }
    else alert('请先导入音乐');
  };
  btnStop.onclick = () => { audio.stop(); btnPlay.textContent = '▶ 播放'; };

  const btnLoop = el('button', {}, '🔁 循环: 关');
  let loopOn = false;
  btnLoop.onclick = () => {
    loopOn = !loopOn;
    if (loopOn && loopRegion) { audio.setLoop(loopRegion[0], loopRegion[1]); btnLoop.textContent = '🔁 循环: 开'; }
    else { audio.clearLoop(); loopOn = false; btnLoop.textContent = '🔁 循环: 关'; }
  };

  bar1.append(btnAudio, fileIn, btnPlay, btnStop, btnLoop, timeLabel);

  // ---- 第二排: 节拍与轨道 ----
  const bar2 = el('div', { class: 'toolbar' });
  const btnTap = el('button', {}, '👆 打拍(空格)');
  btnTap.onclick = tapBeat;
  const bpmInput = el('input', { type: 'number', placeholder: 'BPM', style: 'width:70px' }) as HTMLInputElement;
  bpmInput.value = p.bpm ? String(p.bpm) : '';
  bpmInput.onchange = () => store.update(pr => { pr.bpm = parseFloat(bpmInput.value) || null; });
  const btnBpmFromBeats = el('button', {}, '由节拍算BPM');
  btnBpmFromBeats.onclick = () => {
    if (p.beats.length < 2) { alert('至少打 2 个节拍点'); return; }
    const span = p.beats[p.beats.length - 1] - p.beats[0];
    const bpm = Math.round((60 * (p.beats.length - 1)) / span);
    bpmInput.value = String(bpm);
    store.update(pr => { pr.bpm = bpm; });
  };
  const chkSnap = el('input', { type: 'checkbox' }) as HTMLInputElement;
  chkSnap.checked = true;
  const btnClearBeats = el('button', {}, '清空节拍');
  btnClearBeats.onclick = () => { if (confirm('清空所有节拍点?')) store.update(pr => { pr.beats = []; }); };
  bar2.append(btnTap, el('span', { class: 'hint' }, 'BPM'), bpmInput, btnBpmFromBeats,
    chkSnap, el('span', { class: 'hint' }, '按BPM吸附'), btnClearBeats);

  bar2.append(el('span', { class: 'spacer' }));
  const btnAddWater = el('button', {}, '＋ 水型轨');
  const btnAddLight = el('button', {}, '＋ 灯光轨');
  btnAddWater.onclick = () => addTrack('water');
  btnAddLight.onclick = () => addTrack('light');
  bar2.append(btnAddWater, btnAddLight);

  // ---- 时间线画布 ----
  const wrap = el('div', { class: 'timeline-wrap' });
  const canvas = el('canvas');
  wrap.append(canvas);
  const ctx = canvas.getContext('2d')!;
  page.append(bar1, bar2, wrap);
  page.append(el('div', { class: 'hint' },
    '操作: 标尺点击定位播放头, 标尺拖拽设循环段 · 节拍行点击加/删节拍 · 轨道上拖拽新建片段, 拖片段移动, 拖边缘调长度, 双击改参数, Delete 删除'));
  root.append(page);

  // ---- 视图状态 ----
  let pxPerSec = 40;
  let scrollX = 0; // 秒
  let loopRegion: [number, number] | null = null;
  let selClip: string | null = null;
  let raf = 0;

  function tracksTop() { return RULER_H + BEAT_H + WAVE_H; }
  function t2x(t: number) { return LABEL_W + (t - scrollX) * pxPerSec; }
  function x2t(x: number) { return Math.max(0, (x - LABEL_W) / pxPerSec + scrollX); }

  function zoomFit() {
    const w = canvas.clientWidth - LABEL_W;
    pxPerSec = Math.max(2, w / Math.max(10, p.duration));
    scrollX = 0;
  }

  function snap(t: number): number {
    if (!chkSnap.checked) return t;
    // 优先吸附手动节拍, 其次 BPM 网格
    let best = t, bestD = 0.15 * (40 / pxPerSec) + 0.08;
    for (const b of p.beats) {
      const d = Math.abs(b - t);
      if (d < bestD) { best = b; bestD = d; }
    }
    if (best !== t) return best;
    if (p.bpm) {
      const step = 60 / p.bpm;
      const g = Math.round(t / step) * step;
      if (Math.abs(g - t) < step * 0.2) return g;
    }
    return t;
  }

  function tapBeat() {
    const t = audio.getTime();
    store.update(pr => {
      pr.beats.push(Math.round(t * 100) / 100);
      pr.beats.sort((a, b) => a - b);
    });
  }
  const onKeyTap = (e: KeyboardEvent) => {
    if (e.code === 'Space' && document.activeElement === document.body) {
      e.preventDefault();
      tapBeat();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selClip && document.activeElement === document.body) {
      store.update(pr => { pr.clips = pr.clips.filter(c => c.id !== selClip); });
      selClip = null;
    }
  };
  window.addEventListener('keydown', onKeyTap);

  function addTrack(kind: TrackKind) {
    const name = prompt('轨道名称', kind === 'water' ? `水型${p.tracks.filter(t => t.kind === 'water').length + 1}` : `灯光${p.tracks.filter(t => t.kind === 'light').length + 1}`);
    if (!name) return;
    // 选择目标喷头: 简单起见选回路或全部
    const choices = ['全部喷头', ...p.circuits.map(c => '回路:' + c.name)];
    const pick = prompt(`目标(${choices.join(' / )')})? 输入序号, 默认1`, '1');
    let targetIds: string[] = [];
    const idx = (parseInt(pick || '1', 10) || 1) - 1;
    if (idx <= 0) targetIds = p.nozzles.map(n => n.id);
    else {
      const c = p.circuits[idx - 1];
      targetIds = c ? p.nozzles.filter(n => n.circuitId === c.id).map(n => n.id) : p.nozzles.map(n => n.id);
    }
    store.update(pr => pr.tracks.push({ id: uid(), kind, name, targetIds }));
  }

  // ---- 绘制 ----
  function draw() {
    const dpr = devicePixelRatio;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t0 = x2t(LABEL_W), t1 = x2t(W);

    // 标尺
    ctx.fillStyle = '#16202f';
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = '#8ba0b8';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const step = niceStep(pxPerSec);
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = t2x(t);
      if (x < LABEL_W) continue;
      ctx.fillRect(x, RULER_H - 6, 1, 6);
      ctx.fillText(fmtTime(t).slice(0, 5), x + 3, RULER_H / 2);
    }
    // 循环区
    if (loopRegion) {
      ctx.fillStyle = 'rgba(52,211,160,0.18)';
      ctx.fillRect(t2x(loopRegion[0]), 0, (loopRegion[1] - loopRegion[0]) * pxPerSec, RULER_H + BEAT_H + WAVE_H + p.tracks.length * TRACK_H);
    }

    // 节拍行
    ctx.fillStyle = '#131c2b';
    ctx.fillRect(0, RULER_H, W, BEAT_H);
    ctx.fillStyle = '#ffb84d';
    for (const b of p.beats) {
      const x = t2x(b);
      if (x < LABEL_W || x > W) continue;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H + 3); ctx.lineTo(x + 4, RULER_H + BEAT_H / 2);
      ctx.lineTo(x, RULER_H + BEAT_H - 3); ctx.lineTo(x - 4, RULER_H + BEAT_H / 2);
      ctx.closePath(); ctx.fill();
    }
    // BPM 网格(淡)
    if (p.bpm) {
      ctx.strokeStyle = 'rgba(255,184,77,0.12)';
      const stepB = 60 / p.bpm;
      for (let t = Math.floor(t0 / stepB) * stepB; t <= t1; t += stepB) {
        const x = t2x(t);
        if (x < LABEL_W) continue;
        ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H + BEAT_H + WAVE_H); ctx.stroke();
      }
    }

    // 波形
    ctx.fillStyle = '#0e1622';
    ctx.fillRect(0, RULER_H + BEAT_H, W, WAVE_H);
    if (audio.peaks.length) {
      ctx.fillStyle = '#2ea6ff';
      const N = audio.peaks.length;
      const dur = audio.duration || 1;
      for (let x = LABEL_W; x < W; x += 2) {
        const t = x2t(x);
        const i = Math.floor((t / dur) * N);
        if (i < 0 || i >= N) continue;
        const h = audio.peaks[i] * (WAVE_H - 8);
        ctx.fillRect(x, RULER_H + BEAT_H + (WAVE_H - h) / 2, 1.5, Math.max(1, h));
      }
    } else {
      ctx.fillStyle = '#8ba0b8';
      ctx.textAlign = 'center';
      ctx.fillText('未导入音乐 —— 点击左上角「导入音乐」', W / 2, RULER_H + BEAT_H + WAVE_H / 2);
    }

    // 轨道
    const ty0 = tracksTop();
    p.tracks.forEach((track, i) => {
      const y = ty0 + i * TRACK_H;
      ctx.fillStyle = i % 2 ? '#121b29' : '#152031';
      ctx.fillRect(0, y, W, TRACK_H);
      ctx.strokeStyle = '#2a3a52';
      ctx.strokeRect(0.5, y + 0.5, W - 1, TRACK_H - 1);
      // 标签
      ctx.fillStyle = track.kind === 'water' ? '#4db8ff' : '#ffb84d';
      ctx.textAlign = 'left';
      ctx.font = '12px sans-serif';
      ctx.fillText(`${track.kind === 'water' ? '💧' : '💡'} ${track.name}`, 10, y + 15);
      ctx.fillStyle = '#8ba0b8';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${track.targetIds.length} 个喷头 · 双击改名`, 10, y + 32);
      // 片段
      for (const c of p.clips.filter(c => c.trackId === track.id)) {
        const cx = t2x(c.start), cw = c.duration * pxPerSec;
        if (cx + cw < LABEL_W || cx > W) continue;
        const isSel = c.id === selClip;
        ctx.fillStyle = track.kind === 'water'
          ? (isSel ? '#4db8ff' : 'rgba(77,184,255,0.55)')
          : (isSel ? c.color : hexA(c.color, 0.55));
        roundRect(ctx, Math.max(cx, LABEL_W), y + 6, Math.max(4, cw - Math.max(0, LABEL_W - cx)), TRACK_H - 12, 3);
        ctx.fill();
        if (isSel) {
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(Math.max(cx, LABEL_W) + 0.5, y + 6.5, Math.max(4, cw) - 1, TRACK_H - 13);
        }
        if (cw > 40) {
          ctx.fillStyle = '#0e1420';
          ctx.font = '10px sans-serif';
          const label = track.kind === 'water'
            ? `${Math.round(c.intensity * 100)}% ${c.ramp}`
            : c.color;
          ctx.fillText(label, Math.max(cx, LABEL_W) + 5, y + TRACK_H / 2);
        }
      }
    });

    // 标签列分隔
    ctx.fillStyle = '#16202f';
    ctx.fillRect(0, 0, LABEL_W, H);
    ctx.strokeStyle = '#2a3a52';
    ctx.beginPath(); ctx.moveTo(LABEL_W - 0.5, 0); ctx.lineTo(LABEL_W - 0.5, H); ctx.stroke();
    ctx.fillStyle = '#8ba0b8';
    ctx.font = '11px sans-serif';
    ctx.fillText('节拍', 10, RULER_H + BEAT_H / 2);
    ctx.fillText('波形', 10, RULER_H + BEAT_H + WAVE_H / 2);
    p.tracks.forEach((track, i) => {
      const y = ty0 + i * TRACK_H;
      ctx.fillStyle = track.kind === 'water' ? '#4db8ff' : '#ffb84d';
      ctx.font = '12px sans-serif';
      ctx.fillText(`${track.kind === 'water' ? '💧' : '💡'} ${track.name}`, 10, y + 17);
      ctx.fillStyle = '#8ba0b8';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${track.targetIds.length} 喷头 · 右键删轨`, 10, y + 34);
    });

    // 播放头(音频时钟)
    const pt = audio.getTime();
    const px = t2x(pt);
    if (px >= LABEL_W) {
      ctx.strokeStyle = '#34d3a0';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.lineWidth = 1;
    }
    timeLabel.textContent = `${fmtTime(pt)} / ${fmtTime(audio.duration || p.duration)}`;
    if (!audio.playing) btnPlay.textContent = '▶ 播放';
  }

  function niceStep(ppS: number): number {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
    for (const s of steps) if (s * ppS > 60) return s;
    return 120;
  }

  function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function hexA(hex: string, a: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(255,184,77,${a})`;
    const v = parseInt(m[1], 16);
    return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`;
  }

  // ---- 交互 ----
  type Drag =
    | { kind: 'loop'; anchor: number }
    | { kind: 'create'; trackId: string; start: number }
    | { kind: 'move'; clip: Clip; off: number }
    | { kind: 'resize'; clip: Clip }
    | { kind: 'pan'; x: number }
    | null;
  let drag: Drag = null;

  function trackAt(y: number): { track: Track; index: number } | null {
    const i = Math.floor((y - tracksTop()) / TRACK_H);
    return i >= 0 && i < p.tracks.length ? { track: p.tracks[i], index: i } : null;
  }

  function clipAt(x: number, y: number): Clip | null {
    const ta = trackAt(y);
    if (!ta) return null;
    const t = x2t(x);
    for (const c of p.clips) {
      if (c.trackId === ta.track.id && t >= c.start && t <= c.start + c.duration) return c;
    }
    return null;
  }

  const onDown = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.button === 2) {
      // 右键: 删轨道(标签区) 或删片段
      const ta = trackAt(y);
      if (ta && x < LABEL_W) {
        if (confirm(`删除轨道「${ta.track.name}」及其片段?`)) {
          store.update(pr => {
            pr.tracks = pr.tracks.filter(t => t.id !== ta.track.id);
            pr.clips = pr.clips.filter(c => c.trackId !== ta.track.id);
          });
        }
      } else {
        const c = clipAt(x, y);
        if (c) store.update(pr => { pr.clips = pr.clips.filter(cc => cc.id !== c.id); });
      }
      return;
    }
    if (y < RULER_H && x >= LABEL_W) {
      const t = x2t(x);
      drag = { kind: 'loop', anchor: t };
      loopRegion = [t, t];
      audio.seek(t);
      return;
    }
    if (y < RULER_H + BEAT_H && x >= LABEL_W) {
      // 节拍行: 点击加/删节拍
      const t = x2t(x);
      const near = p.beats.findIndex(b => Math.abs(b - t) < 8 / pxPerSec + 0.05);
      store.update(pr => {
        if (near >= 0) pr.beats.splice(near, 1);
        else { pr.beats.push(Math.round(t * 100) / 100); pr.beats.sort((a, b) => a - b); }
      });
      return;
    }
    if (x < LABEL_W) return;
    const c = clipAt(x, y);
    if (c) {
      selClip = c.id;
      const t = x2t(x);
      if (t > c.start + c.duration - 6 / pxPerSec) drag = { kind: 'resize', clip: c };
      else drag = { kind: 'move', clip: c, off: t - c.start };
      return;
    }
    const ta = trackAt(y);
    if (ta) {
      selClip = null;
      drag = { kind: 'create', trackId: ta.track.id, start: snap(x2t(x)) };
    }
  };

  const onMove = (e: MouseEvent) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = x2t(Math.max(x, LABEL_W));
    if (drag.kind === 'loop') {
      loopRegion = [Math.min(drag.anchor, t), Math.max(drag.anchor, t)];
    } else if (drag.kind === 'create') {
      // 预览中, mouseup 时落盘
    } else if (drag.kind === 'move') {
      const c = drag.clip;
      const ns = Math.max(0, snap(t - drag.off));
      store.update(() => { c.start = ns; });
    } else if (drag.kind === 'resize') {
      const c = drag.clip;
      store.update(() => { c.duration = Math.max(0.1, snap(t) - c.start); });
    }
  };

  const onUp = (e: MouseEvent) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = x2t(Math.max(x, LABEL_W));
    if (drag.kind === 'loop') {
      if (loopRegion && loopRegion[1] - loopRegion[0] < 0.2) {
        loopRegion = null;
        audio.clearLoop();
        loopOn = false;
        btnLoop.textContent = '🔁 循环: 关';
      } else if (loopRegion && loopOn) {
        audio.setLoop(loopRegion[0], loopRegion[1]);
      }
    } else if (drag.kind === 'create') {
      const start = Math.min(drag.start, snap(t));
      const end = Math.max(drag.start, snap(t));
      if (end - start > 0.05) {
        const track = p.tracks.find(tr => tr.id === (drag as any).trackId)!;
        store.update(pr => pr.clips.push({
          id: uid(), trackId: track.id, start, duration: end - start,
          intensity: 0.8, color: '#ff9f43', ramp: 'const',
        }));
      }
    }
    drag = null;
  };

  const onDbl = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // 轨道标签双击改名
    const ta = trackAt(y);
    if (ta && x < LABEL_W) {
      const name = prompt('轨道名称', ta.track.name);
      if (name) store.update(() => { ta.track.name = name; });
      return;
    }
    const c = clipAt(x, y);
    if (!c) return;
    const track = p.tracks.find(t => t.id === c.trackId)!;
    if (track.kind === 'water') {
      const v = prompt('强度 0-100%', String(Math.round(c.intensity * 100)));
      if (v === null) return;
      const ramp = prompt('变化方式: const恒定 / up渐强 / down渐弱 / pulse脉冲', c.ramp);
      store.update(() => {
        c.intensity = Math.min(1, Math.max(0, (parseFloat(v) || 80) / 100));
        if (ramp && ['const', 'up', 'down', 'pulse'].includes(ramp)) c.ramp = ramp as Clip['ramp'];
      });
    } else {
      const v = prompt('颜色(#rrggbb)', c.color);
      if (v && /^#[0-9a-f]{6}$/i.test(v)) store.update(() => { c.color = v; });
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (e.shiftKey) {
      scrollX = Math.max(0, scrollX + e.deltaY * 20 / pxPerSec);
    } else {
      const t = x2t(x);
      pxPerSec = Math.min(400, Math.max(2, pxPerSec * (1 - e.deltaY * 0.001)));
      scrollX = Math.max(0, t - (x - LABEL_W) / pxPerSec);
    }
  };

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // 播放头动画循环
  const tick = () => {
    draw();
    // 播放头快出屏时跟随滚动
    if (audio.playing) {
      const pt = audio.getTime();
      if (t2x(pt) > canvas.clientWidth - 40) scrollX = pt - 1;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // 载入已有音频
  getAudio(p.id).then(buf => {
    if (buf && !audio.buffer) {
      audio.load(buf).then(() => { zoomFit(); });
    }
  });

  cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyTap);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    store.flushSave();
  };

  zoomFit();
}
