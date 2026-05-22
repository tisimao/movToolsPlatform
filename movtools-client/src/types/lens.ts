/**
 * 镜头类型定义
 * 
 * 本文件定义镜头相关的所有类型：
 * - 镜头状态、资产类型
 * - 版本绑定、版本问题
 * - 生命周期事件
 * - 列表响应、详情响应
 */
import type { LayoutReferenceCheckRecord, LayoutReferenceCheckStatus, LensLayoutCandidate } from './fileCheck';
import type { InternalReviewStatusCode } from '../lib/internalReview';

/** 镜头制作状态 */
export type LensStatus = '制作' | '提交' | '返修' | '通过' | '关闭';

/** 镜头状态流转动作 */
export type LensStatusAction = 'submit' | 'approve' | 'rework' | 'close';

export type LensRecentStatusAction = LensStatusAction;

/** 镜头资产文件类型 */
export type LensAssetType = 'ma' | 'mov';
export type LensBindingType = 'ma' | 'mov' | 'layout' | 'layoutVideo';
export type MakerMatchStatus = 'matched' | 'unmatched' | 'unassigned';

export interface LensFileBindingSyncRequest {
  bindingType: LensBindingType;
  relativePath: string;
  sourceRoot?: string | null;
  versionNum?: string | null;
  fileName?: string | null;
}

export interface LensFileBindingSyncResponse {
  bindingId: string;
  lensId: string;
  lensCode: string;
  bindingType: LensBindingType;
  relativePath: string;
  sourceRoot?: string | null;
  versionNum?: string | null;
  fileName?: string | null;
  bindTime: string;
}

/** 镜头版本问题描述 */
export interface LensVersionIssue {
  fileType: LensAssetType;
  reason: '未绑定' | '文件缺失' | '多候选待确认' | '帧数不匹配';
  message: string;
  candidatePaths?: string[];
}

/** 镜头版本匹配候选文件 */
export interface LensVersionMatchCandidate {
  fileName: string;
  relativePath: string;
  absolutePath: string;
  sourceRoot: string;
  score: number;
  extractedVersion?: number;
}

/** 镜头版本匹配调试信息 */
export interface LensVersionMatchDebug {
  fileType: LensAssetType;
  versionNum: string;
  scanRoots: string[];
  scannedFileCount: number;
  relatedFileCount: number;
  candidateCount: number;
  note: string;
  relatedFiles: LensVersionMatchCandidate[];
  candidates: LensVersionMatchCandidate[];
}

/** 镜头版本文件绑定记录 */
export interface LensVersionBinding {
  fileId: string;
  bindingId?: string;
  lensId?: string;
  lensCode: string;
  versionNum: string;
  fileType: LensAssetType;
  bindingType?: LensBindingType;
  fileName?: string;
  relativePath: string;
  bindTime: string;
  absolutePath: string;
  exists: boolean;
  sourceRoot?: string;
  mediaPreviewUrl?: string;
  mediaDurationSeconds?: number;
  mediaFrameCount?: number;
  mediaFps?: number;
   mediaWidth?: number;
   mediaHeight?: number;
   mediaCodecName?: string;
  mediaCodecLongName?: string;
  mediaCodecProfile?: string;
  mediaPixelFormat?: string;
  mediaPreviewMode?: 'direct' | 'proxy' | 'pending';
  mediaPreviewNote?: string;
  mediaPreviewProgressPercent?: number;
}

/** 镜头生命周期事件记录 */
export interface LensLifecycleEvent {
  eventId: string;
  lensId: string;
  eventType: '创建' | '基础信息更新' | '状态流转' | '文件绑定';
  title: string;
  detail: string;
  fromStatus?: LensStatus;
  toStatus?: LensStatus;
  versionNum: string;
  fileName: string;
  eventTime: string;
  editable: boolean;
  reworkNote?: string;
  attachments: LensLifecycleAttachment[];
}

export interface LensLifecycleAttachment {
  attachmentId: string;
  eventId: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  previewUrl: string;
  createTime: string;
}

export interface ServerRepairAttachmentResponse {
  id: string;
  lensId: string;
  lensStatusHistoryId?: string | null;
  fileName: string;
  originalName: string;
  fileSize: number;
  sortOrder: number;
  previewUrl: string;
  createdAtUtc: string;
}

/** 镜头版本快照 - 包含特定版本的所有信息 */
export interface LensVersionSnapshot {
  versionNum: string;
  fileName: string;
  issues: LensVersionIssue[];
  bindings: LensVersionBinding[];
  matchDebug: Partial<Record<LensAssetType, LensVersionMatchDebug>>;
}

