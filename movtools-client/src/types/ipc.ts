/**
 * IPC 类型定义与请求/响应契约
 * 
 * 本文件定义所有前端与主进程之间通信的接口类型、请求参数、响应格式，
 * 以及使用 Zod 实现的请求验证 Schema。
 * 
 * 主要模块：
 * - 任务管理：创建、执行、取消媒体处理任务
 * - 项目管理：创建、打开、删除项目和集
 * - 镜头管理：镜头 CRUD、状态更新、批量导入
 * - 文件检查：配置路径、扫描状态、绑定文件
 * - 文件提取：生成预览、执行提取、查看历史
 * - 系统设置：环境检测、配置更新
 * - 对话框：文件/目录选择、手册打开
 */
import { z } from 'zod';
import type { AppSettings } from './settings';
import type { LensDetailResponse, LensListResponse, LensRecord, LensStatus, LensStatusAction, MakerMatchStatus } from './lens';
import type { BindFileType, FileCheckStatePayload, LensBoundFile, ScanRootConfigItem } from './fileCheck';
import type { ExtractExecutionLogItem, ExtractFileSelection, ExtractHistoryResponse, ExtractPreviewResponse } from './extract';
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from './project';
import type {
  CompressTaskConfig,
  ExportFrameTaskConfig,
  ExtractAudioTaskConfig,
  MergeVideoTaskConfig,
  MediaTask,
  TaskPayload,
  TaskType,
  TranscodeTaskConfig,
  TrimTaskConfig,
} from './task';

export type { AppSettings, BindFileType, ExtractFileSelection, ExtractHistoryResponse, ExtractPreviewResponse, FileCheckStatePayload, LensDetailResponse, LensListResponse, LensRecord, LensStatus, LensStatusAction, MediaTask, TaskPayload, TaskType };
export type { EpisodeSummary, ProjectSummary, ProjectWorkspace };

// ============================================
// 任务配置 Schema - 定义各类媒体处理任务的参数结构
// ============================================

/** 转码任务配置 */
const transcodeTaskConfigSchema = z.object({
  format: z.enum(['mp4', 'mov', 'webm']),
  videoCodec: z.enum(['h264', 'hevc', 'vp9']),
  resolution: z.enum(['source', '1080p', '720p', 'custom']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.union([z.literal('source'), z.literal(24), z.literal(30), z.literal(60)]),
  rateMode: z.enum(['crf', 'bitrate']),
  crf: z.number().min(0).max(51).optional(),
  bitrateKbps: z.number().int().positive().optional(),
  audioCodec: z.enum(['aac', 'mp3', 'copy']).optional(),
}) satisfies z.ZodType<TranscodeTaskConfig>;

/** 提取音频任务配置 */
const extractAudioTaskConfigSchema = z.object({
  format: z.enum(['mp3', 'aac', 'wav']),
  bitrateKbps: z.number().int().positive().optional(),
}) satisfies z.ZodType<ExtractAudioTaskConfig>;

/** 视频裁剪任务配置 */
const trimTaskConfigSchema = z.object({
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  reencode: z.boolean(),
}) satisfies z.ZodType<TrimTaskConfig>;

/** 视频压缩任务配置 */
const compressTaskConfigSchema = z.object({
  preset: z.enum(['high-quality', 'balanced', 'small-size']),
}) satisfies z.ZodType<CompressTaskConfig>;

/** 导出帧任务配置 */
const exportFrameTaskConfigSchema = z.object({
  mode: z.enum(['single', 'interval']),
  time: z.string().optional(),
  intervalSeconds: z.number().int().positive().optional(),
  imageFormat: z.enum(['jpg', 'png']),
}) satisfies z.ZodType<ExportFrameTaskConfig>;

/** 视频拼接任务配置 */
const mergeVideoTaskConfigSchema = z.object({
  inputPaths: z.array(z.string().min(1)).min(2),
  mode: z.enum(['fast', 'compatible']),
  upscaleMode: z.enum(['pad', 'stretch']),
  overlayTexts: z.array(z.string()).optional(),
  overlayStyle: z.object({
    position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    fontSize: z.number().int().min(16).max(96),
    fontColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    fontOpacity: z.number().int().min(0).max(100),
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    backgroundOpacity: z.number().int().min(0).max(100),
    boxPadding: z.number().int().min(0).max(64),
    offsetX: z.number().int().min(0).max(200),
    offsetY: z.number().int().min(0).max(200),
  }).optional(),
  outputName: z.string().min(1),
  outputFormat: z.literal('mp4'),
}) satisfies z.ZodType<MergeVideoTaskConfig>;

/** 任务载荷联合类型 - 支持多种任务类型 */
const taskPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('merge-video'), config: mergeVideoTaskConfigSchema }),
  z.object({ type: z.literal('transcode'), config: transcodeTaskConfigSchema }),
  z.object({ type: z.literal('extract-audio'), config: extractAudioTaskConfigSchema }),
  z.object({ type: z.literal('trim'), config: trimTaskConfigSchema }),
  z.object({ type: z.literal('compress'), config: compressTaskConfigSchema }),
  z.object({ type: z.literal('export-frame'), config: exportFrameTaskConfigSchema }),
]) satisfies z.ZodType<TaskPayload>;

