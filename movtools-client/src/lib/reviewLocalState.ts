import type { AnnotationPath } from '../components/AnnotationCanvas';
import type { LocalFeedbackDraft } from '../types/localDraft';

export interface ReviewFrameDrawingRecord {
  frameNumber: number;
  paths: AnnotationPath[];
  updatedAt: string;
}

export interface ReviewClearFrameRecord {
  frameNumber: number;
  updatedAt: string;
}

export interface ReviewLocalShotState {
  taskId: string;
  shotId: string;
  feedbackRoundId: string | null;
  feedbackDrafts: LocalFeedbackDraft[];
  frameDrawingRecords: ReviewFrameDrawingRecord[];
  clearFrameRecords: ReviewClearFrameRecord[];
  updatedAt: string;
}

const STORAGE_PREFIX = 'movtools.review.local-shot-state.v1';

function normalizeFeedbackRoundId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function hasWindowStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isPersistableFeedbackDraft(draft: unknown): draft is LocalFeedbackDraft {
  if (!draft || typeof draft !== 'object') return false;
  return true;
}

function normalizeLoadedFeedbackDrafts(drafts: unknown[]): LocalFeedbackDraft[] {
  return drafts.filter(isPersistableFeedbackDraft).filter((draft) => {
    if (draft.pendingAction !== 'delete') return true;
    return Boolean(draft.sourceFeedbackId?.trim() || draft.submittedFeedbackId?.trim());
  });
}

export function getReviewLocalShotStorageKey(taskId: string, shotId: string, feedbackRoundId?: string | null): string {
  const roundKey = normalizeFeedbackRoundId(feedbackRoundId);
  return roundKey ? `${STORAGE_PREFIX}:${taskId}:${shotId}:${roundKey}` : `${STORAGE_PREFIX}:${taskId}:${shotId}`;
}

export function createEmptyReviewLocalShotState(taskId: string, shotId: string, feedbackRoundId: string | null = null): ReviewLocalShotState {
  return {
    taskId,
    shotId,
    feedbackRoundId,
    feedbackDrafts: [],
    frameDrawingRecords: [],
    clearFrameRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadReviewLocalShotState(taskId: string, shotId: string, feedbackRoundId?: string | null): ReviewLocalShotState {
  if (!hasWindowStorage()) {
    return createEmptyReviewLocalShotState(taskId, shotId, normalizeFeedbackRoundId(feedbackRoundId));
  }

  const normalizedRoundId = normalizeFeedbackRoundId(feedbackRoundId);
  const raw = window.localStorage.getItem(getReviewLocalShotStorageKey(taskId, shotId, normalizedRoundId));
  if (!raw) {
    return createEmptyReviewLocalShotState(taskId, shotId, normalizedRoundId);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReviewLocalShotState>;
    const rawFeedbackDrafts = Array.isArray(parsed.feedbackDrafts) ? parsed.feedbackDrafts : [];
    const feedbackDrafts = normalizeLoadedFeedbackDrafts(rawFeedbackDrafts);
    const loadedRoundId = normalizeFeedbackRoundId(parsed.feedbackRoundId);
    const state = {
      taskId,
      shotId,
      feedbackRoundId: loadedRoundId ?? normalizedRoundId,
      feedbackDrafts,
      frameDrawingRecords: Array.isArray(parsed.frameDrawingRecords) ? parsed.frameDrawingRecords : [],
      clearFrameRecords: Array.isArray(parsed.clearFrameRecords) ? parsed.clearFrameRecords : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };

    if (feedbackDrafts.length !== rawFeedbackDrafts.length) {
      saveReviewLocalShotState(state);
    }

    return state;
  } catch {
    return createEmptyReviewLocalShotState(taskId, shotId);
  }
}

export function saveReviewLocalShotState(state: ReviewLocalShotState): void {
  if (!hasWindowStorage()) {
    return;
  }

  window.localStorage.setItem(getReviewLocalShotStorageKey(state.taskId, state.shotId, state.feedbackRoundId), JSON.stringify({
    ...state,
    updatedAt: new Date().toISOString(),
  }));
}

export function clearReviewLocalShotState(taskId: string, shotId: string): ReviewLocalShotState {
  const emptyState = createEmptyReviewLocalShotState(taskId, shotId);
  if (hasWindowStorage()) {
    const prefix = `${STORAGE_PREFIX}:${taskId}:${shotId}`;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  }
  return emptyState;
}

export function clearReviewLocalShotStateForTask(taskId: string): void {
  if (!hasWindowStorage()) {
    return;
  }

  const prefix = `${STORAGE_PREFIX}:${taskId}:`;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    window.localStorage.removeItem(key);
  }
}

function clonePaths(paths: AnnotationPath[]): AnnotationPath[] {
  return paths.map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point })),
  }));
}

