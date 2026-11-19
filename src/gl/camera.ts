// ============ 轨道相机 ============
export class OrbitCamera {
  yaw = -0.6;       // 弧度
  pitch = 0.45;
  dist = 30;
  target = [0, 0, 0] as [number, number, number];

  eye(): number[] {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [
      this.target[0] + this.dist * cp * Math.sin(this.yaw),
      this.target[1] + this.dist * sp,
      this.target[2] + this.dist * cp * Math.cos(this.yaw),
    ];
  }

  /** 绑定鼠标交互: 左键旋转, 右键/Shift平移, 滚轮缩放 */
  attach(canvas: HTMLCanvasElement) {
    let dragging = false, panning = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', e => {
      dragging = true;
      panning = e.button === 2 || e.shiftKey;
      lx = e.clientX; ly = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (panning) {
        const s = this.dist * 0.0016;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.target[0] += (-dx * cy) * s;
        this.target[2] += (dx * sy) * s;
        this.target[1] += dy * s;
      } else {
        this.yaw -= dx * 0.005;
        this.pitch = Math.min(1.5, Math.max(0.05, this.pitch + dy * 0.005));
      }
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.min(200, Math.max(5, this.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
}
