/**
 * 服务层 - 数据源统一访问入口
 * 
 * 本文件提供统一的服务接口，支持在本地和远程数据源之间切换。
 * 页面层通过服务层访问数据，不需要关心底层数据来源。
 */
import type { DataSourceType, IProjectRepository, ILensRepository, IReviewRepository, IPathMappingRepository, StorageRoot, ClientPathMapping } from '../repositories/types';
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from '../types/project';
import type { LensDetailPayload, LensListResponse, LensStatus, LensStatusAction } from '../types/lens';
import type { ReviewDetailPayload, ReviewListResponse, ReviewTask, ReviewTaskStatus, ReviewAction, ReviewComment, ReviewCommentType, ReviewFeedback, ReviewFeedbackListResponse, ReviewFeedbackResponse, ReviewTaskListResponse, ReviewTaskDetailResponse, ReviewTaskActionResponse, CreateDraftTaskRequest, UpdateTaskRequest, AddTaskShotsRequest, RemoveTaskShotRequest, ReorderTaskShotsRequest, SubmitTaskRequest, CreateReviewDrawingFrameRequest } from '../types/review';
import type { ApplyProjectInitializationRequest, LensMutationResponse } from '../types/ipc';
import { localProjectRepository } from '../repositories/local/projectRepository';
import { remoteProjectRepository } from '../repositories/remote/projectRepository';
import { localLensRepository } from '../repositories/local/lensRepository';
import { remoteLensRepository } from '../repositories/remote/lensRepository';
import { localReviewRepository } from '../repositories/local/reviewRepository';
import { remoteReviewRepository } from '../repositories/remote/reviewRepository';
import { localPathMappingRepository } from '../repositories/local/pathMappingRepository';
import { remotePathMappingRepository } from '../repositories/remote/pathMappingRepository';
import { useAuthStore } from '../auth/store';
import { getPrimaryRole } from '../auth/permissions';

const syncingAutoInitializedLensIds = new Set<string>();
let autoInitializedLensSyncSuppressedUntil = 0;

export function suppressAutoInitializedLensSync(durationMs = 3000): void {
  autoInitializedLensSyncSuppressedUntil = Math.max(autoInitializedLensSyncSuppressedUntil, Date.now() + durationMs);
}

export async function syncAutoInitializedLensFrames(response: LensListResponse): Promise<void> {
  if (currentDataSource !== 'remote') {
    return;
  }

  const currentRole = getPrimaryRole(useAuthStore.getState().user);
  if (currentRole !== 'producer' && currentRole !== 'director' && currentRole !== 'admin' && currentRole !== 'system-admin') {
    return;
  }

  if (Date.now() < autoInitializedLensSyncSuppressedUntil) {
    return;
  }

  const autoInitializedLensIds = new Set((response.autoInitializedLensIds ?? []).filter(Boolean));
  const syncTargets = autoInitializedLensIds.size > 0
    ? response.lenses.filter((lens) => autoInitializedLensIds.has(lens.lensId))
    : response.lenses.filter((lens) => lens.singleFrame > 0);

  if (syncTargets.length === 0) {
    return;
  }

  for (const lens of syncTargets) {
    if (syncingAutoInitializedLensIds.has(lens.lensId)) {
      continue;
    }

    syncingAutoInitializedLensIds.add(lens.lensId);
    try {
      const result = await lensService.updateLens(lens.lensId, {
        lensCode: lens.lensCode,
        sceneNo: lens.sceneNo,
        lensName: lens.lensName,
        singleFrame: lens.singleFrame,
        maker: lens.maker,
        makerUserId: lens.makerUserId ?? null,
        makerNameRaw: lens.makerNameRaw ?? null,
        makerMatchStatus: lens.makerMatchStatus,
        note: lens.note,
        lensStatus: lens.lensStatus,
        versionTag: lens.versionTag,
        versionNum: lens.versionNum,
        fileName: lens.fileName,
      });

      if (!result.success) {
        console.warn('[RepositoryService] Sync initialized lens frame failed:', result.error);
      }
    } finally {
      syncingAutoInitializedLensIds.delete(lens.lensId);
    }
  }
}

/**
 * 当前使用的数据源类型
 * 第四批需要使用 remote 模式才能访问审片、路径映射、远程镜头详情等功能
 */
let currentDataSource: DataSourceType = 'remote';

/**
 * 获取当前数据源类型
 */
export function getDataSource(): DataSourceType {
  return currentDataSource;
}

/**
 * 切换数据源
 */
export function switchDataSource(source: DataSourceType): void {
  currentDataSource = source;
}

