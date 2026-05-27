/**
 * Repository 类型定义
 * 
 * 本文件定义所有数据仓储的接口契约，用于分离本地与远程数据源。
 */
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from '../types/project';
import type { LensDetailPayload, LensListResponse, LensRecord, LensStatus, LensStatusAction, MakerMatchStatus } from '../types/lens';
import type { ApplyProjectInitializationRequest, ApplyProjectInitializationResponse, LensMutationResponse, ProjectInitializationResult, UpdateReworkRecordRequest } from '../types/ipc';
import type { ReviewDetailPayload, ReviewListResponse, ReviewTask, ReviewTaskStatus, ReviewAction, ReviewComment, ReviewCommentType, ReviewFeedback, ReviewFeedbackListResponse, ReviewFeedbackResponse, ReviewTaskDetail, ReviewTaskListResponse, ReviewTaskDetailResponse, ReviewTaskActionResponse, CreateDraftTaskRequest, UpdateTaskRequest, AddTaskShotsRequest, RemoveTaskShotRequest, ReorderTaskShotsRequest, SubmitTaskRequest, CreateReviewDrawingFrameRequest } from '../types/review';

/**
 * 数据源类型
 */
export type DataSourceType = 'local' | 'remote';

/**
 * 项目仓储接口
 */
export interface IProjectRepository {
  /** 获取工作空间（所有项目 + 激活状态）*/
  getWorkspace(): Promise<ProjectWorkspace>;
  
  /** 获取单个项目详情 */
  getProject(projectId: string): Promise<ProjectSummary | null>;
  
  /** 获取项目下的所有集 */
  listEpisodes(projectId: string): Promise<{ success: boolean; episodes: EpisodeSummary[]; activeProjectId: string | null; activeEpisodeId: string | null; error?: string }>;
  
  /** 创建项目 */
  createProject(request: {
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
  }): Promise<{ success: boolean; project?: ProjectSummary; initialEpisode?: EpisodeSummary | null; workspace?: ProjectWorkspace; initResult?: ProjectInitializationResult; message?: string; error?: string }>;

  /** 应用项目初始化后的本地文件动作 */
  applyInitialization(request: ApplyProjectInitializationRequest): Promise<ApplyProjectInitializationResponse>;
  
  /** 打开已有项目 */
  openProject(projectRootPath: string): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }>;
  
  /** 设为当前项目 */
  setActiveProject(projectId: string, options?: {
    projectRootPath?: string;
  }): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }>;
  
  /** 创建集 */
  createEpisode(request: {
    projectId: string;
    episodeCode: string;
    episodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
  }): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; episodes?: EpisodeSummary[]; error?: string }>;
  
  /** 设为当前集 */
  setActiveEpisode(episodeId: string): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; error?: string }>;
  
  /** 删除项目 */
  deleteProject(projectId: string, removeFiles?: boolean): Promise<{ success: boolean; workspace?: ProjectWorkspace; error?: string }>;
}

/**
 * 镜头仓储接口
 * 
 * 注意：客户端支持本地模式（旧版，基于 lensId）和远程模式（新版，基于 projectCode/lensCode）
 * 远程模式下，lensCode 作为标识符，同时需要 episodeContext 来定位资源
 */
export interface ILensRepository {
  /** 获取镜头列表 */
  listLenses(): Promise<LensListResponse>;
  
  /** 获取镜头详情 */
  getLensDetail(lensId: string): Promise<{ success: boolean; detail?: LensDetailPayload; error?: string }>;
  
  /** 创建镜头 */
  createLens(request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }): Promise<LensMutationResponse>;
  
  /** 更新镜头 */
  updateLens(lensId: string, request: {
    lensCode: string;
    sceneNo?: number;
    lensName?: string;
    singleFrame: number;
    maker?: string;
    makerUserId?: string | null;
    makerNameRaw?: string | null;
    makerMatchStatus?: MakerMatchStatus;
    note?: string;
    lensStatus: LensStatus;
    versionTag?: string;
    versionNum?: string;
    fileName?: string;
  }): Promise<LensMutationResponse>;
  
  /** 更新镜头状态 */
  updateLensStatus(lensId: string, action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse>;

  /** 上传返修图片到服务端 */
  uploadRepairAttachment(lensId: string, filePath: string, sortOrder: number, lensStatusHistoryId?: string | null): Promise<LensMutationResponse>;

  /** 更新镜头二级状态 */
  updateInternalReviewStatus(lensId: string, targetStatusCode: import('../lib/internalReview').InternalReviewStatusCode, note?: string): Promise<LensMutationResponse>;
  
  /** 批量更新状态 */
  batchUpdateLensStatus(lensIds: string[], action: LensStatusAction, note?: string, imagePaths?: string[]): Promise<LensMutationResponse>;
  
  /** 删除镜头 */
  deleteLens(lensId: string): Promise<LensMutationResponse>;
  
  /** 批量删除镜头 */
  batchDeleteLenses(lensIds: string[]): Promise<LensMutationResponse>;
  
  /** 导入镜��� */
  importLenses(filePath: string): Promise<LensMutationResponse>;
  
  /** 导出问题报告 */
  exportIssueReport(lensIds: string[], mode?: 'all-issues' | 'missing-layout'): Promise<{ success: boolean; filePath?: string; exportedCount?: number; error?: string }>;

  /** 同步文件绑定 */
  syncLensFileBinding(lensId: string, request: {
    bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo';
    relativePath: string;
    sourceRoot?: string | null;
    versionNum?: string | null;
    fileName?: string | null;
  }): Promise<LensMutationResponse>;

  /** 删除文件绑定 */
  deleteLensFileBinding(lensId: string, bindingType: 'ma' | 'mov' | 'layout' | 'layoutVideo', versionNum?: string | null): Promise<LensMutationResponse>;

  /** 更新返修记录 */
  updateReworkRecord(request: UpdateReworkRecordRequest): Promise<LensMutationResponse>;
}

