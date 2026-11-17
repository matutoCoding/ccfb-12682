import { create } from 'zustand';
import type {
  CircuitGroup,
  LightClip,
  LightFixture,
  PlacedNozzle,
  Project,
  ProjectFile,
  Pump,
  WaterClip,
} from './types';
import { DEFAULT_SPECS, newDemoProject, newGroup, newProject, NOZZLE_DMX_FOOTPRINT, PUMP_DMX_FOOTPRINT, LIGHT_DMX_FOOTPRINT } from './defaults';
import { uid } from './id';
import { deleteBlob, deleteProject, getBlob, listProjects, putBlob, saveProject } from './storage';

export type ViewName = 'projects' | 'layout' | 'timeline' | 'preview' | 'equipment';

interface StudioState {
  projects: Project[];
  current: Project | null;
  view: ViewName;
  selectedIds: string[];
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;

  refreshProjects: () => Promise<void>;
  createProject: (name: string, demo?: boolean) => Promise<Project>;
  duplicateProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  setView: (v: ViewName) => void;

  /** 以函数方式修改当前工程并标记 dirty */
  mutate: (fn: (p: Project) => void) => void;
  persist: () => Promise<void>;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;

  addNozzle: (partial: Partial<PlacedNozzle> & { type: PlacedNozzle['type']; x: number; y: number }) => PlacedNozzle;
  addPump: (x: number, y: number) => void;
  addLight: (x: number, y: number) => void;
  removeDevices: (ids: string[]) => void;
  addGroup: (name: string) => void;
  addWaterClip: (clip: Omit<WaterClip, 'id'>) => void;
  updateWaterClip: (id: string, patch: Partial<WaterClip>) => void;
  removeWaterClip: (id: string) => void;
  addLightClip: (clip: Omit<LightClip, 'id'>) => void;
  updateLightClip: (id: string, patch: Partial<LightClip>) => void;
  removeLightClip: (id: string) => void;

