import type { ReviewFeedback, ReviewFeedbackListResponse, ReviewDrawingFrame } from '../types/review';
import { reviewService } from '../services/repositoryService';
import { resolveVisibleAnnotationPathsFromDrawingFrames } from './reviewDrawingResolver';
import type { AnnotationPath } from '../components/AnnotationCanvas';

function parseTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareFeedbackOrder(left: ReviewFeedback, right: ReviewFeedback): number {
  const timeDelta = parseTime(left.createdAtUtc) - parseTime(right.createdAtUtc);
  if (timeDelta !== 0) return timeDelta;

  const idDelta = left.feedbackId.localeCompare(right.feedbackId);
  if (idDelta !== 0) return idDelta;

  return 0;
}

function parseAnnotationDataTimeline(feedback: ReviewFeedback): ReviewDrawingFrame[] {
  if (!feedback.annotationDataJson) return [];

  try {
    const parsed = JSON.parse(feedback.annotationDataJson) as {
      drawingFrames?: ReviewDrawingFrame[];
      frameDrawingRecords?: Array<{ frameNumber?: number; timestampSeconds?: number; timecode?: string; paths?: AnnotationPath[] }>;
      clearFrameRecords?: Array<{ frameNumber?: number; updatedAt?: string }>;
    };

    if (Array.isArray(parsed.drawingFrames) && parsed.drawingFrames.length > 0) {
      return parsed.drawingFrames;
    }

    const frames: ReviewDrawingFrame[] = [];
    for (const record of parsed.frameDrawingRecords ?? []) {
      if (typeof record.frameNumber !== 'number') continue;
      frames.push({
        frameNumber: record.frameNumber,
        timestampSeconds: record.timestampSeconds ?? null,
        timecode: record.timecode ?? null,
        drawingStateCode: 'DRAWN',
        drawingObjectsJson: JSON.stringify(record.paths ?? []),
      });
    }

    for (const record of parsed.clearFrameRecords ?? []) {
      if (typeof record.frameNumber !== 'number') continue;
      frames.push({
        frameNumber: record.frameNumber,
        timestampSeconds: null,
        timecode: null,
        drawingStateCode: 'CLEAR',
        drawingObjectsJson: null,
      });
    }

    return frames;
  } catch {
    return [];
  }
}

export function resolveFeedbackRoundTimeline(feedbacks: ReviewFeedback[], currentVersionNum?: string | null): ReviewDrawingFrame[] {
  const versionKey = currentVersionNum?.trim().toUpperCase() ?? '';
  const scopedFeedbacks = versionKey
    ? feedbacks.filter((feedback) => (feedback.versionNum ?? '').trim().toUpperCase() === versionKey)
    : [...feedbacks];

  if (scopedFeedbacks.length === 0) {
    return [];
  }

  const roundTaggedFeedbacks = scopedFeedbacks.filter((feedback) => Boolean(feedback.feedbackRoundId?.trim()));
  const targetFeedbacks = roundTaggedFeedbacks.length > 0 ? roundTaggedFeedbacks : scopedFeedbacks;
  const latestFeedback = sortFeedbacksForFrame(targetFeedbacks).at(-1) ?? null;
  const roundId = latestFeedback?.feedbackRoundId?.trim() || null;

  const roundFeedbacks = roundId
    ? scopedFeedbacks.filter((feedback) => feedback.feedbackRoundId?.trim() === roundId)
    : scopedFeedbacks;

  const resolvedFrames = roundFeedbacks.flatMap((feedback) => {
    if (feedback.drawingFrames?.length) {
      return feedback.drawingFrames;
    }
    return parseAnnotationDataTimeline(feedback);
  });

  if (resolvedFrames.length > 0) {
    return resolvedFrames;
  }

  return latestFeedback?.drawingFrames?.length
    ? latestFeedback.drawingFrames
    : latestFeedback ? parseAnnotationDataTimeline(latestFeedback) : [];
}

export function sortFeedbacksForFrame(feedbacks: ReviewFeedback[]): ReviewFeedback[] {
  return [...feedbacks].sort(compareFeedbackOrder);
}