// ============================================
// 任务相关接口定义
// ============================================

/** 单个任务项的创建参数 */
export interface CreateTaskItem {
  inputPath: string;      // 输入文件路径
  outputDir: string;      // 输出目录
  payload: TaskPayload;   // 任务类型及其配置
  mergeLensCodes?: string[]; // 拼接任务时的镜头编号列表
}

/** 批量创建任务的请求参数 */
export interface CreateTaskRequest {
  items: CreateTaskItem[];
}

/** 创建任务的响应结果 */
export interface CreateTaskResponse {
  success: boolean;
  taskIds: string[];      // 成功创建的任务 ID 列表
  error?: string;
}

/** 取消任务的请求参数 */
export interface CancelTaskRequest {
  taskId: string;
}

/** 任务操作（重试/移除/打开日志等）的请求参数 */
export interface TaskActionRequest {
  taskId: string;
}

/** 任务操作的响应结果 */
export interface TaskActionResponse {
  success: boolean;
  error?: string;
}

// ============================================
// 系统设置与环境相关接口
// ============================================

/** 设置验证结果 */
export interface SettingsValidationResult {
  success: boolean;
  error?: string;
}

export interface PreviewCacheCleanupResponse {
  success: boolean;
  removedFileCount: number;
  error?: string;
}

export interface AppInfo {
  name: string;
  version: string;
}

/** 运行时依赖（FFmpeg/FFprobe）的状态 */
export interface RuntimeDependencyStatus {
  path: string;           // 实际路径
  available: boolean;     // 是否可用
  error?: string;         // 错误信息
}

export interface EnvironmentStatus {
  isReady: boolean;
  ffmpeg: RuntimeDependencyStatus;
  ffprobe: RuntimeDependencyStatus;
  hasDefaultOutputDir: boolean;
  defaultOutputDir: string;
  defaultOutputDirWritable: boolean;
  defaultOutputDirError?: string;
  recommendations: string[];
  setupState?: 'idle' | 'detected' | 'installing' | 'installed' | 'failed';
  setupMessage?: string;
}

export interface TaskUpdatedEvent {
  task: MediaTask;
}

export interface TaskLogAppendedEvent {
  taskId: string;
  chunk: string;
}

export interface TaskLogsResponse {
  logs: Record<string, string[]>;
}

export interface FileCheckProgressEvent {
  mode: 'all' | 'layout' | 'reference';
  phase: 'started' | 'scanning' | 'matching' | 'writing' | 'completed' | 'failed';
  message: string;
  current?: number;
  total?: number;
  logLine?: string;
  success?: boolean;
}

export interface ExtractProgressEvent {
  phase: 'started' | 'preparing' | 'copying' | 'completed' | 'failed';
  message: string;
  current?: number;
  total?: number;
  logLine?: string;
  lensCode?: string;
  fileType?: BindFileType;
  success?: boolean;
}

export type ManualDocument = 'usage' | 'testing';

export interface DialogFileFilter {
  name: string;
  extensions: string[];
}

export interface DialogPickFileOptions {
  title?: string;
  filters?: DialogFileFilter[];
  defaultPath?: string;
}

export interface FileExistsRequest {
  path: string;
}

