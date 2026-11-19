// ============ 入口: 路由 + 页面装配 ============
import { store } from './store';
import { readShareData } from './exporter';
import { audio } from './audio';
import { renderProjects } from './pages/projects';
import { renderLayout, destroyLayout } from './pages/layout';
import { renderTimeline, destroyTimeline } from './pages/timeline';
import { renderPreview, destroyPreview } from './pages/preview';
import { renderEquipment } from './pages/equipment';

const app = document.getElementById('app')!;
const indicator = document.getElementById('project-indicator')!;

type PageFn = (root: HTMLElement) => void;
const pages: Record<string, { render: PageFn; destroy?: () => void }> = {
  projects: { render: renderProjects },
  layout: { render: renderLayout, destroy: destroyLayout },
  timeline: { render: renderTimeline, destroy: destroyTimeline },
  preview: { render: renderPreview, destroy: destroyPreview },
  equipment: { render: renderEquipment },
};

let currentPage = '';

function updateIndicator() {
  indicator.textContent = store.current
    ? `当前工程: ${store.current.name}${store.current.audioName ? ' ♪' : ''}`
    : '未打开工程';
}

function route() {
  const hash = location.hash || '#/projects';
  const name = hash.replace('#/', '').split('?')[0] || 'projects';
  if (currentPage && pages[currentPage]?.destroy) pages[currentPage]!.destroy!();
  currentPage = pages[name] ? name : 'projects';
  document.querySelectorAll('#nav a').forEach(a => {
    a.classList.toggle('active', (a as HTMLElement).dataset.page === currentPage);
  });
  // 除项目页外都需要已打开工程
  if (currentPage !== 'projects' && !store.current) {
    location.hash = '#/projects';
    return;
  }
  app.innerHTML = '';
  pages[currentPage].render(app);
  updateIndicator();
}

window.addEventListener('hashchange', route);
store.onChange(updateIndicator);

// 分享文件模式: 内嵌工程数据, 直接进预演
const share = readShareData();
if (share) {
  store.current = share.project;
  if (share.audio) {
    audio.load(share.audio).then(() => {
      location.hash = '#/preview';
      route();
      // 自动播放
      setTimeout(() => audio.play(0), 300);
    });
  } else {
    location.hash = '#/preview';
  }
}

route();
