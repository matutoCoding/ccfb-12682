import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from './types';

interface FountainDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    keyPath: 'id';
    indexes: { 'by-updatedAt': number };
  };
  blobs: {
    key: string;
    value: { id: string; mime: string; blob: Blob };
    keyPath: 'id';
  };
}

const DB_NAME = 'fountain-studio-db';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase<FountainDB>> | null = null;

function db(): Promise<IDBPDatabase<FountainDB>> {
  if (!dbp) {
    dbp = openDB<FountainDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        const p = d.createObjectStore('projects', { keyPath: 'id' });
        p.createIndex('by-updatedAt', 'updatedAt');
        d.createObjectStore('blobs', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export async function listProjects(): Promise<Project[]> {
  const d = await db();
  const all = await d.getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const d = await db();
  return d.get('projects', id);
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  project.updatedAt = Date.now();
  await d.put('projects', project);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete('projects', id);
}

export async function putBlob(id: string, mime: string, blob: Blob): Promise<void> {
  const d = await db();
  await d.put('blobs', { id, mime, blob });
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const d = await db();
  const row = await d.get('blobs', id);
  return row?.blob;
}

export async function deleteBlob(id: string): Promise<void> {
  const d = await db();
  await d.delete('blobs', id);
}