export interface FileExistsResponse {
  success: boolean;
  exists: boolean;
  error?: string;
}

export interface ReadFileBase64Response {
  success: boolean;
  fileName?: string;
  mimeType?: string;
  base64?: string;
  error?: string;
}

export interface SavePastedImageRequest {
  dataUrl: string;
}

export interface SaveAnnotationImageRequest {
  dataUrl: string;
  shotId: string;
  frameNumber: number;
}

export interface SaveAnnotationImageResponse {
  success: boolean;
  localPath?: string;
  error?: string;
}

export type UpdateSettingsRequest = Partial<AppSettings>;

export interface CreateProjectRequest {
  projectName: string;
  projectRootPath: string;
  /** 项目默认帧率；未填写时默认按 30 处理 */
  projectDefaultFps?: number;
  initialEpisodeCode?: string;
  initialEpisodeName?: string;
  /** 初始化 Excel 文件路径（可选）；指定后会在创建项目时自动导入首集镜头底表 */
  initExcelPath?: string;
  /** 首集镜头文件根目录；系统会按镜头名称创建同名空文件夹 */
  lensFolderRootPath?: string;
  /** 首集 layout Maya 根目录；后续会按当前集在该目录中扫描 layout 文件 */
  layoutCheckPath?: string;
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
  members?: Array<{
    userId: string;
    projectRoleCode: string;
  }>;
  memberUserIds?: string[];
}

export interface CreateEpisodeRequest {
  projectId: string;
  episodeCode: string;
  episodeName?: string;
  initExcelPath?: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
}

export interface ApplyProjectInitializationRequest {
  projectId?: string;
  episodeId?: string;
  episodeCode?: string;
  episodeName?: string;
  versionTag?: string;
  layoutTag?: string;
  pendingClientActions?: ProjectClientAction[];
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
  lensFolderPlans?: ProjectLensFolderPlan[];
  lensSyncItems?: ProjectLensSyncRequest[];
}

export interface ProjectLensSyncRequest {
  lensId?: string;
  code: string;
  name: string;
  sequence: number;
  singleFrame?: number;
  lensStatus?: LensStatus;
  maker?: string | null;
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerMatchStatus?: MakerMatchStatus;
  description?: string | null;
  rootCode?: string | null;
  logicalPath?: string | null;
  versionTag?: string | null;
  layoutTag?: string | null;
}

export interface PrepareProjectInitializationRequest {
  initExcelPath?: string;
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
}

export interface PrepareProjectInitializationResponse {
  success: boolean;
  initResult: ProjectInitializationResult;
  preparedLensSyncItems: ProjectLensSyncRequest[];
  error?: string;
}

export interface OpenProjectRequest {
  projectRootPath: string;
}

export interface SetActiveProjectRequest {
  projectId: string;
}

export interface SetActiveEpisodeRequest {
  episodeId: string;
}

export interface DeleteProjectRequest {
  projectId: string;
  removeFiles?: boolean;
}

export type ProjectInitializationStatus = 'not_requested' | 'skipped' | 'success' | 'partial_success' | 'failed';

export type ProjectClientAction = 'create_lens_folders' | 'refresh_local_episode_workspace';

export interface ProjectLensFolderPlan {
  lensId?: string;
  lensCode: string;
  lensName?: string;
  rootPath: string;
  folderName: string;
}

export interface ProjectInitializationResult {
  status: ProjectInitializationStatus;
  message: string;
  excelImportAttempted: boolean;
  excelImportSuccess: boolean;
  createdLensCount?: number;
  lensFoldersPlanned?: number;
  lensFoldersCreated?: number;
  pendingClientActions?: ProjectClientAction[];
  errors?: string[];
}

export interface ProjectMutationResponse {
  success: boolean;
  project?: ProjectSummary;
  initialEpisode?: EpisodeSummary | null;
  workspace?: ProjectWorkspace;
  initResult?: ProjectInitializationResult;
  message?: string;
  error?: string;
}

export interface EpisodeListResponse {
  success: boolean;
  episodes: EpisodeSummary[];
  activeProjectId: string | null;
  activeEpisodeId: string | null;
  error?: string;
}