/**
 * 冲突错误类型
 */
export interface ConflictError {
  code: 'CONFLICT';
  message: string;
  currentVersion?: number;
  serverVersion?: number;
  refreshCallback?: () => Promise<void>;
}

/**
 * 检查是否是冲突错误
 */
export function isConflictError(error: unknown): error is ConflictError {
  return typeof error === 'object' && error !== null && 'code' in error && (error as Record<string, unknown>).code === 'CONFLICT';
}

/**
 * 审片仓储接口
 */
export interface IReviewRepository {
  /** 获取待审列表 */
  listReviewTasks(options?: {
    status?: ReviewTaskStatus;
    projectId?: string;
    episodeId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReviewListResponse>;
  
  /** 获取审片详情 */
  getReviewDetail(taskId: string): Promise<{ success: boolean; detail?: ReviewDetailPayload; error?: string }>;
  
  /** 创建审片评论 */
  createReviewComment(request: {
    taskId: string;
    commentType: ReviewCommentType;
    content: string;
    timestampInSeconds?: number;
  }): Promise<{ success: boolean; comment?: ReviewComment; error?: string }>;
  
  /** 提交审片动作（通过/返修/关闭） */
  submitReviewAction(taskId: string, action: ReviewAction): Promise<{ success: boolean; task?: ReviewTask; error?: string }>;
  
  /** 将镜头提交到待审 */
  submitLensForReview(lensId: string): Promise<{ success: boolean; task?: ReviewTask; error?: string }>;

  listReviewFeedbacks(lensId: string): Promise<ReviewFeedbackListResponse>;

  createReviewFeedback(request: {
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
  }): Promise<ReviewFeedbackResponse>;

  updateReviewFeedback(feedbackId: string, request: {
    commentText?: string | null;
    frameImagePath?: string | null;
    annotatedImagePath?: string | null;
    thumbnailPath?: string | null;
    annotationDataJson?: string | null;
    drawingFrames?: CreateReviewDrawingFrameRequest[];
    decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  }): Promise<ReviewFeedbackResponse>;

  deleteReviewFeedback(feedbackId: string): Promise<{ success: boolean; error?: string }>;

  // ========== 多镜头任务管理（制片内部提审链路） ==========

  /** 创建草稿任务 */
  createDraftTask(request: CreateDraftTaskRequest): Promise<ReviewTaskActionResponse>;

  /** 更新任务基础信息 */
  updateTask(taskId: string, request: UpdateTaskRequest): Promise<ReviewTaskActionResponse>;

  /** 获取任务详情（含镜头队列） */
  getTaskDetail(taskId: string): Promise<ReviewTaskDetailResponse>;

  /** 获取制片视角的任务列表 */
  listProducerTasks(options?: {
    status?: string;
    projectId?: string;
  }): Promise<ReviewTaskListResponse>;

  /** 添加镜头到任务 */
  addTaskShots(request: AddTaskShotsRequest): Promise<ReviewTaskActionResponse>;

  /** 从任务移除镜头 */
  removeTaskShot(request: RemoveTaskShotRequest): Promise<ReviewTaskActionResponse>;

  /** 重排任务镜头顺序 */
  reorderTaskShots(request: ReorderTaskShotsRequest): Promise<ReviewTaskActionResponse>;

  /** 提交任务给导演 */
  submitTask(request: SubmitTaskRequest): Promise<ReviewTaskActionResponse>;

  /** 导演开始任务 */
  startTask(taskId: string): Promise<ReviewTaskActionResponse>;

  /** 导演完成任务 */
  completeTask(taskId: string): Promise<ReviewTaskActionResponse>;

  /** 关闭任务 */
  closeTask(taskId: string): Promise<ReviewTaskActionResponse>;
}

/**
 * 路径映射仓储接口
 */
export interface IPathMappingRepository {
  /** 获取所有路径根 */
  listStorageRoots(): Promise<{ success: boolean; roots: StorageRoot[]; error?: string }>;
  
  /** 获取本机路径映射 */
  getClientPathMappings(): Promise<{ success: boolean; mappings: ClientPathMapping[]; error?: string }>;
  
  /** 保存路径映射 */
  savePathMapping(mapping: {
    rootCode: string;
    localAbsolutePath: string;
  }): Promise<{ success: boolean; mapping?: ClientPathMapping; error?: string }>;
  
  /** 删除路径映射 */
  deletePathMapping(rootCode: string): Promise<{ success: boolean; error?: string }>;
  
  /** 解析逻辑路径到本地路径 */
  resolveLogicalPath(rootCode: string, logicalPath: string): Promise<{ success: boolean; localPath?: string; error?: string }>;
}

/**
 * 存储根
 */
export interface StorageRoot {
  rootId: string;
  rootCode: string;
  rootLabel: string;
  description?: string;
  createdAt: string;
  isActive?: boolean;
}

/**
 * 客户端节点
 */
export interface ClientNode {
  id: string;
  clientId: string;
  clientName: string;
  machineName?: string;
  isActive: boolean;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 客户端路径映射
 */
export interface ClientPathMapping {
  mappingId: string;
  clientNodeId: string;
  rootCode: string;
  localAbsolutePath: string;
  createdAt: string;
  updatedAt: string;
}
