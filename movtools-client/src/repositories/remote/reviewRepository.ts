/**
 * 远程审片仓储
 * 
 * 连接到服务端进行审片管理。
 */
import type { IReviewRepository } from '../types';
import type { ReviewDetailPayload, ReviewListResponse, ReviewTask, ReviewAction, ReviewComment, ReviewCommentType, ReviewTaskResponse, ReviewCommentResponse, ReviewFeedback, ReviewFeedbackListResponse, ReviewFeedbackResponse, ReviewTaskDetail, ReviewTaskShot, ReviewTaskSummary, ReviewTaskListResponse, ReviewTaskDetailResponse, ReviewTaskActionResponse, CreateDraftTaskRequest, UpdateTaskRequest, AddTaskShotsRequest, RemoveTaskShotRequest, ReorderTaskShotsRequest, SubmitTaskRequest, CreateReviewDrawingFrameRequest, ReviewParticipationMode, CreateReviewTaskShotRequest } from '../../types/review';
import type { ReviewTaskStatus } from '../../types/review';
import { apiClient } from '../../api/client';
import { resolveImageUrl } from '../../lib/imageUrl';
import { resolveReviewParticipationMode } from '../../lib/reviewParticipationMode';

/** 映射绘制帧响应 */
function mapDrawingFrameResponse(frame: any) {
  return {
    frameNumber: frame.frameNumber ?? null,
    timestampSeconds: frame.timestampSeconds ?? null,
    timecode: frame.timecode ?? null,
    drawingStateCode: frame.drawingStateCode ?? 'DRAWN',
    drawingObjectsJson: frame.drawingObjectsJson ?? null,
  };
}

/** 将标注数据 JSON 转换为绘制帧请求列表 */
function toDrawingFrameRequests(annotationDataJson?: string | null): CreateReviewDrawingFrameRequest[] {
  if (!annotationDataJson) return [];

  try {
    const parsed = JSON.parse(annotationDataJson) as {
      frameDrawingRecords?: Array<{ frameNumber?: number; timestampSeconds?: number; timecode?: string; paths?: unknown[] }>;
      clearFrameRecords?: Array<{ frameNumber?: number }>;
    };

    const records: CreateReviewDrawingFrameRequest[] = [];
    for (const record of parsed.frameDrawingRecords ?? []) {
      if (typeof record.frameNumber !== 'number') continue;
      records.push({
        frameNumber: record.frameNumber,
        timestampSeconds: record.timestampSeconds ?? null,
        timecode: record.timecode ?? null,
        drawingStateCode: 'DRAWN',
        drawingObjectsJson: JSON.stringify(record.paths ?? []),
      });
    }

    for (const record of parsed.clearFrameRecords ?? []) {
      if (typeof record.frameNumber !== 'number') continue;
      records.push({
        frameNumber: record.frameNumber,
        timestampSeconds: null,
        timecode: null,
        drawingStateCode: 'CLEAR',
        drawingObjectsJson: null,
      });
    }

    return records;
  } catch {
    return [];
  }
}

/** 判断是否为本地文件路径 */
function isLocalFilePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
}

/** 从 Base64 创建 Blob 对象 */
function blobFromBase64(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** 上传反馈图片到服务端，返回预览 URL */
async function uploadFeedbackImage(lensId: string, filePath: string, sortOrder: number): Promise<string> {
  const fileResponse = await window.movtools.file.readBase64({ path: filePath });
  if (!fileResponse.success || !fileResponse.base64 || !fileResponse.fileName) {
    throw new Error(fileResponse.error || '读取图片失败');
  }

  const formData = new FormData();
  formData.append('SortOrder', String(sortOrder));
  formData.append('File', blobFromBase64(fileResponse.base64, fileResponse.mimeType || 'application/octet-stream'), fileResponse.fileName);

  const response = await apiClient.request<any>(`/api/lenses/${lensId}/repair-attachments`, {
    method: 'POST',
    body: formData,
  });

  return response?.previewUrl || response?.PreviewUrl || response?.preview_url || '';
}

/** 将请求中的本地图片路径上传并替换为远程 URL */
async function normalizeImagePaths(lensId: string, request: {
  frameImagePath?: string | null;
  annotatedImagePath?: string | null;
  thumbnailPath?: string | null;
}): Promise<{
  frameImagePath?: string | null;
  annotatedImagePath?: string | null;
  thumbnailPath?: string | null;
}> {
  const next = { ...request };
  const keys: Array<keyof typeof next> = ['frameImagePath', 'annotatedImagePath', 'thumbnailPath'];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = next[key];
    if (value && isLocalFilePath(value)) {
      next[key] = await uploadFeedbackImage(lensId, value, i);
    }
  }
  return next;
}