/**
 * 获取项目仓储实例
 */
function getProjectRepository(): IProjectRepository {
  return currentDataSource === 'remote' ? remoteProjectRepository : localProjectRepository;
}

/**
 * 获取镜头仓储实例
 */
function getLensRepository(): ILensRepository {
  return currentDataSource === 'remote' ? remoteLensRepository : localLensRepository;
}

/**
 * 获取审片仓储实例
 */
function getReviewRepository(): IReviewRepository {
  return currentDataSource === 'remote' ? remoteReviewRepository : localReviewRepository;
}

/**
 * 获取路径映射仓储实例
 */
function getPathMappingRepository(): IPathMappingRepository {
  return currentDataSource === 'remote' ? remotePathMappingRepository : localPathMappingRepository;
}

// ============================================
// 项目服务
// ============================================

export const projectService = {
  async getWorkspace(): Promise<ProjectWorkspace> {
    return getProjectRepository().getWorkspace();
  },

  async getProject(projectId: string): Promise<ProjectSummary | null> {
    return getProjectRepository().getProject(projectId);
  },

  async listEpisodes(projectId: string) {
    return getProjectRepository().listEpisodes(projectId);
  },

  async createProject(request: {
    projectName: string;
    projectRootPath: string;
    projectDefaultFps?: number;
    initialEpisodeCode?: string;
    initialEpisodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
    members?: Array<{
      userId: string;
      projectRoleCode: string;
    }>;
    memberUserIds?: string[];
  }) {
    return getProjectRepository().createProject(request);
  },

  async applyInitialization(request: ApplyProjectInitializationRequest) {
    return getProjectRepository().applyInitialization(request);
  },

  async openProject(projectRootPath: string) {
    return getProjectRepository().openProject(projectRootPath);
  },

  async setActiveProject(projectId: string, options?: {
    projectRootPath?: string;
  }) {
    return getProjectRepository().setActiveProject(projectId, options);
  },

  async createEpisode(request: {
    projectId: string;
    episodeCode: string;
    episodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
  }) {
    return getProjectRepository().createEpisode(request);
  },

  async setActiveEpisode(episodeId: string) {
    return getProjectRepository().setActiveEpisode(episodeId);
  },

  async deleteProject(projectId: string, removeFiles?: boolean) {
    return getProjectRepository().deleteProject(projectId, removeFiles);
  },
};

// ============================================
// 镜头服务
// ============================================

export const lensService = {
  async listLenses(): Promise<LensListResponse> {
    return getLensRepository().listLenses();
  },

  async getLensDetail(lensId: string) {
    return getLensRepository().getLensDetail(lensId);
  },

  async createLens(request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: import('../types/lens').MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }) {
    return getLensRepository().createLens(request);
  },

  async updateLens(lensId: string, request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: import('../types/lens').MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }) {
    return getLensRepository().updateLens(lensId, request);
  },

  async updateLensStatus(lensId: string, action: LensStatusAction, note?: string, imagePaths?: string[]) {
    return getLensRepository().updateLensStatus(lensId, action, note, imagePaths);
  },

  async updateInternalReviewStatus(lensId: string, targetStatusCode: import('../lib/internalReview').InternalReviewStatusCode, note?: string) {
    return getLensRepository().updateInternalReviewStatus(lensId, targetStatusCode, note);
  },

  async batchUpdateLensStatus(lensIds: string[], action: LensStatusAction, note?: string, imagePaths?: string[]) {
    return getLensRepository().batchUpdateLensStatus(lensIds, action, note, imagePaths);
  },

  async deleteLens(lensId: string) {
    return getLensRepository().deleteLens(lensId);
  },

  async batchDeleteLenses(lensIds: string[]) {
    return getLensRepository().batchDeleteLenses(lensIds);
  },

  async importLenses(filePath: string) {
    return getLensRepository().importLenses(filePath);
  },

  async exportIssueReport(lensIds: string[], mode?: 'all-issues' | 'missing-layout') {
    return getLensRepository().exportIssueReport(lensIds, mode);
  },

  async syncLensFileBinding(lensId: string, request: {
    bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo';
    relativePath: string;
    sourceRoot?: string | null;
    versionNum?: string | null;
    fileName?: string | null;
  }) {
    return getLensRepository().syncLensFileBinding(lensId, request);
  },

  async deleteLensFileBinding(lensId: string, bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo', versionNum?: string | null) {
    return getLensRepository().deleteLensFileBinding(lensId, bindingType, versionNum);
  },

  async updateReworkRecord(request: {
    lensId: string;
    eventId: string;
    note?: string;
    keepAttachmentIds?: string[];
    newImagePaths?: string[];
  }) {
    const repo = getLensRepository();
    return repo.updateReworkRecord(request as Parameters<ILensRepository['updateReworkRecord']>[0]);
  },
};

