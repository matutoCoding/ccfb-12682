// ============ 状态管理: 项目列表 + 自动保存(localStorage) + 音频(IndexedDB) ============
import { Project, newProject, uid } from './types';

const LS_INDEX = 'fountain.projects.index';
const LS_PREFIX = 'fountain.project.';
const IDB_NAME = 'fountain-audio';
const IDB_STORE = 'audio';

export interface ProjectMeta { id: string; name: string; updatedAt: number }

type Listener = () => void;

class Store {
  current: Project | null = null;
  private listeners: Listener[] = [];
  private saveTimer: number | null = null;

  onChange(fn: Listener) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(f => f()); }

  /** 修改当前工程并调度自动保存 */
  update(mutate: (p: Project) => void) {
    if (!this.current) return;
    mutate(this.current);
    this.current.updatedAt = Date.now();
    this.scheduleSave();
    this.emit();
  }

  // ---- 项目列表 ----
  listProjects(): ProjectMeta[] {
    try {
      return JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
    } catch { return []; }
  }

  private saveIndex(list: ProjectMeta[]) {
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  }

  createProject(name: string): Project {
    const p = newProject(name || '未命名工程');
    this.persist(p);
    return p;
  }

  duplicateProject(id: string): Project | null {
    const src = this.loadProject(id);
    if (!src) return null;
    const copy: Project = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = src.name + ' 副本';
    copy.createdAt = Date.now();
    this.persist(copy);
    // 音频也复制一份
    getAudio(id).then(buf => { if (buf) putAudio(copy.id, buf); });
    return copy;
  }

  deleteProject(id: string) {
    localStorage.removeItem(LS_PREFIX + id);
    this.saveIndex(this.listProjects().filter(m => m.id !== id));
    deleteAudio(id);
    if (this.current?.id === id) this.current = null;
  }

  loadProject(id: string): Project | null {
    try {
      const raw = localStorage.getItem(LS_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  open(id: string): Project | null {
    const p = this.loadProject(id);
    if (p) this.current = p;
    return p;
  }

  /** 立即落盘 */
  persist(p: Project) {
    try {
      localStorage.setItem(LS_PREFIX + p.id, JSON.stringify(p));
    } catch (e) {
      console.warn('localStorage 写入失败(可能超限)', e);
    }
    const idx = this.listProjects();
    const i = idx.findIndex(m => m.id === p.id);
    const meta = { id: p.id, name: p.name, updatedAt: p.updatedAt };
    if (i >= 0) idx[i] = meta; else idx.push(meta);
    this.saveIndex(idx);
  }

  private scheduleSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (this.current) this.persist(this.current);
    }, 400);
  }

  flushSave() {
    if (this.current) this.persist(this.current);
  }
}

export const store = new Store();

// ---- IndexedDB 存音频(ArrayBuffer) ----
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function putAudio(projectId: string, buf: ArrayBuffer): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(buf, projectId);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function getAudio(projectId: string): Promise<ArrayBuffer | null> {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(projectId);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => rej(req.error);
    });
  } catch { return null; }
}

export async function deleteAudio(projectId: string): Promise<void> {
  try {
    const db = await idb();
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(projectId);
  } catch { /* ignore */ }
}
