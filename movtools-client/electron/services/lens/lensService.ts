import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  BatchDeleteLensRequest,
  BatchImportLensRequest,
  BatchUpdateLensVersionTagRequest,
  BatchUpdateLensStatusRequest,
  CreateLensRequest,
  DeleteLensRequest,
  ExportLensIssueReportRequest,
  ExportLensIssueReportResponse,
  GetLensDetailRequest,
  LensMutationResponse,
  ResolvedVideoPreviewPayload,
  ResolveLensLocalPreviewRequest,
  ResolveLensLocalPreviewResponse,
  UpdateReworkRecordRequest,
  UpdateLensStatusRequest,
  UpdateLensRequest,
} from '../../../src/types/ipc';
import type { EpisodeSummary } from '../../../src/types/project';
import type { LensAssetType, LensDetailResponse, LensLifecycleAttachment, LensLifecycleEvent, LensListResponse, LensRecentStatusAction, LensRecord, LensStatus, LensStatusAction, LensVersionBinding, LensVersionIssue, LensVersionMatchCandidate, LensVersionMatchDebug, LensVersionSnapshot } from '../../../src/types/lens';
import type { LayoutReferenceCheckRecord, LayoutReferenceCheckStatus, LayoutReferenceIssue, LensLayoutCandidate, LensLayoutVideoBinding } from '../../../src/types/fileCheck';
import { probeVideoMetadata } from '../ffmpeg/ffprobeService';
import { resolveVideoPreviewSource } from '../ffmpeg/videoPreviewService';
import { projectService } from '../project/projectService';
import { getEnabledScanRootPaths, readConfiguredScanRoots } from '../project/scanRootService';
import { settingsService } from '../settings/settingsService';
import { assertLensFolderIsEmptyOrMissing, deleteEmptyLensFolder, ensureLensFolder, ensureLensRootDirectory, removeCreatedLensFolders, resolveLensFolderName, resolveLensFolderRootPath, validateLensFolderName } from './lensFolderService';
import { parseLensImportRow, type ParsedLensImportRow, type ParsedLensImportRowError } from './lensImport';
import { loadXlsx } from '../../shared/xlsx';

type DatabaseValue = string | number | null;

interface RawLensRow {
  lens_id: string;
  episode_id: string | null;
  lens_code: string;
  scene_no: number | null;
  lens_name: string | null;
  single_frame: number;
  maker: string | null;
  note: string | null;
  lens_status: string;
  version_tag: string | null;
  version_num: string | null;
  file_name: string | null;
  frame_source_locked?: number;
  update_time: string;
}

interface RawLensFileRow {
  file_id: string;
  episode_id: string | null;
  lens_code: string;
  version_num: string;
  file_type: LensAssetType;
  file_relative_path: string;
  source_root: string | null;
  bind_time: string;
}

interface RawLifecycleRow {
  event_id: string;
  lens_id: string;
  episode_id: string;
  event_type: LensLifecycleEvent['eventType'];
  title: string;
  detail: string | null;
  from_status: string | null;
  to_status: string | null;
  version_num: string;
  file_name: string;
  event_time: string;
}

interface RawLifecycleAttachmentRow {
  attachment_id: string;
  event_id: string;
  file_relative_path: string;
  file_name: string;
  create_time: string;
  sort_order: number;
}

interface RawLayoutCandidateRow {
  candidate_id: string;
  episode_id: string;
  lens_code: string;
  file_relative_path: string;
  file_name: string;
  source_root: string | null;
  source: 'auto-scan' | 'manual';
  is_selected: number;
  bind_time: string;
}

interface RawLayoutVideoBindingRow {
  binding_id: string;
  episode_id: string;
  lens_code: string;
  candidate_id: string;
  file_relative_path: string;
  file_name: string;
  source_root: string | null;
  bind_time: string;
}

interface LensLayoutSummary {
  layoutCandidateCount: number;
  selectedLayoutFileName: string;
  selectedLayoutRelativePath: string;
  layoutReady: boolean;
}

interface LayoutVideoSummary {
  selectedLayoutCandidateId?: string;
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
}

interface MediaMetadataEnrichmentOptions {
  generationMode: 'background' | 'disabled' | 'blocking';
  forceProxy?: boolean;
}

interface RawLayoutReferenceCheckRow {
  check_id: string;
  episode_id: string;
  lens_code: string;
  candidate_id: string;
  layout_file_path: string;
  status: LayoutReferenceCheckStatus;
  issue_count: number;
  path_missing_count: number;
  file_missing_count: number;
  filename_mismatch_count: number;
  checked_reference_count: number;
  error_message: string | null;
  last_check_time: string;
}

interface RawLayoutReferenceIssueRow {
  issue_id: string;
  check_id: string;
  issue_type: LayoutReferenceIssue['issueType'];
  ref_original_path: string;
  ref_absolute_path: string;
  ref_directory: string;
  expected_file_name: string;
  core_basename: string;
  related_files_same_dir: string | null;
  related_files_parent_dirs: string | null;
}

interface RecentStatusSummary {
  action?: LensRecentStatusAction;
  label: string;
  eventTime: string;
}

interface NormalizedLensPayload {
  lensCode: string;
  sceneNo: number;
  lensName: string;
  singleFrame: number;
  maker: string;
  note: string;
  lensStatus: LensStatus;
  versionTag: string;
  versionNum: string;
  fileName: string;
}

interface ActiveProjectContext {
  success: true;
  project: NonNullable<Awaited<ReturnType<typeof projectService.getActiveProjectSummary>>>;
  episode: EpisodeSummary;
}

interface DiscoveredVersionFile {
  fileName: string;
  absolutePath: string;
  relativePath: string;
  sourceRoot: string;
}

const VIDEO_FILE_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.avi', '.mxf', '.mpg', '.mpeg', '.wmv'] as const;

type VersionMatchDebugLookup = Record<string, Partial<Record<LensAssetType, LensVersionMatchDebug>>>;

interface ExportIssueReportPayload extends ExportLensIssueReportRequest {
  filePath: string;
}