export interface EpisodeMutationResponse {
  success: boolean;
  episode?: EpisodeSummary;
  workspace?: ProjectWorkspace;
  episodes?: EpisodeSummary[];
  initResult?: ProjectInitializationResult;
  message?: string;
  error?: string;
}

export interface CreateLensRequest {
  lensCode: string;     // 来自 Excel "镜头名称"
  sceneNo?: number;     // 来自 Excel "场次"
  lensName?: string;    // 来自 Excel "镜头名称"（默认等于 lensCode）
  singleFrame: number;  // 来自 Excel "镜头时长（帧数）"
  maker?: string;        // 来自 Excel "负责人"
  makerUserId?: string | null;
  makerNameRaw?: string | null;
  makerMatchStatus?: MakerMatchStatus;
  note?: string;
  lensStatus: LensStatus;
  versionTag?: string;
  versionNum?: string;
  fileName?: string;
}

export interface UpdateLensRequest extends CreateLensRequest {
  lensId: string;
}

export interface UpdateLensStatusRequest {
  lensId: string;
  action: LensStatusAction;
  note?: string;
  imagePaths?: string[];
}

export interface BatchUpdateLensStatusRequest {
  lensIds: string[];
  action: LensStatusAction;
  note?: string;
  imagePaths?: string[];
}

export interface UpdateReworkRecordRequest {
  lensId: string;
  eventId: string;
  note?: string;
  keepAttachmentIds?: string[];
  newImagePaths?: string[];
}

export interface BatchUpdateLensVersionTagRequest {
  versionTag: string;
}

export interface DeleteLensRequest {
  lensId: string;
}

export interface GetLensDetailRequest {
  lensId: string;
}

export interface BatchDeleteLensRequest {
  lensIds: string[];
}

export interface BatchImportLensRequest {
  filePath: string;
}

export interface ExportLensIssueReportRequest {
  lensIds: string[];
  mode?: 'all-issues' | 'missing-layout';
}

export interface LensMutationResponse {
  success: boolean;
  lens?: LensRecord;
  binding?: LensBoundFile;
  importedCount?: number;
  affectedCount?: number;
  error?: string;
}

export interface ExportLensIssueReportResponse {
  success: boolean;
  filePath?: string;
  exportedCount?: number;
  error?: string;
}

export interface FileCheckConfigRequest {
  layoutTag: string;
  lensRoots: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
}

export interface SelectLayoutCandidateRequest {
  lensCode: string;
  candidateId: string;
}

export interface AddLayoutCandidateRequest {
  lensCode: string;
  filePath: string;
  selectAfterAdd?: boolean;
}

export interface AddLayoutVideoBindingRequest {
  lensCode: string;
  candidateId: string;
  filePath: string;
}

export interface ScanSingleLensFileCheckRequest {
  lensId: string;
}

export interface ScanSingleLensLayoutReferenceRequest {
  lensId: string;
}

export interface RefreshLensBindingsRequest {
  lensIds: string[];
}

export interface ExportLayoutReferenceReportRequest {
  onlyWithIssues?: boolean;
  issueType?: 'all' | '路径不存在' | '路径存在但文件不存在' | '路径存在但文件名不匹配';
}

export interface BindLensFileRequest {
  lensCode: string;
  versionNum: string;
  fileType: BindFileType;
  filePath: string;
}

export interface FileCheckMutationResponse {
  success: boolean;
  error?: string;
  binding?: LensBoundFile;
  initializedLensFrames?: Array<{
    lensId: string;
    singleFrame: number;
  }>;
}

export interface ApplyProjectInitializationResponse {
  success: boolean;
  initResult: ProjectInitializationResult;
  executedClientActions?: ProjectClientAction[];
  error?: string;
}

export interface ExportLayoutReferenceReportResponse {
  success: boolean;
  filePath?: string;
  exportedCount?: number;
  error?: string;
}

export interface GenerateExtractPreviewRequest {
  lensCode?: string;
  maker?: string;
  lensStatus?: LensStatus | '';
  versionNum?: string;
  fileSelection: ExtractFileSelection;
}

export interface ExecuteExtractRequest {
  previewId: string;
  targetPath: string;
}

