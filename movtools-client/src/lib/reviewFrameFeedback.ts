import type { ReviewFeedback, ReviewFeedbackListResponse, ReviewDrawingFrame } from '../types/review';
import { reviewService } from '../services/repositoryService';

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
}

export interface ShotFeedbackView {
  shotId: string;
  feedbacks: ReviewFeedback[];
  latestRound: ReviewFeedbackListResponse['latestRound'] | null;
  latestRoundDrawingFrames: ReviewDrawingFrame[];
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
      drawingFrames: items.flatMap((item) => item.drawingFrames ?? []),
    }))
    .sort((left, right) => right.createdAtUtc.localeCompare(left.createdAtUtc));
}

export function buildShotFeedbackView(
  shotId: string,
  response: ReviewFeedbackListResponse,
  filter?: ShotFeedbackFilter | null,
): ShotFeedbackView {
  const feedbacks = filterFeedbacksForShot(response.feedbacks, filter ?? { shotId });
  const latestRoundDrawingFrames = response.latestRound?.drawingFrames ?? [];
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
    roundGroups: groupFeedbacksByRound(feedbacks),
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