class LensService {
  async listLenses(): Promise<LensListResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return {
        ...activeProject,
        lenses: [],
        activeProjectId: null,
      };
    }

    const autoInitializedLensIds = await this.backfillLensFramesFromLayoutVideos(activeProject.project.databasePath, {
      projectRootPath: activeProject.project.projectRootPath,
      episodeId: activeProject.episode.episodeId,
    });

    const listData = this.withDatabase(activeProject.project.databasePath, (database) => {
      const scanRoots = readConfiguredScanRoots(database, {
        projectId: activeProject.project.projectId,
        episodeId: activeProject.episode.episodeId,
      });
      const rows = database
        .prepare(`
          SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
          FROM lens
          WHERE episode_id = ?
          ORDER BY scene_no ASC, lens_code ASC
      `)
        .all(activeProject.episode.episodeId) as unknown as RawLensRow[];
      const bindingMap = readLensBindingsByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
      const layoutMap = readLayoutCandidatesByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
      const layoutVideoBindingMap = readLayoutVideoBindingsByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
      const layoutReferenceMap = readLayoutReferenceChecksByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
      const recentStatusMap = readRecentStatusSummaryByLensId(database, activeProject.episode.episodeId);
      return { rows, bindingMap, layoutMap, layoutVideoBindingMap, layoutReferenceMap, recentStatusMap, scanRoots };
    });

    const enrichedBindingMap = await enrichCurrentVersionMovMetadataMap(listData.rows, listData.bindingMap);
    const discoveredVideoFiles = await collectDiscoveredVideoFiles(activeProject.project.projectRootPath, getEnabledScanRootPaths(listData.scanRoots.layout));
    const lenses = listData.rows.map((row) => enrichLensRecord(
      mapLensRow(row),
      enrichedBindingMap.get(row.lens_code) ?? [],
      listData.layoutMap.get(row.lens_code) ?? [],
      listData.layoutReferenceMap.get(row.lens_code),
      buildLayoutVideoSummary(row.lens_code, listData.layoutMap.get(row.lens_code) ?? [], listData.layoutVideoBindingMap.get(row.lens_code) ?? [], discoveredVideoFiles),
      listData.recentStatusMap.get(row.lens_id),
    ));

    return {
      success: true,
      lenses,
      autoInitializedLensIds,
      activeProjectId: activeProject.project.projectId,
      activeProjectName: activeProject.project.projectName,
      activeEpisodeId: activeProject.episode.episodeId,
      activeEpisodeName: activeProject.episode.episodeName,
      activeEpisodeCode: activeProject.episode.episodeCode,
      episodeVersionTag: normalizeVersionTag(activeProject.episode.versionTag),
      episodeLayoutTag: normalizeVersionTag(activeProject.episode.layoutTag ?? 'LAY'),
    };
  }

  async getLensDetail(request: GetLensDetailRequest): Promise<LensDetailResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    await this.backfillLensFramesFromLayoutVideos(activeProject.project.databasePath, {
      projectRootPath: activeProject.project.projectRootPath,
      episodeId: activeProject.episode.episodeId,
      lensId: request.lensId,
    });

    const detailData = this.withDatabase(activeProject.project.databasePath, (database) => {
      const scanRoots = readConfiguredScanRoots(database, {
        projectId: activeProject.project.projectId,
        episodeId: activeProject.episode.episodeId,
      });
      const existing = findLensById(database, activeProject.episode.episodeId, request.lensId);
      if (!existing) {
        return { success: false, error: '未找到对应镜头。' } satisfies LensDetailResponse;
      }

      const bindingMap = readLensBindingsByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
      const bindings = bindingMap.get(existing.lensCode) ?? [];
      const layoutCandidates = readLayoutCandidatesByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath).get(existing.lensCode) ?? [];
      const layoutReferenceCheck = readLayoutReferenceChecksByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath).get(existing.lensCode);
      const history = readLifecycleEvents(database, activeProject.episode.episodeId, existing.lensId, activeProject.project.projectRootPath);
      const lens = enrichLensRecord(existing, bindings, layoutCandidates, layoutReferenceCheck);

      return {
        success: true,
        existing,
        lens,
        bindings,
        history,
        layoutCandidates,
        layoutReferenceCheck,
        scanRoots,
      } as const;
    });

    if (!detailData.success) {
      return detailData;
    }

    const enrichedBindings = await enrichBindingsWithMediaMetadata(detailData.bindings, { generationMode: 'blocking', forceProxy: true });
    const candidateLookup = await discoverVersionCandidates(activeProject.project, activeProject.episode, detailData.lens, enrichedBindings, detailData.scanRoots);
    const discoveredVideoFiles = await collectDiscoveredVideoFiles(activeProject.project.projectRootPath, getEnabledScanRootPaths(detailData.scanRoots.layout));
    const layoutVideoBindings = this.withDatabase(activeProject.project.databasePath, (database) => readLayoutVideoBindingsByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath));
    const layoutVideoSummary = await enrichLayoutVideoSummaryWithMediaMetadata(buildLayoutVideoSummary(
      detailData.lens.lensCode,
      detailData.layoutCandidates,
      layoutVideoBindings.get(detailData.lens.lensCode) ?? [],
      discoveredVideoFiles,
    ), { generationMode: 'blocking', forceProxy: true });
    return {
      success: true,
      detail: {
        lens: enrichLensRecord(detailData.existing, enrichedBindings, detailData.layoutCandidates, detailData.layoutReferenceCheck, layoutVideoSummary),
        versions: buildVersionSnapshots(detailData.lens, enrichedBindings, candidateLookup),
        history: detailData.history,
        layoutCandidates: detailData.layoutCandidates,
        layoutReferenceCheck: detailData.layoutReferenceCheck,
      },
    } satisfies LensDetailResponse;
  }

  async resolveLocalPreview(request: ResolveLensLocalPreviewRequest): Promise<ResolveLensLocalPreviewResponse> {
    try {
      const forceProxyTargets = new Set(request.forceProxyPreviewTargets ?? []);
      const movBindings = await Promise.all(request.movBindings.map(async (binding) => ({
        fileId: binding.fileId,
        ...(await resolveLocalVideoPreviewPayload(binding.absolutePath, binding.exists !== false, forceProxyTargets.has('production'))),
      })));

      const layoutVideo = request.layoutVideoAbsolutePath
        ? await resolveLocalVideoPreviewPayload(request.layoutVideoAbsolutePath, true, forceProxyTargets.has('layout'))
        : undefined;

      return {
        success: true,
        movBindings,
        layoutVideo,
      } satisfies ResolveLensLocalPreviewResponse;
    } catch (error) {
      return {
        success: false,
        movBindings: [],
        error: error instanceof Error ? error.message : '生成本地视频预览信息失败。',
      } satisfies ResolveLensLocalPreviewResponse;
    }
  }

  async createLens(request: CreateLensRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    const payload = normalizeLensPayload(request);
    if ('error' in payload) {
      return { success: false, error: payload.error };
    }

    const folderRootPath = activeProject.episode.lensFolderRootPath?.trim() ?? '';
    const folderName = resolveLensFolderName(payload.lensName, payload.lensCode);
    const folderNameError = validateLensFolderName(folderName);
    if (folderNameError) {
      return { success: false, error: folderNameError };
    }

    const database = new DatabaseSync(activeProject.project.databasePath);
    let createdFolderPath: string | null = null;

    try {
      if (findLensByCode(database, activeProject.episode.episodeId, payload.lensCode)) {
        return { success: false, error: `镜头编号「${payload.lensCode}」已存在。` } satisfies LensMutationResponse;
      }

      const folderOwner = findLensByFolderName(database, activeProject.episode.episodeId, folderName);
      if (folderOwner) {
        return { success: false, error: `镜头文件夹名称「${folderName}」已被镜头「${folderOwner.lensCode}」占用。` } satisfies LensMutationResponse;
      }

      if (folderRootPath) {
        await ensureLensRootDirectory(folderRootPath);
        const folderResult = await ensureLensFolder(folderRootPath, folderName);
        if (folderResult.created) {
          createdFolderPath = folderResult.folderPath;
        }
      }

      const now = formatDateTime(new Date());
      const versionTag = normalizeVersionTag(activeProject.episode.versionTag);
      const versionNum = normalizeVersion(payload.versionNum) || DEFAULT_VERSION_NUM;
      const lens: LensRecord = {
        lensId: createCompactId(),
        episodeId: activeProject.episode.episodeId,
        lensCode: payload.lensCode,
        sceneNo: payload.sceneNo,
        lensName: payload.lensName,
        singleFrame: payload.singleFrame,
        maker: payload.maker,
        note: payload.note,
        lensStatus: payload.lensStatus,
        versionTag,
        versionNum,
        fileName: buildFileName(payload.lensCode, versionTag, versionNum),
        updateTime: now,
        currentVersionIssues: [],
        currentVersionReady: true,
        currentVersionMatchedFileNames: [],
        layoutCandidateCount: 0,
        selectedLayoutFileName: '',
        selectedLayoutRelativePath: '',
        layoutReady: false,
        layoutVideoReady: false,
        layoutVideoFileName: '',
        layoutVideoRelativePath: '',
        layoutVideoAbsolutePath: '',
        layoutVideoVersionNum: '',
        recentStatusActionLabel: '',
        recentStatusActionTime: '',
        layoutReferenceStatus: '未检查',
        layoutReferenceIssueCount: 0,
      };

      insertLens(database, lens);
      writeOperateLog(database, {
        lensCode: lens.lensCode,
        operateType: '镜头创建',
        oldContent: null,
        newContent: JSON.stringify(lens),
        operateTime: now,
      });
      writeLifecycleEvent(database, {
        lensId: lens.lensId,
        episodeId: lens.episodeId,
        eventType: '创建',
        title: '镜头创建',
        detail: `创建镜头，初始状态为${lens.lensStatus}`,
        versionNum: lens.versionNum,
        fileName: lens.fileName,
        toStatus: lens.lensStatus,
        eventTime: now,
      });

      return { success: true, lens } satisfies LensMutationResponse;
    } catch (error) {
      if (createdFolderPath) {
        await removeCreatedLensFolders([createdFolderPath]);
      }
      return { success: false, error: error instanceof Error ? error.message : '创建镜头失败。' };
    } finally {
      database.close();
    }
  }

  async updateLens(request: UpdateLensRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    return this.withDatabase(activeProject.project.databasePath, (database) => {
      const existing = findLensById(database, activeProject.episode.episodeId, request.lensId);
      if (!existing) {
        return { success: false, error: '未找到要更新的镜头。' } satisfies LensMutationResponse;
      }

      const payload = normalizeLensPayload(request, {
        allowZeroSingleFrame: existing.singleFrame === 0 && Number(request.singleFrame) === 0,
      });
      if ('error' in payload) {
        return { success: false, error: payload.error };
      }

      const duplicate = findLensByCode(database, activeProject.episode.episodeId, payload.lensCode);
      if (duplicate && duplicate.lensId !== request.lensId) {
        return { success: false, error: `镜头编号「${payload.lensCode}」已存在。` } satisfies LensMutationResponse;
      }

      const folderName = resolveLensFolderName(payload.lensName, payload.lensCode);
      const folderNameError = validateLensFolderName(folderName);
      if (folderNameError) {
        return { success: false, error: folderNameError } satisfies LensMutationResponse;
      }

      const folderOwner = findLensByFolderName(database, activeProject.episode.episodeId, folderName);
      if (folderOwner && folderOwner.lensId !== request.lensId) {
        return { success: false, error: `镜头文件夹名称「${folderName}」已被镜头「${folderOwner.lensCode}」占用。` } satisfies LensMutationResponse;
      }

      const now = formatDateTime(new Date());
      const versionTag = normalizeVersionTag(activeProject.episode.versionTag ?? existing.versionTag);
      const versionNum = normalizeVersion(existing.versionNum) || DEFAULT_VERSION_NUM;

      const updated: LensRecord = {
        ...existing,
        lensCode: payload.lensCode,
        sceneNo: payload.sceneNo,
        lensName: payload.lensName,
        singleFrame: payload.singleFrame,
        maker: payload.maker,
        note: payload.note,
        lensStatus: existing.lensStatus,
        versionTag,
        versionNum,
        fileName: buildFileName(payload.lensCode, versionTag, versionNum),
        updateTime: now,
        currentVersionIssues: existing.currentVersionIssues,
        currentVersionReady: existing.currentVersionReady,
        currentVersionMatchedFileNames: existing.currentVersionMatchedFileNames,
        layoutCandidateCount: existing.layoutCandidateCount,
        selectedLayoutFileName: existing.selectedLayoutFileName,
        selectedLayoutRelativePath: existing.selectedLayoutRelativePath,
        layoutReady: existing.layoutReady,
        layoutVideoReady: existing.layoutVideoReady,
        layoutVideoFileName: existing.layoutVideoFileName,
        layoutVideoRelativePath: existing.layoutVideoRelativePath,
        layoutVideoAbsolutePath: existing.layoutVideoAbsolutePath,
        layoutVideoVersionNum: existing.layoutVideoVersionNum,
      };

      if (existing.lensCode !== updated.lensCode) {
        renameLensLinkedRecords(database, activeProject.episode.episodeId, existing.lensCode, updated.lensCode);
      }
      updateLensRow(database, updated);
      writeOperateLog(database, {
        lensCode: updated.lensCode,
        operateType: '镜头更新',
        oldContent: JSON.stringify(existing),
        newContent: JSON.stringify(updated),
        operateTime: now,
      });
      writeLifecycleEvent(database, {
        lensId: updated.lensId,
        episodeId: updated.episodeId,
        eventType: '基础信息更新',
        title: '基础信息更新',
        detail: `镜头编号：${existing.lensCode} → ${updated.lensCode}`,
        versionNum: updated.versionNum,
        fileName: updated.fileName,
        toStatus: updated.lensStatus,
        eventTime: now,
      });

      return { success: true, lens: updated } satisfies LensMutationResponse;
    });
  }

  async updateLensStatus(request: UpdateLensStatusRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    return this.withDatabase(activeProject.project.databasePath, (database) => {
      const existing = findLensById(database, activeProject.episode.episodeId, request.lensId);
      if (!existing) {
        return { success: false, error: '未找到要更新状态的镜头。' } satisfies LensMutationResponse;
      }

      const now = formatDateTime(new Date());
      const transitioned = transitionLensStatus(existing.lensCode, existing.versionTag, existing.lensStatus, existing.versionNum, request.action);
      if ('error' in transitioned) {
        return { success: false, error: transitioned.error } satisfies LensMutationResponse;
      }
      const updated: LensRecord = {
        ...existing,
        lensStatus: transitioned.nextStatus,
        versionNum: transitioned.versionNum,
        fileName: transitioned.fileName,
        updateTime: now,
        currentVersionIssues: existing.currentVersionIssues,
        currentVersionReady: existing.currentVersionReady,
        currentVersionMatchedFileNames: existing.currentVersionMatchedFileNames,
        layoutCandidateCount: existing.layoutCandidateCount,
        selectedLayoutFileName: existing.selectedLayoutFileName,
        selectedLayoutRelativePath: existing.selectedLayoutRelativePath,
        layoutReady: existing.layoutReady,
      };

      updateLensRow(database, updated);
      writeOperateLog(database, {
        lensCode: updated.lensCode,
        operateType: '状态修改',
        oldContent: existing.lensStatus,
        newContent: updated.lensStatus,
        operateTime: now,
      });
      const eventId = writeLifecycleEvent(database, {
        lensId: updated.lensId,
        episodeId: updated.episodeId,
        eventType: '状态流转',
        title: `状态：${existing.lensStatus} → ${updated.lensStatus}`,
        detail: buildStatusTransitionDetail(request.action, request.note),
        versionNum: updated.versionNum,
        fileName: updated.fileName,
        fromStatus: existing.lensStatus,
        toStatus: updated.lensStatus,
        eventTime: now,
      });

      if (request.action === 'rework' && request.imagePaths?.length) {
        ensureLifecycleAttachmentTable(database);
        writeLifecycleAttachments(database, activeProject.project.projectRootPath, activeProject.episode.episodeId, eventId, request.imagePaths, now);
      }

      return { success: true, lens: updated } satisfies LensMutationResponse;
    });
  }

  async updateReworkRecord(request: UpdateReworkRecordRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    const note = request.note?.trim() ?? '';
    const requestedKeepAttachmentIds = request.keepAttachmentIds;
    const newImagePaths = Array.from(new Set((request.newImagePaths ?? []).map((filePath) => path.resolve(filePath)).filter(Boolean)));

    const database = new DatabaseSync(activeProject.project.databasePath);
    const copiedFiles: Array<{ absolutePath: string }> = [];
    const removedFiles: string[] = [];

    try {
      const event = findLifecycleEventById(database, activeProject.episode.episodeId, request.eventId);
      if (!event) {
        return { success: false, error: '未找到要编辑的返修记录。' } satisfies LensMutationResponse;
      }

      if (!isEditableReworkLifecycleRow(event)) {
        return { success: false, error: '当前记录不是可编辑的返修记录。' } satisfies LensMutationResponse;
      }

      ensureLifecycleAttachmentTable(database);

      const existingAttachments = readLifecycleAttachmentsByEventId(database, request.eventId, activeProject.project.projectRootPath);
      const keepAttachmentIds = new Set((requestedKeepAttachmentIds ?? existingAttachments.map((attachment) => attachment.attachmentId)).filter(Boolean));
      const removableAttachments = existingAttachments.filter((attachment) => !keepAttachmentIds.has(attachment.attachmentId));
      const retainedAttachments = (requestedKeepAttachmentIds ?? existingAttachments.map((attachment) => attachment.attachmentId))
        .map((attachmentId) => existingAttachments.find((attachment) => attachment.attachmentId === attachmentId))
        .filter((attachment): attachment is LensLifecycleAttachment => attachment !== undefined)
        .filter((attachment) => keepAttachmentIds.has(attachment.attachmentId));
      const retainedCount = retainedAttachments.length;
      const nextSortOrderStart = retainedCount;
      const copiedAttachments = await Promise.all(newImagePaths.map(async (sourcePath, index) => {
        const copied = await copyLifecycleAttachmentFile(activeProject.project.projectRootPath, activeProject.episode.episodeId, event.event_id, sourcePath, index + nextSortOrderStart);
        copiedFiles.push({ absolutePath: copied.absolutePath });
        return copied;
      }));

      database.exec('BEGIN');
      try {
        database.prepare('UPDATE lens_lifecycle SET detail = ? WHERE event_id = ?').run(buildEditableReworkDetail(event.title, note), event.event_id);

        removableAttachments.forEach((attachment) => {
          database.prepare('DELETE FROM lens_lifecycle_attachment WHERE attachment_id = ?').run(attachment.attachmentId);
          removedFiles.push(attachment.absolutePath);
        });

        retainedAttachments.forEach((attachment, index) => {
          database.prepare('UPDATE lens_lifecycle_attachment SET sort_order = ? WHERE attachment_id = ?').run(index, attachment.attachmentId);
        });

        copiedAttachments.forEach((attachment) => {
          database.prepare(`
            INSERT INTO lens_lifecycle_attachment (attachment_id, event_id, file_relative_path, file_name, create_time, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            attachment.attachmentId,
            event.event_id,
            attachment.relativePath,
            attachment.fileName,
            attachment.createTime,
            attachment.sortOrder,
          );
        });

        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }

      await Promise.all(removedFiles.map(async (filePath) => {
        try {
          await rm(filePath, { force: true });
        } catch {
          // 删除旧附件失败不影响记录更新。
        }
      }));

      return { success: true } satisfies LensMutationResponse;
    } catch (error) {
      await Promise.all(copiedFiles.map(async (file) => {
        try {
          await rm(file.absolutePath, { force: true });
        } catch {
          // ignore cleanup failure for copied temp files
        }
      }));
      return { success: false, error: error instanceof Error ? error.message : '返修记录更新失败。' } satisfies LensMutationResponse;
    } finally {
      database.close();
    }
  }

  async batchUpdateLensStatus(request: BatchUpdateLensStatusRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    return this.withDatabase(activeProject.project.databasePath, (database) => {
      try {
        const uniqueLensIds = [...new Set(request.lensIds)];
        if (uniqueLensIds.length === 0) {
          return { success: false, error: '请先选择至少一个镜头。' } satisfies LensMutationResponse;
        }

        const existingLenses = uniqueLensIds.map((lensId) => findLensById(database, activeProject.episode.episodeId, lensId));
        const missingLens = existingLenses.find((lens) => !lens);
        if (!missingLens) {
          const now = formatDateTime(new Date());
          let affectedCount = 0;

          existingLenses.forEach((lens) => {
            if (!lens) {
              return;
            }

            const transitioned = transitionLensStatus(lens.lensCode, lens.versionTag, lens.lensStatus, lens.versionNum, request.action);
            if ('error' in transitioned) {
              throw new Error(`镜头 ${lens.lensCode}：${transitioned.error}`);
            }
            const updated: LensRecord = {
              ...lens,
              lensStatus: transitioned.nextStatus,
              versionNum: transitioned.versionNum,
              fileName: transitioned.fileName,
              updateTime: now,
              currentVersionIssues: lens.currentVersionIssues,
              currentVersionReady: lens.currentVersionReady,
              currentVersionMatchedFileNames: lens.currentVersionMatchedFileNames,
              layoutCandidateCount: lens.layoutCandidateCount,
              selectedLayoutFileName: lens.selectedLayoutFileName,
              selectedLayoutRelativePath: lens.selectedLayoutRelativePath,
              layoutReady: lens.layoutReady,
              layoutVideoReady: lens.layoutVideoReady,
              layoutVideoFileName: lens.layoutVideoFileName,
              layoutVideoRelativePath: lens.layoutVideoRelativePath,
              layoutVideoAbsolutePath: lens.layoutVideoAbsolutePath,
              layoutVideoVersionNum: lens.layoutVideoVersionNum,
            };

            updateLensRow(database, updated);
            writeOperateLog(database, {
              lensCode: updated.lensCode,
              operateType: '批量状态修改',
              oldContent: lens.lensStatus,
              newContent: updated.lensStatus,
              operateTime: now,
            });
            const eventId = writeLifecycleEvent(database, {
              lensId: updated.lensId,
              episodeId: updated.episodeId,
              eventType: '状态流转',
              title: `批量状态：${lens.lensStatus} → ${updated.lensStatus}`,
              detail: buildBatchStatusTransitionDetail(request.action, request.note),
              versionNum: updated.versionNum,
              fileName: updated.fileName,
              fromStatus: lens.lensStatus,
              toStatus: updated.lensStatus,
              eventTime: now,
            });

            if (request.action === 'rework' && request.imagePaths?.length) {
              ensureLifecycleAttachmentTable(database);
              writeLifecycleAttachments(database, activeProject.project.projectRootPath, activeProject.episode.episodeId, eventId, request.imagePaths, now);
            }
            affectedCount += 1;
          });

          return { success: true, affectedCount } satisfies LensMutationResponse;
        }

        return { success: false, error: '选中的镜头中存在已失效记录，请刷新后重试。' } satisfies LensMutationResponse;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '批量状态更新失败。' } satisfies LensMutationResponse;
      }
    });
  }

  async batchUpdateLensVersionTag(request: BatchUpdateLensVersionTagRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    const nextVersionTag = normalizeVersionTag(request.versionTag);
    if (!nextVersionTag) {
      return { success: false, error: '版本文件字段不能为空。' };
    }

    if (/[<>:"/\\|?*\x00-\x1F]/.test(nextVersionTag)) {
      return { success: false, error: '版本文件字段包含非法文件名字符。' };
    }

    return this.withDatabase(activeProject.project.databasePath, (database) => {
      const now = formatDateTime(new Date());
      const rows = database.prepare(`
        SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
        FROM lens
        WHERE episode_id = ?
        ORDER BY lens_code ASC
      `).all(activeProject.episode.episodeId) as unknown as RawLensRow[];

      rows.forEach((row) => {
        const lens = mapLensRow(row);
        const updated: LensRecord = {
          ...lens,
          versionTag: nextVersionTag,
          fileName: buildFileName(lens.lensCode, nextVersionTag, lens.versionNum),
          updateTime: now,
        };
        updateLensRow(database, updated);
      });

      database.prepare(`
        UPDATE episode SET version_tag = ?, update_time = ? WHERE episode_id = ?
      `).run(nextVersionTag, now, activeProject.episode.episodeId);

      writeOperateLog(database, {
        lensCode: null,
        operateType: '批量更新版本文件字段',
        oldContent: null,
        newContent: JSON.stringify({ episodeId: activeProject.episode.episodeId, versionTag: nextVersionTag, affectedCount: rows.length }),
        operateTime: now,
      });
      return { success: true, affectedCount: rows.length } satisfies LensMutationResponse;
    });
  }

  async deleteLens(request: DeleteLensRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    const folderRootPath = activeProject.episode.lensFolderRootPath?.trim() ?? '';
    const database = new DatabaseSync(activeProject.project.databasePath);

    try {
      const existing = findLensById(database, activeProject.episode.episodeId, request.lensId);
      if (!existing) {
        return { success: false, error: '未找到要删除的镜头。' } satisfies LensMutationResponse;
      }

      if (folderRootPath) {
        const folderName = resolveLensFolderName(existing.lensName, existing.lensCode);
        await deleteEmptyLensFolder(folderRootPath, folderName);
      }

      deleteLensLinkedRecords(database, activeProject.episode.episodeId, existing.lensId, existing.lensCode);
      database.prepare('DELETE FROM lens WHERE lens_id = ?').run(request.lensId);
      writeOperateLog(database, {
        lensCode: existing.lensCode,
        operateType: '镜头删除',
        oldContent: JSON.stringify(existing),
        newContent: null,
        operateTime: formatDateTime(new Date()),
      });

      return { success: true } satisfies LensMutationResponse;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '删除镜头失败。' };
    } finally {
      database.close();
    }
  }

  async batchDeleteLenses(request: BatchDeleteLensRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    const folderRootPath = activeProject.episode.lensFolderRootPath?.trim() ?? '';
    const database = new DatabaseSync(activeProject.project.databasePath);

    try {
      const uniqueLensIds = [...new Set(request.lensIds)];
      if (uniqueLensIds.length === 0) {
        return { success: false, error: '请先选择至少一个镜头。' } satisfies LensMutationResponse;
      }

      const existingLenses = uniqueLensIds.map((lensId) => findLensById(database, activeProject.episode.episodeId, lensId));
      const missingLens = existingLenses.find((lens) => !lens);
      if (!missingLens) {
        const now = formatDateTime(new Date());

        if (folderRootPath) {
          for (const lens of existingLenses) {
            if (!lens) {
              continue;
            }
            const folderName = resolveLensFolderName(lens.lensName, lens.lensCode);
            await assertLensFolderIsEmptyOrMissing(folderRootPath, folderName);
          }

          for (const lens of existingLenses) {
            if (!lens) {
              continue;
            }
            const folderName = resolveLensFolderName(lens.lensName, lens.lensCode);
            await deleteEmptyLensFolder(folderRootPath, folderName);
          }
        }

        existingLenses.forEach((lens) => {
          if (!lens) {
            return;
          }

          deleteLensLinkedRecords(database, activeProject.episode.episodeId, lens.lensId, lens.lensCode);
          database.prepare('DELETE FROM lens WHERE lens_id = ?').run(lens.lensId);
          writeOperateLog(database, {
            lensCode: lens.lensCode,
            operateType: '批量删除',
            oldContent: JSON.stringify(lens),
            newContent: null,
            operateTime: now,
          });
        });

        return { success: true, affectedCount: uniqueLensIds.length } satisfies LensMutationResponse;
      }

      return { success: false, error: '选中的镜头中存在已失效记录，请刷新后重试。' } satisfies LensMutationResponse;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '批量删除镜头失败。' };
    } finally {
      database.close();
    }
  }

  async importLenses(request: BatchImportLensRequest): Promise<LensMutationResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    try {
      const XLSX = await loadXlsx();
      const workbook = XLSX.readFile(request.filePath, { cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return { success: false, error: 'Excel 文件中没有可读取的工作表。' };
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
        blankrows: false,
      });

      if (rows.length === 0) {
        return { success: false, error: 'Excel 中没有可导入的数据。' };
      }

      const parsedRows = rows.map((row) => parseLensImportRow(row));
      const invalidRow = parsedRows.find((row) => 'error' in row);
      if (invalidRow && 'error' in invalidRow) {
        return { success: false, error: invalidRow.error };
      }

      const validRows = parsedRows as ParsedLensImportRow[];

      const seenCodes = new Set<string>();
      for (const row of validRows) {
        if (seenCodes.has(row.lensCode)) {
          return { success: false, error: `导入文件中存在重复镜头编号：${row.lensCode}` };
        }
        seenCodes.add(row.lensCode);
      }

      const folderRootPath = activeProject.episode.lensFolderRootPath?.trim() ?? '';
      const database = new DatabaseSync(activeProject.project.databasePath);
      const createdFolderPaths: string[] = [];

      try {
        const seenFolderNames = new Set<string>();
        for (const row of validRows) {
          const folderName = resolveLensFolderName(row.lensName, row.lensCode);
          const folderNameError = validateLensFolderName(folderName);
          if (folderNameError) {
            return { success: false, error: folderNameError };
          }
          if (seenFolderNames.has(folderName)) {
            return { success: false, error: `导入文件中存在重复镜头文件夹名称：${folderName}` };
          }
          seenFolderNames.add(folderName);
        }

        for (const row of validRows) {
          if (findLensByCode(database, activeProject.episode.episodeId, row.lensCode)) {
            return { success: false, error: `镜头编号「${row.lensCode}」已存在，导入终止。` } satisfies LensMutationResponse;
          }

          const folderName = resolveLensFolderName(row.lensName, row.lensCode);
          const folderOwner = findLensByFolderName(database, activeProject.episode.episodeId, folderName);
          if (folderOwner) {
            return { success: false, error: `镜头文件夹名称「${folderName}」已被镜头「${folderOwner.lensCode}」占用。` } satisfies LensMutationResponse;
          }
        }

        if (folderRootPath) {
          await ensureLensRootDirectory(folderRootPath);
          for (const row of validRows) {
            const folderName = resolveLensFolderName(row.lensName, row.lensCode);
            const folderResult = await ensureLensFolder(folderRootPath, folderName);
            if (folderResult.created) {
              createdFolderPaths.push(folderResult.folderPath);
            }
          }
        }

        const now = formatDateTime(new Date());
        const inserted: LensRecord[] = validRows.map((row) => {
          const versionNum = normalizeVersion(row.versionNum) || DEFAULT_VERSION_NUM;
          const lens: LensRecord = {
            lensId: createCompactId(),
            episodeId: activeProject.episode.episodeId,
            lensCode: row.lensCode,
            sceneNo: row.sceneNo,
            lensName: row.lensName,
            singleFrame: row.singleFrame,
            maker: row.maker,
            lensStatus: row.lensStatus,
            versionTag: normalizeVersionTag(activeProject.episode.versionTag),
            versionNum,
            fileName: buildFileName(row.lensCode, normalizeVersionTag(activeProject.episode.versionTag), versionNum),
            updateTime: now,
            currentVersionIssues: [],
            currentVersionReady: true,
            currentVersionMatchedFileNames: [],
            layoutCandidateCount: 0,
            selectedLayoutFileName: '',
            selectedLayoutRelativePath: '',
            layoutReady: false,
            layoutVideoReady: false,
            layoutVideoFileName: '',
            layoutVideoRelativePath: '',
            layoutVideoAbsolutePath: '',
            layoutVideoVersionNum: '',
            recentStatusActionLabel: '',
            recentStatusActionTime: '',
            layoutReferenceStatus: '未检查',
            layoutReferenceIssueCount: 0,
          };

          insertLens(database, lens);
          writeLifecycleEvent(database, {
            lensId: lens.lensId,
            episodeId: lens.episodeId,
            eventType: '创建',
            title: '批量导入创建',
            detail: '通过 Excel 批量导入镜头。',
            versionNum: lens.versionNum,
            fileName: lens.fileName,
            toStatus: lens.lensStatus,
            eventTime: now,
          });
          return lens;
        });

        writeOperateLog(database, {
          lensCode: null,
          operateType: '批量导入',
          oldContent: null,
          newContent: `导入镜头数量：${inserted.length}`,
          operateTime: now,
        });

        return { success: true, importedCount: inserted.length } satisfies LensMutationResponse;
      } catch (error) {
        if (createdFolderPaths.length > 0) {
          await removeCreatedLensFolders(createdFolderPaths);
        }
        return { success: false, error: error instanceof Error ? error.message : '导入镜头失败。' };
      } finally {
        database.close();
      }
    } catch (error) {
      return {
        success: false,
        error: `导入 Excel 失败：${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  async exportIssueReport(request: ExportIssueReportPayload): Promise<ExportLensIssueReportResponse> {
    const activeProject = await this.requireActiveProject();
    if (!('project' in activeProject)) {
      return activeProject;
    }

    try {
      const exportRows = this.withDatabase(activeProject.project.databasePath, (database) => {
        const rows = database.prepare(`
          SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
          FROM lens
          WHERE episode_id = ?
        `).all(activeProject.episode.episodeId) as unknown as RawLensRow[];
        const bindingMap = readLensBindingsByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
        const layoutMap = readLayoutCandidatesByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
        const layoutReferenceMap = readLayoutReferenceChecksByCode(database, activeProject.episode.episodeId, activeProject.project.projectRootPath);
        const lensById = new Map(rows.map((row) => {
          const lens = enrichLensRecord(mapLensRow(row), bindingMap.get(row.lens_code) ?? [], layoutMap.get(row.lens_code) ?? [], layoutReferenceMap.get(row.lens_code));
          return [lens.lensId, lens] as const;
        }));

        return request.lensIds
          .map((lensId) => lensById.get(lensId))
          .filter((lens): lens is LensRecord => Boolean(lens))
          .map((lens) => ({
            镜头编号: lens.lensCode,
            镜头名称: lens.lensName || '',
            场次: lens.sceneNo,
            帧数: lens.singleFrame,
            制作人员: lens.maker || '',
            状态: lens.lensStatus,
            当前版本: lens.versionNum,
            问题类型: request.mode === 'missing-layout' ? formatExportLayoutIssueType(lens) : formatExportCombinedIssueType(lens),
            版本文件缺项: formatExportVersionIssueSummary(lens.currentVersionIssues),
            Layout状态: lens.layoutReady ? '已采用' : lens.layoutCandidateCount > 0 ? '待确认/缺失' : '缺失',
            Layout候选数: lens.layoutCandidateCount,
            当前采用Layout: lens.selectedLayoutFileName || '',
            当前采用Layout路径: lens.selectedLayoutRelativePath || '',
            同步说明: formatExportSyncComment(lens),
            更新时间: lens.updateTime,
          }))
          .filter((row) => request.mode === 'missing-layout'
            ? row.Layout状态 !== '已采用'
            : row.版本文件缺项 !== '无' || row.Layout状态 !== '已采用');
      });

      if (exportRows.length === 0) {
        return { success: false, error: '当前筛选结果中没有可导出的缺项镜头。' };
      }

      const xlsx = await loadXlsx();
      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(exportRows);
      worksheet['!cols'] = [
        { wch: 24 },
        { wch: 24 },
        { wch: 10 },
        { wch: 10 },
        { wch: 16 },
        { wch: 10 },
        { wch: 10 },
        { wch: 28 },
        { wch: 26 },
        { wch: 16 },
        { wch: 12 },
        { wch: 32 },
        { wch: 48 },
        { wch: 28 },
        { wch: 20 },
      ];
      xlsx.utils.book_append_sheet(workbook, worksheet, '缺项同步');

      const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
      await writeFile(request.filePath, buffer);

      return {
        success: true,
        filePath: request.filePath,
        exportedCount: exportRows.length,
      } satisfies ExportLensIssueReportResponse;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出缺项同步表失败。',
      } satisfies ExportLensIssueReportResponse;
    }
  }

  private async requireActiveProject(): Promise<ActiveProjectContext | LensMutationResponse> {
    const project = await projectService.getActiveProjectSummary();
    if (!project) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const episode = await projectService.getActiveEpisodeSummary();
    if (!episode || episode.projectId !== project.projectId) {
      return { success: false, error: '请先在项目页创建或选择一个集。' };
    }

    return { success: true, project, episode };
  }

  private withDatabase<T>(databasePath: string, action: (database: DatabaseSync) => T): T {
    const database = new DatabaseSync(databasePath);
    try {
      return action(database);
    } finally {
      database.close();
    }
  }

  private async backfillLensFramesFromLayoutVideos(
    databasePath: string,
    payload: { projectRootPath: string; episodeId: string; lensId?: string },
  ): Promise<string[]> {
    const database = new DatabaseSync(databasePath);
    try {
      const rows = database.prepare(`
        SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, frame_source_locked, update_time
        FROM lens
        WHERE episode_id = ?
          AND single_frame <= 0
          AND COALESCE(frame_source_locked, 1) = 0
          ${payload.lensId ? 'AND lens_id = ?' : ''}
        ORDER BY scene_no ASC, lens_code ASC
      `).all(...(payload.lensId ? [payload.episodeId, payload.lensId] : [payload.episodeId])) as unknown as RawLensRow[];

      if (rows.length === 0) {
        return [];
      }

      const layoutCandidatesByCode = readLayoutCandidatesByCode(database, payload.episodeId, payload.projectRootPath);
      const layoutVideoBindingsByCode = readLayoutVideoBindingsByCode(database, payload.episodeId, payload.projectRootPath);
      const now = formatDateTime(new Date());
      const initializedLensIds: string[] = [];

      for (const row of rows) {
        const candidates = layoutCandidatesByCode.get(row.lens_code) ?? [];
        const bindings = layoutVideoBindingsByCode.get(row.lens_code) ?? [];
        const selectedCandidate = candidates.find((candidate) => candidate.isSelected) ?? candidates[0];
        if (!selectedCandidate) {
          continue;
        }

        const matchedBinding = bindings.find((binding) => binding.candidateId === selectedCandidate.candidateId) ?? bindings[0];
        if (!matchedBinding?.exists) {
          continue;
        }

        try {
          const settings = await settingsService.getSettings();
          const metadata = await probeVideoMetadata(settings.ffprobePath, matchedBinding.absolutePath);
          if (!metadata.frameCount || metadata.frameCount <= 0) {
            continue;
          }

          const updateResult = database.prepare(`
            UPDATE lens
            SET single_frame = ?, frame_source_locked = 1, update_time = ?
            WHERE lens_id = ? AND episode_id = ? AND single_frame <= 0 AND COALESCE(frame_source_locked, 1) = 0
          `).run(metadata.frameCount, now, row.lens_id, payload.episodeId);

          if ((updateResult.changes ?? 0) > 0) {
            initializedLensIds.push(row.lens_id);
          }
        } catch {
          // 帧数补偿仅做兜底，不阻塞镜头读取
        }
      }

      return initializedLensIds;
    } finally {
      database.close();
    }
  }
}

function insertLens(database: DatabaseSync, lens: LensRecord): void {
  database.prepare(`
    INSERT INTO lens (lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lens.lensId, lens.episodeId, lens.lensCode, lens.sceneNo, nullableString(lens.lensName), lens.singleFrame, nullableString(lens.maker), nullableString(lens.note ?? ''), lens.lensStatus, lens.versionTag, lens.versionNum, lens.fileName, lens.updateTime);
}

function updateLensRow(database: DatabaseSync, lens: LensRecord): void {
  database.prepare(`
    UPDATE lens
    SET episode_id = ?, lens_code = ?, scene_no = ?, lens_name = ?, single_frame = ?, maker = ?, note = ?, lens_status = ?, version_tag = ?, version_num = ?, file_name = ?, update_time = ?
    WHERE lens_id = ?
  `).run(lens.episodeId, lens.lensCode, lens.sceneNo, nullableString(lens.lensName), lens.singleFrame, nullableString(lens.maker), nullableString(lens.note ?? ''), lens.lensStatus, lens.versionTag, lens.versionNum, lens.fileName, lens.updateTime, lens.lensId);
}

function findLensById(database: DatabaseSync, episodeId: string, lensId: string): LensRecord | null {
  const row = database.prepare(`
    SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
    FROM lens
    WHERE lens_id = ? AND episode_id = ?
  `).get(lensId, episodeId) as RawLensRow | undefined;

  return row ? mapLensRow(row) : null;
}

function findLensByCode(database: DatabaseSync, episodeId: string, lensCode: string): LensRecord | null {
  const row = database.prepare(`
    SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
    FROM lens
    WHERE episode_id = ? AND lens_code = ?
  `).get(episodeId, lensCode) as RawLensRow | undefined;
  
  return row ? mapLensRow(row) : null;
}

function findLensByFolderName(database: DatabaseSync, episodeId: string, folderName: string): LensRecord | null {
  const row = database.prepare(`
    SELECT lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, note, lens_status, version_tag, version_num, file_name, update_time
    FROM lens
    WHERE episode_id = ? AND COALESCE(NULLIF(TRIM(lens_name), ''), lens_code) = ?
  `).get(episodeId, folderName) as RawLensRow | undefined;

  return row ? mapLensRow(row) : null;
}

function writeOperateLog(database: DatabaseSync, payload: { lensCode: string | null; operateType: string; oldContent: string | null; newContent: string | null; operateTime: string }): void {
  database.prepare(`
    INSERT INTO operate_log (log_id, lens_code, operate_type, old_content, new_content, operate_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(createCompactId(), payload.lensCode, payload.operateType, payload.oldContent, payload.newContent, payload.operateTime);
}

function mapLensRow(row: RawLensRow): LensRecord {
  return {
    lensId: row.lens_id,
    episodeId: row.episode_id ?? '',
    lensCode: row.lens_code,
    sceneNo: row.scene_no ?? 0,
    lensName: row.lens_name ?? '',
    singleFrame: row.single_frame,
    maker: row.maker ?? '',
    note: row.note ?? '',
    lensStatus: normalizeLensStatus(row.lens_status),
    versionTag: normalizeVersionTag(row.version_tag),
    versionNum: row.version_num ?? '',
    fileName: row.file_name ?? '',
    updateTime: row.update_time,
    currentVersionIssues: [],
    currentVersionReady: true,
    currentVersionMatchedFileNames: [],
    layoutCandidateCount: 0,
    selectedLayoutFileName: '',
    selectedLayoutRelativePath: '',
    layoutReady: false,
    layoutVideoReady: false,
    layoutVideoFileName: '',
    layoutVideoRelativePath: '',
    layoutVideoAbsolutePath: '',
    layoutVideoVersionNum: '',
    recentStatusActionLabel: '',
    recentStatusActionTime: '',
    layoutReferenceStatus: '未检查',
    layoutReferenceIssueCount: 0,
  };
}

function normalizeLensPayload(
  request: Pick<CreateLensRequest, 'lensCode' | 'sceneNo' | 'lensName' | 'singleFrame' | 'maker' | 'note' | 'lensStatus' | 'versionTag' | 'versionNum' | 'fileName'>,
  options: { allowZeroSingleFrame?: boolean } = {},
): NormalizedLensPayload | { error: string } {
  const lensCode = request.lensCode.trim();
  const maker = (request.maker ?? '').trim();
  const note = (request.note ?? '').trim();
  const singleFrame = Number(request.singleFrame);
  const sceneNo = Number(request.sceneNo) || 0;
  const lensName = request.lensName?.trim() ?? lensCode;
  const lensStatus = normalizeLensStatus(request.lensStatus);
  const versionTag = normalizeVersionTag(request.versionTag);
  const versionNum = normalizeVersion(request.versionNum?.trim() ?? '') || DEFAULT_VERSION_NUM;
  const fileName = buildFileName(lensCode, versionTag, versionNum);

  if (!lensCode) {
    return { error: '镜头编号不能为空。' };
  }

  if (!Number.isInteger(singleFrame) || singleFrame <= 0) {
    return { error: '单镜头帧数必须为大于 0 的整数。' };
  }

  if (!versionTag) {
    return { error: '版本文件字段不能为空。' };
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(versionTag)) {
    return { error: '版本文件字段包含非法文件名字符。' };
  }

  return {
    lensCode,
    sceneNo,
    lensName,
    maker,
    note,
    singleFrame,
    lensStatus,
    versionTag,
    versionNum,
    fileName,
  };
}

function transitionLensStatus(lensCode: string, versionTag: string, previousStatus: LensStatus, currentVersion: string, action: LensStatusAction): { nextStatus: LensStatus; versionNum: string; fileName: string } | { error: string } {
  const normalizedCurrentVersion = normalizeVersion(currentVersion) || DEFAULT_VERSION_NUM;
  if (action === 'submit') {
    if (previousStatus !== '制作' && previousStatus !== '返修') {
      return { error: `当前状态为“${previousStatus}”，只能从“制作”或“返修”提交。` };
    }

    return {
      nextStatus: '提交',
      versionNum: normalizedCurrentVersion,
      fileName: buildFileName(lensCode, versionTag, normalizedCurrentVersion),
    };
  }

  if (action === 'approve') {
    if (previousStatus !== '提交') {
      return { error: `当前状态为“${previousStatus}”，只有“提交”状态可以通过。` };
    }

    return {
      nextStatus: '通过',
      versionNum: normalizedCurrentVersion,
      fileName: buildFileName(lensCode, versionTag, normalizedCurrentVersion),
    };
  }

  if (action === 'rework') {
    if (previousStatus !== '提交' && previousStatus !== '通过') {
      return { error: `当前状态为“${previousStatus}”，只有“提交”或“通过”状态可以返修。` };
    }

    const versionNum = incrementVersion(normalizedCurrentVersion);
    return {
      nextStatus: '返修',
      versionNum,
      fileName: buildFileName(lensCode, versionTag, versionNum),
    };
  }

  if (previousStatus !== '提交') {
    return { error: `当前状态为“${previousStatus}”，只有“提交”状态可以关闭。` };
  }

  return {
    nextStatus: '关闭',
    versionNum: normalizedCurrentVersion,
    fileName: buildFileName(lensCode, versionTag, normalizedCurrentVersion),
  };
}

function buildFileName(lensCode: string, versionTag: string, versionNum: string): string {
  const normalizedTag = normalizeVersionTag(versionTag);
  const normalizedVersion = normalizeVersion(versionNum) || DEFAULT_VERSION_NUM;
  const suffix = normalizedVersion.toLowerCase();
  return lensCode ? `${lensCode}_${normalizedTag}_${suffix}` : `_${normalizedTag}_${suffix}`;
}

function normalizeVersionTag(value?: string | null): string {
  const text = value?.trim() ?? '';
  return text ? text.toUpperCase() : 'ANI';
}

function incrementVersion(version: string): string {
  const match = normalizeVersion(version).match(/^V(\d{2,3})$/);
  if (!match) {
    return DEFAULT_VERSION_NUM;
  }

  return `V${String(Number(match[1]) + 1).padStart(Math.max(match[1].length, 2), '0')}`;
}

function normalizeVersion(version: string): string {
  const text = version.trim().toUpperCase();
  if (!text) {
    return '';
  }

  const match = text.match(/^V?(\d{1,3})$/);
  if (!match) {
    return text;
  }

  return `V${match[1].padStart(Math.max(match[1].length, 2), '0')}`;
}

function normalizeLensStatus(value: string): LensStatus {
  if (value === '提交' || value === '返修' || value === '通过' || value === '关闭') {
    return value;
  }

  return '制作';
}

function buildStatusTransitionDetail(action: LensStatusAction, note?: string): string {
  const trimmedNote = note?.trim() ?? '';
  const baseDetail = action === 'submit'
    ? '镜头已进入提交状态。'
    : action === 'approve'
      ? '镜头已通过，当前版本已锁定。'
      : action === 'rework'
        ? '镜头已进入返修状态，版本号已自动递增。'
        : '镜头已关闭，记录保留但默认不在列表中展示。';

  return trimmedNote ? `${baseDetail} 备注：${trimmedNote}` : baseDetail;
}

function buildBatchStatusTransitionDetail(action: LensStatusAction, note?: string): string {
  const trimmedNote = note?.trim() ?? '';
  const baseDetail = action === 'submit'
    ? '批量提交完成。'
    : action === 'approve'
      ? '批量通过完成，当前版本已锁定。'
      : action === 'rework'
        ? '批量返修完成，镜头已进入返修状态且版本号递增。'
        : '批量关闭完成，记录保留但默认不在列表中展示。';

  return trimmedNote ? `${baseDetail} 备注：${trimmedNote}` : baseDetail;
}

function buildEditableReworkDetail(title: string, note?: string): string {
  const trimmedNote = note?.trim() ?? '';
  return title.startsWith('批量状态：')
    ? buildBatchStatusTransitionDetail('rework', trimmedNote)
    : buildStatusTransitionDetail('rework', trimmedNote);
}

function parseReworkNote(detail: string): string {
  const marker = '备注：';
  const index = detail.indexOf(marker);
  if (index === -1) {
    return '';
  }

  return detail.slice(index + marker.length).trim();
}

function isEditableReworkLifecycleRow(row: Pick<RawLifecycleRow, 'event_type' | 'to_status'>): boolean {
  return row.event_type === '状态流转' && normalizeLensStatus(row.to_status ?? '') === '返修';
}

const DEFAULT_VERSION_NUM = 'V01';
const REQUIRED_VERSION_FILE_TYPES: LensAssetType[] = ['ma', 'mov'];
const ALLOWED_REWORK_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function readLensBindingsByCode(database: DatabaseSync, episodeId: string, projectRootPath: string): Map<string, LensVersionBinding[]> {
  const rows = database.prepare(`
    SELECT file_id, episode_id, lens_code, version_num, file_type, file_relative_path, source_root, bind_time
    FROM lens_file
    WHERE episode_id = ?
    ORDER BY bind_time DESC
  `).all(episodeId) as unknown as RawLensFileRow[];

  return rows.reduce<Map<string, LensVersionBinding[]>>((accumulator, row) => {
    const binding = mapLensFileRow(row, projectRootPath);
    const list = accumulator.get(binding.lensCode) ?? [];
    list.push(binding);
    accumulator.set(binding.lensCode, list);
    return accumulator;
  }, new Map());
}

function mapLensFileRow(row: RawLensFileRow, projectRootPath: string): LensVersionBinding {
  const absolutePath = path.resolve(projectRootPath, row.file_relative_path);
  return {
    fileId: row.file_id,
    lensCode: row.lens_code,
    versionNum: normalizeVersion(row.version_num) || DEFAULT_VERSION_NUM,
    fileType: row.file_type,
    relativePath: row.file_relative_path,
    bindTime: row.bind_time,
    absolutePath,
    exists: existsSync(absolutePath),
    sourceRoot: row.source_root ?? undefined,
  };
}

function enrichLensRecord(
  lens: LensRecord,
  bindings: LensVersionBinding[],
  layoutCandidates: LensLayoutCandidate[],
  layoutReferenceCheck?: LayoutReferenceCheckRecord,
  layoutVideoSummary: LayoutVideoSummary = emptyLayoutVideoSummary(),
  recentStatusSummary: RecentStatusSummary = emptyRecentStatusSummary(),
): LensRecord {
  const issues = buildVersionIssues(lens, bindings);
  const fileReadinessIssues = issues.filter((issue) => issue.reason !== '帧数不匹配');
  const layoutSummary = buildLayoutSummary(layoutCandidates, layoutVideoSummary.selectedLayoutCandidateId);
  const currentVersionMatchedFileNames = bindings
    .filter((binding) => binding.versionNum === (normalizeVersion(lens.versionNum) || DEFAULT_VERSION_NUM))
    .filter((binding) => binding.exists)
    .map((binding) => path.basename(binding.relativePath));
  const effectiveSingleFrame = lens.singleFrame > 0
    ? lens.singleFrame
    : (layoutVideoSummary.layoutVideoFrameCount && layoutVideoSummary.layoutVideoFrameCount > 0
      ? layoutVideoSummary.layoutVideoFrameCount
      : lens.singleFrame);
  return {
    ...lens,
    singleFrame: effectiveSingleFrame,
    currentVersionIssues: issues,
    currentVersionReady: fileReadinessIssues.length === 0,
    currentVersionMatchedFileNames,
    layoutCandidateCount: layoutSummary.layoutCandidateCount,
    selectedLayoutFileName: layoutSummary.selectedLayoutFileName,
    selectedLayoutRelativePath: layoutSummary.selectedLayoutRelativePath,
    layoutReady: layoutSummary.layoutReady,
    layoutVideoReady: layoutVideoSummary.layoutVideoReady,
    layoutVideoFileName: layoutVideoSummary.layoutVideoFileName,
    layoutVideoRelativePath: layoutVideoSummary.layoutVideoRelativePath,
    layoutVideoAbsolutePath: layoutVideoSummary.layoutVideoAbsolutePath,
    layoutVideoVersionNum: layoutVideoSummary.layoutVideoVersionNum,
    layoutVideoPreviewUrl: layoutVideoSummary.layoutVideoPreviewUrl,
    layoutVideoDurationSeconds: layoutVideoSummary.layoutVideoDurationSeconds,
    layoutVideoFrameCount: layoutVideoSummary.layoutVideoFrameCount,
    layoutVideoFps: layoutVideoSummary.layoutVideoFps,
    layoutVideoWidth: layoutVideoSummary.layoutVideoWidth,
    layoutVideoHeight: layoutVideoSummary.layoutVideoHeight,
    layoutVideoCodecName: layoutVideoSummary.layoutVideoCodecName,
    layoutVideoCodecLongName: layoutVideoSummary.layoutVideoCodecLongName,
    layoutVideoCodecProfile: layoutVideoSummary.layoutVideoCodecProfile,
    layoutVideoPixelFormat: layoutVideoSummary.layoutVideoPixelFormat,
    recentStatusAction: recentStatusSummary.action,
    recentStatusActionLabel: recentStatusSummary.label,
    recentStatusActionTime: recentStatusSummary.eventTime,
    layoutReferenceStatus: layoutReferenceCheck?.status ?? '未检查',
    layoutReferenceIssueCount: layoutReferenceCheck?.issueCount ?? 0,
    layoutReferenceLastCheckTime: layoutReferenceCheck?.lastCheckTime,
  };
}

function emptyRecentStatusSummary(): RecentStatusSummary {
  return {
    label: '',
    eventTime: '',
  };
}

function emptyLayoutVideoSummary(): LayoutVideoSummary {
  return {
    selectedLayoutCandidateId: undefined,
    layoutVideoReady: false,
    layoutVideoFileName: '',
    layoutVideoRelativePath: '',
    layoutVideoAbsolutePath: '',
    layoutVideoVersionNum: '',
  };
}

async function enrichLayoutVideoSummaryWithMediaMetadata(summary: LayoutVideoSummary, options: MediaMetadataEnrichmentOptions): Promise<LayoutVideoSummary> {
  if (!summary.layoutVideoReady || !summary.layoutVideoAbsolutePath) {
    return summary;
  }

  const settings = await settingsService.getSettings();
  try {
    const metadata = await probeVideoMetadata(settings.ffprobePath, summary.layoutVideoAbsolutePath);
      const preview = await resolveVideoPreviewSource({
        ffmpegExecutable: settings.ffmpegPath,
        inputPath: summary.layoutVideoAbsolutePath,
        metadata,
        generationMode: options.generationMode,
        forceProxy: options.forceProxy,
      });
    return {
      ...summary,
      layoutVideoPreviewUrl: preview.previewUrl,
      layoutVideoDurationSeconds: metadata.durationSeconds,
      layoutVideoFrameCount: metadata.frameCount ?? undefined,
      layoutVideoFps: metadata.fps ?? undefined,
      layoutVideoWidth: metadata.width ?? undefined,
      layoutVideoHeight: metadata.height ?? undefined,
      layoutVideoCodecName: metadata.codecName ?? undefined,
      layoutVideoCodecLongName: metadata.codecLongName ?? undefined,
      layoutVideoCodecProfile: metadata.codecProfile ?? undefined,
      layoutVideoPixelFormat: metadata.pixelFormat ?? undefined,
      layoutVideoPreviewMode: preview.mode,
      layoutVideoPreviewNote: preview.note,
      layoutVideoPreviewProgressPercent: preview.progressPercent,
    };
  } catch {
    return {
      ...summary,
      layoutVideoPreviewUrl: toFileUrl(summary.layoutVideoAbsolutePath),
      layoutVideoPreviewMode: 'direct',
      layoutVideoPreviewNote: '兼容预览副本生成失败，已回退为原文件直连；如仍无法播放，请检查 FFmpeg 路径或手动清理预览缓存后重试。',
    };
  }
}

function buildLayoutVideoSummary(
  lensCode: string,
  layoutCandidates: LensLayoutCandidate[],
  layoutVideoBindings: LensLayoutVideoBinding[],
  videoFiles: DiscoveredVersionFile[],
): LayoutVideoSummary {
  const selectedLayout = resolveSelectedLayoutCandidate(layoutCandidates, videoFiles, lensCode);
  const manualBinding = selectedLayout
    ? layoutVideoBindings.find((binding) => binding.candidateId === selectedLayout.candidateId && binding.exists)
    : layoutVideoBindings.find((binding) => !binding.candidateId && binding.exists);
  if (manualBinding) {
    return {
      selectedLayoutCandidateId: selectedLayout?.candidateId,
      layoutVideoReady: true,
      layoutVideoFileName: manualBinding.fileName,
      layoutVideoRelativePath: manualBinding.relativePath,
      layoutVideoAbsolutePath: manualBinding.absolutePath,
      layoutVideoVersionNum: extractVersionNumber(manualBinding.fileName) === null ? '' : normalizeVersion(`V${extractVersionNumber(manualBinding.fileName)}`),
    };
  }

  const matched = matchLayoutVideoFileByLensCode(lensCode, videoFiles, selectedLayout?.fileName);

  if (!matched) {
    return {
      ...emptyLayoutVideoSummary(),
      selectedLayoutCandidateId: selectedLayout?.candidateId,
    };
  }

  return {
    selectedLayoutCandidateId: selectedLayout?.candidateId,
    layoutVideoReady: true,
    layoutVideoFileName: matched.fileName,
    layoutVideoRelativePath: matched.relativePath,
    layoutVideoAbsolutePath: matched.absolutePath,
    layoutVideoVersionNum: extractVersionNumber(matched.fileName) === null ? '' : normalizeVersion(`V${extractVersionNumber(matched.fileName)}`),
  };
}

function scoreLayoutVideoFileMatch(
  file: DiscoveredVersionFile,
  normalizedLensCode: string,
  selectedLayoutFileName?: string,
): number {
  const baseName = path.basename(file.fileName, path.extname(file.fileName)).toUpperCase();
  const selectedLayoutBaseName = selectedLayoutFileName
    ? path.basename(selectedLayoutFileName, path.extname(selectedLayoutFileName)).toUpperCase()
    : '';
  const normalizedVideoStem = stripVersionToken(baseName);
  const normalizedLayoutStem = selectedLayoutBaseName ? stripVersionToken(selectedLayoutBaseName) : '';

  if (selectedLayoutBaseName) {
    if (baseName === selectedLayoutBaseName) {
      return 1200;
    }

    if (normalizedLayoutStem && normalizedVideoStem === normalizedLayoutStem) {
      return 1100;
    }
  }

  if (!fileNameContainsLensCode(baseName, normalizedLensCode)) {
    return 0;
  }

  const baseNameWithoutVersion = normalizedVideoStem;
  const fileVersion = extractVersionNumber(baseName);
  const exactLensStemMatch = baseNameWithoutVersion === normalizedLensCode;
  if (!hasLayoutVideoKeyword(baseNameWithoutVersion) && !exactLensStemMatch) {
    return 0;
  }

  let score = 0;
  if (baseNameWithoutVersion === `${normalizedLensCode}_LAY` || baseNameWithoutVersion === `${normalizedLensCode}_LAYOUT`) {
    score += 400;
  } else if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_`)) {
    score += 320;
  } else if (exactLensStemMatch) {
    score += 240;
  }
  score += scoreLayoutVideoLensStemAffinity(baseNameWithoutVersion, normalizedLensCode);
  if (fileVersion !== null) {
    score += Math.min(fileVersion, 99);
  }

  return score >= 140 ? score : 0;
}

function matchLayoutVideoFileByLensCode(
  lensCode: string,
  videoFiles: DiscoveredVersionFile[],
  selectedLayoutFileName?: string,
): DiscoveredVersionFile | null {
  const normalizedLensCode = lensCode.trim().toUpperCase();
  if (!normalizedLensCode) {
    return null;
  }

  return videoFiles
    .map((file) => ({
      file,
      score: scoreLayoutVideoFileMatch(file, normalizedLensCode, selectedLayoutFileName),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => compareMatchedLayoutVideoCandidate(left, right, normalizedLensCode))[0]?.file ?? null;
}

function compareMatchedLayoutVideoCandidate(
  left: { file: DiscoveredVersionFile; score: number },
  right: { file: DiscoveredVersionFile; score: number },
  normalizedLensCode: string,
): number {
  const scoreDiff = right.score - left.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const versionDiff = (extractVersionNumber(right.file.fileName) ?? 0) - (extractVersionNumber(left.file.fileName) ?? 0);
  if (versionDiff !== 0) {
    return versionDiff;
  }

  const namingDiff = compareLayoutVideoNamingPriority(right.file.fileName, left.file.fileName, normalizedLensCode);
  if (namingDiff !== 0) {
    return namingDiff;
  }

  return left.file.fileName.localeCompare(right.file.fileName, 'zh-CN');
}

function compareLayoutVideoNamingPriority(leftFileName: string, rightFileName: string, normalizedLensCode: string): number {
  return scoreLayoutVideoNamingPriority(leftFileName, normalizedLensCode) - scoreLayoutVideoNamingPriority(rightFileName, normalizedLensCode);
}

function scoreLayoutVideoNamingPriority(fileName: string, normalizedLensCode: string): number {
  const baseName = path.basename(fileName, path.extname(fileName)).toUpperCase();
  const baseNameWithoutVersion = stripVersionToken(baseName);

  if (baseNameWithoutVersion === `${normalizedLensCode}_LAY`) {
    return 400;
  }

  if (baseNameWithoutVersion === `${normalizedLensCode}_LAYOUT`) {
    return 380;
  }

  if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_LAY_`)) {
    return 320;
  }

  if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_LAYOUT_`)) {
    return 300;
  }

  if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_`)) {
    return 220;
  }

  if (baseNameWithoutVersion === normalizedLensCode) {
    return 160;
  }

  return 0;
}

function scoreLayoutVideoLensStemAffinity(baseNameWithoutVersion: string, normalizedLensCode: string): number {
  if (baseNameWithoutVersion === normalizedLensCode) {
    return 220;
  }

  if (baseNameWithoutVersion === `${normalizedLensCode}_LAY`) {
    return 220;
  }

  if (baseNameWithoutVersion === `${normalizedLensCode}_LAYOUT`) {
    return 220;
  }

  if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_`)) {
    return 160;
  }

  return 0;
}

function stripVersionToken(value: string): string {
  return value
    .replace(/(?:^|[_-])V0*\d{1,3}(?=$|[_-])/gi, '')
    .replace(/[_-]{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
}

function tokenizeFileName(value: string): string[] {
  return value
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function countSharedTokens(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftUnique = [...new Set(left.filter((token) => token.length > 1))];
  const rightSet = new Set(right.filter((token) => token.length > 1));
  return leftUnique.filter((token) => rightSet.has(token)).length;
}

function fileNameContainsLensCode(baseName: string, normalizedLensCode: string): boolean {
  const escapedLensCode = normalizedLensCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^A-Z0-9])${escapedLensCode}(?=$|[^A-Z0-9])`, 'i');
  return pattern.test(baseName);
}

function hasLayoutVideoKeyword(baseName: string): boolean {
  return /(?:^|[^A-Z0-9])(LAY|LAYOUT)(?=$|[^A-Z0-9])/i.test(baseName);
}

function buildLayoutSummary(layoutCandidates: LensLayoutCandidate[], selectedCandidateId?: string): LensLayoutSummary {
  const selected = selectedCandidateId
    ? layoutCandidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? resolveSelectedLayoutCandidate(layoutCandidates)
    : resolveSelectedLayoutCandidate(layoutCandidates);
  return {
    layoutCandidateCount: layoutCandidates.length,
    selectedLayoutFileName: selected?.fileName ?? '',
    selectedLayoutRelativePath: selected?.relativePath ?? '',
    layoutReady: Boolean(selected && selected.exists),
  };
}

function resolveSelectedLayoutCandidate(
  layoutCandidates: LensLayoutCandidate[],
  videoFiles: DiscoveredVersionFile[] = [],
  lensCode = '',
): LensLayoutCandidate | undefined {
  const explicitSelected = layoutCandidates.find((candidate) => candidate.isSelected);
  if (explicitSelected) {
    return explicitSelected;
  }

  if (layoutCandidates.length <= 1) {
    return layoutCandidates[0];
  }

  return layoutCandidates[0];
}

function buildVersionIssues(lens: Pick<LensRecord, 'versionNum' | 'singleFrame'>, bindings: LensVersionBinding[], matchDebug?: Partial<Record<LensAssetType, LensVersionMatchDebug>>): LensVersionIssue[] {
  const normalizedVersion = normalizeVersion(lens.versionNum) || DEFAULT_VERSION_NUM;
  const currentBindings = bindings.filter((binding) => binding.versionNum === normalizedVersion);
  const issues: LensVersionIssue[] = [];

  for (const fileType of REQUIRED_VERSION_FILE_TYPES) {
    const matched = currentBindings.filter((binding) => binding.fileType === fileType);
    const debug = matchDebug?.[fileType];
    if (matched.length === 0) {
      if (debug && debug.candidateCount > 1) {
        issues.push({
          fileType,
          reason: '多候选待确认',
          message: `${fileType.toUpperCase()} 在 ${normalizedVersion} 发现 ${debug.candidateCount} 个候选，待人工确认`,
          candidatePaths: debug.candidates.map((candidate) => candidate.relativePath),
        });
      } else {
        issues.push({
          fileType,
          reason: '未绑定',
          message: `${fileType.toUpperCase()} 未绑定到 ${normalizedVersion}`,
          candidatePaths: debug?.candidates.map((candidate) => candidate.relativePath),
        });
      }
      continue;
    }

    if (matched.every((binding) => !binding.exists)) {
      issues.push({
        fileType,
        reason: '文件缺失',
        message: `${fileType.toUpperCase()} 已绑定，但磁盘文件缺失`,
      });
    }
  }

  const movBinding = currentBindings.find((binding) => binding.fileType === 'mov' && binding.exists);
  if (lens.singleFrame > 0 && movBinding?.mediaFrameCount && movBinding.mediaFrameCount !== lens.singleFrame) {
    issues.push({
      fileType: 'mov',
      reason: '帧数不匹配',
      message: `MOV 帧数 ${movBinding.mediaFrameCount} 与镜头设计帧数 ${lens.singleFrame} 不一致`,
    });
  }

  return issues;
}

function formatExportVersionIssueSummary(issues: LensVersionIssue[]): string {
  if (issues.length === 0) {
    return '无';
  }

  return issues.map((issue) => issue.message).join('；');
}

function formatExportCombinedIssueType(lens: LensRecord): string {
  const issueTypes: string[] = [];
  if (lens.currentVersionIssues.length > 0) {
    issueTypes.push(...Array.from(new Set(lens.currentVersionIssues.map((issue) => `${issue.fileType.toUpperCase()}-${issue.reason}`))));
  }

  if (!lens.layoutReady) {
    issueTypes.push(`Layout-${formatExportLayoutIssueType(lens)}`);
  }

  return issueTypes.join('；') || '无';
}

function formatExportLayoutIssueType(lens: LensRecord): string {
  if (lens.layoutReady) {
    return '无';
  }

  if (lens.layoutCandidateCount === 0) {
    return '未发现layout候选';
  }

  return lens.selectedLayoutFileName ? '当前采用layout磁盘缺失' : '已有layout候选但未确认采用项';
}

function formatExportSyncComment(lens: LensRecord): string {
  const notes: string[] = [];
  if (lens.currentVersionIssues.length > 0) {
    notes.push(`版本文件待补：${formatExportVersionIssueSummary(lens.currentVersionIssues)}`);
  }

  if (!lens.layoutReady) {
    notes.push(lens.layoutCandidateCount > 0 ? 'Layout 已发现候选，请确认最终采用项。' : 'Layout 未发现候选，请补充或重新扫描。');
  }

  return notes.join('；') || '已完整';
}

function buildVersionSnapshots(lens: LensRecord, bindings: LensVersionBinding[], debugLookup: VersionMatchDebugLookup = {}): LensVersionSnapshot[] {
  const versionSet = new Set<string>([normalizeVersion(lens.versionNum) || DEFAULT_VERSION_NUM]);
  bindings.forEach((binding) => versionSet.add(binding.versionNum));

  return [...versionSet]
    .sort(compareVersionDesc)
    .map((versionNum) => {
      const matchDebug = debugLookup[versionNum] ?? {};
      return {
        versionNum,
        fileName: buildFileName(lens.lensCode, lens.versionTag, versionNum),
        issues: buildVersionIssues({ versionNum, singleFrame: lens.singleFrame }, bindings, matchDebug),
        bindings: bindings.filter((binding) => binding.versionNum === versionNum),
        matchDebug,
      };
    });
}

async function discoverVersionCandidates(
  project: ActiveProjectContext['project'],
  episode: ActiveProjectContext['episode'],
  lens: LensRecord,
  bindings: LensVersionBinding[],
  scanRoots: ReturnType<typeof readConfiguredScanRoots>,
): Promise<VersionMatchDebugLookup> {
  const versionSet = new Set<string>([normalizeVersion(lens.versionNum) || DEFAULT_VERSION_NUM]);
  bindings.forEach((binding) => versionSet.add(binding.versionNum));

  const maScanRoots = getEnabledScanRootPaths(scanRoots.ma, episode.lensFolderRootPath);
  const movScanRoots = getEnabledScanRootPaths(scanRoots.mov, episode.lensFolderRootPath);

  const [maFiles, movFiles] = await Promise.all([
    collectDiscoveredVersionFilesFromRoots(maScanRoots, '.ma', project.projectRootPath),
    collectDiscoveredVideoFiles(project.projectRootPath, movScanRoots),
  ]);

  return [...versionSet].reduce<VersionMatchDebugLookup>((accumulator, versionNum) => {
    accumulator[versionNum] = {
      ma: buildVersionMatchDebug('ma', versionNum, lens.lensCode, lens.versionTag, maScanRoots, maFiles),
      mov: buildVersionMatchDebug('mov', versionNum, lens.lensCode, lens.versionTag, movScanRoots, movFiles),
    };
    return accumulator;
  }, {});
}

async function enrichBindingsWithMediaMetadata(bindings: LensVersionBinding[], options: MediaMetadataEnrichmentOptions): Promise<LensVersionBinding[]> {
  const movBindings = bindings.filter((binding) => binding.fileType === 'mov' && binding.exists);
  if (movBindings.length === 0) {
    return bindings;
  }

  const settings = await settingsService.getSettings();
  const metadataMap = new Map<string, {
    mediaDurationSeconds?: number;
    mediaFrameCount?: number;
    mediaFps?: number;
    mediaPreviewUrl?: string;
    mediaWidth?: number;
    mediaHeight?: number;
    mediaCodecName?: string;
    mediaCodecLongName?: string;
    mediaCodecProfile?: string;
    mediaPixelFormat?: string;
    mediaPreviewMode?: 'direct' | 'proxy' | 'pending';
    mediaPreviewNote?: string;
    mediaPreviewProgressPercent?: number;
  }>();

  await Promise.all(movBindings.map(async (binding) => {
    try {
      const metadata = await probeVideoMetadata(settings.ffprobePath, binding.absolutePath);
      const preview = await resolveVideoPreviewSource({
        ffmpegExecutable: settings.ffmpegPath,
        inputPath: binding.absolutePath,
        metadata,
        generationMode: options.generationMode,
        forceProxy: options.forceProxy,
      });
      metadataMap.set(binding.fileId, {
        mediaPreviewUrl: preview.previewUrl,
        mediaDurationSeconds: metadata.durationSeconds,
        mediaFrameCount: metadata.frameCount ?? undefined,
        mediaFps: metadata.fps ?? undefined,
        mediaWidth: metadata.width ?? undefined,
        mediaHeight: metadata.height ?? undefined,
        mediaCodecName: metadata.codecName ?? undefined,
        mediaCodecLongName: metadata.codecLongName ?? undefined,
        mediaCodecProfile: metadata.codecProfile ?? undefined,
        mediaPixelFormat: metadata.pixelFormat ?? undefined,
        mediaPreviewMode: preview.mode,
        mediaPreviewNote: preview.note,
        mediaPreviewProgressPercent: preview.progressPercent,
      });
    } catch {
      metadataMap.set(binding.fileId, {
        mediaPreviewUrl: toFileUrl(binding.absolutePath),
        mediaPreviewMode: 'direct',
        mediaPreviewNote: '兼容预览副本生成失败，已回退为原文件直连；如仍无法播放，请检查 FFmpeg 路径或手动清理预览缓存后重试。',
      });
    }
  }));

  return bindings.map((binding) => ({
    ...binding,
    ...metadataMap.get(binding.fileId),
  }));
}

async function enrichCurrentVersionMovMetadataMap(rows: RawLensRow[], bindingMap: Map<string, LensVersionBinding[]>): Promise<Map<string, LensVersionBinding[]>> {
  const currentBindings = rows.flatMap((row) => {
    const versionNum = normalizeVersion(row.version_num ?? '') || DEFAULT_VERSION_NUM;
    return (bindingMap.get(row.lens_code) ?? []).filter((binding) => binding.versionNum === versionNum);
  });

  const enrichedBindings = await enrichBindingsWithMediaMetadata(currentBindings, { generationMode: 'disabled' });
  const enrichedById = new Map(enrichedBindings.map((binding) => [binding.fileId, binding]));

  return new Map([...bindingMap.entries()].map(([lensCode, bindings]) => [
    lensCode,
    bindings.map((binding) => enrichedById.get(binding.fileId) ?? binding),
  ]));
}

function toFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString();
}

async function resolveLocalVideoPreviewPayload(absolutePath: string, shouldResolve: boolean, forceProxy = false): Promise<ResolvedVideoPreviewPayload> {
  if (!shouldResolve || !absolutePath || !existsSync(absolutePath)) {
    return {};
  }

  const settings = await settingsService.getSettings();
  try {
    const metadata = await probeVideoMetadata(settings.ffprobePath, absolutePath);
    const preview = await resolveVideoPreviewSource({
      ffmpegExecutable: settings.ffmpegPath,
      inputPath: absolutePath,
      metadata,
      generationMode: 'blocking',
      forceProxy,
    });
    return {
      previewUrl: preview.previewUrl,
      durationSeconds: metadata.durationSeconds,
      frameCount: metadata.frameCount ?? undefined,
      fps: metadata.fps ?? undefined,
      width: metadata.width ?? undefined,
      height: metadata.height ?? undefined,
      codecName: metadata.codecName ?? undefined,
      codecLongName: metadata.codecLongName ?? undefined,
      codecProfile: metadata.codecProfile ?? undefined,
      pixelFormat: metadata.pixelFormat ?? undefined,
      previewMode: preview.mode,
      previewNote: preview.note,
      previewProgressPercent: preview.progressPercent,
    };
    } catch {
      return forceProxy
        ? {
        previewMode: 'proxy',
        previewNote: '兼容预览副本生成失败，请检查 FFmpeg 路径或预览缓存。',
      }
        : {
          previewUrl: toFileUrl(absolutePath),
          previewMode: 'direct',
          previewNote: '兼容预览副本生成失败。',
        };
    }
  }

function buildVersionMatchDebug(
  fileType: LensAssetType,
  versionNum: string,
  lensCode: string,
  versionTag: string,
  scanRoots: string[],
  files: DiscoveredVersionFile[],
): LensVersionMatchDebug {
  const relatedFiles = files
    .filter((file) => fileRelatesToLens(file, lensCode))
    .map((file) => toVersionMatchCandidate(file, versionNum, lensCode, versionTag));
  const candidates = relatedFiles.filter((file) => file.score > 0);
  const normalizedVersion = normalizeVersion(versionNum) || DEFAULT_VERSION_NUM;

  let note = `已扫描 ${files.length} 个 ${fileType.toUpperCase()} 文件。`;
  if (scanRoots.length === 0) {
    note = `当前未配置 ${fileType.toUpperCase()} 扫描根目录。`;
  } else if (candidates.length === 1) {
    note = `发现 1 个 ${normalizedVersion} 候选，可自动绑定。`;
  } else if (candidates.length > 1) {
    note = `发现 ${candidates.length} 个 ${normalizedVersion} 候选，需要人工确认。`;
  } else if (relatedFiles.length > 0) {
    note = `已扫描到 ${relatedFiles.length} 个与镜头相关的 ${fileType.toUpperCase()} 文件，但没有命中 ${normalizedVersion}。`;
  }

  return {
    fileType,
    versionNum: normalizedVersion,
    scanRoots,
    scannedFileCount: files.length,
    relatedFileCount: relatedFiles.length,
    candidateCount: candidates.length,
    note,
    relatedFiles,
    candidates,
  };
}

function toVersionMatchCandidate(file: DiscoveredVersionFile, versionNum: string, lensCode: string, versionTag: string): LensVersionMatchCandidate {
  const extractedVersion = extractVersionNumber(file.fileName) ?? undefined;
  return {
    fileName: file.fileName,
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    sourceRoot: file.sourceRoot,
    score: scoreVersionFileMatch(file, lensCode, versionTag, versionNum),
    extractedVersion,
  };
}

function fileRelatesToLens(file: DiscoveredVersionFile, lensCode: string): boolean {
  const normalizedLensCode = lensCode.trim().toUpperCase();
  const baseName = path.basename(file.fileName, path.extname(file.fileName)).toUpperCase();
  const normalizedRelativePath = file.relativePath.replaceAll('\\', '/').toUpperCase();
  return baseName.includes(normalizedLensCode) || normalizedRelativePath.includes(normalizedLensCode);
}

function scoreVersionFileMatch(file: DiscoveredVersionFile, lensCode: string, versionTag: string, versionNum: string): number {
  const extension = path.extname(file.fileName);
  const baseName = path.basename(file.fileName, extension).toUpperCase();
  const relativePath = file.relativePath.replaceAll('\\', '/').toUpperCase();
  const pathSegments = relativePath.split('/').map((segment) => segment.trim()).filter(Boolean);
  const normalizedLensCode = lensCode.trim().toUpperCase();
  if (!normalizedLensCode) {
    return 0;
  }

  const compactLensCode = normalizeLooseComparableText(normalizedLensCode);
  const canonicalLensCode = normalizeLooseComparableTextWithNumericNormalization(normalizedLensCode);
  const compactBaseName = normalizeLooseComparableText(baseName);
  const canonicalBaseName = normalizeLooseComparableTextWithNumericNormalization(baseName);
  const compactRelativePath = normalizeLooseComparableText(relativePath);
  const canonicalRelativePath = normalizeLooseComparableTextWithNumericNormalization(relativePath);
  const lensMatched = fileNameContainsLensCode(baseName, normalizedLensCode)
    || relativePath.includes(normalizedLensCode)
    || pathSegments.includes(normalizedLensCode)
    || compactBaseName.includes(compactLensCode)
    || compactRelativePath.includes(compactLensCode)
    || canonicalBaseName.includes(canonicalLensCode)
    || canonicalRelativePath.includes(canonicalLensCode);
  if (!lensMatched) {
    return 0;
  }

  const targetVersion = extractVersionNumber(versionNum);
  const fileVersion = extractVersionNumber(baseName);
  if (targetVersion === null || fileVersion === null || targetVersion !== fileVersion) {
    return 0;
  }

  let score = 100;
  if (baseName === buildFileName(lensCode, versionTag, versionNum).toUpperCase()) {
    score += 100;
  }
  if (baseName.startsWith(normalizedLensCode)) {
    score += 30;
  }
  if (pathSegments.includes(normalizedLensCode)) {
    score += 20;
  }
  if (compactBaseName.startsWith(compactLensCode)) {
    score += 15;
  }
  if (baseName.includes(`_${normalizeVersionTag(versionTag)}_`)) {
    score += 20;
  }
  if (baseName.endsWith(`V${String(targetVersion).padStart(2, '0')}`) || baseName.endsWith(`V${String(targetVersion).padStart(3, '0')}`)) {
    score += 10;
  }

  return score;
}

function extractVersionNumber(value: string): number | null {
  const match = value.toUpperCase().match(/(?:^|[_-])V0*(\d{1,3})(?=$|[_-])/);
  return match ? Number(match[1]) : null;
}

function normalizeLooseComparableText(value: string): string {
  return value.replace(/[^A-Z0-9]+/gi, '').toUpperCase();
}

function normalizeLooseComparableTextWithNumericNormalization(value: string): string {
  return value
    .replace(/\d+/g, (match) => String(Number(match)))
    .replace(/[^A-Z0-9]+/gi, '')
    .toUpperCase();
}

async function collectDiscoveredVersionFilesFromRoots(directoryPaths: string[], extension: string, projectRootPath: string): Promise<DiscoveredVersionFile[]> {
  const collected = new Map<string, DiscoveredVersionFile>();
  await Promise.all(directoryPaths.map(async (directoryPath) => {
    const files = await collectDiscoveredVersionFiles(directoryPath, extension, projectRootPath, directoryPath);
    files.forEach((file) => collected.set(file.absolutePath.toUpperCase(), file));
  }));
  return [...collected.values()];
}

async function collectDiscoveredVideoFiles(projectRootPath: string, directoryPaths: string[]): Promise<DiscoveredVersionFile[]> {
  if (directoryPaths.length === 0) {
    return [];
  }

  const collected = new Map<string, DiscoveredVersionFile>();
  const groups = await Promise.all(VIDEO_FILE_EXTENSIONS.map((extension) => collectDiscoveredVersionFilesFromRoots(directoryPaths, extension, projectRootPath)));
  groups.flat().forEach((file) => collected.set(file.absolutePath.toUpperCase(), file));
  return [...collected.values()];
}

async function collectDiscoveredVersionFiles(
  directoryPath: string,
  extension: string,
  projectRootPath: string,
  sourceRoot: string,
): Promise<DiscoveredVersionFile[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const nestedFiles = await Promise.all(entries.map(async (entry) => {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return collectDiscoveredVersionFiles(absolutePath, extension, projectRootPath, sourceRoot);
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== extension.toLowerCase()) {
        return [] as DiscoveredVersionFile[];
      }
      return [{
        fileName: entry.name,
        absolutePath,
        relativePath: normalizeStoredPath(projectRootPath, absolutePath),
        sourceRoot,
      } satisfies DiscoveredVersionFile];
    }));
    return nestedFiles.flat();
  } catch {
    return [];
  }
}