export interface ExtractActionResponse {
  success: boolean;
  error?: string;
  fileTotal?: number;
  successCount?: number;
  failedCount?: number;
  maFileNum?: number;
  movFileNum?: number;
  logs?: ExtractExecutionLogItem[];
  manifestPath?: string;
}

export interface ResolveLensLocalPreviewRequest {
  movBindings: Array<{
    fileId: string;
    absolutePath: string;
    exists?: boolean;
  }>;
  layoutVideoAbsolutePath?: string;
  forceProxyPreviewTargets?: Array<'production' | 'layout'>;
}

export interface ResolvedVideoPreviewPayload {
  previewUrl?: string;
  durationSeconds?: number;
  frameCount?: number;
  fps?: number;
  width?: number;
  height?: number;
  codecName?: string;
  codecLongName?: string;
  codecProfile?: string;
  pixelFormat?: string;
  previewMode?: 'direct' | 'proxy' | 'pending';
  previewNote?: string;
  previewProgressPercent?: number;
}

export interface ResolveLensLocalPreviewResponse {
  success: boolean;
  movBindings: Array<ResolvedVideoPreviewPayload & { fileId: string }>;
  layoutVideo?: ResolvedVideoPreviewPayload;
  error?: string;
}

export const createTaskRequestSchema = z.object({
  items: z.array(
    z.object({
      inputPath: z.string().min(1),
      outputDir: z.string().min(1),
      payload: taskPayloadSchema,
      mergeLensCodes: z.array(z.string().min(1)).optional(),
    }),
  ),
}) satisfies z.ZodType<CreateTaskRequest>;

export const updateSettingsSchema = z.object({
  serverBaseUrl: z.string().min(1).optional(),
  ffmpegPath: z.string().min(1).optional(),
  ffprobePath: z.string().min(1).optional(),
  defaultOutputDir: z.string().optional(),
  autoOpenOutputDir: z.boolean().optional(),
  logRetentionDays: z.number().int().positive().optional(),
});

const scanRootConfigItemSchema = z.object({
  rootId: z.string(),
  fileKind: z.union([z.literal('ma'), z.literal('mov'), z.literal('layout')]),
  label: z.string(),
  absolutePath: z.string(),
  initExcelPath: z.string().optional(),
  priority: z.number().int(),
  isEnabled: z.boolean(),
});

export const createProjectRequestSchema = z.object({
  projectName: z.string().min(1),
  projectRootPath: z.string().min(1),
  projectDefaultFps: z.number().int().positive().optional(),
  initialEpisodeCode: z.string().optional(),
  initialEpisodeName: z.string().optional(),
  initExcelPath: z.string().optional(),
  lensFolderRootPath: z.string().optional(),
  layoutCheckPath: z.string().optional(),
  lensRoots: z.array(scanRootConfigItemSchema).optional(),
  layoutRoots: z.array(scanRootConfigItemSchema).optional(),
});

export const createEpisodeRequestSchema = z.object({
  projectId: z.string().min(1),
  episodeCode: z.string().min(1),
  episodeName: z.string().optional(),
  initExcelPath: z.string().optional(),
  lensFolderRootPath: z.string().optional(),
  layoutCheckPath: z.string().optional(),
  lensRoots: z.array(scanRootConfigItemSchema).optional(),
  layoutRoots: z.array(scanRootConfigItemSchema).optional(),
});

export const applyProjectInitializationRequestSchema = z.object({
  projectId: z.string().optional(),
  episodeId: z.string().optional(),
  episodeCode: z.string().optional(),
  episodeName: z.string().optional(),
  versionTag: z.string().optional(),
  layoutTag: z.string().optional(),
  pendingClientActions: z.array(z.enum(['create_lens_folders', 'refresh_local_episode_workspace'])).optional(),
  lensRoots: z.array(scanRootConfigItemSchema).optional(),
  layoutRoots: z.array(scanRootConfigItemSchema).optional(),
  lensFolderPlans: z.array(z.object({
    lensId: z.string().optional(),
    lensCode: z.string().min(1),
    lensName: z.string().optional(),
    rootPath: z.string().min(1),
    folderName: z.string().min(1),
  })).optional(),
  lensSyncItems: z.array(z.object({
    lensId: z.string().optional(),
    code: z.string().min(1),
    name: z.string().min(1),
    sequence: z.number().int().min(0),
    singleFrame: z.number().int().min(0).optional(),
    lensStatus: z.enum(['制作', '提交', '返修', '通过', '关闭']).optional(),
    maker: z.string().nullable().optional(),
    makerUserId: z.string().nullable().optional(),
    makerNameRaw: z.string().nullable().optional(),
    makerMatchStatus: z.enum(['matched', 'unmatched', 'unassigned']).optional(),
    description: z.string().nullable().optional(),
    rootCode: z.string().nullable().optional(),
    logicalPath: z.string().nullable().optional(),
    versionTag: z.string().nullable().optional(),
    layoutTag: z.string().nullable().optional(),
  })).optional(),
});