export interface FeedbackFrameGroup {
  frameNumber: number | null;
  feedbacks: ReviewFeedback[];
  drawingFrames: ReviewDrawingFrame[];
}

export interface FrameFeedbackIndex {
  feedbacksByFrameNumber: Map<number, ReviewFeedback[]>;
  drawingFramesByFrameNumber: Map<number, ReviewDrawingFrame[]>;
  frameGroups: FeedbackFrameGroup[];
  unframedFeedbacks: ReviewFeedback[];
  getFeedbacksForFrame: (frameNumber?: number | null) => ReviewFeedback[];
  getLatestFeedbackForFrame: (frameNumber?: number | null) => ReviewFeedback | null;
}

export interface FeedbackRoundGroup {
  roundKey: string;
  roundId: string | null;
  createdAtUtc: string;
  feedbacks: ReviewFeedback[];
  drawingFrames: ReviewDrawingFrame[];
  drawingTimeline: ReviewDrawingFrame[];
}

export interface ShotFeedbackView {
  shotId: string;
  feedbacks: ReviewFeedback[];
  latestRound: ReviewFeedbackListResponse['latestRound'] | null;
  latestRoundDrawingFrames: ReviewDrawingFrame[];
  latestRoundDrawingTimeline: ReviewDrawingFrame[];
  roundGroups: FeedbackRoundGroup[];
  frameIndex: FrameFeedbackIndex;
}

export interface ShotFeedbackFilter {
  shotId?: string | null;
  taskShotId?: string | null;
  reviewTaskId?: string | null;
}

function isSameTaskShot(feedback: ReviewFeedback, taskShotId: string | null): boolean {
  if (!taskShotId) return true;
  const feedbackTaskShotId = feedback.taskShotId?.trim() || null;
  if (!feedbackTaskShotId) return true;
  return feedbackTaskShotId === taskShotId;
}

function isSameReviewTask(feedback: ReviewFeedback, reviewTaskId: string | null): boolean {
  if (!reviewTaskId) return true;
  const feedbackReviewTaskId = feedback.reviewTaskId?.trim() || null;
  if (!feedbackReviewTaskId) return true;
  return feedbackReviewTaskId === reviewTaskId;
}

export function filterFeedbacksForShot(feedbacks: ReviewFeedback[], filter?: ShotFeedbackFilter | null): ReviewFeedback[] {
  const shotId = filter?.shotId?.trim() || null;
  const taskShotId = filter?.taskShotId?.trim() || null;
  const reviewTaskId = filter?.reviewTaskId?.trim() || null;

  return sortFeedbacksForFrame((Array.isArray(feedbacks) ? feedbacks : []).filter((feedback) => {
    if (shotId && feedback.lensId?.trim() !== shotId) {
      return false;
    }

    if (!isSameReviewTask(feedback, reviewTaskId)) {
      return false;
    }

    return isSameTaskShot(feedback, taskShotId);
  }));
}

export function groupFeedbacksByFrame(feedbacks: ReviewFeedback[]): Omit<FrameFeedbackIndex, 'getFeedbacksForFrame'> {
  const feedbacksByFrameNumber = new Map<number, ReviewFeedback[]>();
  const drawingFramesByFrameNumber = new Map<number, ReviewDrawingFrame[]>();
  const unframedFeedbacks: ReviewFeedback[] = [];

  for (const feedback of sortFeedbacksForFrame(feedbacks)) {
    const frameNumber = typeof feedback.frameNumber === 'number' && Number.isFinite(feedback.frameNumber)
      ? feedback.frameNumber
      : null;

    if (frameNumber === null) {
      unframedFeedbacks.push(feedback);
      continue;
    }

    const list = feedbacksByFrameNumber.get(frameNumber) ?? [];
    list.push(feedback);
    feedbacksByFrameNumber.set(frameNumber, list);

    const frameDrawingFrames = drawingFramesByFrameNumber.get(frameNumber) ?? [];
    if (Array.isArray(feedback.drawingFrames) && feedback.drawingFrames.length > 0) {
      frameDrawingFrames.push(...feedback.drawingFrames);
    }
    drawingFramesByFrameNumber.set(frameNumber, frameDrawingFrames);
  }

  const frameGroups: FeedbackFrameGroup[] = [...feedbacksByFrameNumber.entries()]
    .map(([frameNumber, items]) => ({
      frameNumber,
      feedbacks: sortFeedbacksForFrame(items),
      drawingFrames: drawingFramesByFrameNumber.get(frameNumber) ?? [],
    }))
    .sort((left, right) => left.frameNumber - right.frameNumber);

  return {
    feedbacksByFrameNumber,
    drawingFramesByFrameNumber,
    frameGroups,
    unframedFeedbacks: sortFeedbacksForFrame(unframedFeedbacks),
    getLatestFeedbackForFrame(frameNumber?: number | null) {
      const frameFeedbacks = typeof frameNumber !== 'number' || !Number.isFinite(frameNumber)
        ? unframedFeedbacks
        : (feedbacksByFrameNumber.get(frameNumber) ?? []);
      return frameFeedbacks[frameFeedbacks.length - 1] ?? null;
    },
  };
}

