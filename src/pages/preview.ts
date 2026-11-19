// ============ 3D 预演页: WebGL2 实时渲染 ============
import { store } from '../store';
import { audio } from '../audio';
import { el, fmtTime } from '../ui';
import { mat4Perspective, mat4LookAt, mat4Multiply } from '../gl/mat';
import { OrbitCamera } from '../gl/camera';
import { JetRenderer, JetState } from '../gl/jets';
import { SceneRenderer } from '../gl/scene';
import { ChoreoEvaluator, NozzleEval } from '../choreo';
import { windVector } from '../physics';
import { exportShareFile } from '../exporter';
import { testSprayRequest } from './layout';

let cleanup: (() => void) | null = null;
export function destroyPreview() { cleanup?.(); cleanup = null; }

export function renderPreview(root: HTMLElement) {
  const p = store.current!;
  const page = el('div', { class: 'page' });

  // ---- 工具栏 ----
  const bar = el('div', { class: 'toolbar' });
  const btnPlay = el('button', { class: 'primary' }, '▶ 播放');
  const btnStop = el('button', {}, '■ 停止');
  const timeLabel = el('span', { style: 'font-family:Consolas,monospace;color:var(--accent2)' }, '00:00.00');
  const testMode = !!testSprayRequest.nozzleId;
  const testNozzle = testMode ? p.nozzles.find(n => n.id === testSprayRequest.nozzleId) : null;
  testSprayRequest.nozzleId = null; // 消费掉

  btnPlay.onclick = () => {
    if (audio.playing) { audio.pause(); }
    else if (audio.buffer) { audio.play(); }
    else if (!testMode) alert('未导入音乐 —— 以自由时钟预演(无音乐)');
  };
  btnStop.onclick = () => audio.stop();

  bar.append(btnPlay, btnStop, timeLabel);
  if (testMode && testNozzle) {
    bar.append(el('span', { class: 'hint', style: 'color:var(--warn)' }, `试喷模式: ${testNozzle.name}(持续喷水)`));
  }
  bar.append(el('span', { class: 'spacer' }));
  // 风速
  bar.append(el('span', { class: 'hint' }, '风速'));
  const windInput = el('input', { type: 'range', min: '0', max: '12', step: '0.5', value: String(p.settings.wind) }) as HTMLInputElement;
  const windVal = el('span', { class: 'hint' }, `${p.settings.wind}m/s`);
  windInput.oninput = () => {
    store.update(pr => { pr.settings.wind = parseFloat(windInput.value); });
    windVal.textContent = `${windInput.value}m/s`;
  };
  bar.append(windInput, windVal);
  bar.append(el('span', { class: 'hint' }, '风向'));
  const dirInput = el('input', { type: 'range', min: '0', max: '360', step: '15', value: String(p.settings.windDir) }) as HTMLInputElement;
  const dirVal = el('span', { class: 'hint' }, `${p.settings.windDir}°`);
  dirInput.oninput = () => {
    store.update(pr => { pr.settings.windDir = parseFloat(dirInput.value); });
    dirVal.textContent = `${dirInput.value}°`;
  };
  bar.append(dirInput, dirVal);
  const btnShare = el('button', {}, '📤 导出分享文件');
  btnShare.onclick = () => exportShareFile(p);
  bar.append(btnShare);

  // ---- GL 画布 ----
  const wrap = el('div', { class: 'preview-wrap' });
  const canvas = el('canvas');
  wrap.append(canvas);
  const hud = el('div', { class: 'preview-hud' }, '左键旋转 · Shift/右键平移 · 滚轮缩放');
  const fpsBadge = el('div', { class: 'fps-badge' }, '-- fps');
  wrap.append(hud, fpsBadge);
  page.append(bar, wrap);
  root.append(page);

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })! as WebGL2RenderingContext;
  if (!gl) {
    wrap.append(el('div', { class: 'panel' }, '当前浏览器不支持 WebGL2, 请使用新版 Chrome/Edge/Firefox。'));
    return;
  }

  const camera = new OrbitCamera();
  camera.target = [0, 1, 0];
  camera.dist = Math.max(p.settings.poolW, p.settings.poolH) * 1.1;
  camera.attach(canvas);

  const jets = new JetRenderer(gl);
  const scene = new SceneRenderer(gl);
  const evaluator = new ChoreoEvaluator(p);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST);

  // ---- 时钟: 有音乐用音频时钟, 否则自由时钟 ----
  let freeT = 0;
  let lastFrame = performance.now();
  const useAudioClock = () => !!audio.buffer && !testMode;

  // 预分配, 避免每帧 GC
  const evalOut: NozzleEval = { intensity: 0, color: [1, 1, 1] };
  const sceneNozzles: { x: number; y: number; color: [number, number, number]; glow: number }[] = [];
  const states: JetState[] = []; // 与 p.nozzles 对齐

  let frames = 0, fpsT = performance.now();
  let raf = 0;
  let running = true;

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // 尺寸
    const dpr = Math.min(2, devicePixelRatio);
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);

    // 时间
    let t: number;
    if (useAudioClock()) {
      t = audio.getTime();
    } else {
      freeT += dt;
      t = freeT;
    }
    timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(audio.duration || p.duration)}`;
    btnPlay.textContent = audio.playing ? '⏸ 暂停' : '▶ 播放';

    // 相机矩阵
    const proj = mat4Perspective(0.9, w / h, 0.1, 500);
    const eye = camera.eye();
    const view = mat4LookAt(eye, camera.target, [0, 1, 0]);
    const vp = mat4Multiply(proj, view);
    // 公告板基向量(view 矩阵的右/上向量)
    const camRight = [view[0], view[4], view[8]];
    const camUp = [view[1], view[5], view[9]];

    const wind = windVector(p.settings.wind, p.settings.windDir);
    const windArr: [number, number, number] = [wind.x, wind.y, wind.z];

    gl.clearColor(0.024, 0.04, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 求值每个喷头
    sceneNozzles.length = 0;
    states.length = 0;
    for (const n of p.nozzles) {
      if (testMode) {
        evalOut.intensity = n.id === testNozzle!.id ? 0.9 : 0;
        evalOut.color = [0.75, 0.88, 1.0];
      } else if (evaluator.hasContent) {
        evaluator.evalNozzle(n.id, t, evalOut);
      } else {
        evalOut.intensity = 0.85;
        evalOut.color = [0.75, 0.88, 1.0];
      }
      sceneNozzles.push({ x: n.x, y: n.y, color: [evalOut.color[0], evalOut.color[1], evalOut.color[2]], glow: evalOut.intensity });
      states.push({ intensity: evalOut.intensity, color: [evalOut.color[0], evalOut.color[1], evalOut.color[2]] });
    }

    // 1. 池底网格
    gl.depthMask(true);
    scene.build(p.settings.poolW, p.settings.poolH, sceneNozzles);
    scene.drawLines(vp);

    // 2. 倒影(水面下镜像, 先画)
    gl.depthMask(false);
    for (let i = 0; i < p.nozzles.length; i++) {
      const st = states[i];
      if (st.intensity <= 0.01) continue;
      jets.draw(vp, p.nozzles[i], st, t, windArr, camRight, camUp, true);
    }
    // 3. 水面
    scene.drawWater(vp, p.settings.poolW, p.settings.poolH);
    // 4. 真实水柱
    for (let i = 0; i < p.nozzles.length; i++) {
      const st = states[i];
      if (st.intensity <= 0.01) continue;
      jets.draw(vp, p.nozzles[i], st, t, windArr, camRight, camUp, false);
    }
    gl.depthMask(true);

    // FPS
    frames++;
    if (now - fpsT > 1000) {
      fpsBadge.textContent = `${frames} fps · ${p.nozzles.length} 喷头`;
      frames = 0;
      fpsT = now;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  cleanup = () => {
    running = false;
    cancelAnimationFrame(raf);
    store.flushSave();
  };
}
