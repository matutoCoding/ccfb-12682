/** BPM 节拍网格吸附 */

export function beatInterval(bpm: number): number {
  return 60 / bpm;
}

/** 吸附到最近节拍网格（网格从 0 开始） */
export function snapToBeat(timeSec: number, bpm: number): number {
  const step = beatInterval(bpm);
  return Math.round(timeSec / step) * step;
}

/** 吸附到小节（4 拍） */
export function snapToBar(timeSec: number, bpm: number): number {
  const step = beatInterval(bpm) * 4;
  return Math.round(timeSec / step) * step;
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
