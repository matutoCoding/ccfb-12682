import { getBlob, putBlob } from './storage';
import { uid } from './id';
import type { AudioInfo } from './types';

const PEAK_BUCKETS = 1600;

/** 解码音频并提取归一化波形峰值 */
export async function analyzeAudio(file: File): Promise<{ info: AudioInfo; blob: Blob }> {
  const arrayBuf = await file.arrayBuffer();
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const tmp = new Ctx();
  const audioBuf = await tmp.decodeAudioData(arrayBuf.slice(0));
  await tmp.close();

  const channels: Float32Array[] = [];
  for (let c = 0; c < audioBuf.numberOfChannels; c++) channels.push(audioBuf.getChannelData(c));
  const total = audioBuf.length;
  const bucketSize = Math.max(1, Math.floor(total / PEAK_BUCKETS));
  const peaks: number[] = [];
  for (let b = 0; b < PEAK_BUCKETS; b++) {
    const start = b * bucketSize;
    const end = Math.min(total, start + bucketSize);
    let max = 0;
    for (let i = start; i < end; i += 8) {
      let v = 0;
      for (const ch of channels) v += ch[i] * ch[i];
      v = Math.sqrt(v / channels.length);
      if (v > max) max = v;
    }
    peaks.push(Math.min(1, max * 1.4));
  }

  const info: AudioInfo = {
    blobId: uid('audio'),
    name: file.name,
    durationSec: audioBuf.duration,
    sampleRate: audioBuf.sampleRate,
    channels: audioBuf.numberOfChannels,
    peaks,
    bpm: null,
    blobSize: file.size,
  };
  return { info, blob: new Blob([arrayBuf], { type: file.type || 'audio/mpeg' }) };
}

export async function persistAudio(info: AudioInfo, blob: Blob): Promise<void> {
  await putBlob(info.blobId, blob.type, blob);
}

export interface LoopRange {
  start: number;
  end: number;
}

/**
 * 播放传输器。所有视觉时间一律取 currentTime()（AudioContext 时钟），
 * rAF 渲染循环只读这个时间 —— 保证水柱和音乐严格同源，不会出现画面等音频。
 */
export class Transport {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startCtxTime = 0;
  private offsetWhenStart = 0;
  private loop: LoopRange | null = null;
  private playing = false;
  /** 无音频工程的性能时钟基准 */
  private perfBase = 0;
  private perfPos = 0;
  private onEnded: (() => void) | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  get hasAudio(): boolean {
    return !!this.buffer;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** 从 IndexedDB 载入音频 */
  async loadFromStorage(blobId: string): Promise<boolean> {
    const blob = await getBlob(blobId);
    if (!blob) return false;
    await this.loadArrayBuffer(await blob.arrayBuffer());
    return true;
  }

  async loadArrayBuffer(buf: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    this.stopInternal();
    this.buffer = await ctx.decodeAudioData(buf.slice(0));
    this.offsetWhenStart = 0;
    this.perfPos = 0;
  }

  /** 清空音频（切换到无音频工程时），保留实例和上下文 */
  clearBuffer(): void {
    this.stopInternal();
    this.buffer = null;
    this.offsetWhenStart = 0;
    this.perfPos = 0;
  }

  setLoop(range: LoopRange | null): void {
    this.loop = range && range.end > range.start ? range : null;
    if (this.playing && this.buffer) {
      const pos = this.currentTime();
      this.stopInternal();
      this.startSource(pos);
    }
  }

  getLoop(): LoopRange | null {
    return this.loop;
  }

  private startSource(offset: number): void {
    if (!this.ctx || !this.buffer || !this.gain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    let at = offset;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
      at = this.loop.start + ((offset - this.loop.start) % (this.loop.end - this.loop.start));
    }
    src.connect(this.gain);
    src.onended = () => {
      // 主动 stop 也会触发，用引用比对过滤
      if (this.source === src && !src.loop) {
        this.playing = false;
        this.perfPos = this.buffer?.duration ?? 0;
        this.onEnded?.();
      }
    };
    src.start(0, Math.min(Math.max(0, at), this.buffer.duration - 0.01));
    this.source = src;
    this.startCtxTime = this.ctx.currentTime;
    this.offsetWhenStart = offset;
    this.playing = true;
  }

  private stopInternal(): void {
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try { s.stop(); } catch { /* 已停止 */ }
    }
    this.playing = false;
  }

  async play(offset?: number): Promise<void> {
    if (this.playing) return;
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const pos = offset ?? this.currentTime();
    if (this.buffer) {
      this.startSource(pos);
    } else {
      // 无音频：性能时钟
      this.perfBase = performance.now();
      this.perfPos = pos;
      this.playing = true;
    }
  }

  pause(): number {
    const pos = this.currentTime();
    if (this.buffer) {
      this.stopInternal();
    } else {
      this.playing = false;
      this.perfPos = pos;
    }
    return pos;
  }

  seek(timeSec: number): void {
    const wasPlaying = this.playing;
    if (this.buffer) {
      this.stopInternal();
      if (wasPlaying) this.startSource(timeSec);
      else this.offsetWhenStart = timeSec;
    } else {
      this.perfPos = timeSec;
      this.perfBase = performance.now();
    }
  }

  setVolume(v: number): void {
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setOnEnded(cb: (() => void) | null): void {
    this.onEnded = cb;
  }

  /** 唯一权威时间（秒）。3D 渲染循环每帧读它 */
  currentTime(): number {
    if (this.buffer && this.ctx) {
      if (!this.playing) return this.offsetWhenStart;
      let t = this.offsetWhenStart + (this.ctx.currentTime - this.startCtxTime);
      if (this.loop) {
        const span = this.loop.end - this.loop.start;
        t = this.loop.start + ((t - this.loop.start) % span);
      }
      return Math.max(0, t);
    }
    if (this.playing) {
      const now = performance.now();
      this.perfPos += (now - this.perfBase) / 1000;
      this.perfBase = now;
      if (this.loop) {
        const span = this.loop.end - this.loop.start;
        this.perfPos = this.loop.start + ((this.perfPos - this.loop.start) % span);
      }
    }
    return this.perfPos;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  dispose(): void {
    this.stopInternal();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.buffer = null;
  }
}
