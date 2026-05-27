import type { AnnotationPath } from '../components/AnnotationCanvas';
import type { ReviewDrawingFrame } from '../types/review';
import type { ReviewClearFrameRecord, ReviewFrameDrawingRecord } from './reviewLocalState';
import { DEFAULT_REVIEW_PLAYBACK_FPS } from './reviewPlaybackFps';

export interface ReviewDrawingResolverInput {
  drawingTimeline?: ReviewDrawingFrame[] | null;
  drawingFrames?: ReviewDrawingFrame[] | null;
  frameDrawingRecords?: ReviewFrameDrawingRecord[] | null;
  clearFrameRecords?: ReviewClearFrameRecord[] | null;
  fps?: number;
}

function clonePaths(paths: AnnotationPath[]): AnnotationPath[] {
  return paths.map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point })),
  }));
}

function getFrameKey(frame: ReviewDrawingFrame, fps: number): number | null {
  if (typeof frame.frameNumber === 'number' && Number.isFinite(frame.frameNumber)) {
    return frame.frameNumber;
  }

  if (typeof frame.timestampSeconds === 'number' && Number.isFinite(frame.timestampSeconds)) {
    const effectiveFps = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_REVIEW_PLAYBACK_FPS;
    return Math.floor(frame.timestampSeconds * effectiveFps) + 1;
  }

  return null;
}

function parseDrawingObjects(json?: string | null): AnnotationPath[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as AnnotationPath[];
    return clonePaths(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function toResolvedEvents(input: ReviewDrawingResolverInput): Array<{
  frameNumber: number;
  order: number;
  kind: 'draw' | 'clear';
  paths: AnnotationPath[];
}> {
  const fps = input.fps && Number.isFinite(input.fps) && input.fps > 0 ? input.fps : DEFAULT_REVIEW_PLAYBACK_FPS;
  const roundTimeline = Array.isArray(input.drawingTimeline) && input.drawingTimeline.length > 0
    ? input.drawingTimeline
    : input.drawingFrames;

  const serverEvents = (Array.isArray(roundTimeline) ? roundTimeline : [])
    .map((frame, index) => ({
      frameNumber: getFrameKey(frame, fps),
      order: index,
      kind: frame.drawingStateCode === 'CLEAR' ? 'clear' as const : 'draw' as const,
      paths: frame.drawingStateCode === 'DRAWN' ? parseDrawingObjects(frame.drawingObjectsJson) : [],
    }))
    .filter((event): event is { frameNumber: number; order: number; kind: 'draw' | 'clear'; paths: AnnotationPath[] } => event.frameNumber !== null && Number.isFinite(event.frameNumber));

  const localEvents = [
    ...(input.frameDrawingRecords ?? []).map((record, index) => ({
      frameNumber: record.frameNumber,
      order: new Date(record.updatedAt).getTime() || index,
      kind: 'draw' as const,
      paths: clonePaths(record.paths),
    })),
    ...(input.clearFrameRecords ?? []).map((record, index) => ({
      frameNumber: record.frameNumber,
      order: new Date(record.updatedAt).getTime() || index,
      kind: 'clear' as const,
      paths: [],
    })),
  ];

  return [...serverEvents, ...localEvents].sort((left, right) => left.frameNumber - right.frameNumber || left.order - right.order);
}

export function resolveVisibleAnnotationPathsFromDrawingFrames(
  drawingFrames: ReviewDrawingFrame[] | null | undefined,
  frameNumber: number,
  fps: number = DEFAULT_REVIEW_PLAYBACK_FPS,
): AnnotationPath[] {
  const replay = toResolvedEvents({ drawingFrames, fps });
  const events = replay.filter((event) => event.frameNumber <= frameNumber);
  if (events.length === 0) return [];

  let visiblePaths: AnnotationPath[] = [];
  for (const event of events) {
    visiblePaths = event.kind === 'clear' ? [] : clonePaths(event.paths);
  }

  return visiblePaths;
}

export function resolveReviewVisibleAnnotationPaths(
  input: ReviewDrawingResolverInput,
  frameNumber: number,
  fps: number = DEFAULT_REVIEW_PLAYBACK_FPS,
): AnnotationPath[] {
  const events = toResolvedEvents({ ...input, fps }).filter((event) => event.frameNumber <= frameNumber);
  if (events.length === 0) return [];

  let visiblePaths: AnnotationPath[] = [];
  for (const event of events) {
    visiblePaths = event.kind === 'clear' ? [] : clonePaths(event.paths);
  }

  return visiblePaths;
}