/** 将服务端审片状态映射为客户端状态 */
function mapServerReviewStatus(status: string): ReviewTaskStatus {
  if (status === 'completed') return 'approved';
  if (status === 'closed') return 'rejected';
  return status as ReviewTaskStatus;
}

/** 将客户端审片状态过滤条件映射为服务端参数 */
function mapReviewListFilter(status?: ReviewTaskStatus): string | undefined {
  if (status === 'approved') return 'completed';
  if (status === 'rejected') return 'closed';
  return status;
}

/** 映射服务端任务响应为客户端 ReviewTask */
function mapTaskResponseToReviewTask(t: ReviewTaskResponse): ReviewTask {
  const primaryShot = t.shots?.[0];
  return {
    taskId: t.id,
    lensId: t.lensId || primaryShot?.lensId || '',
    lensCode: t.lensCode || primaryShot?.lensCode || '',
    episodeId: t.episodeId ?? '',
    episodeCode: t.episodeCode ?? '',
    projectId: t.projectCode || t.projectId || '',
    projectName: t.projectName || t.projectCode || '',
    versionNum: t.versionNum || primaryShot?.submitVersionNum || primaryShot?.playVersionNum || '',
    status: mapServerReviewStatus(t.status),
    producerStatus: t.producerStatus ?? undefined,
    submitterId: t.createdByUserId,
    submitterName: t.createdByUserName,
    submitTime: t.submittedAtUtc || t.createdAtUtc?.toString() || '',
    reviewerId: t.reviewerId,
    reviewerName: t.reviewerName,
    reviewTime: t.updatedAtUtc?.toString(),
    reviewResult: t.resultComment as ReviewAction | undefined,
    commentCount: t.commentCount,
    rowVersion: t.rowVersion,
    shotCount: t.summary?.shotCount ?? t.shots?.length ?? t.shotCount ?? undefined,
    dueTime: t.dueAtUtc ?? t.dueTime ?? undefined,
    updatedAtUtc: t.updatedAtUtc ?? undefined,
    assignedToUserId: t.assignedToUserId ?? undefined,
    assignedToUserName: t.assignedToUserName ?? undefined,
  };
}

/** 映射服务端镜头响应为客户端 ReviewTaskShot */
function mapTaskShotResponse(shot: any): ReviewTaskShot {
  const participationMode = resolveReviewParticipationMode(shot);
  return {
    taskShotId: shot.taskShotId,
    taskId: shot.taskId,
    shotId: shot.shotId,
    lensCode: shot.lensCode,
    sortOrder: shot.sortOrder ?? 0,
    participationMode: participationMode ?? undefined,
    reviewParticipationMode: participationMode ?? undefined,
    submitVersionNum: shot.submitVersionNum ?? null,
    actualVersionNum: shot.actualVersionNum ?? null,
    feedbackCount: shot.feedbackCount ?? 0,
    status: shot.status ?? 'pending',
    internalReviewStatusCode: shot.internalReviewStatusCode ?? null,
    internalReviewStatusName: shot.internalReviewStatusName ?? null,
    lastFeedbackAtUtc: shot.lastFeedbackAtUtc ?? null,
    hasPlayableMedia: shot.hasPlayableMedia,
  };
}

