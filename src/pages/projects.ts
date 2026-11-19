// ============ 项目列表页 ============
import { store } from '../store';
import { el, fmtDate } from '../ui';
import { exportProject, importProjectFile } from '../exporter';

export function renderProjects(root: HTMLElement) {
  const page = el('div', { class: 'page' });

  const toolbar = el('div', { class: 'toolbar' });
  const btnNew = el('button', { class: 'primary' }, '＋ 新建工程');
  btnNew.onclick = () => {
    const name = prompt('工程名称', '音乐喷泉方案 ' + new Date().toLocaleDateString());
    if (name === null) return;
    const p = store.createProject(name);
    store.open(p.id);
    location.hash = '#/layout';
  };
  const btnImport = el('button', {}, '导入工程文件');
  const fileInput = el('input', { type: 'file', accept: '.json,.fountain.json', style: 'display:none' });
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const p = await importProjectFile(f);
    if (p) { store.open(p.id); refresh(); }
    fileInput.value = '';
  };
  btnImport.onclick = () => fileInput.click();
  toolbar.append(btnNew, btnImport, fileInput);

  const grid = el('div', { class: 'project-grid' });

  function refresh() {
    grid.innerHTML = '';
    const list = store.listProjects().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      grid.append(el('div', { class: 'hint' }, '还没有工程, 点击「新建工程」开始。'));
      return;
    }
    for (const meta of list) {
      const card = el('div', { class: 'project-card' });
      const h = el('h3', {}, meta.name);
      const m = el('div', { class: 'meta' }, `更新于 ${fmtDate(meta.updatedAt)}`);
      const ops = el('div', { class: 'ops' });
      const bOpen = el('button', { class: 'primary' }, '打开');
      bOpen.onclick = e => { e.stopPropagation(); store.open(meta.id); location.hash = '#/layout'; };
      const bDup = el('button', {}, '复制');
      bDup.onclick = e => { e.stopPropagation(); store.duplicateProject(meta.id); refresh(); };
      const bExp = el('button', {}, '导出');
      bExp.onclick = async e => {
        e.stopPropagation();
        const p = store.loadProject(meta.id);
        if (p) await exportProject(p);
      };
      const bDel = el('button', { class: 'danger' }, '删除');
      bDel.onclick = e => {
        e.stopPropagation();
        if (confirm(`确定删除「${meta.name}」? 不可恢复。`)) { store.deleteProject(meta.id); refresh(); }
      };
      ops.append(bOpen, bDup, bExp, bDel);
      card.append(h, m, ops);
      card.onclick = () => { store.open(meta.id); location.hash = '#/layout'; };
      grid.append(card);
    }
  }

  page.append(toolbar, grid);
  root.append(page);
  refresh();
}