export const prepareProjectInitializationRequestSchema = z.object({
  initExcelPath: z.string().optional(),
  lensRoots: z.array(scanRootConfigItemSchema).optional(),
  layoutRoots: z.array(scanRootConfigItemSchema).optional(),
});

export const openProjectRequestSchema = z.object({
  projectRootPath: z.string().min(1),
});

export const setActiveProjectRequestSchema = z.object({
  projectId: z.string().min(1),
});

export const setActiveEpisodeRequestSchema = z.object({
  episodeId: z.string().min(1),
});

export const deleteProjectRequestSchema = z.object({
  projectId: z.string().min(1),
  removeFiles: z.boolean().optional(),
});

const lensStatusSchema = z.enum(['制作', '提交', '返修', '通过', '关闭']) satisfies z.ZodType<LensStatus>;
const lensStatusActionSchema = z.enum(['submit', 'approve', 'rework', 'close']) satisfies z.ZodType<LensStatusAction>;

export const createLensRequestSchema = z.object({
  lensCode: z.string().min(1),
  sceneNo: z.number().int().min(0).optional().default(0),
  lensName: z.string().optional(),
  singleFrame: z.number().int().min(0),
  maker: z.string().optional().default(''),
  note: z.string().optional().default(''),
  lensStatus: lensStatusSchema,
  versionTag: z.string().optional(),
  versionNum: z.string().optional(),
  fileName: z.string().optional(),
});

export const updateLensRequestSchema = createLensRequestSchema.extend({
  singleFrame: z.number().int().min(0),
  lensId: z.string().min(1),
});

export const updateLensStatusRequestSchema = z.object({
  lensId: z.string().min(1),
  action: lensStatusActionSchema,
  note: z.string().optional(),
  imagePaths: z.array(z.string().min(1)).optional(),
});

export const batchUpdateLensStatusRequestSchema = z.object({
  lensIds: z.array(z.string().min(1)).min(1),
  action: lensStatusActionSchema,
  note: z.string().optional(),
  imagePaths: z.array(z.string().min(1)).optional(),
});

export const updateReworkRecordRequestSchema = z.object({
  lensId: z.string().min(1),
  eventId: z.string().min(1),
  note: z.string().optional(),
  keepAttachmentIds: z.array(z.string().min(1)).optional(),
  newImagePaths: z.array(z.string().min(1)).optional(),
});

export const batchUpdateLensVersionTagRequestSchema = z.object({
  versionTag: z.string().min(1),
});

export const deleteLensRequestSchema = z.object({
  lensId: z.string().min(1),
});

export const getLensDetailRequestSchema = z.object({
  lensId: z.string().min(1),
});

export const resolveLensLocalPreviewRequestSchema = z.object({
  movBindings: z.array(z.object({
    fileId: z.string().min(1),
    absolutePath: z.string().min(1),
    exists: z.boolean().optional(),
  })),
  layoutVideoAbsolutePath: z.string().min(1).optional(),
  forceProxyPreviewTargets: z.array(z.enum(['production', 'layout'])).optional(),
}) satisfies z.ZodType<ResolveLensLocalPreviewRequest>;

export const batchDeleteLensRequestSchema = z.object({
  lensIds: z.array(z.string().min(1)).min(1),
});

export const batchImportLensRequestSchema = z.object({
  filePath: z.string().min(1),
});

export const exportLensIssueReportRequestSchema = z.object({
  lensIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['all-issues', 'missing-layout']).optional(),
});