/** 映射服务端任务详情响应为客户端 ReviewTaskDetail */
function mapTaskDetailResponse(response: any): ReviewTaskDetail {
  return {
    taskId: response.taskId,
    taskName: response.taskName ?? null,
    projectId: response.projectId,
    projectName: response.projectName ?? null,
    episodeId: response.episodeId ?? null,
    episodeCode: response.episodeCode ?? null,
    directorId: response.directorId ?? null,
    directorName: response.directorName ?? null,
    submitterId: response.submitterId,
    submitterName: response.submitterName ?? null,
    status: mapServerReviewStatus(response.status),
    producerStatus: response.producerStatus ?? undefined,
    description: response.description ?? null,
    deadlineUtc: response.deadlineUtc ?? null,
    submitTime: response.submitTime ?? null,
    startTime: response.startTime ?? null,
    completeTime: response.completeTime ?? null,
    closeTime: response.closeTime ?? null,
    shots: Array.isArray(response.shots) ? response.shots.map(mapTaskShotResponse) : [],
    totalShots: response.totalShots ?? response.shots?.length ?? 0,
    feedbackShotCount: response.feedbackShotCount ?? 0,
    approvedShotCount: response.approvedShotCount ?? 0,
    updatedAtUtc: response.updatedAtUtc ?? null,
    createdAtUtc: response.createdAtUtc,
  };
}

/** 映射服务端反馈响应为客户端 ReviewFeedback */
function mapFeedbackResponse(feedback: any): ReviewFeedback {
  return {
    feedbackId: feedback.id,
    feedbackRoundId: feedback.feedbackRoundId ?? feedback.roundId ?? null,
    reviewTaskId: feedback.reviewTaskId,
    lensId: feedback.lensId ?? '',
    lensCode: feedback.lensCode ?? '',
    versionNum: feedback.versionNum ?? null,
    frameNumber: feedback.frameNumber ?? null,
    timecode: feedback.timecode ?? null,
    commentText: feedback.content ?? feedback.commentText ?? null,
    frameImagePath: resolveImageUrl(feedback.frameImagePath) ?? feedback.frameImagePath ?? null,
    annotatedImagePath: resolveImageUrl(feedback.annotatedImagePath) ?? feedback.annotatedImagePath ?? null,
    thumbnailPath: resolveImageUrl(feedback.thumbnailPath) ?? feedback.thumbnailPath ?? null,
    annotationDataJson: feedback.annotationDataJson ?? null,
    createdByDisplayName: feedback.createdByUserName ?? feedback.createdByDisplayName ?? null,
    createdAtUtc: feedback.createdAtUtc,
    updatedAtUtc: feedback.updatedAtUtc ?? null,
    decisionCode: feedback.decisionCode ?? null,
    decisionName: feedback.decisionCode ?? null,
    drawingFrames: Array.isArray(feedback.drawingFrames) ? feedback.drawingFrames.map(mapDrawingFrameResponse) : null,
  };
}

