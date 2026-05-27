/**
 * 本地审片仓储
 * 
 * 由于审片是协同功能，本地模式下返回空结果。
 */
import type { IReviewRepository } from '../types';
import type { ReviewDetailPayload, ReviewListResponse, ReviewTask, ReviewAction, ReviewComment, ReviewCommentType, ReviewFeedbackListResponse, ReviewFeedbackResponse, ReviewTaskListResponse, ReviewTaskDetailResponse, ReviewTaskActionResponse, CreateDraftTaskRequest, UpdateTaskRequest, AddTaskShotsRequest, RemoveTaskShotRequest, ReorderTaskShotsRequest, SubmitTaskRequest, CreateReviewDrawingFrameRequest } from '../../types/review';
import type { ReviewTaskStatus } from '../../types/review';

export const localReviewRepository: IReviewRepository = {
  async listReviewTasks(_options?: {
    status?: ReviewTaskStatus;
    projectId?: string;
    episodeId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReviewListResponse> {
    // 本地模式下不支持审片，返回空列表
    return {
      success: true,
      tasks: [],
      totalCount: 0,
      pendingCount: 0,
      inReviewCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    };
  },

  async getReviewDetail(_taskId: string): Promise<{ success: boolean; detail?: ReviewDetailPayload; error?: string }> {
    return {
      success: false,
      error: '本地模式下不支持审片功能。',
    };
  },

  async createReviewComment(_request: {
    taskId: string;
    commentType: ReviewCommentType;
    content: string;
    timestampInSeconds?: number;
  }): Promise<{ success: boolean; comment?: ReviewComment; error?: string }> {
    return {
      success: false,
      error: '本地模式下不支持审片评论。',
    };
  },

  async submitReviewAction(_taskId: string, _action: ReviewAction): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    return {
      success: false,
      error: '本地模式下不支持审片动作。',
    };
  },

  async submitLensForReview(_lensId: string): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    return {
      success: false,
      error: '本地模式下不支持提交审片。',
    };
  },

  async listReviewFeedbacks(_lensId: string): Promise<ReviewFeedbackListResponse> {
    return { success: true, feedbacks: [] };
  },

  async createReviewFeedback(_request: {
    feedbackRoundId?: string | null;
    reviewTaskId: string;
    lensId: string;
    versionNum?: string | null;
    frameNumber?: number | null;
    timecode?: string | null;
    commentText?: string | null;
    decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
    frameImagePath?: string | null;
    annotatedImagePath?: string | null;
    thumbnailPath?: string | null;
    annotationDataJson?: string | null;
    drawingFrames?: CreateReviewDrawingFrameRequest[];
  }): Promise<ReviewFeedbackResponse> {
    return { success: false, error: '本地模式下不支持反馈卡片。' };
  },

  async updateReviewFeedback(_feedbackId: string, _request: {
    commentText?: string | null;
    frameImagePath?: string | null;
    annotatedImagePath?: string | null;
    thumbnailPath?: string | null;
    annotationDataJson?: string | null;
    drawingFrames?: CreateReviewDrawingFrameRequest[];
    decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  }): Promise<ReviewFeedbackResponse> {
    return { success: false, error: '本地模式下不支持反馈卡片。' };
  },

  async deleteReviewFeedback(_feedbackId: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: '本地模式下不支持反馈卡片。' };
  },

  async createDraftTask(_request: CreateDraftTaskRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async updateTask(_taskId: string, _request: UpdateTaskRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async getTaskDetail(_taskId: string): Promise<ReviewTaskDetailResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async listProducerTasks(_options?: { status?: string; projectId?: string }): Promise<ReviewTaskListResponse> {
    return { success: true, tasks: [], totalCount: 0 };
  },

  async addTaskShots(_request: AddTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async removeTaskShot(_request: RemoveTaskShotRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async reorderTaskShots(_request: ReorderTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async submitTask(_request: SubmitTaskRequest): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async startTask(_taskId: string): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async completeTask(_taskId: string): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },

  async closeTask(_taskId: string): Promise<ReviewTaskActionResponse> {
    return { success: false, error: '本地模式下不支持审片任务管理。' };
  },
};
