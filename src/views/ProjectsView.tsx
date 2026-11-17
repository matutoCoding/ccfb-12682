import { useRef, useState } from 'react';
import { useStudio } from '../core/store';
import { buildShareHtml, downloadProjectFile, downloadShareHtml } from '../player/share';
import type { ProjectFile } from '../core/types';

export default function ProjectsView() {
  const projects = useStudio((s) => s.projects);
  const createProject = useStudio((s) => s.createProject);
  const duplicateProject = useStudio((s) => s.duplicateProject);
  const removeProject = useStudio((s) => s.removeProject);
  const openProject = useStudio((s) => s.openProject);
  const importProjectFile = useStudio((s) => s.importProjectFile);
  const exportProjectFile = useStudio((s) => s.exportProjectFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [toast, setToast] = useState('');

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  };

  const doCreate = async (demo: boolean) => {
    const p = await createProject(name.trim() || (demo ? '示例工程 · 广场音乐喷泉' : '未命名工程'), demo);
    setCreating(false);
    setName('');
    flash(`已创建工程「${p.name}」`);
  };

  const onImport = async (f: File) => {
    try {
      const text = await f.text();
      const pf = JSON.parse(text) as ProjectFile;
      await importProjectFile(pf);
      flash('工程导入成功');
    } catch (e) {
      alert('导入失败：' + (e as Error).message);
    }
  };

  return (
    <div className="projects-page">
      <div className="projects-head">
        <h2>我的工程</h2>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ 新建工程</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>导入工程文件</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.fpj,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {projects.length === 0 ? (
        <div className="empty-tip">
          还没有工程。<br />
          新建空白工程从零编排，或创建「示例工程」快速体验完整流程（含示例喷头布局、曲目编排和节拍）。
        </div>
      ) : (
        <div className="card-grid">
          {projects.map((p) => (
            <div key={p.id} className="proj-card">
              <h3>{p.name}</h3>
              <div className="proj-meta">
                喷头 {p.nozzles.length} · 水泵 {p.pumps.length} · 灯具 {p.lights.length}<br />
                水型片段 {p.waterClips.length} · 灯光片段 {p.lightClips.length}<br />
                {p.audio ? `曲目：${p.audio.name}` : '未导入曲目'}<br />
                更新于 {new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}
              </div>
              <div className="proj-actions">
                <button className="btn primary small" onClick={() => void openProject(p.id)}>打开</button>
                <button className="btn small" onClick={() => void duplicateProject(p.id)}>复制</button>
                <button
                  className="btn small"
                  onClick={async () => {
                    await openProject(p.id);
                    const pf = await exportProjectFile();
                    downloadProjectFile(pf);
                    flash('工程文件已导出');
                  }}
                >
                  导出
                </button>
                <button
                  className="btn small"
                  onClick={async () => {
                    await openProject(p.id);
                    const cur = useStudio.getState().current!;
                    const html = await buildShareHtml(cur);
                    downloadShareHtml(html, cur.name);
                    flash('分享 HTML 已导出，双击即可播放');
                  }}
                >
                  导出预演
                </button>
                <button
                  className="btn danger small"
                  onClick={() => {
                    if (confirm(`确定删除工程「${p.name}」？此操作不可恢复。`)) void removeProject(p.id);
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="modal-mask" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>新建工程</h3>
            <div className="prop-row">
              <label>工程名称</label>
              <input style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：中心广场音乐喷泉" autoFocus />
            </div>
            <div className="actions">
              <button className="btn" onClick={() => void doCreate(true)}>创建示例工程</button>
              <button className="btn primary" onClick={() => void doCreate(false)}>创建空白工程</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
