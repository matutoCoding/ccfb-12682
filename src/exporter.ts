// ============ 导入导出: 工程文件 / 分享文件 / 设备表 CSV ============
import { Project } from './types';
import { store, getAudio, putAudio } from './store';
import { buildBom } from './checks';

function download(filename: string, content: string | Blob, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

// ---- 工程文件(.fountain.json, 含音频 base64) ----
export async function exportProject(p: Project) {
  const audioBuf = await getAudio(p.id);
  const payload = {
    format: 'fountain-project',
    version: 1,
    project: p,
    audioBase64: audioBuf ? bufToBase64(audioBuf) : null,
    audioName: p.audioName,
  };
  download(`${p.name}.fountain.json`, JSON.stringify(payload), 'application/json');
}

export async function importProjectFile(file: File): Promise<Project | null> {
  const data = JSON.parse(await file.text());
  if (data.format !== 'fountain-project' || !data.project) {
    alert('不是有效的喷泉工程文件');
    return null;
  }
  const p: Project = data.project;
  // 避免与本地工程撞 id
  if (store.loadProject(p.id)) {
    p.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  p.updatedAt = Date.now();
  store.persist(p);
  if (data.audioBase64) await putAudio(p.id, base64ToBuf(data.audioBase64));
  return p;
}

// ---- 分享文件: 自包含 HTML, 客户双击即看 ----
export async function exportShareFile(p: Project) {
  // 当前应用是单文件构建, 直接把自身 HTML 拿出来注入工程数据。
  // 注意: 必须替换占位注释(在 <head> 最前面), 不能用 </head> 定位 ——
  // 打包后的 JS 在 <head> 里且代码中包含 "</head>" 字符串, 会注错位置。
  let html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  // 去掉旧的分享数据(若有)
  html = html.replace(/<script id="fountain-share-data"[^>]*>[\s\S]*?<\/script>/, '');
  const audioBuf = await getAudio(p.id);
  const payload = {
    project: p,
    audioBase64: audioBuf ? bufToBase64(audioBuf) : null,
  };
  // JSON 中的 </script> 需要转义
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
  const tag = `<script id="fountain-share-data" type="application/json">${json}</` + `script>`;
  if (!html.includes('<!--fountain-share-slot-->')) {
    alert('页面结构缺少分享占位符, 无法导出');
    return;
  }
  html = html.replace('<!--fountain-share-slot-->', '<!--fountain-share-slot-->' + tag);
  download(`${p.name}-预演.html`, html, 'text/html');
}

/** 启动时检测是否为分享文件, 是则返回工程数据 */
export function readShareData(): { project: Project; audio: ArrayBuffer | null } | null {
  const el = document.getElementById('fountain-share-data');
  if (!el || !el.textContent) return null;
  try {
    const data = JSON.parse(el.textContent);
    return {
      project: data.project,
      audio: data.audioBase64 ? base64ToBuf(data.audioBase64) : null,
    };
  } catch { return null; }
}

// ---- 设备清单 CSV(带 BOM, Excel 直接打开不乱码) ----
export function exportBomCsv(p: Project) {
  const rows = buildBom(p);
  const headers = ['名称', '类别', '规格', '数量', '单位', '备注'] as const;
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','));
  download(`${p.name}-设备清单.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv');
}

// ---- DMX 通道表 CSV ----
export function exportDmxCsv(p: Project) {
  const lines = ['喷头,类型,DMX起始通道,占用通道数,通道范围,回路,水泵'];
  for (const n of p.nozzles) {
    const fp = { direct: 2, swing: 4, running: 3, curtain: 2 }[n.type];
    const circuit = p.circuits.find(c => c.id === n.circuitId)?.name ?? '';
    const pump = p.pumps.find(x => x.id === n.pumpId)?.name ?? '';
    lines.push([n.name, n.type, n.dmxStart, fp, `${n.dmxStart}-${n.dmxStart + fp - 1}`, circuit, pump].join(','));
  }
  download(`${p.name}-DMX通道表.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv');
}
