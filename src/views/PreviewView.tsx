import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../core/store';
import { useTransport } from '../core/TransportContext';
import { FountainRenderer, evaluateFrame } from '../player/player.raw.js';
import { windVector } from '../core/physics';
import { buildShareHtml, downloadShareHtml } from '../player/share';
import { formatTime } from '../core/snap';
import type { FrameState } from '../core/types';

export default function PreviewView() {
  const project = useStudio((s) => s.current)!;
  const mutate = useStudio((s) => s.mutate);
  const transport = useTransport();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FountainRenderer | null>(null);
  const frameRef = useRef<FrameState>({ nozzles: [], lights: [] });
  const projectRef = useRef(project);
  projectRef.current = project;
  const [testIds, setTestIds] = useState<string[]>([]);
  const testRef = useRef<string[]>([]);
  testRef.current = testIds;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [fps, setFps] = useState(0);
  const [exporting, setExporting] = useState(false);

  // 渲染器生命周期
  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: FountainRenderer;
    try {
      renderer = new FountainRenderer(canvas, projectRef.current);
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    rendererRef.current = renderer;
    let raf = 0;
    let frames = 0;
    let lastFps = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = projectRef.current;
      // 权威时间：只取 Transport（AudioContext 时钟），视觉永远追随音频
      const t = transport.currentTime();
      const st = evaluateFrame(p, t, testRef.current, frameRef.current);
      const wind = windVector(p.windSpeed, p.windDirDeg);
      renderer.setFrame(st, wind);
      renderer.render(performance.now());
      frames++;
      const now = performance.now();
      if (now - lastFps >= 1000) {
        setFps(Math.round((frames * 1000) / (now - lastFps)));
        frames = 0;
        lastFps = now;
      }
    };
    loop();
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工程数据变化时重建实例数据（水柱缓冲不动，零重新分配）
  useEffect(() => {
    rendererRef.current?.setProject(project);
  }, [project]);

  // 播放头 UI 同步
  useEffect(() => {
    const t = setInterval(() => {
      setTime(transport.currentTime());
      setPlaying(transport.isPlaying);
    }, 120);
    return () => clearInterval(t);
  }, [transport]);

  const duration = project.audio?.durationSec ?? 32;
  const loop = transport.getLoop();

  const togglePlay = async () => {
    if (transport.isPlaying) transport.pause();
    else await transport.play();
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const html = await buildShareHtml(project, { loopStart: loop?.start ?? null, loopEnd: loop?.end ?? null });
      downloadShareHtml(html, project.name);
    } finally {
      setExporting(false);
    }
  };

  const selectedNozzles = useMemo(() => project.nozzles.filter((n) => testIds.includes(n.id)), [project.nozzles, testIds]);

  return (
    <div className="preview-wrap">
      <canvas ref={canvasRef} />
      <div className="preview-hud">
        <strong style={{ fontSize: 13 }}>预演控制</strong>
        <button className="btn primary" onClick={togglePlay}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
        <button className="btn small" onClick={() => transport.seek(0)}>回到开头</button>
        <div className="time-readout" style={{ minWidth: 0 }}>{formatTime(time)} / {formatTime(duration)}</div>
        {loop && <span className="chip on">循环 {formatTime(loop.start)}–{formatTime(loop.end)}</span>}

        <div className="prop-section" />
        <strong style={{ fontSize: 13 }}>单喷头试喷</strong>
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            setTestIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
          }}
        >
          <option value="">选择喷头加入试喷…</option>
          {project.nozzles.map((n) => <option key={n.id} value={n.id}>{n.name}{testIds.includes(n.id) ? ' ✓' : ''}</option>)}
        </select>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selectedNozzles.map((n) => (
            <span key={n.id} className="chip on" style={{ cursor: 'pointer' }} onClick={() => setTestIds((p) => p.filter((x) => x !== n.id))} title="点击移除">
              {n.name} ✕
            </span>
          ))}
        </div>
        <button className="btn small" disabled={!testIds.length} onClick={() => setTestIds([])}>停止全部试喷</button>

        <div className="prop-section" />
        <strong style={{ fontSize: 13 }}>环境</strong>
        <div className="prop-row">
          <label>风速(m/s)</label>
          <input type="number" min={0} max={20} step={0.5} value={project.windSpeed}
            onChange={(e) => mutate((p) => { p.windSpeed = +e.target.value; })} />
        </div>
        <div className="prop-row">
          <label>风向(°)</label>
          <input type="number" min={0} max={360} step={5} value={project.windDirDeg}
            onChange={(e) => mutate((p) => { p.windDirDeg = +e.target.value; })} />
        </div>
        <button className="btn small" onClick={() => rendererRef.current?.resetCamera()}>复位视角</button>

        <div className="prop-section" />
        <button className="btn primary" disabled={exporting} onClick={onExport}>
          {exporting ? '正在打包…' : '导出客户分享文件（单 HTML）'}
        </button>
        <small style={{ color: 'var(--muted)', lineHeight: 1.5 }}>双击导出的 HTML 即可播放，无需安装任何软件、无需联网；含循环段设置。</small>
      </div>
      <div className="fps-badge">{fps} FPS · {project.nozzles.length} 喷头</div>
    </div>
  );
}
