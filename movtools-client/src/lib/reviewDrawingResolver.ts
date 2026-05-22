import type { AnnotationPath } from '../components/AnnotationCanvas';
import type { ReviewDrawingFrame } from '../types/review';
import type { ReviewClearFrameRecord, ReviewFrameDrawingRecord } from './reviewLocalState';

export interface ReviewDrawingResolverInput {
  drawingFrames?: ReviewDrawingFrame[] | null;
  frameDrawingRecords?: ReviewFrameDrawingRecord[] | null;
  clearFrameRecords?: ReviewClearFrameRecord[] | null;
}

function clonePaths(paths: AnnotationPath[]): AnnotationPath[] {
  return paths.map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point })),
  }));
}

function getFrameKey(frame: ReviewDrawingFrame): number | null {
  if (typeof frame.frameNumber === 'number' && Number.isFinite(frame.frameNumber)) {
    return frame.frameNumber;
  }

  if (typeof frame.timestampSeconds === 'number' && Number.isFinite(frame.timestampSeconds)) {
    return Math.floor(frame.timestampSeconds * 24) + 1;
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

export function resolveVisibleAnnotationPathsFromDrawingFrames(
  drawingFrames: ReviewDrawingFrame[] | null | undefined,
  frameNumber: number,
): AnnotationPath[] {
  const events = (Array.isArray(drawingFrames) ? drawingFrames : [])
    .map((frame, index) => ({ frame, index, frameKey: getFrameKey(frame) }))
    .filter((item) => item.frameKey !== null && item.frameKey <= frameNumber)
    .sort((left, right) => (left.frameKey ?? 0) - (right.frameKey ?? 0) || left.index - right.index);

  let visiblePaths: AnnotationPath[] = [];
  for (const { frame } of events) {
    if (frame.drawingStateCode === 'CLEAR') {
      visiblePaths = [];
      continue;
    }

    if (frame.drawingStateCode !== 'DRAWN') continue;
    visiblePaths = parseDrawingObjects(frame.drawingObjectsJson);
  }

  return visiblePaths;
}

export function resolveReviewVisibleAnnotationPaths(
  input: ReviewDrawingResolverInput,
  frameNumber: number,
): AnnotationPath[] {
  const localEvents = [
    ...(input.frameDrawingRecords ?? []).map((record, index) => ({
      kind: 'draw' as const,
      source: 'local' as const,
      frameNumber: record.frameNumber,
      order: index,
      paths: record.paths,
    })),
    ...(input.clearFrameRecords ?? []).map((record, index) => ({
      kind: 'clear' as const,
      source: 'local' as const,
      frameNumber: record.frameNumber,
      order: index,
      paths: [] as AnnotationPath[],
    })),
  ];

  const serverEvents = (Array.isArray(input.drawingFrames) ? input.drawingFrames : [])
    .map((frame, index) => ({
      kind: frame.drawingStateCode === 'CLEAR' ? 'clear' as const : 'draw' as const,
      source: 'server' as const,
      frameNumber: getFrameKey(frame),
      order: index,
      paths: frame.drawingStateCode === 'DRAWN' ? parseDrawingObjects(frame.drawingObjectsJson) : [] as AnnotationPath[],
    }));

  const events = [...serverEvents, ...localEvents]
    .filter((event) => event.frameNumber !== null && event.frameNumber <= frameNumber)
    .sort((left, right) => (left.frameNumber ?? 0) - (right.frameNumber ?? 0)
      || (left.source === right.source ? left.order - right.order : left.source === 'server' ? -1 : 1));

  let visiblePaths: AnnotationPath[] = [];
  for (const event of events) {
    visiblePaths = event.kind === 'clear' ? [] : clonePaths(event.paths);
  }

  return visiblePaths;
}
