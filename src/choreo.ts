// ============ 编排求值: 给定时刻 t, 算出每个喷头的水型强度与灯光颜色 ============
import { Project, Clip } from './types';

export interface NozzleEval {
  intensity: number; // 0..1
  color: [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}

function clipLevel(c: Clip, t: number): number {
  const p = (t - c.start) / c.duration; // 0..1
  switch (c.ramp) {
    case 'up': return c.intensity * p;
    case 'down': return c.intensity * (1 - p);
    case 'pulse': {
      // 2Hz 脉冲
      return c.intensity * (Math.sin(t * Math.PI * 4) > 0 ? 1 : 0.15);
    }
    default: return c.intensity;
  }
}

/**
 * 求值器: 预计算 trackId -> 受影响喷头集合, 每帧 O(活动clip数)。
 */
export class ChoreoEvaluator {
  private waterClips: { clip: Clip; targets: Set<string> }[] = [];
  private lightClips: { clip: Clip; targets: Set<string> }[] = [];
  private sorted = false;

  constructor(private project: Project) { this.rebuild(); }

  rebuild() {
    const p = this.project;
    this.waterClips = [];
    this.lightClips = [];
    const trackMap = new Map(p.tracks.map(t => [t.id, t]));
    for (const c of p.clips) {
      const track = trackMap.get(c.trackId);
      if (!track) continue;
      const entry = { clip: c, targets: new Set(track.targetIds) };
      (track.kind === 'water' ? this.waterClips : this.lightClips).push(entry);
    }
    this.waterClips.sort((a, b) => a.clip.start - b.clip.start);
    this.lightClips.sort((a, b) => a.clip.start - b.clip.start);
    this.sorted = true;
  }

  /** 求 t 时刻某喷头状态。无编排时默认常开白色(方便布局页试喷)。 */
  evalNozzle(nozzleId: string, t: number, out: NozzleEval): void {
    let intensity = 0;
    let r = 0.9, g = 0.95, b = 1.0;
    let hasLight = false;
    for (const { clip, targets } of this.waterClips) {
      if (clip.start > t) break;
      if (t >= clip.start + clip.duration || !targets.has(nozzleId)) continue;
      const lv = clipLevel(clip, t);
      if (lv > intensity) intensity = lv;
    }
    for (const { clip, targets } of this.lightClips) {
      if (clip.start > t) break;
      if (t >= clip.start + clip.duration || !targets.has(nozzleId)) continue;
      const lv = clipLevel(clip, t);
      if (lv > 0.05) {
        const c = hexToRgb(clip.color);
        r = c[0]; g = c[1]; b = c[2];
        hasLight = true;
      }
    }
    if (!hasLight && intensity > 0) { r = 0.75; g = 0.88; b = 1.0; }
    out.intensity = intensity;
    out.color[0] = r; out.color[1] = g; out.color[2] = b;
  }

  /** 是否存在任何编排内容 */
  get hasContent() { return this.waterClips.length + this.lightClips.length > 0; }
}
