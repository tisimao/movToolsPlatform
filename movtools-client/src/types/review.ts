/**
 * 审片类型定义
 * 
 * 本文件定义导演审片相关的所有类型：
 * - 审片任务、待审列表
 * - 评论、时间点批注
 * - 审片状态流转
 * - 多镜头任务支持
 */
import type { LensStatus } from './lens';
import type { InternalReviewStatusCode } from '../lib/internalReview';

/**
 * 审片任务状态（导演端/通用视角）
 *
 * 页面投影映射（已固化，禁止各页面各自重写一套）：
 * - pending    -> 待审
 * - in-review  -> 审阅中
 * - approved   -> 通过 (completed 的导演端投影)
 * - rejected   -> 返修 (closed 的导演端投影)
 * - closed     -> 已关闭
 *
 * 服务端真实状态与页面投影的对应关系（通过 mapServerReviewStatus 映射）：
 * - 服务端 'completed' -> 导演端显示 'approved'（通过）
 * - 服务端 'closed'    -> 导演端显示 'rejected'（返修）
 * - 其他状态名直接透传
 *
 * 注意：ReviewTaskStatus 描述的是"一轮审片任务"的进度，
 * 不要与镜头二级状态 (InternalReviewStatusCode) 混淆。
 *
 * 制片端直接消费服务端原始状态（含 completed/closed），
 * 因此该类型同时覆盖导演投影态和服务端原始态。
 */
export type ReviewTaskStatus = 'pending' | 'in-review' | 'approved' | 'rejected' | 'closed' | 'completed';

/**
 * 审片任务业务状态（制片端视角）
 *
 * 页面投影映射（已固化）：
 * - draft          -> 草稿
 * - pending-submit -> 待提交 (服务端 'ready' 的页面投影名)
 * - pending        -> 待审
 * - in-review      -> 审阅中
 * - completed      -> 已完成
 * - closed         -> 已关闭
 *
 * 制片页显示的"待提交"不是独立持久化状态，
 * 是服务端 'ready' 的页面投影，参见通信协议文档第6章。
 */
export type ProducerTaskStatus = 'draft' | 'pending-submit' | 'pending' | 'in-review' | 'completed' | 'closed';

/** 任务镜头参与类型 */
export type ReviewParticipationMode = 'review' | 'context';

/** 任务内镜头状态 */
export type TaskShotStatus = 'pending' | 'has-feedback' | 'approved' | 'changes-required';

/** 审片动作 */
export type ReviewAction = 'approve' | 'rework' | 'close';

/** 评论类型 */
export type ReviewCommentType = 'general' | 'timestamp';

/** 审片任务 - 待审列表项 */
export interface ReviewTask {
  taskId: string;
  lensId: string;
  lensCode: string;
  episodeId: string;
  episodeCode: string;
  projectId: string;
  projectName: string;
  versionNum: string;
  status: ReviewTaskStatus;
  producerStatus?: ProducerTaskStatus;
  submitterId: string;
  submitterName: string;
  submitTime: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewTime?: string;
  reviewResult?: ReviewAction;
  commentCount: number;
  latestCommentTime?: string;
  /** 服务端返回的 RowVersion 用于并发控制 */
  rowVersion?: number;
  /** 多镜头任务扩展字段 */
  shotCount?: number;
  dueTime?: string;
  updatedAtUtc?: string;
  assignedToUserId?: string;
  assignedToUserName?: string;
}

/** 审片评论 */
export interface ReviewComment {
  commentId: string;
  taskId: string;
  lensId: string;
  commentType: ReviewCommentType;
  content: string;
  timestampInSeconds?: number;
  authorId: string;
  authorName: string;
  createTime: string;
  attachments: ReviewAttachment[];
}

/** 审片评论附件 */
export interface ReviewAttachment {
  attachmentId: string;
  commentId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  createTime: string;
}

/** 审片详情payload */
export interface ReviewDetailPayload {
  task: ReviewTask;
  lensCode: string;
  versionNum: string;
  comments: ReviewComment[];
  submitterName: string;
  reviewerName?: string;
}

