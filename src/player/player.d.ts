import type { FrameState, Project } from '../core/types';

/** player.raw.js 对外暴露的项目形状（结构化子集，兼容 Project） */
export type ProjectLike = Project;

export interface StandaloneData {
  project: ProjectLike;
  audioDataUri: string | null;
  loopStart?: number | null;
  loopEnd?: number | null;
}

export interface StandaloneHandle {
  dispose(): void;
}

export function evaluateFrame(
  project: ProjectLike,
  timeSec: number,
  overrideIds: string[],
  out?: FrameState | null,
): FrameState;

export class FountainRenderer {
  constructor(canvas: HTMLCanvasElement, project: ProjectLike);
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
  setProject(project: ProjectLike): void;
  setFrame(frame: FrameState, wind: { x: number; z: number }): void;
  resetCamera(): void;
  resize(): void;
  render(timeMs?: number): void;
  dispose(): void;
}

export function mountStandalone(root: HTMLElement, data: StandaloneData): StandaloneHandle;