function groupFeedbacksByRound(feedbacks: ReviewFeedback[]): FeedbackRoundGroup[] {
  const groups = new Map<string, ReviewFeedback[]>();

  for (const feedback of feedbacks) {
    const roundKey = feedback.feedbackRoundId?.trim() || feedback.feedbackId;
    const items = groups.get(roundKey) ?? [];
    items.push(feedback);
    groups.set(roundKey, items);
  }

  return [...groups.entries()]
    .map(([roundKey, items]) => ({
      roundKey,
      roundId: items[0]?.feedbackRoundId?.trim() || null,
      createdAtUtc: items.reduce((latest, item) => (item.createdAtUtc > latest ? item.createdAtUtc : latest), items[0]?.createdAtUtc ?? ''),
      feedbacks: sortFeedbacksForFrame(items),
      drawingFrames: items.flatMap((item) => item.drawingFrames?.length ? item.drawingFrames : parseAnnotationDataTimeline(item)),
      drawingTimeline: items.flatMap((item) => item.drawingFrames?.length ? item.drawingFrames : parseAnnotationDataTimeline(item)),
    }))
    .sort((left, right) => right.createdAtUtc.localeCompare(left.createdAtUtc));
}

function buildRoundSnapshotFromGroup(group: FeedbackRoundGroup | null): ReviewFeedbackListResponse['latestRound'] | null {
  if (!group) {
    return null;
  }

  return {
    feedbackRoundId: group.roundId ?? group.roundKey,
    createdAtUtc: group.createdAtUtc,
    feedbackCount: group.feedbacks.length,
    drawingTimeline: group.drawingTimeline,
    drawingFrames: group.drawingFrames,
  };
}

function resolveRoundTimeline(response: ReviewFeedbackListResponse): ReviewDrawingFrame[] {
  const latestRoundTimeline = response.latestRound?.drawingTimeline ?? response.latestRound?.drawingFrames ?? [];
  if (latestRoundTimeline.length > 0) {
    return latestRoundTimeline;
  }

  const latestRoundId = response.latestRound?.feedbackRoundId ?? response.latestFeedbackRoundId ?? null;
  if (!latestRoundId) {
    return [];
  }

  const roundFeedbacks = sortFeedbacksForFrame((response.feedbacks ?? []).filter((feedback) => (feedback.feedbackRoundId?.trim() || null) === latestRoundId));
  return roundFeedbacks.flatMap((feedback) => feedback.drawingFrames?.length ? feedback.drawingFrames : parseAnnotationDataTimeline(feedback));
}

export function getShotTimelinePaths(view: ShotFeedbackView | null | undefined, frameNumber: number): AnnotationPath[] {
  if (!view) return [];
  return resolveVisibleAnnotationPathsFromDrawingFrames(view.latestRoundDrawingTimeline.length > 0 ? view.latestRoundDrawingTimeline : view.latestRoundDrawingFrames, frameNumber);
}