export interface ReviewFeedback {
  feedbackId: string;
  feedbackRoundId?: string | null;
  reviewTaskId: string;
  taskShotId?: string | null;
  lensId: string;
  lensCode: string;
  versionNum?: string | null;
  frameNumber?: number | null;
  timecode?: string | null;
  commentText?: string | null;
  decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  frameImagePath?: string | null;
  annotatedImagePath?: string | null;
  thumbnailPath?: string | null;
  annotationDataJson?: string | null;
  createdByDisplayName?: string | null;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  decisionName?: string | null;
  drawingFrames?: ReviewDrawingFrame[] | null;
}

export interface ReviewDrawingFrame {
  frameNumber?: number | null;
  timestampSeconds?: number | null;
  timecode?: string | null;
  drawingStateCode: 'DRAWN' | 'CLEAR' | string;
  drawingObjectsJson?: string | null;
}

export interface CreateReviewDrawingFrameRequest {
  frameNumber?: number | null;
  timestampSeconds?: number | null;
  timecode?: string | null;
  drawingStateCode: 'DRAWN' | 'CLEAR' | string;
  drawingObjectsJson?: string | null;
}

/** 响应类型 */
export interface ReviewListResponse {
  success: boolean;
  tasks: ReviewTask[];
  totalCount: number;
  pendingCount: number;
  inReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  error?: string;
}

export interface ReviewDetailResponse {
  success: boolean;
  detail?: ReviewDetailPayload;
  error?: string;
}

export interface ReviewCommentResponse {
  success: boolean;
  comment?: ReviewComment;
  error?: string;
}

export interface ReviewActionResponse {
  success: boolean;
  task?: ReviewTask;
  error?: string;
}

export interface ReviewFeedbackListResponse {
  success: boolean;
  feedbacks: ReviewFeedback[];
  latestFeedbackRoundId?: string | null;
  latestFeedbackAtUtc?: string | null;
  latestRound?: {
    feedbackRoundId: string;
    createdAtUtc: string;
    feedbackCount: number;
    drawingTimeline?: ReviewDrawingFrame[];
    drawingFrames: ReviewDrawingFrame[];
  } | null;
  error?: string;
}

export interface ReviewFeedbackResponse {
  success: boolean;
  feedback?: ReviewFeedback;
  error?: string;
}

/** 服务端审片任务响应（直接映射） */
export interface ReviewTaskResponse {
  id: string;
  lensId?: string;
  lensCode?: string;
  lensName?: string;
  episodeId?: string;
  episodeCode?: string;
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  versionNum?: string;
  status: string;
  producerStatus?: ProducerTaskStatus;
  resultComment?: string;
  reviewerId?: string;
  reviewerName?: string;
  assignedToUserId?: string;
  assignedToUserName?: string;
  createdByUserId: string;
  createdByUserName: string;
  rowVersion: number;
  submittedAtUtc?: string;
  completedAtUtc?: string;
  dueAtUtc?: string;
  createdAtUtc?: string;
  updatedAtUtc?: string;
  commentCount: number;
  shotCount?: number;
  dueTime?: string;
  shots?: Array<{
    id: string;
    lensId: string;
    lensCode: string;
    sequence: number;
    submitVersionNum?: string | null;
    playVersionNum?: string | null;
  }>;
  summary?: {
    shotCount: number;
  };
  // 兼容字段
  submitterId?: string;
  submitterName?: string;
  submitTime?: string;
  reviewTime?: string;
  reviewResult?: string;
  latestCommentTime?: string;
}

/** 服务端审片评论响应（直接映射） */
export interface ReviewCommentResponse {
  id: string;
  reviewTaskId: string;
  authorId?: string;
  authorName?: string;
  createdByUserId?: string;
  createdByUserName?: string;
  content: string;
  timestampSeconds?: number;
  createTime?: string;
  createdAtUtc?: string;
}

// ============================================
// 多镜头审片任务类型（制片内部提审链路）
// ============================================