export const fileCheckConfigRequestSchema = z.object({
  layoutTag: z.string(),
  lensRoots: z.array(scanRootConfigItemSchema),
  layoutRoots: z.array(scanRootConfigItemSchema).optional(),
});

export const bindLensFileRequestSchema = z.object({
  lensCode: z.string().min(1),
  versionNum: z.string().min(1),
  fileType: z.enum(['ma', 'mov']),
  filePath: z.string().min(1),
});

export const selectLayoutCandidateRequestSchema = z.object({
  lensCode: z.string().min(1),
  candidateId: z.string().min(1),
});

export const addLayoutCandidateRequestSchema = z.object({
  lensCode: z.string().min(1),
  filePath: z.string().min(1),
  selectAfterAdd: z.boolean().optional(),
});

export const addLayoutVideoBindingRequestSchema = z.object({
  lensCode: z.string().min(1),
  candidateId: z.string().min(1),
  filePath: z.string().min(1),
});

export const scanSingleLensFileCheckRequestSchema = z.object({
  lensId: z.string().min(1),
});

export const scanSingleLensLayoutReferenceRequestSchema = z.object({
  lensId: z.string().min(1),
});

export const refreshLensBindingsRequestSchema = z.object({
  lensIds: z.array(z.string().min(1)).min(1),
});

export const exportLayoutReferenceReportRequestSchema = z.object({
  onlyWithIssues: z.boolean().optional(),
  issueType: z.enum(['all', '路径不存在', '路径存在但文件不存在', '路径存在但文件名不匹配']).optional(),
});

export const generateExtractPreviewRequestSchema = z.object({
  lensCode: z.string().optional(),
  maker: z.string().optional(),
  lensStatus: z.enum(['', '制作', '提交', '返修', '通过', '关闭']).optional(),
  versionNum: z.string().optional(),
  fileSelection: z.enum(['ma', 'mov', 'ma+mov']),
});

export const executeExtractRequestSchema = z.object({
  previewId: z.string().min(1),
  targetPath: z.string().min(1),
});