export function buildShotFeedbackView(
  shotId: string,
  response: ReviewFeedbackListResponse,
  filter?: ShotFeedbackFilter | null,
): ShotFeedbackView {
  const feedbacks = filterFeedbacksForShot(response.feedbacks, filter ?? { shotId });
  const latestRoundDrawingTimeline = resolveRoundTimeline(response);
  const latestRoundDrawingFrames = latestRoundDrawingTimeline;
  const frameGroupBase = groupFeedbacksByFrame(feedbacks);
  const frameIndex: FrameFeedbackIndex = {
    ...frameGroupBase,
    getFeedbacksForFrame(frameNumber?: number | null) {
      if (typeof frameNumber !== 'number' || !Number.isFinite(frameNumber)) {
        return frameGroupBase.unframedFeedbacks;
      }

      return frameGroupBase.feedbacksByFrameNumber.get(frameNumber) ?? [];
    },
    getLatestFeedbackForFrame(frameNumber?: number | null) {
      const frameFeedbacks = typeof frameNumber !== 'number' || !Number.isFinite(frameNumber)
        ? frameGroupBase.unframedFeedbacks
        : (frameGroupBase.feedbacksByFrameNumber.get(frameNumber) ?? []);
      return frameFeedbacks[frameFeedbacks.length - 1] ?? null;
    },
  };

  return {
    shotId,
    feedbacks,
    latestRound: response.latestRound ?? null,
    latestRoundDrawingFrames,
    latestRoundDrawingTimeline,
    roundGroups: groupFeedbacksByRound(feedbacks),
    frameIndex,
  };
}

export function buildVersionScopedShotFeedbackView(
  shotId: string,
  response: ReviewFeedbackListResponse,
  currentVersionNum?: string | null,
  filter?: ShotFeedbackFilter | null,
): ShotFeedbackView {
  const feedbacks = filterFeedbacksForShot(response.feedbacks, filter ?? { shotId });
  const versionKey = currentVersionNum?.trim().toUpperCase() ?? '';
  const scopedFeedbacks = versionKey
    ? feedbacks.filter((feedback) => (feedback.versionNum ?? '').trim().toUpperCase() === versionKey)
    : feedbacks;

  const roundGroups = groupFeedbacksByRound(scopedFeedbacks);
  const latestRoundGroup = roundGroups[0] ?? null;
  const currentRoundFeedbacks = latestRoundGroup?.feedbacks ?? scopedFeedbacks;
  const frameGroupBase = groupFeedbacksByFrame(currentRoundFeedbacks);
  const latestRoundDrawingTimeline = latestRoundGroup?.drawingTimeline ?? [];
  const latestRoundDrawingFrames = latestRoundDrawingTimeline;
  const frameIndex: FrameFeedbackIndex = {
    ...frameGroupBase,
    getFeedbacksForFrame(frameNumber?: number | null) {
      if (typeof frameNumber !== 'number' || !Number.isFinite(frameNumber)) {
        return frameGroupBase.unframedFeedbacks;
      }

      return frameGroupBase.feedbacksByFrameNumber.get(frameNumber) ?? [];
    },
    getLatestFeedbackForFrame(frameNumber?: number | null) {
      const frameFeedbacks = typeof frameNumber !== 'number' || !Number.isFinite(frameNumber)
        ? frameGroupBase.unframedFeedbacks
        : (frameGroupBase.feedbacksByFrameNumber.get(frameNumber) ?? []);
      return frameFeedbacks[frameFeedbacks.length - 1] ?? null;
    },
  };

  return {
    shotId,
    feedbacks: currentRoundFeedbacks,
    latestRound: buildRoundSnapshotFromGroup(latestRoundGroup),
    latestRoundDrawingFrames,
    latestRoundDrawingTimeline,
    roundGroups,
    frameIndex,
  };
}

export async function loadAllFeedbacksForShot(shotId: string, filter?: ShotFeedbackFilter | null): Promise<ShotFeedbackView> {
  const response = await reviewService.listReviewFeedbacks(shotId);
  if (response.success) {
    return buildShotFeedbackView(shotId, response, filter ?? { shotId });
  }

  return buildShotFeedbackView(shotId, { success: true, feedbacks: [] }, filter ?? { shotId });
}