function normalizeStoredPath(projectRootPath: string, absolutePath: string): string {
  const relativePath = path.relative(projectRootPath, absolutePath);
  return relativePath.startsWith('..') ? absolutePath : relativePath;
}

async function copyLifecycleAttachmentFile(
  projectRootPath: string,
  episodeId: string,
  eventId: string,
  sourcePath: string,
  sortOrder: number,
): Promise<{ attachmentId: string; relativePath: string; absolutePath: string; fileName: string; createTime: string; sortOrder: number }> {
  const absoluteSourcePath = path.resolve(sourcePath);
  const extension = path.extname(absoluteSourcePath).toLowerCase();
  if (!ALLOWED_REWORK_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('返修记录仅支持 png / jpg / jpeg / webp / bmp / gif 图片。');
  }

  const createTime = formatDateTime(new Date());
  const attachmentId = createCompactId();
  const safeFileName = path.basename(absoluteSourcePath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const targetDirectory = path.join(projectRootPath, '.movtools', 'lifecycle-attachments', episodeId, eventId);
  const targetFileName = `${String(sortOrder + 1).padStart(2, '0')}_${attachmentId}_${safeFileName}`;
  const absoluteTargetPath = path.join(targetDirectory, targetFileName);

  await mkdir(targetDirectory, { recursive: true });
  await copyFile(absoluteSourcePath, absoluteTargetPath);

  return {
    attachmentId,
    relativePath: normalizeStoredPath(projectRootPath, absoluteTargetPath),
    absolutePath: absoluteTargetPath,
    fileName: safeFileName,
    createTime,
    sortOrder,
  };
}

function compareVersionDesc(left: string, right: string): number {
  const leftValue = Number((normalizeVersion(left).match(/\d+/)?.[0] ?? '0'));
  const rightValue = Number((normalizeVersion(right).match(/\d+/)?.[0] ?? '0'));
  return rightValue - leftValue;
}

function readLifecycleEvents(database: DatabaseSync, episodeId: string, lensId: string, projectRootPath: string): LensLifecycleEvent[] {
  const rows = database.prepare(`
    SELECT event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time
    FROM lens_lifecycle
    WHERE episode_id = ? AND lens_id = ?
  ORDER BY event_time DESC
  `).all(episodeId, lensId) as unknown as RawLifecycleRow[];

  const attachmentMap = readLifecycleAttachmentsByEventIds(database, rows.map((row) => row.event_id), projectRootPath);

  return rows.map((row) => ({
    eventId: row.event_id,
    lensId: row.lens_id,
    eventType: row.event_type,
    title: row.title,
    detail: row.detail ?? '',
    fromStatus: row.from_status ? normalizeLensStatus(row.from_status) : undefined,
    toStatus: row.to_status ? normalizeLensStatus(row.to_status) : undefined,
    versionNum: normalizeVersion(row.version_num) || DEFAULT_VERSION_NUM,
    fileName: row.file_name,
    eventTime: row.event_time,
    editable: isEditableReworkLifecycleRow(row),
    reworkNote: isEditableReworkLifecycleRow(row) ? parseReworkNote(row.detail ?? '') : undefined,
    attachments: attachmentMap.get(row.event_id) ?? [],
  }));
}

function findLifecycleEventById(database: DatabaseSync, episodeId: string, eventId: string): RawLifecycleRow | null {
  const row = database.prepare(`
    SELECT event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time
    FROM lens_lifecycle
    WHERE episode_id = ? AND event_id = ?
  `).get(episodeId, eventId) as RawLifecycleRow | undefined;

  return row ?? null;
}

function readLifecycleAttachmentsByEventId(database: DatabaseSync, eventId: string, projectRootPath: string): LensLifecycleAttachment[] {
  if (!hasLifecycleAttachmentTable(database)) {
    return [];
  }

  const rows = database.prepare(`
    SELECT attachment_id, event_id, file_relative_path, file_name, create_time, sort_order
    FROM lens_lifecycle_attachment
    WHERE event_id = ?
    ORDER BY sort_order ASC, create_time ASC
  `).all(eventId) as unknown as RawLifecycleAttachmentRow[];

  return rows.map((row) => mapLifecycleAttachmentRow(row, projectRootPath));
}

function readLifecycleAttachmentsByEventIds(
  database: DatabaseSync,
  eventIds: string[],
  projectRootPath: string,
): Map<string, LensLifecycleAttachment[]> {
  const map = new Map<string, LensLifecycleAttachment[]>();
  if (eventIds.length === 0) {
    return map;
  }

  if (!hasLifecycleAttachmentTable(database)) {
    return map;
  }

  const placeholders = eventIds.map(() => '?').join(', ');
  const rows = database.prepare(`
    SELECT attachment_id, event_id, file_relative_path, file_name, create_time, sort_order
    FROM lens_lifecycle_attachment
    WHERE event_id IN (${placeholders})
    ORDER BY sort_order ASC, create_time ASC
  `).all(...eventIds) as unknown as RawLifecycleAttachmentRow[];

  rows.forEach((row) => {
    const list = map.get(row.event_id) ?? [];
    list.push(mapLifecycleAttachmentRow(row, projectRootPath));
    map.set(row.event_id, list);
  });

  return map;
}

function mapLifecycleAttachmentRow(row: RawLifecycleAttachmentRow, projectRootPath: string): LensLifecycleAttachment {
  const absolutePath = resolveStoredPath(projectRootPath, row.file_relative_path);
  return {
    attachmentId: row.attachment_id,
    eventId: row.event_id,
    fileName: row.file_name,
    relativePath: row.file_relative_path,
    absolutePath,
    previewUrl: pathToFileURL(absolutePath).toString(),
    createTime: row.create_time,
  };
}

function hasLifecycleAttachmentTable(database: DatabaseSync): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lens_lifecycle_attachment' LIMIT 1").get() as { name?: string } | undefined;
  return row?.name === 'lens_lifecycle_attachment';
}

