import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio } from '../core/store';
import { useTransport } from '../core/TransportContext';
import { analyzeAudio, persistAudio } from '../core/audio';
import { PATTERN_LABELS } from '../core/defaults';
import { snapToBeat, formatTime } from '../core/snap';
import { uid } from '../core/id';
import type { LightClip, WaterClip } from '../core/types';

const PPS = 46; // 每秒像素
const ROW_H = 46;

export default function TimelineView() {
  const project = useStudio((s) => s.current)!;
  const mutate = useStudio((s) => s.mutate);
  const transport = useTransport();
  const duration = Math.max(project.audio?.durationSec ?? 0, 32, ...project.waterClips.map((c) => c.startSec + c.durationSec));
  const widthPx = Math.max(900, (duration + 4) * PPS);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragClip = useRef<{ id: string; kind: 'water' | 'light'; x: number; origStart: number; mode: 'move' | 'resize-l' | 'resize-r' } | null>(null);

  // 播放头轮询（读 Transport 的 AudioContext 权威时钟）
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setTime(transport.currentTime());
      setPlaying(transport.isPlaying);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [transport]);

  useEffect(() => {
    transport.setLoop(loop);
  }, [loop, transport]);

  const pxToTime = useCallback((clientX: number) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    const t = (clientX - rect.left + scrollRef.current!.scrollLeft - 190) / PPS;
    return snap ? snapToBeat(Math.max(0, t), project.bpm) : Math.max(0, t);
  }, [project.bpm, snap]);

  const onImportAudio = async (file: File) => {
    const { info, blob } = await analyzeAudio(file);
    await persistAudio(info, blob);
    mutate((p) => { p.audio = info; p.beats = []; });
    // 重新载入 transport
    await transport.loadFromStorage(info.blobId);
  };

  const togglePlay = async () => {
    if (transport.isPlaying) transport.pause();
    else await transport.play();
  };

  const seekTo = (t: number) => transport.seek(Math.max(0, t));

  const addBeatHere = () => {
    const t = snap ? snapToBeat(time, project.bpm) : Number(time.toFixed(3));
    if (!project.beats.some((b) => Math.abs(b.timeSec - t) < 0.02)) {
      mutate((p) => p.beats.push({ id: uid('beat'), timeSec: Number(t.toFixed(3)) }));
    }
  };

  const autoBeats = () => {
    if (!project.bpm) return;
    const beats: { id: string; timeSec: number }[] = [];
    const step = 60 / project.bpm;
    for (let t = 0; t < duration; t += step) beats.push({ id: uid('beat'), timeSec: Number(t.toFixed(3)) });
    mutate((p) => { p.beats = beats; });
  };

  // 水型轨：每个回路一条；未分组喷头归入 'ungrouped'
  const tracks = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of project.nozzles) map.set(n.groupId ?? 'ungrouped', n.groupId ?? 'ungrouped');
    const rows: { id: string; name: string }[] = project.groups.map((g) => ({ id: g.id, name: `水型 · ${g.name}` }));
    if (map.has('ungrouped')) rows.push({ id: 'ungrouped', name: '水型 · 未分组' });
    return rows;
  }, [project.groups, project.nozzles]);

  const startClipDrag = (e: React.PointerEvent, clip: WaterClip | LightClip, kind: 'water' | 'light', mode: 'move' | 'resize-l' | 'resize-r') => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragClip.current = { id: clip.id, kind, x: e.clientX, origStart: clip.startSec, mode };
    setSelectedClip(clip.id);
  };

  const onClipMove = (e: React.PointerEvent) => {
    const d = dragClip.current;
    if (!d) return;
    const t = pxToTime(e.clientX);
    const delta = t - pxToTime(d.x);
    const store = useStudio.getState();
    store.mutate((p) => {
      const list = d.kind === 'water' ? p.waterClips : p.lightClips;
      const c = list.find((x) => x.id === d.id);
      if (!c) return;
      if (d.mode === 'move') c.startSec = Math.max(0, Number((d.origStart + delta).toFixed(3)));
      if (d.mode === 'resize-r') c.durationSec = Math.max(0.2, Number((t - c.startSec).toFixed(3)));
      if (d.mode === 'resize-l') {
        const end = c.startSec + c.durationSec;
        c.startSec = Math.min(end - 0.2, t);
        c.durationSec = end - c.startSec;
      }
    });
  };

  const selWater = project.waterClips.find((c) => c.id === selectedClip);
  const selLight = project.lightClips.find((c) => c.id === selectedClip);

  return (
    <div className="timeline-wrap">
      <div className="transport">
        <button className="btn primary" onClick={togglePlay}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
        <button className="btn small" onClick={() => seekTo(0)}>⏮ 回到开头</button>
        <span className="time-readout">{formatTime(time)} / {formatTime(duration)}</span>
        <label className="chip on" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> BPM 吸附
        </label>
        <label className="prop-row" style={{ margin: 0 }}>
          BPM
          <input type="number" min={40} max={240} value={project.bpm} onChange={(e) => mutate((p) => { p.bpm = +e.target.value; })} />
        </label>
        <button className="btn small" onClick={addBeatHere}>📍 在播放头打节拍</button>
        <button className="btn small" onClick={autoBeats}>按 BPM 铺满节拍</button>
        <button className="btn small" onClick={() => mutate((p) => { p.beats = []; })}>清空节拍</button>
        <span className="chip">{project.beats.length} 个节拍点</span>
        <div style={{ flex: 1 }} />
        <button
          className={`btn small ${loop ? 'primary' : ''}`}
          onClick={() => {
            if (loop) setLoop(null);
            else {
              const step = 60 / project.bpm * 4;
              const s = snapToBeat(time, project.bpm);
              setLoop({ start: s, end: Number((s + step).toFixed(3)) });
            }
          }}
        >
          {loop ? `循环段 ${formatTime(loop.start)}–${formatTime(loop.end)}（点击取消）` : '🔁 设循环段（一小节）'}
        </button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>导入 MP3 曲目</button>
        <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportAudio(f); e.target.value = ''; }} />
      </div>

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width: widthPx + 190 }} onPointerMove={onClipMove} onPointerUp={() => { dragClip.current = null; }}>
          {/* 波形行 */}
          <div className="tl-row" style={{ height: 70 }}>
            <div className="track-head tl-label" style={{ height: 70 }}>
              {project.audio ? project.audio.name : '未导入曲目'}
            </div>
            <div className="tl-track-area" style={{ position: 'relative', height: 70, width: widthPx }}
              onClick={(e) => seekTo(pxToTime(e.clientX))}
            >
              <Waveform peaks={project.audio?.peaks ?? []} width={widthPx} />
              <BeatLayer duration={duration} width={widthPx} bpm={project.bpm} beats={project.beats} />
            </div>
          </div>

          {/* 标尺 */}
          <div className="tl-head-row">
            <div className="tl-head-label">轨道 / 片段</div>
            <div className="tl-ruler" style={{ width: widthPx }} onClick={(e) => seekTo(pxToTime(e.clientX))}>
              {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
                <span key={i} style={{ position: 'absolute', left: i * PPS, top: 8, fontSize: 11, color: '#8fa6c2', fontVariantNumeric: 'tabular-nums' }}>
                  {i % 5 === 0 ? formatTime(i) : ''}
                </span>
              ))}
              <BeatLayer duration={duration} width={widthPx} bpm={project.bpm} beats={project.beats} />
            </div>
          </div>

          {/* 水型轨 */}
          {tracks.map((tr) => (
            <div className="tl-row" key={tr.id}>
              <div className="track-head tl-label">
                {tr.name}
                <div style={{ marginTop: 4 }}>
                  <button className="btn small" onClick={() => addWaterClip(tr.id, time, project, useStudio.getState().mutate)}>＋ 片段</button>
                </div>
              </div>
              <div className="tl-track-area" style={{ width: widthPx }} onClick={(e) => { setSelectedClip(null); seekTo(pxToTime(e.clientX)); }}>
                <BeatLayer duration={duration} width={widthPx} bpm={project.bpm} beats={project.beats} />
                {project.waterClips.filter((c) => c.trackId === tr.id).map((c) => (
                  <div
                    key={c.id}
                    className={`clip water ${selectedClip === c.id ? 'selected' : ''}`}
                    style={{ left: c.startSec * PPS, width: c.durationSec * PPS - 2, background: clipColor(c) }}
                    onPointerDown={(e) => startClipDrag(e, c, 'water', e.shiftKey ? 'resize-r' : 'move')}
                    onClick={(e) => { e.stopPropagation(); setSelectedClip(c.id); }}
                    title="拖动移动，Shift+拖动改时长"
                  >
                    {PATTERN_LABELS[c.pattern]} · {c.targetIds.length}喷头
                    <span className="rsize" onPointerDown={(e) => startClipDrag(e, c, 'water', 'resize-r')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(255,255,255,.25)' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 灯光轨 */}
          <div className="tl-row">
            <div className="track-head tl-label">
              灯光染色
              <div style={{ marginTop: 4 }}>
                <button className="btn small" onClick={() => addLightClip(time, project, useStudio.getState().mutate)}>＋ 灯光片段</button>
              </div>
            </div>
            <div className="tl-track-area" style={{ width: widthPx }} onClick={(e) => { setSelectedClip(null); seekTo(pxToTime(e.clientX)); }}>
              <BeatLayer duration={duration} width={widthPx} bpm={project.bpm} beats={project.beats} />
              {project.lightClips.map((c) => (
                <div
                  key={c.id}
                  className={`clip light ${selectedClip === c.id ? 'selected' : ''}`}
                  style={{ left: c.startSec * PPS, width: c.durationSec * PPS - 2, background: `rgb(${c.color.map((v) => Math.round(v * 255)).join(',')})` }}
                  onPointerDown={(e) => startClipDrag(e, c, 'light', e.shiftKey ? 'resize-r' : 'move')}
                  onClick={(e) => { e.stopPropagation(); setSelectedClip(c.id); }}
                >
                  {c.lightIds.length}灯 · {Math.round(c.intensity * 100)}%{c.pulse ? ' 脉冲' : ''}
                  <span onPointerDown={(e) => startClipDrag(e, c, 'light', 'resize-r')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(255,255,255,.25)' }} />
                </div>
              ))}
            </div>
          </div>

          {/* 播放头 */}
          <div className="playhead" style={{ left: 190 + time * PPS }} />
        </div>
      </div>

      {/* 片段属性编辑 */}
      {(selWater || selLight) && (
        <ClipInspector
          water={selWater}
          light={selLight}
          onClose={() => setSelectedClip(null)}
        />
      )}
    </div>
  );
}

function clipColor(c: WaterClip): string {
  const palette: Record<string, string> = {
    constant: '#2f7fd1',
    pulse: '#1f9d8a',
    chase: '#b06b1f',
    wave: '#7a56c6',
    burst: '#c44d6b',
  };
  return palette[c.pattern] ?? '#2f7fd1';
}

function addWaterClip(trackId: string, time: number, project: ReturnType<typeof useStudio.getState>['current'], mutate: ReturnType<typeof useStudio.getState>['mutate']) {
  if (!project) return;
  const inTrack = project.nozzles.filter((n) => (n.groupId ?? 'ungrouped') === trackId);
  if (!inTrack.length) { alert('该轨道还没有喷头，请先在布局页放置喷头并分配回路'); return; }
  const step = 60 / project.bpm * 4;
  mutate((p) => {
    p.waterClips.push({
      id: uid('clip'), trackId, targetIds: inTrack.map((n) => n.id),
      startSec: snapToBeat(time, p.bpm), durationSec: step,
      pattern: 'constant', level01: 0.9, pulseCount: 4, chaseStepSec: 0.25, waveFreq: 0.5,
    });
  });
}

function addLightClip(time: number, project: ReturnType<typeof useStudio.getState>['current'], mutate: ReturnType<typeof useStudio.getState>['mutate']) {
  if (!project) return;
  if (!project.lights.length) { alert('请先在布局页放置染色灯'); return; }
  const step = 60 / project.bpm * 4;
  mutate((p) => {
    p.lightClips.push({
      id: uid('lc'), lightIds: p.lights.map((l) => l.id),
      startSec: snapToBeat(time, p.bpm), durationSec: step,
      color: [0.2, 0.5, 1], intensity: 1, pulse: false, pulseHz: 1,
    });
  });
}

function Waveform({ peaks, width }: { peaks: number[]; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = width * dpr;
    c.height = 64 * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 64);
    if (!peaks.length) {
      ctx.fillStyle = '#5d7390';
      ctx.font = '12px sans-serif';
      ctx.fillText('导入 MP3 后这里显示波形', 16, 36);
      return;
    }
    ctx.fillStyle = '#4e9eff';
    const bw = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * 56);
      ctx.fillRect(i * bw, 32 - h / 2, Math.max(1, bw - 0.3), h);
    }
  }, [peaks, width]);
  return <canvas ref={ref} className="wave-canvas" style={{ width, height: 64 }} />;
}

function BeatLayer({ duration, width, bpm, beats }: { duration: number; width: number; bpm: number; beats: { id: string; timeSec: number }[] }) {
  const step = 60 / bpm;
  const grid: number[] = [];
  for (let t = 0; t <= duration; t += step) grid.push(Number(t.toFixed(3)));
  const manual = new Set(beats.map((b) => b.timeSec));
  return (
    <>
      {grid.map((t) => (
        <span key={`g${t}`} className="beat-tick" style={{ left: t * PPS, height: '100%' }} />
      ))}
      {beats.map((b) => (
        <span key={b.id} className={`beat-tick manual ${manual.has(b.timeSec) ? '' : ''}`} style={{ left: b.timeSec * PPS, height: '100%' }} title={`节拍 ${formatTime(b.timeSec)}`} />
      ))}
    </>
  );
}

function ClipInspector({ water, light, onClose }: { water?: WaterClip; light?: LightClip; onClose: () => void }) {
  const project = useStudio((s) => s.current)!;
  const updateWaterClip = useStudio((s) => s.updateWaterClip);
  const updateLightClip = useStudio((s) => s.updateLightClip);
  const removeWaterClip = useStudio((s) => s.removeWaterClip);
  const removeLightClip = useStudio((s) => s.removeLightClip);
  return (
    <div style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
      {water && (
        <>
          <strong>水型片段</strong>
          <label className="prop-row" style={{ margin: 0 }}>起始<input type="number" step={0.1} value={water.startSec} onChange={(e) => updateWaterClip(water.id, { startSec: +e.target.value })} /></label>
          <label className="prop-row" style={{ margin: 0 }}>时长<input type="number" step={0.1} value={Number(water.durationSec.toFixed(2))} onChange={(e) => updateWaterClip(water.id, { durationSec: Math.max(0.2, +e.target.value) })} /></label>
          <label className="prop-row" style={{ margin: 0 }}>水型
            <select value={water.pattern} onChange={(e) => updateWaterClip(water.id, { pattern: e.target.value as WaterClip['pattern'] })}>
              {Object.entries(PATTERN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="prop-row" style={{ margin: 0 }}>开度<input type="number" min={0} max={1} step={0.05} value={water.level01} onChange={(e) => updateWaterClip(water.id, { level01: +e.target.value })} /></label>
          {water.pattern === 'pulse' && <label className="prop-row" style={{ margin: 0 }}>脉冲次数<input type="number" min={1} value={water.pulseCount} onChange={(e) => updateWaterClip(water.id, { pulseCount: +e.target.value })} /></label>}
          {water.pattern === 'chase' && <label className="prop-row" style={{ margin: 0 }}>追逐步长(s)<input type="number" step={0.05} value={water.chaseStepSec} onChange={(e) => updateWaterClip(water.id, { chaseStepSec: +e.target.value })} /></label>}
          {water.pattern === 'wave' && <label className="prop-row" style={{ margin: 0 }}>波浪频率(Hz)<input type="number" step={0.1} value={water.waveFreq} onChange={(e) => updateWaterClip(water.id, { waveFreq: +e.target.value })} /></label>}
          <label className="prop-row" style={{ margin: 0 }}>喷头
            <select
              value="all"
              onChange={(e) => {
                if (e.target.value === 'all') updateWaterClip(water.id, { targetIds: project.nozzles.map((n) => n.id) });
              }}
            >
              <option value="all">全部 {water.targetIds.length} 个（在轨道上多选调整）</option>
            </select>
          </label>
          <button className="btn danger small" onClick={() => { removeWaterClip(water.id); onClose(); }}>删除片段</button>
        </>
      )}
      {light && (
        <>
          <strong>灯光片段</strong>
          <label className="prop-row" style={{ margin: 0 }}>起始<input type="number" step={0.1} value={light.startSec} onChange={(e) => updateLightClip(light.id, { startSec: +e.target.value })} /></label>
          <label className="prop-row" style={{ margin: 0 }}>时长<input type="number" step={0.1} value={Number(light.durationSec.toFixed(2))} onChange={(e) => updateLightClip(light.id, { durationSec: Math.max(0.2, +e.target.value) })} /></label>
          <label className="prop-row" style={{ margin: 0 }}>颜色
            <input type="color" value={rgbToHex(light.color)} onChange={(e) => updateLightClip(light.id, { color: hexToRgb(e.target.value) })} />
          </label>
          <label className="prop-row" style={{ margin: 0 }}>亮度<input type="number" min={0} max={1.5} step={0.1} value={light.intensity} onChange={(e) => updateLightClip(light.id, { intensity: +e.target.value })} /></label>
          <label className="prop-row" style={{ margin: 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={light.pulse} onChange={(e) => updateLightClip(light.id, { pulse: e.target.checked })} /> 随节拍脉冲
          </label>
          {light.pulse && <label className="prop-row" style={{ margin: 0 }}>脉冲频率(Hz)<input type="number" step={0.5} value={light.pulseHz} onChange={(e) => updateLightClip(light.id, { pulseHz: +e.target.value })} /></label>}
          <button className="btn danger small" onClick={() => { removeLightClip(light.id); onClose(); }}>删除片段</button>
        </>
      )}
      <button className="btn small" onClick={onClose}>完成</button>
    </div>
  );
}

function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
