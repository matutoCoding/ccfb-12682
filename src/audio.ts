// ============ 音频引擎: 解码 / 波形 / 以 AudioContext 为主时钟的播放 ============
// 关键: 所有画面都从这里取"当前音乐时间", 保证水柱与音乐严格同步。

export class AudioEngine {
  ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  peaks: Float32Array = new Float32Array(0); // 归一化波形峰值
  duration = 0;

  private source: AudioBufferSourceNode | null = null;
  private startCtxTime = 0;   // 播放起点对应的 ctx 时间
  private startOffset = 0;    // 播放起点对应的音乐时间
  private _playing = false;
  private _loop: { a: number; b: number } | null = null;

  get playing() { return this._playing; }
  get loop() { return this._loop; }

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  async load(buf: ArrayBuffer): Promise<void> {
    this.ensureCtx();
    const copy = buf.slice(0);
    this.buffer = await this.ctx!.decodeAudioData(copy);
    this.duration = this.buffer.duration;
    this.computePeaks();
    this.stop();
  }

  /** 预计算波形峰值(约 2000 根柱), 供时间线绘制 */
  private computePeaks() {
    if (!this.buffer) return;
    const N = 2000;
    const ch = this.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / N));
    const peaks = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let max = 0;
      const off = i * step;
      for (let j = 0; j < step; j += 16) {
        const v = Math.abs(ch[off + j] || 0);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    this.peaks = peaks;
  }

  /** 当前音乐时间(秒)。播放中从音频时钟推算, 暂停时返回固定值。 */
  getTime(): number {
    if (!this._playing || !this.ctx) return this.startOffset;
    let t = this.startOffset + (this.ctx.currentTime - this.startCtxTime);
    if (this._loop) {
      // source 开了原生 loop, 声音本身在 [a,b) 内循环, 时钟做同样的回绕
      const { a, b } = this._loop;
      if (t >= b) t = a + ((t - a) % (b - a));
    } else if (this.buffer && t >= this.duration) {
      this.pauseAt(this.duration);
      return this.duration;
    }
    return t;
  }

  play(from?: number) {
    if (!this.buffer) return;
    const ctx = this.ensureCtx();
    this.stopSource();
    let offset = Math.min(Math.max(0, from ?? this.startOffset), this.duration - 0.01);
    if (this._loop && (offset < this._loop.a || offset >= this._loop.b)) offset = this._loop.a;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    if (this._loop) {
      // 采样级精确循环, 声音和时钟用同一套边界
      src.loop = true;
      src.loopStart = this._loop.a;
      src.loopEnd = this._loop.b;
    }
    src.connect(ctx.destination);
    src.start(0, offset);
    this.source = src;
    this.startCtxTime = ctx.currentTime;
    this.startOffset = offset;
    this._playing = true;
  }

  pause() { this.pauseAt(this.getTime()); }

  private pauseAt(t: number) {
    this.stopSource();
    this.startOffset = Math.min(Math.max(0, t), this.duration || t);
    this._playing = false;
  }

  stop() { this.pauseAt(0); }

  seek(t: number) {
    if (this._playing) this.play(t);
    else this.pauseAt(t);
  }

  setLoop(a: number, b: number) {
    this._loop = b > a ? { a, b } : null;
    if (this._playing) {
      // 循环边界变了, 重建 source 使声音与新边界对齐
      const t = this.getTime();
      const nt = this._loop && (t < this._loop.a || t >= this._loop.b) ? this._loop.a : t;
      this.play(nt);
    }
  }

  clearLoop() { this._loop = null; }

  private stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }
}

export const audio = new AudioEngine();