export interface LensRecord {
  lensId: string;
  episodeId: string;
  lensCode: string;       // 来自 Excel "镜头名称"
  sceneNo: number;       // 来自 Excel "场次"
  lensName: string;       // 来自 Excel "镜头名称"
  singleFrame: number;   // 来自 Excel "镜头时长（帧数）"
  maker: string;         // 来自 Excel "负责人"
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerDisplayName?: string | null;
  makerMatchStatus?: MakerMatchStatus;
  note?: string;
  lensStatus: LensStatus;
  versionTag: string;
  versionNum: string;
  fileName: string;
  updateTime: string;
  currentVersionIssues: LensVersionIssue[];
  currentVersionReady: boolean;
  currentVersionMatchedFileNames: string[];
  layoutCandidateCount: number;
  selectedLayoutFileName: string;
  selectedLayoutRelativePath: string;
  layoutReady: boolean;
  layoutVideoReady: boolean;
  layoutVideoFileName: string;
  layoutVideoRelativePath: string;
  layoutVideoAbsolutePath: string;
  layoutVideoVersionNum: string;
  layoutVideoPreviewUrl?: string;
  layoutVideoDurationSeconds?: number;
  layoutVideoFrameCount?: number;
  layoutVideoFps?: number;
   layoutVideoWidth?: number;
   layoutVideoHeight?: number;
   layoutVideoCodecName?: string;
  layoutVideoCodecLongName?: string;
  layoutVideoCodecProfile?: string;
  layoutVideoPixelFormat?: string;
  layoutVideoPreviewMode?: 'direct' | 'proxy' | 'pending';
  layoutVideoPreviewNote?: string;
  layoutVideoPreviewProgressPercent?: number;
  recentStatusAction?: LensRecentStatusAction;
  recentStatusActionLabel: string;
  recentStatusActionTime: string;
  layoutReferenceStatus: LayoutReferenceCheckStatus;
  layoutReferenceIssueCount: number;
  layoutReferenceLastCheckTime?: string;
  internalReviewStatusCode?: InternalReviewStatusCode | null;
  internalReviewStatusName?: string | null;
  internalReviewUpdatedAtUtc?: string | null;
  latestReviewTaskId?: string | null;
  latestDirectorFeedbackAtUtc?: string | null;
  pendingDirectorFeedbackCount?: number;
  submissionAllowed?: boolean;
}

export interface LensListResponse {
  success: boolean;
  lenses: LensRecord[];
  autoInitializedLensIds?: string[];
  activeProjectId: string | null;
  activeProjectName?: string;
  activeEpisodeId?: string | null;
  activeEpisodeName?: string;
  activeEpisodeCode?: string;
  episodeVersionTag?: string;
  episodeLayoutTag?: string;
  error?: string;
}

export interface LensDetailPayload {
  lens: LensRecord;
  versions: LensVersionSnapshot[];
  history: LensLifecycleEvent[];
  layoutCandidates: LensLayoutCandidate[];
  serverBindings?: ServerLensFileBindingResponse[];
  layoutReferenceCheck?: LayoutReferenceCheckRecord;
  directorFeedbacks?: LensDirectorFeedback[];
}

export interface ServerRepairAttachmentResponse {
  id: string;
  lensId: string;
  lensStatusHistoryId?: string | null;
  fileName: string;
  originalName: string;
  fileSize: number;
  sortOrder: number;
  previewUrl: string;
  createdAtUtc: string;
}

export interface LensDirectorFeedback {
  feedbackId: string;
  reviewTaskId: string;
  lensId: string;
  lensCode: string;
  versionNum?: string | null;
  frameNumber?: number | null;
  timecode?: string | null;
  commentText?: string | null;
  frameImagePath?: string | null;
  annotatedImagePath?: string | null;
  thumbnailPath?: string | null;
  annotationDataJson?: string | null;
  createdByDisplayName?: string | null;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
  decisionCode?: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | null;
  decisionName?: string | null;
}

export interface LensDetailResponse {
  success: boolean;
  detail?: LensDetailPayload;
  error?: string;
}

/** 服务端镜头详情响应（直接映射） */
export interface ServerLensDetailResponse {
  lens: ServerLensResponse;
  versions: ServerLensVersionResponse[];
  fileBindings: ServerLensFileBindingResponse[];
  layoutCandidates: ServerLayoutCandidateResponse[];
  currentLayout: ServerLayoutInfoResponse | null;
  layoutReferenceCheck: ServerLayoutReferenceCheckResponse | null;
}

export interface ServerLensResponse {
  id: string;
  code: string;
  name: string;
  episodeId: string;
  status: string;
  sequence: number;
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerDisplayName?: string | null;
  makerMatchStatus?: MakerMatchStatus;
  description?: string | null;
  rootCode?: string | null;
  logicalPath?: string | null;
  versionTag?: string | null;
  versionNum?: string;
  layoutTag?: string | null;
  comment?: string | null;
  internalReviewStatusCode?: import('../lib/internalReview').InternalReviewStatusCode | null;
  internalReviewStatusName?: string | null;
  internalReviewUpdatedAtUtc?: string | null;
  latestReviewTaskId?: string | null;
  latestDirectorFeedbackAtUtc?: string | null;
  pendingDirectorFeedbackCount?: number;
  submissionAllowed?: boolean;
  isArchived: boolean;
  rowVersion: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  singleFrame?: number;
}

export interface ServerLensVersionResponse {
  versionNum: string;
  fileName?: string | null;
  logicalPath?: string | null;
  issues: ServerVersionIssueResponse[];
}

export interface ServerVersionIssueResponse {
  issueType: string;
  description: string;
  filePath?: string | null;
}

export interface ServerVersionBindingResponse {
  bindingType: string;
  fileName: string;
  filePath?: string | null;
  isMatched: boolean;
}

export interface ServerLensFileBindingResponse {
  bindingId: string;
  lensId: string;
  lensCode: string;
  bindingType: LensBindingType;
  relativePath: string;
  sourceRoot?: string | null;
  versionNum?: string | null;
  fileName?: string | null;
  bindTime: string;
}

export interface ServerLayoutCandidateResponse {
  fileName: string;
  relativePath: string;
  matchedLensCode?: string | null;
  matchScore: number;
  scannedAt: string;
}

export interface ServerLayoutInfoResponse {
  fileName: string;
  relativePath: string;
  videoFileName?: string | null;
  videoRelativePath?: string | null;
  videoReady: boolean;
  selectedAt: string;
}

export interface ServerLayoutReferenceCheckResponse {
  totalReferences: number;
  validReferences: number;
  missingReferences: number;
  missingReferencePaths: string[];
}