  exportProjectFile: () => Promise<ProjectFile>;
  importProjectFile: (file: ProjectFile) => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** 深拷贝工程时重映射所有 id（复制工程 / 导入工程用） */
function reidentify(p: Project): Project {
  const idMap = new Map<string, string>();
  const remap = (oldId: string) => {
    if (!idMap.has(oldId)) idMap.set(oldId, uid(oldId.split('-')[0]));
    return idMap.get(oldId)!;
  };
  const copy: Project = clone(p);
  copy.id = uid('proj');
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  for (const g of copy.groups) g.id = remap(g.id);
  for (const n of copy.nozzles) {
    n.id = remap(n.id);
    n.groupId = n.groupId ? remap(n.groupId) : null;
    n.pumpId = n.pumpId ? remap(n.pumpId) : null;
    n.lightId = n.lightId ? remap(n.lightId) : null;
  }
  for (const pu of copy.pumps) {
    pu.id = remap(pu.id);
    pu.groupId = pu.groupId ? remap(pu.groupId) : null;
  }
  for (const l of copy.lights) l.id = remap(l.id);
  if (copy.audio) copy.audio.blobId = remap(copy.audio.blobId);
  for (const c of copy.waterClips) {
    c.id = remap(c.id);
    c.trackId = idMap.get(c.trackId) ?? c.trackId;
    c.targetIds = c.targetIds.map((x) => idMap.get(x) ?? x);
  }
  for (const c of copy.lightClips) {
    c.id = remap(c.id);
    c.lightIds = c.lightIds.map((x) => idMap.get(x) ?? x);
  }
  for (const b of copy.beats) b.id = remap(b.id);
  return copy;
}

export const useStudio = create<StudioState>((set, get) => ({
  projects: [],
  current: null,
  view: 'projects',
  selectedIds: [],
  dirty: false,
  saving: false,
  lastSavedAt: null,

  async refreshProjects() {
    set({ projects: await listProjects() });
  },

  async createProject(name, demo = false) {
    const p = demo ? newDemoProject() : newProject(name);
    if (!demo) p.name = name;
    await saveProject(p);
    await get().refreshProjects();
    set({ current: p, view: 'layout', selectedIds: [], dirty: false });
    return p;
  },

  async duplicateProject(id) {
    const src = get().projects.find((x) => x.id === id);
    if (!src) return;
    const copy = reidentify(src);
    copy.name = `${src.name} 副本`;
    // 音频 Blob 也要复制一份
    if (src.audio) {
      const blob = await getBlob(src.audio.blobId);
      if (blob) await putBlob(copy.audio!.blobId, blob.type, blob);
    }
    await saveProject(copy);
    await get().refreshProjects();
  },

  async removeProject(id) {
    const p = get().projects.find((x) => x.id === id);
    if (p?.audio) await deleteBlob(p.audio.blobId).catch(() => undefined);
    await deleteProject(id);
    if (get().current?.id === id) set({ current: null, view: 'projects', selectedIds: [] });
    await get().refreshProjects();
  },

  async openProject(id) {
    const p = await listProjects();
    const found = p.find((x) => x.id === id);
    if (found) set({ current: found, view: 'layout', selectedIds: [], dirty: false, lastSavedAt: found.updatedAt });
  },

  closeProject() {
    set({ current: null, view: 'projects', selectedIds: [], dirty: false });
  },

  setView(v) {
    set({ view: v });
  },

  mutate(fn) {
    const cur = get().current;
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    next.updatedAt = Date.now();
    set({ current: next, dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().persist(), 800);
  },

  async persist() {
    const cur = get().current;
    if (!cur) return;
    set({ saving: true });
    try {
      await saveProject(cur);
      set({ dirty: false, saving: false, lastSavedAt: Date.now() });
      await get().refreshProjects();
    } finally {
      set({ saving: false });
    }
  },

  select(ids) {
    set({ selectedIds: ids });
  },
  toggleSelect(id) {
    const s = new Set(get().selectedIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ selectedIds: [...s] });
  },

  addNozzle(partial) {
    const state = get();
    const nz: PlacedNozzle = {
      id: uid('nz'),
      name: `${partial.type}-${(state.current?.nozzles.length ?? 0) + 1}`,
      rotationDeg: 0,
      spec: { ...DEFAULT_SPECS[partial.type] },
      groupId: state.current?.groups[0]?.id ?? null,
      pumpId: state.current?.pumps[0]?.id ?? null,
      dmxStart: null,
      lightId: null,
      ...partial,
    };
    state.mutate((p) => {
      p.nozzles.push(nz);
    });
    return nz;
  },

  addPump(x, y) {
    const state = get();
    const pump: Pump = {
      id: uid('pump'),
      name: `${(state.current?.pumps.length ?? 0) + 1}# 泵`,
      x,
      y,
      powerLimitKw: 15,
      groupId: state.current?.groups[0]?.id ?? null,
      dmxStart: null,
    };
    state.mutate((p) => p.pumps.push(pump));
  },

  addLight(x, y) {
    const state = get();
    const light: LightFixture = { id: uid('lt'), name: `染色灯 ${(state.current?.lights.length ?? 0) + 1}`, x, y, dmxStart: null };
    state.mutate((p) => p.lights.push(light));
  },

  removeDevices(ids) {
    const set = new Set(ids);
    get().mutate((p) => {
      p.nozzles = p.nozzles.filter((n) => !set.has(n.id));
      p.pumps = p.pumps.filter((n) => !set.has(n.id));
      p.lights = p.lights.filter((n) => !set.has(n.id));
      for (const c of p.waterClips) c.targetIds = c.targetIds.filter((t) => !set.has(t));
      for (const c of p.lightClips) c.lightIds = c.lightIds.filter((t) => !set.has(t));
      p.waterClips = p.waterClips.filter((c) => c.targetIds.length > 0);
      p.lightClips = p.lightClips.filter((c) => c.lightIds.length > 0);
    });
    get().select([]);
  },

  addGroup(name) {
    const g: CircuitGroup = newGroup(name, get().current?.groups.length ?? 0);
    get().mutate((p) => p.groups.push(g));
  },

  addWaterClip(clip) {
    get().mutate((p) => p.waterClips.push({ ...clip, id: uid('clip') }));
  },
  updateWaterClip(id, patch) {
    get().mutate((p) => {
      const c = p.waterClips.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    });
  },
  removeWaterClip(id) {
    get().mutate((p) => {
      p.waterClips = p.waterClips.filter((x) => x.id !== id);
    });
  },
  addLightClip(clip) {
    get().mutate((p) => p.lightClips.push({ ...clip, id: uid('lc') }));
  },
  updateLightClip(id, patch) {
    get().mutate((p) => {
      const c = p.lightClips.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    });
  },
  removeLightClip(id) {
    get().mutate((p) => {
      p.lightClips = p.lightClips.filter((x) => x.id !== id);
    });
  },

  async exportProjectFile() {
    const p = get().current;
    if (!p) throw new Error('没有打开的工程');
    let audioDataUri: string | null = null;
    if (p.audio) {
      const blob = await getBlob(p.audio.blobId);
      if (blob) {
        const b64 = await blobToBase64(blob);
        audioDataUri = `data:${blob.type || 'audio/mpeg'};base64,${b64}`;
      }
    }
    return { format: 'fountain-project', fileVersion: 1, project: clone(p), audioDataUri };
  },

  async importProjectFile(file) {
    if (file.format !== 'fountain-project') throw new Error('文件格式不正确');
    const copy = reidentify(file.project);
    copy.name = `${file.project.name}（导入）`;
    if (file.audioDataUri && copy.audio) {
      const blob = dataUriToBlob(file.audioDataUri);
      await putBlob(copy.audio.blobId, blob.type, blob);
    }
    await saveProject(copy);
    await get().refreshProjects();
  },
}));

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function dataUriToBlob(uri: string): Blob {
  const [head, b64] = uri.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'audio/mpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export { NOZZLE_DMX_FOOTPRINT, PUMP_DMX_FOOTPRINT, LIGHT_DMX_FOOTPRINT };