export interface MovtoolsApi {
  app: {
    getInfo: () => Promise<AppInfo>;
  };
  project: {
    list: () => Promise<ProjectWorkspace>;
    create: (request: CreateProjectRequest) => Promise<ProjectMutationResponse>;
    prepareInitialization: (request: PrepareProjectInitializationRequest) => Promise<PrepareProjectInitializationResponse>;
    applyInitialization: (request: ApplyProjectInitializationRequest) => Promise<ApplyProjectInitializationResponse>;
    open: (request: OpenProjectRequest) => Promise<ProjectMutationResponse>;
    setActive: (request: SetActiveProjectRequest) => Promise<ProjectMutationResponse>;
    listEpisodes: (projectId?: string) => Promise<EpisodeListResponse>;
    createEpisode: (request: CreateEpisodeRequest) => Promise<EpisodeMutationResponse>;
    setActiveEpisode: (request: SetActiveEpisodeRequest) => Promise<EpisodeMutationResponse>;
    delete: (request: DeleteProjectRequest) => Promise<ProjectMutationResponse>;
  };
  file: {
    exists: (request: FileExistsRequest) => Promise<FileExistsResponse>;
    readBase64: (request: FileExistsRequest) => Promise<ReadFileBase64Response>;
  };
  fileCheck: {
    getState: () => Promise<FileCheckStatePayload>;
    updateConfig: (request: FileCheckConfigRequest) => Promise<FileCheckMutationResponse>;
    scan: () => Promise<FileCheckMutationResponse>;
    scanLayout: () => Promise<FileCheckMutationResponse>;
    scanLens: (request: ScanSingleLensFileCheckRequest) => Promise<FileCheckMutationResponse>;
    refreshLensBindings: (request: RefreshLensBindingsRequest) => Promise<FileCheckMutationResponse>;
    scanLayoutReferences: () => Promise<FileCheckMutationResponse>;
    scanLensLayoutReferences: (request: ScanSingleLensLayoutReferenceRequest) => Promise<FileCheckMutationResponse>;
    exportLayoutReferences: (request?: ExportLayoutReferenceReportRequest) => Promise<ExportLayoutReferenceReportResponse>;
    bindFile: (request: BindLensFileRequest) => Promise<FileCheckMutationResponse>;
    openBoundFile: (fileId: string) => Promise<FileCheckMutationResponse>;
    selectLayoutCandidate: (request: SelectLayoutCandidateRequest) => Promise<FileCheckMutationResponse>;
    addLayoutCandidate: (request: AddLayoutCandidateRequest) => Promise<FileCheckMutationResponse>;
    addLayoutVideoBinding: (request: AddLayoutVideoBindingRequest) => Promise<FileCheckMutationResponse>;
    onProgress: (listener: (event: FileCheckProgressEvent) => void) => () => void;
  };
  extract: {
    preview: (request: GenerateExtractPreviewRequest) => Promise<ExtractPreviewResponse>;
    execute: (request: ExecuteExtractRequest) => Promise<ExtractActionResponse>;
    history: () => Promise<ExtractHistoryResponse>;
    openTarget: (targetPath: string) => Promise<ExtractActionResponse>;
    onProgress: (listener: (event: ExtractProgressEvent) => void) => () => void;
  };
  lens: {
    list: () => Promise<LensListResponse>;
    detail: (request: GetLensDetailRequest) => Promise<LensDetailResponse>;
    resolveLocalPreview: (request: ResolveLensLocalPreviewRequest) => Promise<ResolveLensLocalPreviewResponse>;
    create: (request: CreateLensRequest) => Promise<LensMutationResponse>;
    update: (request: UpdateLensRequest) => Promise<LensMutationResponse>;
    updateStatus: (request: UpdateLensStatusRequest) => Promise<LensMutationResponse>;
    updateInternalReviewStatus: (request: { lensId: string; targetStatusCode: import('../lib/internalReview').InternalReviewStatusCode; note?: string }) => Promise<LensMutationResponse>;
    updateReworkRecord: (request: UpdateReworkRecordRequest) => Promise<LensMutationResponse>;
    batchUpdateStatus: (request: BatchUpdateLensStatusRequest) => Promise<LensMutationResponse>;
    batchUpdateVersionTag: (request: BatchUpdateLensVersionTagRequest) => Promise<LensMutationResponse>;
    delete: (request: DeleteLensRequest) => Promise<LensMutationResponse>;
    batchDelete: (request: BatchDeleteLensRequest) => Promise<LensMutationResponse>;
    import: (request: BatchImportLensRequest) => Promise<LensMutationResponse>;
    exportIssues: (request: ExportLensIssueReportRequest) => Promise<ExportLensIssueReportResponse>;
  };
  task: {
    create: (request: CreateTaskRequest) => Promise<CreateTaskResponse>;
    list: () => Promise<MediaTask[]>;
    cancel: (request: CancelTaskRequest) => Promise<TaskActionResponse>;
    retry: (request: TaskActionRequest) => Promise<TaskActionResponse>;
    remove: (request: TaskActionRequest) => Promise<TaskActionResponse>;
    clearCompleted: () => Promise<TaskActionResponse>;
    openLog: (request: TaskActionRequest) => Promise<TaskActionResponse>;
    exportLog: (request: TaskActionRequest) => Promise<TaskActionResponse>;
    listLogs: () => Promise<TaskLogsResponse>;
    onUpdated: (listener: (event: TaskUpdatedEvent) => void) => () => void;
    onLogAppended: (listener: (event: TaskLogAppendedEvent) => void) => () => void;
  };
  dialog: {
    pickFile: (options?: DialogPickFileOptions) => Promise<string | null>; 
    pickFiles: (options?: DialogPickFileOptions) => Promise<string[]>;
    savePastedImage: (request: SavePastedImageRequest) => Promise<string>;
    saveAnnotationImage: (request: SaveAnnotationImageRequest) => Promise<SaveAnnotationImageResponse>;
    pickDirectory: () => Promise<string | null>;
    openManual: (manual: ManualDocument) => Promise<TaskActionResponse>;
    openPath: (filePath: string) => Promise<TaskActionResponse>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (request: UpdateSettingsRequest) => Promise<AppSettings>;
    validate: (request: UpdateSettingsRequest) => Promise<SettingsValidationResult>;
    status: () => Promise<EnvironmentStatus>;
    clearPreviewCache: () => Promise<PreviewCacheCleanupResponse>;
  };
}