/** 远程审片仓储实现 */
export const remoteReviewRepository: IReviewRepository = {
  /** 获取审片任务列表 */
  async listReviewTasks(options?: {
    status?: ReviewTaskStatus;
    projectId?: string;
    episodeId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReviewListResponse> {
    try {
      const params = new URLSearchParams();
      if (options?.status) params.append('status', mapReviewListFilter(options.status) ?? options.status);
      if (options?.projectId) params.append('projectId', options.projectId);
      if (options?.episodeId) params.append('episodeId', options.episodeId);
      if (options?.page) params.append('page', String(options.page));
      if (options?.pageSize) params.append('pageSize', String(options.pageSize));

      if (!options?.status) {
        params.append('excludeProducerDrafts', 'true');
      }
      
      const queryString = params.toString();
       const path = queryString ? `/api/review-tasks?${queryString}` : '/api/review-tasks';
      
      const tasks = await apiClient.get<ReviewTaskResponse[]>(path);
      const taskList = Array.isArray(tasks) ? tasks : [];
      
      // 映射为客户端类型
      const mappedTasks: ReviewTask[] = taskList
        .map(mapTaskResponseToReviewTask)
        .filter((task) => task.producerStatus !== 'draft' && task.producerStatus !== 'pending-submit');

      const pendingCount = mappedTasks.filter((t) => t.status === 'pending').length;
      const inReviewCount = mappedTasks.filter((t) => t.status === 'in-review').length;
      const approvedCount = mappedTasks.filter((t) => t.status === 'approved').length;
      const rejectedCount = mappedTasks.filter((t) => t.status === 'rejected').length;
      
      return {
        success: true,
        tasks: mappedTasks,
        totalCount: taskList.length,
        pendingCount,
        inReviewCount,
        approvedCount,
        rejectedCount,
      };
    } catch (error) {
      return {
        success: false,
        tasks: [],
        totalCount: 0,
        pendingCount: 0,
        inReviewCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        error: error instanceof Error ? error.message : '获取待审列表失败',
      };
    }
  },

  /** 获取审片详情（任务 + 评论） */
  async getReviewDetail(taskId: string): Promise<{ success: boolean; detail?: ReviewDetailPayload; error?: string }> {
    try {
      // 获取审片任务详情
       const taskResponse = await apiClient.get<ReviewTaskResponse>(`/api/review-tasks/${taskId}`);
      if (!taskResponse) {
        return { success: false, error: '审片任务不存在' };
      }

      // 获取评论列表
       const commentsResponse = await apiClient.get<ReviewCommentResponse[]>(`/api/review-tasks/${taskId}/comments`);

      const task = taskResponse;
      const comments = commentsResponse || [];

      const detail: ReviewDetailPayload = {
          task: mapTaskResponseToReviewTask(task),
          lensCode: task.lensCode ?? '',
        versionNum: task.versionNum || task.shots?.[0]?.submitVersionNum || '',
        comments: comments.map((c) => ({
          commentId: c.id,
          taskId: c.reviewTaskId,
          lensId: task.lensId || task.shots?.[0]?.lensId || '',
          commentType: c.timestampSeconds ? 'timestamp' : 'general',
          content: c.content,
          timestampInSeconds: c.timestampSeconds,
          authorId: c.authorId || c.createdByUserId || '',
          authorName: c.authorName || c.createdByUserName || '',
          createTime: c.createTime?.toString() || c.createdAtUtc?.toString() || '',
          attachments: [],
        })),
        submitterName: task.createdByUserName,
        reviewerName: task.reviewerName,
      };

      return { success: true, detail };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取审片详情失败',
      };
    }
  },

  /** 创建审片评论 */
  async createReviewComment(request: {
    taskId: string;
    commentType: ReviewCommentType;
    content: string;
    timestampInSeconds?: number;
  }): Promise<{ success: boolean; comment?: ReviewComment; error?: string }> {
    try {
       const response = await apiClient.post<ReviewCommentResponse>(
         `/api/review-tasks/${request.taskId}/comments`,
        {
          content: request.content,
          timestampSeconds: request.timestampInSeconds,
        }
      );
      
      if (!response) {
        return { success: false, error: '创建评论失败' };
      }
      
      const comment: ReviewComment = {
        commentId: response.id,
        taskId: response.reviewTaskId,
        lensId: '',  // 服务端未返回 lensId
        commentType: response.timestampSeconds ? 'timestamp' : 'general',
        content: response.content,
        timestampInSeconds: response.timestampSeconds,
        authorId: response.authorId || response.createdByUserId || '',
        authorName: response.authorName || response.createdByUserName || '',
        createTime: response.createTime?.toString() || response.createdAtUtc?.toString() || '',
        attachments: [],
      };
      
      return { success: true, comment };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '创建评论失败',
      };
    }
  },

  /** 提交审片动作（通过/退回/待定） */
  async submitReviewAction(taskId: string, action: ReviewAction): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    try {
      const taskResponse = await apiClient.get<ReviewTaskResponse>(`/api/review-tasks/${taskId}`);
      const actionPath = action === 'rework' ? `/api/review-tasks/${taskId}/reject` : `/api/review-tasks/${taskId}/${action}`;
      const response = await apiClient.post<ReviewTaskResponse>(
        actionPath,
        { action, rowVersion: taskResponse.rowVersion }
      );
      
      if (!response) {
        return { success: false, error: '操作失败' };
      }
      
      // 映射返回的任务
      const task = mapTaskResponseToReviewTask(response);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '提交审片动作失败',
      };
    }
  },

  /** 提交镜头送审 */
  async submitLensForReview(lensId: string): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    try {
       const response = await apiClient.post<ReviewTaskResponse>(
         '/api/review-tasks',
        { lensId }
      );
      
      if (!response) {
        return { success: false, error: '提交审片失败' };
      }
      
      const task = mapTaskResponseToReviewTask(response);
      
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '提交审片失败',
      };
    }
  },

  /** 获取镜头的反馈卡片列表 */
  async listReviewFeedbacks(lensId: string): Promise<ReviewFeedbackListResponse> {
    try {
      const response = await apiClient.get<any>(`/api/review-feedbacks/lens/${lensId}`);
      if (Array.isArray(response)) {
        return { success: true, feedbacks: response.map(mapFeedbackResponse) };
      }

      return {
        success: true,
        feedbacks: Array.isArray(response?.feedbacks) ? response.feedbacks.map(mapFeedbackResponse) : [],
        latestFeedbackRoundId: response?.latestFeedbackRoundId ?? null,
        latestFeedbackAtUtc: response?.latestFeedbackAtUtc ?? null,
        latestRound: response?.latestRound
          ? {
              feedbackRoundId: response.latestRound.feedbackRoundId,
              createdAtUtc: response.latestRound.createdAtUtc,
              feedbackCount: response.latestRound.feedbackCount,
              drawingTimeline: Array.isArray(response.latestRound.drawingTimeline)
                ? response.latestRound.drawingTimeline.map(mapDrawingFrameResponse)
                : Array.isArray(response.latestRound.drawingFrames)
                  ? response.latestRound.drawingFrames.map(mapDrawingFrameResponse)
                  : [],
              drawingFrames: Array.isArray(response.latestRound.drawingFrames)
                ? response.latestRound.drawingFrames.map(mapDrawingFrameResponse)
                : [],
            }
          : null,
      };
    } catch (error) {
      return { success: false, feedbacks: [], error: error instanceof Error ? error.message : '获取反馈卡片失败' };
    }
  },

  /** 创建反馈卡片 */
  async createReviewFeedback(request: {
    feedbackRoundId?: string | null;
    reviewTaskId: string;
    taskShotId?: string | null;
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
    try {
      const normalized = await normalizeImagePaths(request.lensId, request);
      const drawingFrames = request.drawingFrames ?? toDrawingFrameRequests(request.annotationDataJson);
      const response = await apiClient.post<any>(`/api/review-feedbacks`, {
        ...request,
        ...normalized,
        decisionCode: request.decisionCode ?? null,
        drawingFrames,
      });
      return { success: true, feedback: mapFeedbackResponse(response) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '保存反馈卡片失败' };
    }
  },

  /** 更新反馈卡片 */
  async updateReviewFeedback(feedbackId: string, request: {
    commentText?: string | null;
    frameImagePath?: string | null;
    annotatedImagePath?: string | null;
    thumbnailPath?: string | null;
    annotationDataJson?: string | null;
    drawingFrames?: CreateReviewDrawingFrameRequest[];
    decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  }): Promise<ReviewFeedbackResponse> {
    try {
      const response = await apiClient.request<any>(`/api/review-feedbacks/${feedbackId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...request,
          drawingFrames: request.drawingFrames ?? toDrawingFrameRequests(request.annotationDataJson),
        }),
      });
      return { success: true, feedback: mapFeedbackResponse(response) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '更新反馈卡片失败' };
    }
  },

  /** 删除反馈卡片 */
  async deleteReviewFeedback(feedbackId: string): Promise<{ success: boolean; error?: string }> {
    try {
       await apiClient.request(`/api/review-feedbacks/${feedbackId}`, { method: 'DELETE' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除反馈卡片失败' };
    }
  },

  // ========== 多镜头任务管理 ==========

  /** 创建草稿任务 */
  async createDraftTask(request: CreateDraftTaskRequest): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.post<any>('/api/review-tasks/draft', {
        projectId: request.projectId,
        episodeId: request.episodeId ?? null,
        taskName: request.taskName ?? null,
        directorId: request.directorId ?? null,
        description: request.description ?? null,
        deadlineUtc: request.deadlineUtc ?? null,
        shotIds: request.shotIds ?? [],
        shots: request.shots ?? (request.shotIds ?? []).map((lensId, index) => ({
          lensId,
          sequence: index,
          participationMode: 'review',
        })),
      });
      return {
        success: true,
        task: response as ReviewTaskSummary,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '创建草稿任务失败' };
    }
  },

  /** 更新任务信息 */
  async updateTask(taskId: string, request: UpdateTaskRequest): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.request<any>(`/api/review-tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...request,
          shots: request.shots ?? undefined,
        }),
      });
      return {
        success: true,
        task: response as ReviewTaskSummary,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '更新任务失败' };
    }
  },

  /** 获取任务详情 */
  async getTaskDetail(taskId: string): Promise<ReviewTaskDetailResponse> {
    try {
      const response = await apiClient.get<any>(`/api/review-tasks/${taskId}/detail`);
      return {
        success: true,
        detail: mapTaskDetailResponse(response),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '获取任务详情失败' };
    }
  },

  /** 获取制片方任务列表 */
  async listProducerTasks(options?: { status?: string; projectId?: string }): Promise<ReviewTaskListResponse> {
    try {
      const params = new URLSearchParams();
      if (options?.status) params.append('status', options.status);
      if (options?.projectId) params.append('projectId', options.projectId);
      const query = params.toString();
      const path = query ? `/api/review-tasks/producer?${query}` : '/api/review-tasks/producer';
      const tasks = await apiClient.get<any[]>(path);
      return {
        success: true,
        tasks: Array.isArray(tasks) ? tasks as ReviewTaskSummary[] : [],
        totalCount: Array.isArray(tasks) ? tasks.length : 0,
      };
    } catch (error) {
      return { success: false, tasks: [], totalCount: 0, error: error instanceof Error ? error.message : '获取制片任务列表失败' };
    }
  },

  /** 向任务添加镜头 */
  async addTaskShots(request: AddTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.post<any>(`/api/review-tasks/${request.taskId}/shots`, {
        shotIds: request.shotIds,
        shots: request.shots ?? request.shotIds.map((lensId, index) => ({
          lensId,
          sequence: index,
          participationMode: 'review',
        })),
      });
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '添加镜头到任务失败' };
    }
  },

  /** 从任务移除镜头 */
  async removeTaskShot(request: RemoveTaskShotRequest): Promise<ReviewTaskActionResponse> {
    try {
      await apiClient.request(`/api/review-tasks/${request.taskId}/shots/${request.taskShotId}`, {
        method: 'DELETE',
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '从任务移除镜头失败' };
    }
  },

  /** 重排任务中镜头的顺序 */
  async reorderTaskShots(request: ReorderTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.request<any>(`/api/review-tasks/${request.taskId}/shots/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ shotIds: request.shotIds }),
      });
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '重排镜头顺序失败' };
    }
  },

  /** 提交任务（草稿转审核） */
  async submitTask(request: SubmitTaskRequest): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.post<any>(`/api/review-tasks/${request.taskId}/submit`, {});
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '提交任务失败' };
    }
  },

  /** 开始任务 */
  async startTask(taskId: string): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.post<any>(`/api/review-tasks/${taskId}/start`, {});
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '开始任务失败' };
    }
  },

  /** 完成任务 */
  async completeTask(taskId: string): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.post<any>(`/api/review-tasks/${taskId}/complete`, {});
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '完成任务失败' };
    }
  },

  /** 关闭任务 */
  async closeTask(taskId: string): Promise<ReviewTaskActionResponse> {
    try {
      const response = await apiClient.request<any>(`/api/review-tasks/tasks/${taskId}/close`, {method: 'POST',});
      return { success: true, task: response as ReviewTaskSummary };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '关闭任务失败' };
    }
  },
};