type LocalDrawingEvent =
  | { kind: 'draw'; frameNumber: number; updatedAt: string; paths: AnnotationPath[] }
  | { kind: 'clear'; frameNumber: number; updatedAt: string };

export function getOrderedLocalDrawingEvents(state: Pick<ReviewLocalShotState, 'frameDrawingRecords' | 'clearFrameRecords'>): LocalDrawingEvent[] {
  return [
    ...state.frameDrawingRecords.map((record) => ({ kind: 'draw' as const, frameNumber: record.frameNumber, updatedAt: record.updatedAt, paths: clonePaths(record.paths) })),
    ...state.clearFrameRecords.map((record) => ({ kind: 'clear' as const, frameNumber: record.frameNumber, updatedAt: record.updatedAt })),
  ].sort((left, right) => left.frameNumber - right.frameNumber || left.updatedAt.localeCompare(right.updatedAt));
}

export function resolveVisibleAnnotationPaths(state: ReviewLocalShotState, frameNumber: number): AnnotationPath[] {
  const events = getOrderedLocalDrawingEvents(state);

  const exactFrameRecord = events
    .filter((record) => record.frameNumber === frameNumber)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .at(-1) ?? null;

  if (exactFrameRecord) {
    if (exactFrameRecord.kind === 'draw') {
      return clonePaths(exactFrameRecord.paths);
    }

    return [];
  }

  const latestBoundary = events
    .filter((record) => record.frameNumber < frameNumber)
    .sort((left, right) => left.frameNumber - right.frameNumber || left.updatedAt.localeCompare(right.updatedAt))
    .at(-1) ?? null;

  if (!latestBoundary || latestBoundary.kind !== 'draw') {
    return [];
  }

  return clonePaths(latestBoundary.paths);
}

export function upsertFrameDrawingRecord(
  state: ReviewLocalShotState,
  frameNumber: number,
  paths: AnnotationPath[],
): ReviewLocalShotState {
  return {
    ...state,
    feedbackDrafts: [...state.feedbackDrafts],
    frameDrawingRecords: [
      ...state.frameDrawingRecords.filter((record) => record.frameNumber !== frameNumber),
      { frameNumber, paths: clonePaths(paths), updatedAt: new Date().toISOString() },
    ].sort((a, b) => a.frameNumber - b.frameNumber || a.updatedAt.localeCompare(b.updatedAt)),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertClearFrameRecord(
  state: ReviewLocalShotState,
  frameNumber: number,
): ReviewLocalShotState {
  return {
    ...state,
    feedbackDrafts: [...state.feedbackDrafts],
    clearFrameRecords: [
      ...state.clearFrameRecords.filter((record) => record.frameNumber !== frameNumber),
      { frameNumber, updatedAt: new Date().toISOString() },
    ].sort((a, b) => a.frameNumber - b.frameNumber || a.updatedAt.localeCompare(b.updatedAt)),
    updatedAt: new Date().toISOString(),
  };
}
