import type { AnnotationPath } from '../components/AnnotationCanvas';
import type { ReviewFeedback } from '../types/review';

function normalizeVersionKey(versionNum?: string | null): string {
  return (versionNum ?? '').trim().toUpperCase();
}

function parseTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortFeedbacks(feedbacks: ReviewFeedback[]): ReviewFeedback[] {
  return [...feedbacks].sort((left, right) => {
    const timeDelta = parseTime(left.createdAtUtc) - parseTime(right.createdAtUtc);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.feedbackId.localeCompare(right.feedbackId);
  });
}

export function selectCurrentDirectorFeedbacks(feedbacks: ReviewFeedback[], currentVersionNum?: string | null): ReviewFeedback[] {
  const versionKey = normalizeVersionKey(currentVersionNum);
  const scopedFeedbacks = versionKey
    ? feedbacks.filter((feedback) => normalizeVersionKey(feedback.versionNum) === versionKey)
    : [...feedbacks];

  if (scopedFeedbacks.length === 0) {
    return [];
  }

  const roundTaggedFeedbacks = scopedFeedbacks.filter((feedback) => Boolean(feedback.feedbackRoundId?.trim()));
  if (roundTaggedFeedbacks.length === 0) {
    return sortFeedbacks(scopedFeedbacks);
  }

  const latestRoundFeedback = sortFeedbacks(roundTaggedFeedbacks).at(-1) ?? null;
  const currentRoundId = latestRoundFeedback?.feedbackRoundId?.trim();
  if (!currentRoundId) {
    return sortFeedbacks(scopedFeedbacks);
  }

  const currentRoundFeedbacks = scopedFeedbacks.filter((feedback) => feedback.feedbackRoundId?.trim() === currentRoundId);
  return currentRoundFeedbacks.length > 0 ? sortFeedbacks(currentRoundFeedbacks) : sortFeedbacks(scopedFeedbacks);
}

export function collectDirectorFeedbackMaskPaths(feedbacks: ReviewFeedback[]): AnnotationPath[] {
  const maskPaths: AnnotationPath[] = [];

  for (const feedback of feedbacks) {
    const drawingFrames = Array.isArray(feedback.drawingFrames) ? feedback.drawingFrames : [];
    if (drawingFrames.length > 0) {
      for (const frame of drawingFrames) {
        if (frame.drawingStateCode === 'CLEAR') {
          maskPaths.length = 0;
          continue;
        }

        if (frame.drawingStateCode !== 'DRAWN' || !frame.drawingObjectsJson) continue;

        try {
          const paths = JSON.parse(frame.drawingObjectsJson) as AnnotationPath[];
          for (const path of paths) {
            maskPaths.push({
              ...path,
              points: path.points.map((point) => ({ ...point })),
            });
          }
        } catch {
          continue;
        }
      }
      continue;
    }

    if (!feedback.annotationDataJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(feedback.annotationDataJson) as {
        frameDrawingRecords?: Array<{ paths?: AnnotationPath[] }>;
        clearFrameRecords?: unknown[];
        annotationDataJson?: string | null;
        drawingFrames?: Array<{ drawingStateCode?: string; drawingObjectsJson?: string | null }>;
      };

      const nestedFrames = Array.isArray(parsed.drawingFrames) ? parsed.drawingFrames : [];
      if (nestedFrames.length > 0) {
        for (const frame of nestedFrames) {
          if (frame.drawingStateCode === 'CLEAR') {
            maskPaths.length = 0;
            continue;
          }
          if (frame.drawingStateCode !== 'DRAWN' || !frame.drawingObjectsJson) continue;
          try {
            const paths = JSON.parse(frame.drawingObjectsJson) as AnnotationPath[];
            for (const path of paths) {
              maskPaths.push({
                ...path,
                points: path.points.map((point) => ({ ...point })),
              });
            }
          } catch {
            continue;
          }
        }
        continue;
      }

      const records = Array.isArray(parsed.frameDrawingRecords) ? parsed.frameDrawingRecords : [];
      for (const record of records) {
        for (const path of record.paths ?? []) {
          maskPaths.push({
            ...path,
            points: path.points.map((point) => ({ ...point })),
          });
        }
      }
    } catch {
      continue;
    }
  }

  return maskPaths;
}
