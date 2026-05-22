/**
 * 本地临时草稿类型定义
 *
 * 导演审片工作台中的本地草稿卡片状态管理，
 * 与已提交到服务端的 ReviewFeedback 严格分离。
 */

export interface LocalFeedbackDraft {
  draftId: string;
  feedbackRoundId?: string | null;
  sourceFeedbackId?: string | null;
  sourceFeedbackRoundId?: string | null;
  hasTextChanges?: boolean;
  hasDrawingChanges?: boolean;
  taskShotId: string;
  shotId: string;
  lensCode: string;
  versionNum: string;
  frameNumber: number;
  timecode: string;
  commentText: string;
  frameImageLocalPath?: string;
  annotatedImageLocalPath?: string;
  thumbnailLocalPath?: string;
  annotationDataJson?: string;
  decisionCode: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED';
  pendingAction?: 'create' | 'update' | 'delete';
  createdAt: string;
  updatedAt: string;
  submitStatus: 'unsaved' | 'pending' | 'submitted' | 'failed';
  submittedFeedbackId?: string;
}

export interface DraftCardState {
  drafts: LocalFeedbackDraft[];
  activeDraftId: string | null;
}

export function createEmptyDraft(): Omit<LocalFeedbackDraft, 'draftId' | 'createdAt' | 'updatedAt'> {
  const now = new Date();
  return {
    taskShotId: '',
    shotId: '',
    lensCode: '',
    versionNum: '',
    frameNumber: 0,
    timecode: '',
    commentText: '',
    sourceFeedbackId: null,
    sourceFeedbackRoundId: null,
    hasTextChanges: false,
    hasDrawingChanges: false,
    decisionCode: 'CHANGES_REQUIRED',
    submitStatus: 'unsaved',
  };
}

export function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDraftFromPartial(
  partial: Partial<LocalFeedbackDraft> & { taskShotId: string },
): LocalFeedbackDraft {
  const now = new Date().toISOString();
  return {
    draftId: generateDraftId(),
    feedbackRoundId: partial.feedbackRoundId ?? null,
    sourceFeedbackId: partial.sourceFeedbackId ?? null,
    sourceFeedbackRoundId: partial.sourceFeedbackRoundId ?? null,
    hasTextChanges: partial.hasTextChanges ?? false,
    hasDrawingChanges: partial.hasDrawingChanges ?? false,
    shotId: partial.shotId || '',
    lensCode: partial.lensCode || '',
    versionNum: partial.versionNum || '',
    frameNumber: partial.frameNumber || 0,
    timecode: partial.timecode || '',
    commentText: partial.commentText || '',
    decisionCode: partial.decisionCode || 'CHANGES_REQUIRED',
    pendingAction: partial.pendingAction || 'create',
    submitStatus: 'unsaved',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