// ============================================
// 审片服务
// ============================================

export const reviewService = {
  async listReviewTasks(options?: {
    status?: ReviewTaskStatus;
    projectId?: string;
    episodeId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReviewListResponse> {
    return getReviewRepository().listReviewTasks(options);
  },

  async getReviewDetail(taskId: string): Promise<{ success: boolean; detail?: ReviewDetailPayload; error?: string }> {
    return getReviewRepository().getReviewDetail(taskId);
  },

  async createReviewComment(request: {
    taskId: string;
    commentType: ReviewCommentType;
    content: string;
    timestampInSeconds?: number;
  }): Promise<{ success: boolean; comment?: ReviewComment; error?: string }> {
    return getReviewRepository().createReviewComment(request);
  },

  async submitReviewAction(taskId: string, action: ReviewAction): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    return getReviewRepository().submitReviewAction(taskId, action);
  },

  async submitLensForReview(lensId: string): Promise<{ success: boolean; task?: ReviewTask; error?: string }> {
    return getReviewRepository().submitLensForReview(lensId);
  },

  async listReviewFeedbacks(lensId: string): Promise<ReviewFeedbackListResponse> {
    return getReviewRepository().listReviewFeedbacks(lensId);
  },

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
    return getReviewRepository().createReviewFeedback(request);
  },

  async updateReviewFeedback(feedbackId: string, request: {
    commentText?: string | null;
    frameImagePath?: string | null;
    annotatedImagePath?: string | null;
    thumbnailPath?: string | null;
    annotationDataJson?: string | null;
    drawingFrames?: CreateReviewDrawingFrameRequest[];
    decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  }): Promise<ReviewFeedbackResponse> {
    return getReviewRepository().updateReviewFeedback(feedbackId, request);
  },

  async deleteReviewFeedback(feedbackId: string): Promise<{ success: boolean; error?: string }> {
    return getReviewRepository().deleteReviewFeedback(feedbackId);
  },

  // ========== 多镜头任务管理 ==========

  async createDraftTask(request: CreateDraftTaskRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().createDraftTask(request);
  },

  async updateTask(taskId: string, request: UpdateTaskRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().updateTask(taskId, request);
  },

  async getTaskDetail(taskId: string): Promise<ReviewTaskDetailResponse> {
    return getReviewRepository().getTaskDetail(taskId);
  },

  async listProducerTasks(options?: { status?: string; projectId?: string }): Promise<ReviewTaskListResponse> {
    return getReviewRepository().listProducerTasks(options);
  },

  async addTaskShots(request: AddTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().addTaskShots(request);
  },

  async removeTaskShot(request: RemoveTaskShotRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().removeTaskShot(request);
  },

  async reorderTaskShots(request: ReorderTaskShotsRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().reorderTaskShots(request);
  },

  async submitTask(request: SubmitTaskRequest): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().submitTask(request);
  },

  async startTask(taskId: string): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().startTask(taskId);
  },

  async completeTask(taskId: string): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().completeTask(taskId);
  },

  async closeTask(taskId: string): Promise<ReviewTaskActionResponse> {
    return getReviewRepository().closeTask(taskId);
  },
};

// ============================================
// 路径映射服务
// ============================================

export const pathMappingService = {
  async listStorageRoots(): Promise<{ success: boolean; roots: StorageRoot[]; error?: string }> {
    return getPathMappingRepository().listStorageRoots();
  },

  async getClientPathMappings(): Promise<{ success: boolean; mappings: ClientPathMapping[]; error?: string }> {
    return getPathMappingRepository().getClientPathMappings();
  },

  async savePathMapping(mapping: {
    rootCode: string;
    localAbsolutePath: string;
  }): Promise<{ success: boolean; mapping?: ClientPathMapping; error?: string }> {
    return getPathMappingRepository().savePathMapping(mapping);
  },

  async deletePathMapping(rootCode: string): Promise<{ success: boolean; error?: string }> {
    return getPathMappingRepository().deletePathMapping(rootCode);
  },

  async resolveLogicalPath(rootCode: string, logicalPath: string): Promise<{ success: boolean; localPath?: string; error?: string }> {
    return getPathMappingRepository().resolveLogicalPath(rootCode, logicalPath);
  },
};
