import playerSource from './player.raw.js?raw';
import type { ProjectFile, Project } from '../core/types';
import { blobToBase64 } from '../core/store';
import { getBlob } from '../core/storage';

export interface ShareOptions {
  loopStart?: number | null;
  loopEnd?: number | null;
}

/** 生成完全自包含的分享 HTML（双击即可看，无需安装任何东西/无需联网） */
export async function buildShareHtml(project: Project, opts: ShareOptions = {}): Promise<string> {
  let audioDataUri: string | null = null;
  if (project.audio) {
    const blob = await getBlob(project.audio.blobId);
    if (blob) audioDataUri = `data:${blob.type || 'audio/mpeg'};base64,${await blobToBase64(blob)}`;
  }
  const payload = {
    project,
    audioDataUri,
    loopStart: opts.loopStart ?? null,
    loopEnd: opts.loopEnd ?? null,
  };
  const json = JSON.stringify(payload);
  // </script> 转义防注入截断
  const safeJson = json.replace(/</g, '\\u003c');
  const safePlayer = playerSource.replace(/</g, '<');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${project.name} · 喷泉预演</title>
</head>
<body style="margin:0;background:#070b13">
<div id="root" style="position:fixed;inset:0"></div>
<script type="module">
${safePlayer}
const __SHARE_DATA__ = ${safeJson};
mountStandalone(document.getElementById('root'), __SHARE_DATA__);
<\/script>
</body>
</html>`;
}

export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadProjectFile(pf: ProjectFile): Promise<void> {
  downloadText(`${pf.project.name}.fpj.json`, JSON.stringify(pf), 'application/json');
}

export function downloadShareHtml(html: string, name: string): void {
  downloadText(`${name}-预演.html`, html, 'text/html');
}