function ensureLifecycleAttachmentTable(database: DatabaseSync): void {
  if (hasLifecycleAttachmentTable(database)) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS lens_lifecycle_attachment (
      attachment_id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL,
      file_relative_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      create_time TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function readRecentStatusSummaryByLensId(database: DatabaseSync, episodeId: string): Map<string, RecentStatusSummary> {
  const rows = database.prepare(`
    SELECT event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time
    FROM lens_lifecycle
    WHERE episode_id = ? AND event_type = '状态流转'
    ORDER BY event_time DESC
  `).all(episodeId) as unknown as RawLifecycleRow[];

  const summaryMap = new Map<string, RecentStatusSummary>();
  rows.forEach((row) => {
    if (summaryMap.has(row.lens_id)) {
      return;
    }

    const action = inferRecentStatusAction(row.to_status);
    summaryMap.set(row.lens_id, {
      action: action ?? undefined,
      label: getRecentStatusActionLabel(action),
      eventTime: row.event_time,
    });
  });
  return summaryMap;
}

function inferRecentStatusAction(toStatus: string | null): LensRecentStatusAction | null {
  const normalized = toStatus ? normalizeLensStatus(toStatus) : null;
  if (normalized === '提交') {
    return 'submit';
  }
  if (normalized === '通过') {
    return 'approve';
  }
  if (normalized === '返修') {
    return 'rework';
  }
  if (normalized === '关闭') {
    return 'close';
  }
  return null;
}

function getRecentStatusActionLabel(action: LensRecentStatusAction | null): string {
  if (action === 'submit') {
    return '最近提交';
  }
  if (action === 'approve') {
    return '最近通过';
  }
  if (action === 'rework') {
    return '最近返修';
  }
  if (action === 'close') {
    return '最近关闭';
  }
  return '';
}

function readLayoutCandidatesByCode(database: DatabaseSync, episodeId: string, projectRootPath: string): Map<string, LensLayoutCandidate[]> {
  const rows = database.prepare(`
    SELECT candidate_id, episode_id, lens_code, file_relative_path, file_name, source_root, source, is_selected, bind_time
    FROM lens_layout_candidate
    WHERE episode_id = ?
    ORDER BY is_selected DESC, bind_time DESC, file_name ASC
  `).all(episodeId) as unknown as RawLayoutCandidateRow[];

  return rows.reduce<Map<string, LensLayoutCandidate[]>>((accumulator, row) => {
    const mapped = mapLayoutCandidateRow(row, projectRootPath);
    const list = accumulator.get(mapped.lensCode) ?? [];
    list.push(mapped);
    accumulator.set(mapped.lensCode, list);
    return accumulator;
  }, new Map());
}

function readLayoutVideoBindingsByCode(database: DatabaseSync, episodeId: string, projectRootPath: string): Map<string, LensLayoutVideoBinding[]> {
  const rows = database.prepare(`
    SELECT binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time
    FROM lens_layout_video_binding
    WHERE episode_id = ?
    ORDER BY bind_time DESC, file_name ASC
  `).all(episodeId) as unknown as RawLayoutVideoBindingRow[];

    return rows.reduce<Map<string, LensLayoutVideoBinding[]>>((accumulator, row) => {
      const absolutePath = resolveStoredPath(projectRootPath, row.file_relative_path);
      const mapped: LensLayoutVideoBinding = {
        bindingId: row.binding_id,
        candidateId: row.candidate_id || undefined,
        lensCode: row.lens_code,
        fileName: row.file_name,
      relativePath: row.file_relative_path,
      absolutePath,
      bindTime: row.bind_time,
      exists: existsSync(absolutePath),
      sourceRoot: row.source_root ?? undefined,
    };
    const list = accumulator.get(mapped.lensCode) ?? [];
    list.push(mapped);
    accumulator.set(mapped.lensCode, list);
    return accumulator;
  }, new Map());
}

function readLayoutReferenceChecksByCode(database: DatabaseSync, episodeId: string, projectRootPath: string): Map<string, LayoutReferenceCheckRecord> {
  const rows = database.prepare(`
    SELECT check_id, episode_id, lens_code, candidate_id, layout_file_path, status, issue_count, path_missing_count, file_missing_count, filename_mismatch_count, checked_reference_count, error_message, last_check_time
    FROM layout_reference_check
    WHERE episode_id = ?
    ORDER BY last_check_time DESC, lens_code ASC
  `).all(episodeId) as unknown as RawLayoutReferenceCheckRow[];

  if (rows.length === 0) {
    return new Map();
  }

  const issueRows = database.prepare(`
    SELECT issue_id, check_id, issue_type, ref_original_path, ref_absolute_path, ref_directory, expected_file_name, core_basename, related_files_same_dir, related_files_parent_dirs
    FROM layout_reference_issue
    WHERE check_id IN (${rows.map(() => '?').join(', ')})
    ORDER BY issue_type ASC, expected_file_name ASC
  `).all(...rows.map((row) => row.check_id)) as unknown as RawLayoutReferenceIssueRow[];

  const issueMap = issueRows.reduce<Map<string, LayoutReferenceIssue[]>>((accumulator, row) => {
    const list = accumulator.get(row.check_id) ?? [];
    list.push({
      issueId: row.issue_id,
      issueType: row.issue_type,
      refOriginalPath: row.ref_original_path,
      refAbsolutePath: row.ref_absolute_path,
      refDirectory: row.ref_directory,
      expectedFileName: row.expected_file_name,
      coreBasename: row.core_basename,
      relatedFilesSameDir: parseJsonArray(row.related_files_same_dir),
      relatedFilesParentDirs: parseJsonArray(row.related_files_parent_dirs),
    });
    accumulator.set(row.check_id, list);
    return accumulator;
  }, new Map());

  const candidateMap = readLayoutCandidatesByCode(database, episodeId, projectRootPath);
  const selectedCandidates = new Map<string, LensLayoutCandidate>();
  candidateMap.forEach((list) => list.filter((candidate) => candidate.isSelected).forEach((candidate) => selectedCandidates.set(candidate.candidateId, candidate)));

  return rows.reduce<Map<string, LayoutReferenceCheckRecord>>((accumulator, row) => {
    if (accumulator.has(row.lens_code)) {
      return accumulator;
    }

    const selected = selectedCandidates.get(row.candidate_id);
    const absolutePath = selected?.absolutePath ?? resolveStoredPath(projectRootPath, row.layout_file_path);
    accumulator.set(row.lens_code, {
      checkId: row.check_id,
      episodeId: row.episode_id,
      lensCode: row.lens_code,
      candidateId: row.candidate_id,
      layoutFileName: selected?.fileName ?? path.basename(row.layout_file_path),
      layoutRelativePath: row.layout_file_path,
      layoutAbsolutePath: absolutePath,
      layoutExists: selected?.exists ?? existsSync(absolutePath),
      status: row.status,
      issueCount: row.issue_count,
      pathMissingCount: row.path_missing_count,
      fileMissingCount: row.file_missing_count,
      fileNameMismatchCount: row.filename_mismatch_count,
      checkedReferenceCount: row.checked_reference_count,
      lastCheckTime: row.last_check_time,
      errorMessage: row.error_message ?? undefined,
      issues: issueMap.get(row.check_id) ?? [],
    });
    return accumulator;
  }, new Map());
}

function mapLayoutCandidateRow(row: RawLayoutCandidateRow, projectRootPath: string): LensLayoutCandidate {
  const absolutePath = resolveStoredPath(projectRootPath, row.file_relative_path);
  return {
    candidateId: row.candidate_id,
    lensCode: row.lens_code,
    fileName: row.file_name,
    relativePath: row.file_relative_path,
    absolutePath,
    bindTime: row.bind_time,
    exists: existsSync(absolutePath),
    isSelected: row.is_selected === 1,
    source: row.source,
    sourceRoot: row.source_root ?? undefined,
  };
}

function resolveStoredPath(projectRootPath: string, storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.resolve(projectRootPath, storedPath);
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeLifecycleEvent(database: DatabaseSync, payload: {
  lensId: string;
  episodeId: string;
  eventType: LensLifecycleEvent['eventType'];
  title: string;
  detail: string;
  fromStatus?: LensStatus;
  toStatus?: LensStatus;
  versionNum: string;
  fileName: string;
  eventTime: string;
}): string {
  const eventId = createCompactId();
  database.prepare(`
    INSERT INTO lens_lifecycle (event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    payload.lensId,
    payload.episodeId,
    payload.eventType,
    payload.title,
    payload.detail || null,
    payload.fromStatus ?? null,
    payload.toStatus ?? null,
    payload.versionNum,
    payload.fileName,
    payload.eventTime,
  );

  return eventId;
}

function writeLifecycleAttachments(
  database: DatabaseSync,
  projectRootPath: string,
  episodeId: string,
  eventId: string,
  imagePaths: string[],
  createTime: string,
): void {
  imagePaths.forEach((sourcePath, index) => {
    const absoluteSourcePath = path.resolve(sourcePath);
    const extension = path.extname(absoluteSourcePath).toLowerCase();
    if (!ALLOWED_REWORK_IMAGE_EXTENSIONS.has(extension)) {
      throw new Error('返修记录仅支持 png / jpg / jpeg / webp / bmp / gif 图片。');
    }

    const attachmentId = createCompactId();
    const safeFileName = path.basename(absoluteSourcePath).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const targetDirectory = path.join(projectRootPath, '.movtools', 'lifecycle-attachments', episodeId, eventId);
    const targetFileName = `${String(index + 1).padStart(2, '0')}_${attachmentId}_${safeFileName}`;
    const absoluteTargetPath = path.join(targetDirectory, targetFileName);
    const relativePath = normalizeStoredPath(projectRootPath, absoluteTargetPath);

    if (!existsSync(targetDirectory)) {
      mkdirSync(targetDirectory, { recursive: true });
    }

    copyFileSync(absoluteSourcePath, absoluteTargetPath);

    database.prepare(`
      INSERT INTO lens_lifecycle_attachment (attachment_id, event_id, file_relative_path, file_name, create_time, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      attachmentId,
      eventId,
      relativePath,
      safeFileName,
      createTime,
      index,
    );
  });
}

function renameLensLinkedRecords(database: DatabaseSync, episodeId: string, previousLensCode: string, nextLensCode: string): void {
  database.prepare('UPDATE lens_file SET lens_code = ? WHERE episode_id = ? AND lens_code = ?').run(nextLensCode, episodeId, previousLensCode);
  try {
    database.prepare('UPDATE file_check SET lens_code = ? WHERE episode_id = ? AND lens_code = ?').run(nextLensCode, episodeId, previousLensCode);
  } catch {
    // ignore legacy file_check shape
  }
}

function deleteLensLinkedRecords(database: DatabaseSync, episodeId: string, lensId: string, lensCode: string): void {
  database.prepare('DELETE FROM lens_file WHERE episode_id = ? AND lens_code = ?').run(episodeId, lensCode);
  if (hasLifecycleAttachmentTable(database)) {
    database.prepare('DELETE FROM lens_lifecycle_attachment WHERE event_id IN (SELECT event_id FROM lens_lifecycle WHERE episode_id = ? AND lens_id = ?)').run(episodeId, lensId);
  }
  database.prepare('DELETE FROM lens_lifecycle WHERE episode_id = ? AND lens_id = ?').run(episodeId, lensId);
  try {
    database.prepare('DELETE FROM file_check WHERE episode_id = ? AND lens_code = ?').run(episodeId, lensCode);
  } catch {
    // ignore legacy file_check shape
  }
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function nullableString(value: string): DatabaseValue {
  return value.trim() ? value : null;
}

export const lensService = new LensService();