/** 任务内镜头项 */
export interface ReviewTaskShot {
  taskShotId: string;
  taskId: string;
  shotId: string;
  lensCode: string;
  sortOrder: number;
  participationMode?: ReviewParticipationMode | null;
  reviewParticipationMode?: ReviewParticipationMode;
  submitVersionNum?: string | null;
  actualVersionNum?: string | null;
  feedbackCount: number;
  status: TaskShotStatus;
  internalReviewStatusCode?: InternalReviewStatusCode | null;
  internalReviewStatusName?: string | null;
  lastFeedbackAtUtc?: string | null;
  hasPlayableMedia?: boolean;
}

/** 扩展的审片任务详情（包含镜头队列） */
export interface ReviewTaskDetail {
  taskId: string;
  taskName?: string | null;
  projectId: string;
  projectName?: string | null;
  episodeId?: string | null;
  episodeCode?: string | null;
  directorId?: string | null;
  directorName?: string | null;
  submitterId: string;
  submitterName?: string | null;
  status: ReviewTaskStatus;
  producerStatus?: ProducerTaskStatus;
  description?: string | null;
  deadlineUtc?: string | null;
  submitTime?: string | null;
  startTime?: string | null;
  completeTime?: string | null;
  closeTime?: string | null;
  shots: ReviewTaskShot[];
  totalShots: number;
  feedbackShotCount: number;
  approvedShotCount: number;
  updatedAtUtc?: string | null;
  createdAtUtc: string;
}

/** 创建草稿任务请求 */
export interface CreateDraftTaskRequest {
  projectId: string;
  episodeId?: string | null;
  taskName?: string | null;
  directorId?: string | null;
  description?: string | null;
  deadlineUtc?: string | null;
  shotIds?: string[];
  shots?: CreateReviewTaskShotRequest[];
}

/** 创建任务镜头请求 */
export interface CreateReviewTaskShotRequest {
  lensId: string;
  sequence: number;
  submitVersionNum?: string | null;
  participationMode: ReviewParticipationMode;
}

/** 更新任务请求 */
export interface UpdateTaskRequest {
  taskName?: string | null;
  directorId?: string | null;
  description?: string | null;
  deadlineUtc?: string | null;
  shots?: CreateReviewTaskShotRequest[];
}

/** 添加镜头到任务请求 */
export interface AddTaskShotsRequest {
  taskId: string;
  shotIds: string[];
  shots?: CreateReviewTaskShotRequest[];
}

/** 移除任务镜头请求 */
export interface RemoveTaskShotRequest {
  taskId: string;
  taskShotId: string;
}

/** 重排镜头顺序请求 */
export interface ReorderTaskShotsRequest {
  taskId: string;
  shotIds: string[];
}

/** 提交任务请求 */
export interface SubmitTaskRequest {
  taskId: string;
}

/** 任务基础信息响应 */
export interface ReviewTaskSummary {
  taskId: string;
  taskName?: string | null;
  projectId: string;
  projectName?: string | null;
  episodeId?: string | null;
  episodeCode?: string | null;
  directorId?: string | null;
  directorName?: string | null;
  submitterId: string;
  submitterName?: string | null;
  status: ReviewTaskStatus;
  producerStatus?: ProducerTaskStatus;
  shotCount: number;
  feedbackShotCount: number;
  approvedShotCount: number;
  deadlineUtc?: string | null;
  submitTime?: string | null;
  updatedAtUtc?: string | null;
  createdAtUtc: string;
  description?: string | null;
}

/** 任务列表响应 */
export interface ReviewTaskListResponse {
  success: boolean;
  tasks: ReviewTaskSummary[];
  totalCount: number;
  error?: string;
}

/** 任务详情响应 */
export interface ReviewTaskDetailResponse {
  success: boolean;
  detail?: ReviewTaskDetail;
  error?: string;
}

/** 任务基础操作响应 */
export interface ReviewTaskActionResponse {
  success: boolean;
  task?: ReviewTaskSummary;
  error?: string;
}
