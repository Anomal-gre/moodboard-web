import type { Card, Project, ProjectAppearance, TrashItem } from './types';

export const HISTORY_LIMIT = 40;

export interface ProjectSnapshot {
  name: string;
  description: string;
  appearance: ProjectAppearance;
  cards: Card[];
  trash: TrashItem[];
}

export interface ProjectHistoryStack {
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
}

export function captureSnapshot(project: Project): ProjectSnapshot {
  return {
    name: project.name,
    description: project.description,
    appearance: { ...project.appearance },
    cards: project.cards.map((c) => ({
      ...c,
      source: c.source ? { ...c.source } : undefined,
      designFile: c.designFile ? { ...c.designFile } : undefined,
    })),
    trash: project.trash.map((t) => ({
      removedAt: t.removedAt,
      card: {
        ...t.card,
        source: t.card.source ? { ...t.card.source } : undefined,
        designFile: t.card.designFile ? { ...t.card.designFile } : undefined,
      },
    })),
  };
}

export function applySnapshot(project: Project, snap: ProjectSnapshot): Project {
  return {
    ...project,
    name: snap.name,
    description: snap.description,
    appearance: { ...snap.appearance },
    cards: snap.cards.map((c) => ({
      ...c,
      source: c.source ? { ...c.source } : undefined,
      designFile: c.designFile ? { ...c.designFile } : undefined,
    })),
    trash: snap.trash.map((t) => ({
      removedAt: t.removedAt,
      card: {
        ...t.card,
        source: t.card.source ? { ...t.card.source } : undefined,
        designFile: t.card.designFile ? { ...t.card.designFile } : undefined,
      },
    })),
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyHistory(): ProjectHistoryStack {
  return { past: [], future: [] };
}

export function pushHistory(
  stack: ProjectHistoryStack,
  beforeProject: Project
): ProjectHistoryStack {
  const nextPast = [...stack.past, captureSnapshot(beforeProject)];
  if (nextPast.length > HISTORY_LIMIT) {
    nextPast.shift();
  }
  return {
    past: nextPast,
    future: [],
  };
}

export function stepUndo(
  stack: ProjectHistoryStack,
  currentProject: Project
): { stack: ProjectHistoryStack; project: Project } | null {
  if (stack.past.length === 0) return null;
  const previous = stack.past[stack.past.length - 1];
  const nextPast = stack.past.slice(0, -1);
  const nextFuture = [captureSnapshot(currentProject), ...stack.future].slice(0, HISTORY_LIMIT);
  return {
    stack: { past: nextPast, future: nextFuture },
    project: applySnapshot(currentProject, previous),
  };
}

export function stepRedo(
  stack: ProjectHistoryStack,
  currentProject: Project
): { stack: ProjectHistoryStack; project: Project } | null {
  if (stack.future.length === 0) return null;
  const next = stack.future[0];
  const nextFuture = stack.future.slice(1);
  const nextPast = [...stack.past, captureSnapshot(currentProject)].slice(-HISTORY_LIMIT);
  return {
    stack: { past: nextPast, future: nextFuture },
    project: applySnapshot(currentProject, next),
  };
}
