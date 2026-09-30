import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './settings.js';

/**
 * Projects: first-class places to build something, kept apart from everything else.
 *
 * A project is a name, a goal, and a PRIVATE session namespace. Entering it gives
 * the agent a fresh environment — no recollection of other chats, no ambient
 * lessons, and a build gallery of its own — so a new project cannot quietly
 * become a remix of the last one.
 *
 * It persists. The chat, the builds, and the project's own distilled episodes all
 * live under its session key, so the operator can come back later and continue
 * where it stopped. Isolation is STRUCTURAL, not a promise: history and builds are
 * namespaced by session key (`web:<token>:proj:<id>`), so another project's work is
 * not merely hidden — it is unreachable.
 */
export interface StudioProject {
  id: string;
  tokenId: number;
  title: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
}

export const PROJ_SEP = ':proj:';

const file = (): string => dataPath('projects.json');

function readAll(): StudioProject[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as StudioProject[];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(list: StudioProject[]): void {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(list, null, 2), 'utf8');
  } catch {
    // best-effort: the registry must never break a chat
  }
}

/** Newest activity first — the way an operator thinks about their projects. */
export function listProjects(tokenId: number): StudioProject[] {
  return readAll()
    .filter((p) => p.tokenId === tokenId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(tokenId: number, id: string): StudioProject | null {
  return readAll().find((p) => p.tokenId === tokenId && p.id === id) ?? null;
}

export function createProject(tokenId: number, title: string, goal: string): StudioProject {
  const now = Date.now();
  const project: StudioProject = {
    id: `${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    tokenId,
    title: title.trim().slice(0, 80) || 'untitled project',
    goal: goal.trim().slice(0, 600),
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...readAll(), project]);
  return project;
}

export function updateProject(tokenId: number, id: string, patch: { title?: string; goal?: string }): StudioProject | null {
  const all = readAll();
  const project = all.find((p) => p.tokenId === tokenId && p.id === id);
  if (!project) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) project.title = patch.title.trim().slice(0, 80);
  if (typeof patch.goal === 'string') project.goal = patch.goal.trim().slice(0, 600);
  project.updatedAt = Date.now();
  writeAll(all);
  return project;
}

/** Removes the registry entry only — the project's builds and history stay on disk. */
export function deleteProject(tokenId: number, id: string): boolean {
  const all = readAll();
  const next = all.filter((p) => !(p.tokenId === tokenId && p.id === id));
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

/** Bump activity so the list sorts by what the operator touched last. */
export function touchProject(tokenId: number, id: string): void {
  const all = readAll();
  const project = all.find((p) => p.tokenId === tokenId && p.id === id);
  if (!project) return;
  project.updatedAt = Date.now();
  writeAll(all);
}

export function projectSessionKey(tokenId: number, id: string): string {
  return `web:${tokenId}${PROJ_SEP}${id}`;
}

export function isProjectSession(sessionKey: string): boolean {
  return sessionKey.includes(PROJ_SEP);
}

export function projectIdOf(sessionKey: string): string | null {
  const i = sessionKey.indexOf(PROJ_SEP);
  if (i < 0) return null;
  const rest = sessionKey.slice(i + PROJ_SEP.length);
  return rest.split(':')[0] || null;
}

/** The block injected into every turn of a project chat. */
export function projectDirective(project: StudioProject): string {
  return [
    `PROJECT — "${project.title}": this chat is a PROJECT, isolated from every other chat.`,
    project.goal
      ? `The operator's goal for it: ${project.goal}`
      : 'The operator has not stated a goal — ask for one line of direction, or propose one and say it plainly.',
    '- No memory of other chats applies here: do not draw on other projects, their builds, or their lessons. Whatever you build starts from THIS brief.',
    '- The operator opened a PROJECT precisely because past work converged: do NOT reach for your default stack, genre or palette. Before building, write ONE line naming what makes this structurally different from anything you have built — then build that, not a remix.',
    '- Your gallery in this project starts empty and grows only with what you build here. The operator revisits this project to continue it, so leave it in a state they can pick up, and say what remains.',
  ].join('\n');
}
