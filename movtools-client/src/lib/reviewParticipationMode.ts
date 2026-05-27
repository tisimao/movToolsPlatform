import type { ReviewParticipationMode } from '../types/review';

export interface ReviewParticipationModeSource {
  participationMode?: ReviewParticipationMode | null | string;
  reviewParticipationMode?: ReviewParticipationMode | null | string;
}

export function resolveReviewParticipationMode(source?: ReviewParticipationModeSource | null): ReviewParticipationMode | null {
  const direct = source?.participationMode;
  if (direct === 'review' || direct === 'context') return direct;

  const legacy = source?.reviewParticipationMode;
  if (legacy === 'review' || legacy === 'context') return legacy;

  return null;
}

export function isContextParticipationMode(value?: ReviewParticipationMode | null | string): boolean {
  return value === 'context';
}

export function getParticipationModeLabel(value?: ReviewParticipationMode | null | string): string {
  if (value === 'context') return '上下文陪审';
  if (value === 'review') return '正式审片';
  return '未设置';
}
