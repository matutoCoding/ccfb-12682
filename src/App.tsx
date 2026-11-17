import { useEffect, useState } from 'react';
import { useStudio, type ViewName } from './core/store';
import ProjectsView from './views/ProjectsView';
import LayoutView from './views/LayoutView';
import TimelineView from './views/TimelineView';
import PreviewView from './views/PreviewView';
import EquipmentView from './views/EquipmentView';

const NAV: { key: ViewName; label: string }[] = [
  { key: 'layout', label: '喷头布局' },
  { key: 'timeline', label: '曲目编排' },
  { key: 'preview', label: '3D 预演' },
  { key: 'equipment', label: '设备表' },
];

export default function App() {
  const current = useStudio((s) => s.current);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const refresh = useStudio((s) => s.refreshProjects);
  const closeProject = useStudio((s) => s.closeProject);
  const dirty = useStudio((s) => s.dirty);
  const saving = useStudio((s) => s.saving);
  const lastSavedAt = useStudio((s) => s.lastSavedAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!current || view === 'projects') {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">Fountain Studio<small>喷泉编排预演系统</small></div>
        </header>
        <ProjectsView />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Fountain Studio<small>喷泉编排预演</small></div>
        <button className="nav-btn" onClick={() => setView('projects')}>项目列表</button>
        {NAV.map((n) => (
          <button key={n.key} className={`nav-btn ${view === n.key ? 'active' : ''}`} onClick={() => setView(n.key)}>
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <span className={`save-state ${dirty ? 'dirty' : ''}`}>
          {saving ? '保存中…' : dirty ? '有未保存修改（自动保存中）' : lastSavedAt ? `已自动保存 · ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '已保存'}
        </span>
        <button className="btn small" onClick={() => closeProject()}>关闭工程</button>
      </header>
      <main className="view">
        {view === 'layout' && <LayoutView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'preview' && <PreviewView />}
        {view === 'equipment' && <EquipmentView />}
      </main>
    </div>
  );
}
