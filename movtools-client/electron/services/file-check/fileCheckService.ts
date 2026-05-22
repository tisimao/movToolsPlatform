import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AddLayoutVideoBindingRequest,
  AddLayoutCandidateRequest,
  BindLensFileRequest,
  ExportLayoutReferenceReportRequest,
  ExportLayoutReferenceReportResponse,
  FileCheckConfigRequest,
  FileCheckProgressEvent,
  FileCheckMutationResponse,
  RefreshLensBindingsRequest,
  ScanSingleLensFileCheckRequest,
  ScanSingleLensLayoutReferenceRequest,
  SelectLayoutCandidateRequest,
} from '../../../src/types/ipc';
import type {
  BindFileType,
  FileCheckConfig,
  FileOverallStatus,
  LensLayoutCandidate,
  FileCheckRecord,
  FileCheckStatePayload,
  FileCheckSummary,
  LayoutReferenceCheckRecord,
  LayoutReferenceIssue,
  LayoutReferenceCheckStatus,
  LayoutReferenceSummary,
  LensBoundFile,
  LensLayoutVideoBinding,
  ScanRootConfigItem,
} from '../../../src/types/fileCheck';
import type { LensStatus } from '../../../src/types/lens';
import { probeVideoMetadata } from '../ffmpeg/ffprobeService';
import { projectService } from '../project/projectService';
import {
  getLensLayoutRootConflictMessage,
  getEnabledScanRootPaths,
  migrateLegacyScanRoots,
  readGroupedConfiguredScanRoots,
  replaceLayoutScanRoots,
  replaceLensScanRoots,
  type ConfiguredScanRoot,
} from '../project/scanRootService';
import { settingsService } from '../settings/settingsService';
import { loadXlsx } from '../../shared/xlsx';

interface ProjectRow {
  project_id: string;
  project_name: string;
  project_root_path: string;
  ma_check_path: string | null;
  mov_check_path: string | null;
  layout_check_path: string | null;
  create_time: string;
  update_time: string;
}

interface FileCheckRow {
  check_id: string;
  episode_id: string | null;
  lens_code: string;
  ma_status: '存在' | '缺失';
  mov_status: '存在' | '缺失';
  layout_status: '存在' | '缺失' | null;
  layout_candidate_count: number | null;
  file_overall_status: FileOverallStatus;
  last_check_time: string;
}

interface LensFileRow {
  file_id: string;
  episode_id: string | null;
  lens_code: string;
  version_num: string;
  file_type: BindFileType;
  file_relative_path: string;
  source_root: string | null;
  bind_time: string;
}

interface ActiveContext {
  project: NonNullable<Awaited<ReturnType<typeof projectService.getActiveProjectSummary>>>;
  episode: NonNullable<Awaited<ReturnType<typeof projectService.getActiveEpisodeSummary>>>;
}

interface LensLookupRow {
  lens_id: string;
  lens_code?: string;
  lens_name?: string | null;
  lens_status: string;
  version_tag?: string | null;
}

interface LensScanRow {
  lens_id: string;
  lens_code: string;
  lens_name: string | null;
  lens_status: string;
  version_tag: string | null;
  version_num: string | null;
  single_frame: number;
  frame_source_locked: number;
}

interface LayoutCandidateRow {
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

interface LayoutVideoBindingRow {
  binding_id: string;
  episode_id: string;
  lens_code: string;
  candidate_id: string;
  file_relative_path: string;
  file_name: string;
  source_root: string | null;
  bind_time: string;
}

interface LayoutReferenceCheckRow {
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

interface LayoutReferenceIssueRow {
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

interface SelectedLayoutRow extends LayoutCandidateRow {
  lens_id: string;
  lens_name: string | null;
}

interface DiscoveredLayoutFile {
  fileName: string;
  storedPath: string;
  sourceRoot: string;
  sourcePriority: number;
}

interface DiscoveredBoundFile {
  fileName: string;
  storedPath: string;
  sourceRoot: string;
  sourcePriority: number;
}

const VIDEO_FILE_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.avi', '.mxf', '.mpg', '.mpeg', '.wmv'] as const;

interface ReferenceCheckResult {
  status: LayoutReferenceCheckStatus;
  checkedReferenceCount: number;
  issueCount: number;
  pathMissingCount: number;
  fileMissingCount: number;
  fileNameMismatchCount: number;
  errorMessage?: string;
  issues: Omit<LayoutReferenceIssue, 'issueId'>[];
}

class FileCheckService {
  async getState(): Promise<FileCheckStatePayload> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return emptyState('请先在项目页创建或打开一个项目。');
    }

    await this.hydrateMissingLayoutVideoBindings(activeContext);

    return this.withDatabase(activeContext.project.databasePath, (database) => {
      const project = readProjectRow(database);
      const now = formatDateTime(new Date());
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: project?.ma_check_path,
        movCheckPath: project?.mov_check_path,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);
      const groupedRoots = readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
      const records = readFileCheckRecords(database, activeContext.episode.episodeId);
      const bindings = readLensBindings(database, activeContext.episode.episodeId, activeContext.project.projectRootPath);
      const layoutCandidates = readLayoutCandidates(database, activeContext.episode.episodeId, activeContext.project.projectRootPath);
      const layoutVideoBindings = readLayoutVideoBindings(database, activeContext.episode.episodeId, activeContext.project.projectRootPath);
      const layoutReferenceChecks = readLayoutReferenceChecks(database, activeContext.episode.episodeId, activeContext.project.projectRootPath);
      return {
        success: true,
        activeProjectId: activeContext.project.projectId,
        activeProjectName: activeContext.project.projectName,
        activeEpisodeId: activeContext.episode.episodeId,
        activeEpisodeCode: activeContext.episode.episodeCode,
        activeEpisodeName: activeContext.episode.episodeName,
        config: {
          versionTag: normalizeNamingTag(activeContext.episode.versionTag, 'ANI'),
          layoutTag: normalizeNamingTag(activeContext.episode.layoutTag, 'LAY'),
          lensFolderRootPath: activeContext.episode.lensFolderRootPath ?? '',
          layoutCheckPath: activeContext.episode.layoutCheckPath ?? '',
          lensRoots: groupedRoots.lens.map((root) => ({ ...root, fileKind: 'ma' })),
          layoutRoots: groupedRoots.layout.map((root) => ({ ...root, fileKind: 'layout' })),
        },
        records,
        bindings,
        layoutCandidates,
        layoutVideoBindings,
        summary: buildFileCheckSummary(records),
        layoutReferenceChecks,
        layoutReferenceSummary: buildLayoutReferenceSummary(layoutReferenceChecks, layoutCandidates),
      } satisfies FileCheckStatePayload;
    });
  }

  async updateConfig(request: FileCheckConfigRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const now = formatDateTime(new Date());
    return this.withDatabase(activeContext.project.databasePath, (database) => {
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: activeContext.project.maCheckPath,
        movCheckPath: activeContext.project.movCheckPath,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);
      const groupedRoots = readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });

      const normalizedLensRoots = normalizeScanRootItems(request.lensRoots, 'ma');
      const normalizedLayoutRoots = normalizeScanRootItems(request.layoutRoots ?? groupedRoots.layout, 'layout');
      const rootConflictMessage = getLensLayoutRootConflictMessage(normalizedLensRoots, normalizedLayoutRoots);
      if (rootConflictMessage) {
        return { success: false, error: rootConflictMessage } satisfies FileCheckMutationResponse;
      }

      replaceLensScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, normalizedLensRoots, now);
      replaceLayoutScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, normalizedLayoutRoots, now);

      const primaryLensPath = normalizedLensRoots
        .filter((root) => root.isEnabled && root.absolutePath.trim())
        .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0]?.absolutePath ?? '';
      const primaryLayoutPath = normalizedLayoutRoots
        .filter((root) => root.isEnabled && root.absolutePath.trim())
        .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0]?.absolutePath ?? '';

      database.prepare(`
        UPDATE project
        SET ma_check_path = ?, mov_check_path = ?, update_time = ?
        WHERE project_id = ?
      `).run(nullable(primaryLensPath), nullable(primaryLensPath), now, activeContext.project.projectId);

      database.prepare(`UPDATE episode SET lens_folder_root_path = ?, layout_check_path = ?, layout_tag = ?, update_time = ? WHERE episode_id = ?`)
        .run(nullable(primaryLensPath), nullable(primaryLayoutPath), normalizeNamingTag(request.layoutTag, 'LAY'), now, activeContext.episode.episodeId);

      writeOperateLog(database, null, '路径配置更新', null, JSON.stringify(request), now);
      return { success: true } satisfies FileCheckMutationResponse;
    });
  }

  async bindLensFile(request: BindLensFileRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const absoluteFilePath = path.resolve(request.filePath);
    const relativePath = path.relative(activeContext.project.projectRootPath, absoluteFilePath);
    if (relativePath.startsWith('..')) {
      return { success: false, error: '绑定文件必须位于当前项目目录内，便于相对路径存储。' };
    }

    try {
      const fileStats = await stat(absoluteFilePath);
      if (!fileStats.isFile()) {
        return { success: false, error: '选择的绑定路径不是文件。' };
      }
    } catch {
      return { success: false, error: '选择的绑定文件不存在。' };
    }

    const now = formatDateTime(new Date());
    return this.withDatabase(activeContext.project.databasePath, (database) => {
      const lens = database.prepare(`
        SELECT lens_id, lens_status, version_tag FROM lens WHERE episode_id = ? AND lens_code = ?
      `).get(activeContext.episode.episodeId, request.lensCode) as LensLookupRow | undefined;
      if (!lens) {
        return { success: false, error: '未找到要绑定文件的镜头。' } satisfies FileCheckMutationResponse;
      }

      const existing = database.prepare(`
        SELECT file_id FROM lens_file WHERE episode_id = ? AND lens_code = ? AND version_num = ? AND file_type = ?
      `).get(activeContext.episode.episodeId, request.lensCode, request.versionNum, request.fileType) as { file_id: string } | undefined;

      const bindingId = existing?.file_id ?? createCompactId();

      if (existing) {
        database.prepare(`
          UPDATE lens_file SET file_relative_path = ?, source_root = ?, bind_time = ? WHERE file_id = ?
        `).run(relativePath, path.dirname(absoluteFilePath), now, bindingId);
      } else {
        database.prepare(`
          INSERT INTO lens_file (file_id, episode_id, lens_code, version_num, file_type, file_relative_path, source_root, bind_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(bindingId, activeContext.episode.episodeId, request.lensCode, request.versionNum, request.fileType, relativePath, path.dirname(absoluteFilePath), now);
      }

      writeOperateLog(database, request.lensCode, '文件绑定', null, `${request.fileType}:${relativePath}`, now);
      writeLifecycleEvent(database, {
        lensId: lens.lens_id,
        episodeId: activeContext.episode.episodeId,
        eventType: '文件绑定',
        title: `${request.fileType.toUpperCase()} 文件绑定`,
        detail: `${request.fileType} → ${relativePath}`,
        versionNum: request.versionNum,
        fileName: buildFileName(request.lensCode, lens.version_tag ?? 'ANI', request.versionNum),
        toStatus: normalizeLensStatus(lens.lens_status),
        eventTime: now,
      });
      const binding: LensBoundFile = {
        bindingId,
        lensId: lens.lens_id,
        fileId: bindingId,
        lensCode: request.lensCode,
        versionNum: request.versionNum,
        fileType: request.fileType,
        bindingType: request.fileType,
        fileName: path.basename(absoluteFilePath),
        relativePath,
        bindTime: now,
        absolutePath: absoluteFilePath,
        sourceRoot: path.dirname(absoluteFilePath),
        exists: true,
      };

      return { success: true, binding } satisfies FileCheckMutationResponse;
    });
  }

  async scanMissingFiles(): Promise<FileCheckMutationResponse> {
    return this.performScan('all');
  }

  async scanLayoutCandidates(): Promise<FileCheckMutationResponse> {
    return this.performScan('layout');
  }

  async scanSingleLens(request: ScanSingleLensFileCheckRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const state = await this.getState();
    if (!state.success) {
      return { success: false, error: state.error };
    }

    const { lensRoots, layoutRoots, layoutTag, versionTag } = state.config;
    const normalizedLensRoots = normalizeScanRootItems(lensRoots, 'ma');
    const normalizedLayoutRoots = normalizeScanRootItems(layoutRoots, 'layout');
    const maScanPaths = getEnabledScanRootPaths(normalizedLensRoots, activeContext.episode.lensFolderRootPath);
    const movScanPaths = resolveMovScanPaths(normalizedLensRoots, activeContext.project.projectRootPath, activeContext.episode.lensFolderRootPath, activeContext.project.movCheckPath);
    const layoutScanPaths = getEnabledScanRootPaths(normalizedLayoutRoots);
    const maFiles = await collectBoundFilesFromRoots(maScanPaths, '.ma', activeContext.project.projectRootPath);
    const movFiles = await collectBoundFilesFromRoots(movScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const layoutFiles = await collectMatchingFilesFromRoots(layoutScanPaths, '.ma', activeContext.project.projectRootPath);
    const layoutVideoFiles = await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const now = formatDateTime(new Date());

    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const lensRow = database.prepare(`
        SELECT lens_id, lens_code, lens_name, lens_status, version_tag, version_num, single_frame, frame_source_locked FROM lens WHERE episode_id = ? AND lens_id = ?
      `).get(activeContext.episode.episodeId, request.lensId) as LensScanRow | undefined;

      if (!lensRow) {
        return { success: false, error: '未找到要检查的镜头。' } satisfies FileCheckMutationResponse;
      }

      const matchedLayouts = upsertLensFileCheck(database, {
        episodeId: activeContext.episode.episodeId,
        lensId: lensRow.lens_id,
        lensCode: lensRow.lens_code,
        lensName: lensRow.lens_name ?? '',
        lensStatus: normalizeLensStatus(lensRow.lens_status),
        versionTag: normalizeNamingTag(lensRow.version_tag ?? versionTag, versionTag),
        versionNum: normalizeVersion(lensRow.version_num ?? 'V01'),
        projectRootPath: activeContext.project.projectRootPath,
        lensFolderRootPath: activeContext.episode.lensFolderRootPath ?? undefined,
        maFiles,
        movFiles,
        layoutFiles,
        layoutTag: normalizeNamingTag(activeContext.episode.layoutTag, 'LAY'),
        now,
      });

      const frameCount = await syncLensFrameFromLayoutVideo(database, {
        projectRootPath: activeContext.project.projectRootPath,
        episodeId: activeContext.episode.episodeId,
        lensCode: lensRow.lens_code,
        frameSourceLocked: lensRow.frame_source_locked,
        singleFrame: lensRow.single_frame,
        layoutVideoFiles,
        selectedLayoutFileName: matchedLayouts[0]?.fileName,
        now,
      });
      upsertAutoMatchedLayoutVideoBinding(database, {
        projectRootPath: activeContext.project.projectRootPath,
        episodeId: activeContext.episode.episodeId,
        lensCode: lensRow.lens_code,
        layoutVideoFiles,
        now,
      });

      writeOperateLog(database, lensRow.lens_code, '单镜头文件检查', null, `镜头：${lensRow.lens_code}`, now);
      return frameCount
        ? { success: true, initializedLensFrames: [{ lensId: lensRow.lens_id, singleFrame: frameCount }] } satisfies FileCheckMutationResponse
        : { success: true } satisfies FileCheckMutationResponse;
    } finally {
      database.close();
    }
  }

  async refreshLensBindings(request: RefreshLensBindingsRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const state = await this.getState();
    if (!state.success) {
      return { success: false, error: state.error };
    }

    const normalizedLensRoots = normalizeScanRootItems(state.config.lensRoots, 'ma');
    const maScanPaths = getEnabledScanRootPaths(normalizedLensRoots, activeContext.episode.lensFolderRootPath);
    const movScanPaths = resolveMovScanPaths(normalizedLensRoots, activeContext.project.projectRootPath, activeContext.episode.lensFolderRootPath, activeContext.project.movCheckPath);
    if (maScanPaths.length === 0 && movScanPaths.length === 0) {
      return { success: false, error: '请先配置 ma / mov（拍屏）筛查路径，或先设置当前集镜头文件根目录。' };
    }

    const maFiles = await collectBoundFilesFromRoots(maScanPaths, '.ma', activeContext.project.projectRootPath);
    const movFiles = await collectBoundFilesFromRoots(movScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const groupedRoots = this.withDatabase(activeContext.project.databasePath, (database) => {
      const project = readProjectRow(database);
      const now = formatDateTime(new Date());
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: project?.ma_check_path,
        movCheckPath: project?.mov_check_path,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);
      return readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
    });
    const layoutRoots = normalizeScanRootItems(groupedRoots.layout, 'layout');
    const layoutScanPaths = getEnabledScanRootPaths(layoutRoots);
    const layoutFiles = layoutScanPaths.length > 0
      ? await collectMatchingFilesFromRoots(layoutScanPaths, '.ma', activeContext.project.projectRootPath)
      : [];
    const layoutVideoFiles = layoutScanPaths.length > 0
      ? await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath)
      : [];
    const now = formatDateTime(new Date());
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const placeholders = request.lensIds.map(() => '?').join(', ');
      const lenses = database.prepare(`
        SELECT lens_id, lens_code, lens_name, lens_status, version_tag, version_num, single_frame
        FROM lens
        WHERE episode_id = ? AND lens_id IN (${placeholders})
        ORDER BY lens_code ASC
      `).all(activeContext.episode.episodeId, ...request.lensIds) as unknown as LensScanRow[];

      if (lenses.length === 0) {
        return { success: false, error: '未找到要刷新的镜头。' } satisfies FileCheckMutationResponse;
      }

      const initializedLensFrames: Array<{ lensId: string; singleFrame: number }> = [];

      for (const lens of lenses) {
        refreshLensBindingStatus(database, {
          episodeId: activeContext.episode.episodeId,
          lensId: lens.lens_id,
          lensCode: lens.lens_code,
          lensStatus: normalizeLensStatus(lens.lens_status),
          versionTag: normalizeNamingTag(lens.version_tag ?? state.config.versionTag, state.config.versionTag),
          versionNum: normalizeVersion(lens.version_num ?? 'V01'),
          projectRootPath: activeContext.project.projectRootPath,
          lensFolderRootPath: activeContext.episode.lensFolderRootPath ?? undefined,
          maFiles,
          movFiles,
          now,
        });

        if (layoutFiles.length > 0) {
          upsertLensFileCheck(database, {
            episodeId: activeContext.episode.episodeId,
            lensId: lens.lens_id,
            lensCode: lens.lens_code,
            lensName: lens.lens_name ?? '',
            lensStatus: normalizeLensStatus(lens.lens_status),
            versionTag: normalizeNamingTag(lens.version_tag ?? state.config.versionTag, state.config.versionTag),
            versionNum: normalizeVersion(lens.version_num ?? 'V01'),
            projectRootPath: activeContext.project.projectRootPath,
            lensFolderRootPath: activeContext.episode.lensFolderRootPath ?? undefined,
            maFiles,
            movFiles,
            layoutFiles,
            layoutTag: normalizeNamingTag(activeContext.episode.layoutTag, 'LAY'),
            now,
          });
        }

        upsertAutoMatchedLayoutVideoBinding(database, {
          projectRootPath: activeContext.project.projectRootPath,
          episodeId: activeContext.episode.episodeId,
          lensCode: lens.lens_code,
          layoutVideoFiles,
          preserveExistingBinding: true,
          now,
        });

        const frameCount = await syncLensFrameFromLayoutVideo(database, {
          projectRootPath: activeContext.project.projectRootPath,
          episodeId: activeContext.episode.episodeId,
          lensCode: lens.lens_code,
          frameSourceLocked: lens.frame_source_locked,
          singleFrame: lens.single_frame,
          layoutVideoFiles,
          selectedLayoutFileName: undefined,
          now,
        });
        if ((frameCount ?? 0) > 0) {
          initializedLensFrames.push({ lensId: lens.lens_id, singleFrame: frameCount ?? 0 });
        }
      }

      writeOperateLog(database, null, '批量刷新文件匹配', null, `镜头数量：${lenses.length}`, now);
      return { success: true, initializedLensFrames } satisfies FileCheckMutationResponse;
    } finally {
      database.close();
    }
  }

  async scanLayoutReferences(): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const now = formatDateTime(new Date());
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const selectedLayouts = readSelectedLayoutCandidates(database, activeContext.episode.episodeId);
      if (selectedLayouts.length === 0) {
        return { success: false, error: '当前集还没有“当前采用”的 layout，可先扫描并设置采用项。' } satisfies FileCheckMutationResponse;
      }

      emitFileCheckProgress({ mode: 'reference', phase: 'started', message: '开始批量检查当前采用 layout 的引用…', logLine: `[开始] layout 引用排查，共 ${selectedLayouts.length} 条镜头` });
      deleteLayoutReferenceChecksByEpisode(database, activeContext.episode.episodeId);

      for (let index = 0; index < selectedLayouts.length; index += 1) {
        const selected = selectedLayouts[index];
        emitFileCheckProgress({ mode: 'reference', phase: 'matching', message: `正在检查 ${index + 1} / ${selectedLayouts.length}：${selected.lens_code}`, current: index + 1, total: selectedLayouts.length, logLine: `[匹配] ${selected.lens_code} · ${selected.file_name}` });
        const result = await evaluateLayoutReferenceCandidate(activeContext.project.projectRootPath, selected);
        writeLayoutReferenceCheck(database, activeContext.episode.episodeId, selected, result, now);
        emitFileCheckProgress({ mode: 'reference', phase: 'matching', message: `${selected.lens_code} 完成：${result.status}，问题 ${result.issueCount} 项`, current: index + 1, total: selectedLayouts.length, logLine: `[结果] ${selected.lens_code} · ${result.status} · 问题 ${result.issueCount}` });
      }

      writeOperateLog(database, null, 'Layout引用排查', null, `镜头数量：${selectedLayouts.length}`, now);
      emitFileCheckProgress({ mode: 'reference', phase: 'completed', message: `layout 引用排查完成，共处理 ${selectedLayouts.length} 条镜头。`, current: selectedLayouts.length, total: selectedLayouts.length, logLine: `[完成] 共处理 ${selectedLayouts.length} 条镜头`, success: true });
      return { success: true } satisfies FileCheckMutationResponse;
    } finally {
      database.close();
    }
  }

  async scanSingleLensLayoutReferences(request: ScanSingleLensLayoutReferenceRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const now = formatDateTime(new Date());
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const selected = readSelectedLayoutCandidateByLensId(database, activeContext.episode.episodeId, request.lensId);
      if (!selected) {
        return { success: false, error: '该镜头还没有当前采用的 layout，无法执行引用排查。' } satisfies FileCheckMutationResponse;
      }

      emitFileCheckProgress({ mode: 'reference', phase: 'started', message: `开始检查 ${selected.lens_code} 的 layout 引用…`, current: 0, total: 1, logLine: `[开始] 单镜头 layout 引用排查：${selected.lens_code}` });
      deleteLayoutReferenceCheckByCandidate(database, activeContext.episode.episodeId, selected.candidate_id);
      const result = await evaluateLayoutReferenceCandidate(activeContext.project.projectRootPath, selected);
      writeLayoutReferenceCheck(database, activeContext.episode.episodeId, selected, result, now);
      writeOperateLog(database, selected.lens_code, '单镜头Layout引用排查', null, `${selected.lens_code} · ${selected.file_name}`, now);
      emitFileCheckProgress({ mode: 'reference', phase: 'completed', message: `${selected.lens_code} layout 引用排查完成。`, current: 1, total: 1, logLine: `[完成] ${selected.lens_code} · ${result.status} · 问题 ${result.issueCount}`, success: true });
      return { success: true } satisfies FileCheckMutationResponse;
    } finally {
      database.close();
    }
  }

  async exportLayoutReferenceReport(request: ExportLayoutReferenceReportRequest & { filePath: string }): Promise<ExportLayoutReferenceReportResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    try {
      const rows = this.withDatabase(activeContext.project.databasePath, (database) => readLayoutReferenceChecks(database, activeContext.episode.episodeId, activeContext.project.projectRootPath));
      const filteredRows = rows.filter((row) => matchesLayoutReferenceExportFilter(row, request));
      const exportRows = filteredRows
        .map((row) => ({
          镜头编号: row.lensCode,
          Layout文件: row.layoutFileName,
          Layout路径: row.layoutRelativePath,
          检查状态: row.status,
          检查引用数: row.checkedReferenceCount,
          问题总数: row.issueCount,
          路径不存在: row.pathMissingCount,
          文件不存在: row.fileMissingCount,
          文件名不匹配: row.fileNameMismatchCount,
          问题引用路径: summarizeReferencePaths(row, request.issueType),
          说明: row.errorMessage ?? (row.issueCount > 0 ? row.issues.map((issue) => `${issue.issueType}：${issue.expectedFileName}`).join('；') : '引用完整'),
          检查时间: row.lastCheckTime,
        }));

      if (exportRows.length === 0) {
        return { success: false, error: '当前没有可导出的 layout 引用问题。' };
      }

      const xlsx = await loadXlsx();
      const workbook = xlsx.utils.book_new();
      const summarySheet = xlsx.utils.json_to_sheet(exportRows);
      summarySheet['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 48 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 56 }, { wch: 44 }, { wch: 20 }];
      xlsx.utils.book_append_sheet(workbook, summarySheet, '引用问题汇总');

      const detailRows = filteredRows
        .flatMap((row) => row.issues
          .filter((issue) => request.issueType === undefined || request.issueType === 'all' ? true : issue.issueType === request.issueType)
          .map((issue) => ({
          镜头编号: row.lensCode,
          Layout文件: row.layoutFileName,
          问题类型: issue.issueType,
          Maya原始路径: issue.refOriginalPath,
          绝对路径: issue.refAbsolutePath,
          期望文件名: issue.expectedFileName,
          核心主体名: issue.coreBasename,
          同目录候选: issue.relatedFilesSameDir.join(' | '),
          上层目录候选: issue.relatedFilesParentDirs.join(' | '),
        })));

      if (detailRows.length > 0) {
        const detailSheet = xlsx.utils.json_to_sheet(detailRows);
        detailSheet['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 18 }, { wch: 40 }, { wch: 52 }, { wch: 24 }, { wch: 20 }, { wch: 40 }, { wch: 40 }];
        xlsx.utils.book_append_sheet(workbook, detailSheet, '引用问题明细');
      }

      const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
      await writeFile(request.filePath, buffer);
      return { success: true, filePath: request.filePath, exportedCount: exportRows.length } satisfies ExportLayoutReferenceReportResponse;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '导出 layout 引用报告失败。' } satisfies ExportLayoutReferenceReportResponse;
    }
  }

  private async performScan(mode: 'all' | 'layout'): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const state = await this.getState();
    if (!state.success) {
      return { success: false, error: state.error };
    }

    const normalizedLensRoots = normalizeScanRootItems(state.config.lensRoots, 'ma');
    const normalizedLayoutRoots = normalizeScanRootItems(state.config.layoutRoots, 'layout');
    const { layoutTag, versionTag } = state.config;
    const maScanPaths = getEnabledScanRootPaths(normalizedLensRoots, activeContext.episode.lensFolderRootPath);
    const movScanPaths = resolveMovScanPaths(normalizedLensRoots, activeContext.project.projectRootPath, activeContext.episode.lensFolderRootPath, activeContext.project.movCheckPath);
    const layoutScanPaths = getEnabledScanRootPaths(normalizedLayoutRoots);
    if (mode === 'all' && maScanPaths.length === 0 && movScanPaths.length === 0 && layoutScanPaths.length === 0) {
      return { success: false, error: '请至少配置 ma、mov（拍屏）或 layout 的筛查路径；未配置 ma/mov 时会默认使用当前集镜头文件根目录。' };
    }
    if (mode === 'layout' && layoutScanPaths.length === 0) {
      return { success: false, error: '请先配置当前集的 layout Maya 根目录。' };
    }

    emitFileCheckProgress({ mode, phase: 'started', message: mode === 'layout' ? '开始批量扫描 layout 文件…' : '开始执行文件检查…', logLine: mode === 'layout' ? '[开始] 批量扫描 layout 文件' : '[开始] 执行文件检查' });

    emitFileCheckProgress({ mode, phase: 'scanning', message: '正在扫描 ma 目录…', logLine: `[扫描] ma 路径：${maScanPaths.length > 0 ? maScanPaths.join(' ; ') : '未配置且未找到镜头文件根目录，跳过'}` });
    const maFiles = await collectBoundFilesFromRoots(maScanPaths, '.ma', activeContext.project.projectRootPath);
    emitFileCheckProgress({ mode, phase: 'scanning', message: `ma 扫描完成，发现 ${maFiles.length} 个候选。`, logLine: `[完成] ma 候选数量：${maFiles.length}` });

    emitFileCheckProgress({ mode, phase: 'scanning', message: '正在扫描视频（拍屏）目录…', logLine: `[扫描] 视频路径：${movScanPaths.length > 0 ? movScanPaths.join(' ; ') : '未配置且未找到镜头文件根目录，跳过'} · 扩展名：${VIDEO_FILE_EXTENSIONS.join(', ')}` });
    const movFiles = await collectBoundFilesFromRoots(movScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    emitFileCheckProgress({ mode, phase: 'scanning', message: `视频扫描完成，发现 ${movFiles.length} 个候选。`, logLine: `[完成] 视频候选数量：${movFiles.length}` });

    emitFileCheckProgress({ mode, phase: 'scanning', message: '正在递归扫描 layout Maya 根目录…', logLine: `[扫描] layout 路径：${layoutScanPaths.length > 0 ? layoutScanPaths.join(' ; ') : '未配置，跳过'}` });
    const layoutFiles = await collectMatchingFilesFromRoots(layoutScanPaths, '.ma', activeContext.project.projectRootPath);
    emitFileCheckProgress({ mode, phase: 'scanning', message: `layout 扫描完成，发现 ${layoutFiles.length} 个 Maya 文件。`, logLine: `[完成] layout Maya 文件数量：${layoutFiles.length}` });
    emitFileCheckProgress({ mode, phase: 'scanning', message: '正在扫描 layout 视频目录…', logLine: `[扫描] layout 视频路径：${layoutScanPaths.length > 0 ? layoutScanPaths.join(' ; ') : '未配置，跳过'} · 扩展名：${VIDEO_FILE_EXTENSIONS.join(', ')}` });
    const layoutVideoFiles = await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    emitFileCheckProgress({ mode, phase: 'scanning', message: `layout 视频扫描完成，发现 ${layoutVideoFiles.length} 个候选。`, logLine: `[完成] layout 视频候选数量：${layoutVideoFiles.length}` });
    const now = formatDateTime(new Date());

    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const lenses = database.prepare(`SELECT lens_id, lens_code, lens_name, lens_status, version_tag, version_num, single_frame, frame_source_locked FROM lens WHERE episode_id = ? ORDER BY lens_code ASC`).all(activeContext.episode.episodeId) as unknown as LensScanRow[];
      emitFileCheckProgress({ mode, phase: 'matching', message: `开始匹配 ${lenses.length} 条镜头…`, current: 0, total: lenses.length, logLine: `[匹配] 镜头总数：${lenses.length}` });

      database.prepare(`DELETE FROM file_check WHERE episode_id = ?`).run(activeContext.episode.episodeId);
      database.prepare(`DELETE FROM lens_layout_candidate WHERE episode_id = ? AND source = 'auto-scan'`).run(activeContext.episode.episodeId);
      deleteLayoutReferenceChecksByEpisode(database, activeContext.episode.episodeId);

      const initializedLensFrames: Array<{ lensId: string; singleFrame: number }> = [];

      for (const [index, lens] of lenses.entries()) {
        const { lens_id: lensId, lens_code: lensCode, lens_name: lensName, lens_status: lensStatus, version_tag: versionTag, version_num: versionNum, single_frame: singleFrame, frame_source_locked: frameSourceLocked } = lens;
        emitFileCheckProgress({ mode, phase: 'matching', message: `正在匹配镜头 ${index + 1} / ${lenses.length}：${lensCode}`, current: index + 1, total: lenses.length, logLine: `[匹配] ${lensCode}` });
        const matchedLayouts = upsertLensFileCheck(database, {
          episodeId: activeContext.episode.episodeId,
          lensId,
          lensCode,
          lensName: lensName ?? '',
          lensStatus: normalizeLensStatus(lensStatus),
          versionTag: normalizeNamingTag(versionTag ?? state.config.versionTag, state.config.versionTag),
          versionNum: normalizeVersion(versionNum ?? 'V01'),
          projectRootPath: activeContext.project.projectRootPath,
          lensFolderRootPath: activeContext.episode.lensFolderRootPath ?? undefined,
          maFiles,
          movFiles,
          layoutFiles,
          layoutTag,
          now,
        });
        const frameCount = await syncLensFrameFromLayoutVideo(database, {
          projectRootPath: activeContext.project.projectRootPath,
          episodeId: activeContext.episode.episodeId,
          lensCode,
          frameSourceLocked,
          singleFrame,
          layoutVideoFiles,
          selectedLayoutFileName: matchedLayouts[0]?.fileName,
          now,
        });
        if ((frameCount ?? 0) > 0) {
          initializedLensFrames.push({ lensId, singleFrame: frameCount ?? 0 });
        }
        upsertAutoMatchedLayoutVideoBinding(database, {
          projectRootPath: activeContext.project.projectRootPath,
          episodeId: activeContext.episode.episodeId,
          lensCode,
          layoutVideoFiles,
          now,
        });
        emitFileCheckProgress({ mode, phase: 'matching', message: `${lensCode} 匹配到 ${matchedLayouts.length} 个 layout 候选。`, current: index + 1, total: lenses.length, logLine: `[结果] ${lensCode} · layout 候选 ${matchedLayouts.length}` });
      }

      emitFileCheckProgress({ mode, phase: 'writing', message: '正在写入检查结果…', logLine: '[写入] 文件检查结果已写入数据库' });
      writeOperateLog(database, null, '前期文件筛查', null, `镜头数量：${lenses.length}`, now);
      emitFileCheckProgress({ mode, phase: 'completed', message: `文件检查完成，共处理 ${lenses.length} 条镜头。`, current: lenses.length, total: lenses.length, logLine: `[完成] 共处理 ${lenses.length} 条镜头`, success: true });
      return { success: true } satisfies FileCheckMutationResponse;
    } catch (error) {
      emitFileCheckProgress({ mode, phase: 'failed', message: error instanceof Error ? error.message : '文件检查失败。', logLine: `[失败] ${error instanceof Error ? error.message : '文件检查失败。'}`, success: false });
      throw error;
    } finally {
      database.close();
    }
  }

  async selectLayoutCandidate(request: SelectLayoutCandidateRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const response = this.withDatabase(activeContext.project.databasePath, (database) => {
      const existing = database.prepare(`
        SELECT candidate_id FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ? AND candidate_id = ?
      `).get(activeContext.episode.episodeId, request.lensCode, request.candidateId) as { candidate_id: string } | undefined;
      if (!existing) {
        return { success: false, error: '未找到要设置的 layout 文件。' } satisfies FileCheckMutationResponse;
      }

      database.prepare(`
        UPDATE lens_layout_candidate
        SET is_selected = CASE WHEN candidate_id = ? THEN 1 ELSE 0 END
        WHERE episode_id = ? AND lens_code = ?
      `).run(request.candidateId, activeContext.episode.episodeId, request.lensCode);

      return { success: true } satisfies FileCheckMutationResponse;
    });

    if (!response.success) {
      return response;
    }

    const refreshResponse = await this.refreshAutoMatchedLayoutVideoBinding(activeContext, request.lensCode);
    if (!refreshResponse.success) {
      return { success: false, error: `当前采用项已更新，但自动刷新 Layout 视频匹配失败：${refreshResponse.error}` };
    }

    const syncResponse = await this.syncLensFrameFromCurrentLayoutVideo(activeContext, request.lensCode, request.candidateId);
    return syncResponse.success
      ? response
      : { success: false, error: `当前采用项已更新，但 Layout 视频帧数初始化失败：${syncResponse.error}` };
  }

  async addLayoutCandidate(request: AddLayoutCandidateRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const absoluteFilePath = path.resolve(request.filePath);
    try {
      const fileStats = await stat(absoluteFilePath);
      if (!fileStats.isFile() || path.extname(absoluteFilePath).toLowerCase() !== '.ma') {
        return { success: false, error: '请选择有效的 layout Maya 文件（.ma）。' };
      }
    } catch {
      return { success: false, error: '选择的 layout 文件不存在。' };
    }

    const storedPath = toStoredPath(activeContext.project.projectRootPath, absoluteFilePath);
    const fileName = path.basename(absoluteFilePath);
    const now = formatDateTime(new Date());

    const response = this.withDatabase(activeContext.project.databasePath, (database) => {
      const candidateId = createCompactId();
      database.prepare(`
        INSERT INTO lens_layout_candidate (candidate_id, episode_id, lens_code, file_relative_path, file_name, source_root, source, is_selected, bind_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(candidateId, activeContext.episode.episodeId, request.lensCode, storedPath, fileName, path.dirname(absoluteFilePath), 'manual', request.selectAfterAdd ? 1 : 0, now);

      if (request.selectAfterAdd) {
        database.prepare(`
          UPDATE lens_layout_candidate
          SET is_selected = CASE WHEN candidate_id = ? THEN 1 ELSE 0 END
          WHERE episode_id = ? AND lens_code = ?
        `).run(candidateId, activeContext.episode.episodeId, request.lensCode);
      }

      return { success: true } satisfies FileCheckMutationResponse;
    });

    if (!response.success) {
      return response;
    }

    if (!request.selectAfterAdd) {
      return response;
    }

    const syncResponse = await this.syncLensFrameFromCurrentLayoutVideo(activeContext, request.lensCode);
    return syncResponse.success
      ? response
      : { success: false, error: `layout 已添加，但 Layout 视频帧数初始化失败：${syncResponse.error}` };
  }

  async addLayoutVideoBinding(request: AddLayoutVideoBindingRequest): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const absoluteFilePath = path.resolve(request.filePath);
    try {
      const fileStats = await stat(absoluteFilePath);
      if (!fileStats.isFile() || !VIDEO_FILE_EXTENSIONS.includes(path.extname(absoluteFilePath).toLowerCase() as (typeof VIDEO_FILE_EXTENSIONS)[number])) {
        return { success: false, error: '请选择有效的 Layout 视频文件。' };
      }
    } catch {
      return { success: false, error: '选择的 Layout 视频不存在。' };
    }

    const storedPath = toStoredPath(activeContext.project.projectRootPath, absoluteFilePath);
    const fileName = path.basename(absoluteFilePath);
    const now = formatDateTime(new Date());

    const response = this.withDatabase(activeContext.project.databasePath, (database) => {
      const candidate = database.prepare(`
        SELECT candidate_id FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ? AND candidate_id = ?
      `).get(activeContext.episode.episodeId, request.lensCode, request.candidateId) as { candidate_id: string } | undefined;
      if (!candidate) {
        return { success: false, error: '未找到要绑定视频的 Layout Maya 候选。' } satisfies FileCheckMutationResponse;
      }

      const existing = database.prepare(`
        SELECT binding_id FROM lens_layout_video_binding WHERE episode_id = ? AND candidate_id = ?
      `).get(activeContext.episode.episodeId, request.candidateId) as { binding_id: string } | undefined;

      if (existing) {
        database.prepare(`
          UPDATE lens_layout_video_binding SET file_relative_path = ?, file_name = ?, source_root = ?, bind_time = ? WHERE binding_id = ?
        `).run(storedPath, fileName, path.dirname(absoluteFilePath), now, existing.binding_id);
      } else {
        database.prepare(`
          INSERT INTO lens_layout_video_binding (binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(createCompactId(), activeContext.episode.episodeId, request.lensCode, request.candidateId, storedPath, fileName, path.dirname(absoluteFilePath), now);
      }

      return { success: true } satisfies FileCheckMutationResponse;
    });

    if (!response.success) {
      return response;
    }

    const syncResponse = await this.syncLensFrameFromCurrentLayoutVideo(activeContext, request.lensCode, request.candidateId);
    return syncResponse.success
      ? response
      : { success: false, error: `Layout 视频已绑定，但帧数初始化失败：${syncResponse.error}` };
  }

  async openBoundFile(fileId: string): Promise<FileCheckMutationResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const boundFile = this.withDatabase(activeContext.project.databasePath, (database) => {
      const row = database.prepare(`
        SELECT file_id, episode_id, lens_code, version_num, file_type, file_relative_path, source_root, bind_time
        FROM lens_file WHERE file_id = ?
      `).get(fileId) as LensFileRow | undefined;

      return row ? mapLensFileRow(row, activeContext.project.projectRootPath) : null;
    });

    if (!boundFile) {
      return { success: false, error: '未找到绑定文件。' };
    }

    const openError = await (await import('electron')).shell.openPath(boundFile.absolutePath);
    if (openError) {
      return { success: false, error: `打开文件失败：${openError}` };
    }

    return { success: true };
  }

  private withDatabase<T>(databasePath: string, action: (database: DatabaseSync) => T): T {
    const database = new DatabaseSync(databasePath);
    try {
      return action(database);
    } finally {
      database.close();
    }
  }

  private async requireActiveContext(): Promise<ActiveContext | null> {
    const project = await projectService.getActiveProjectSummary();
    const episode = await projectService.getActiveEpisodeSummary();
    if (!project || !episode || episode.projectId !== project.projectId) {
      return null;
    }

    return { project, episode };
  }

  private async refreshAutoMatchedLayoutVideoBinding(activeContext: ActiveContext, lensCode: string): Promise<FileCheckMutationResponse> {
    const groupedRoots = this.withDatabase(activeContext.project.databasePath, (database) => {
      const project = readProjectRow(database);
      const now = formatDateTime(new Date());
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: project?.ma_check_path,
        movCheckPath: project?.mov_check_path,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);
      return readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
    });

    const layoutRoots = normalizeScanRootItems(groupedRoots.layout, 'layout');
    const layoutScanPaths = getEnabledScanRootPaths(layoutRoots);
    if (layoutScanPaths.length === 0) {
      return { success: true };
    }

    const layoutVideoFiles = await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const now = formatDateTime(new Date());
    this.withDatabase(activeContext.project.databasePath, (database) => {
      upsertAutoMatchedLayoutVideoBinding(database, {
        projectRootPath: activeContext.project.projectRootPath,
        episodeId: activeContext.episode.episodeId,
        lensCode,
        layoutVideoFiles,
        preserveExistingBinding: true,
        now,
      });
    });

    return { success: true };
  }

  private async syncLensFrameFromCurrentLayoutVideo(activeContext: ActiveContext, lensCode: string, candidateId?: string): Promise<FileCheckMutationResponse> {
    const snapshot = this.withDatabase(activeContext.project.databasePath, (database) => {
      const project = readProjectRow(database);
      const now = formatDateTime(new Date());
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: project?.ma_check_path,
        movCheckPath: project?.mov_check_path,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);

      const groupedRoots = readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
      const lensRow = database.prepare(`
        SELECT single_frame, frame_source_locked FROM lens WHERE episode_id = ? AND lens_code = ?
      `).get(activeContext.episode.episodeId, lensCode) as { single_frame?: number; frame_source_locked?: number } | undefined;
      const selectedLayout = candidateId
        ? database.prepare(`
          SELECT file_name FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ? AND candidate_id = ?
        `).get(activeContext.episode.episodeId, lensCode, candidateId) as { file_name: string } | undefined
        : undefined;
      const fallbackSelectedLayout = selectedLayout ?? database.prepare(`
        SELECT file_name FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ? AND is_selected = 1 ORDER BY bind_time DESC LIMIT 1
      `).get(activeContext.episode.episodeId, lensCode) as { file_name: string } | undefined;

      return {
        groupedRoots,
        frameSourceLocked: lensRow?.frame_source_locked ?? 1,
        singleFrame: lensRow?.single_frame ?? 0,
        selectedLayoutFileName: fallbackSelectedLayout?.file_name,
      };
    });

    const layoutRoots = normalizeScanRootItems(snapshot.groupedRoots.layout, 'layout');
    const layoutScanPaths = getEnabledScanRootPaths(layoutRoots);
    if (layoutScanPaths.length === 0) {
      return { success: true };
    }

    const layoutVideoFiles = await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      await syncLensFrameFromLayoutVideo(database, {
        projectRootPath: activeContext.project.projectRootPath,
        episodeId: activeContext.episode.episodeId,
        lensCode,
        frameSourceLocked: snapshot.frameSourceLocked,
        singleFrame: snapshot.singleFrame,
        layoutVideoFiles,
        selectedLayoutFileName: snapshot.selectedLayoutFileName,
        now: formatDateTime(new Date()),
      });
      return { success: true };
    } finally {
      database.close();
    }
  }

  private async hydrateMissingLayoutVideoBindings(activeContext: ActiveContext): Promise<void> {
    const hydrationContext = this.withDatabase(activeContext.project.databasePath, (database) => {
      const project = readProjectRow(database);
      const now = formatDateTime(new Date());
      migrateLegacyScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      }, {
        maCheckPath: project?.ma_check_path,
        movCheckPath: project?.mov_check_path,
        layoutCheckPath: activeContext.episode.layoutCheckPath,
      }, now);

      const groupedRoots = readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
      const selectedLayouts = readSelectedLayoutCandidates(database, activeContext.episode.episodeId);
      const bindingRows = database.prepare(`
        SELECT candidate_id, file_relative_path FROM lens_layout_video_binding WHERE episode_id = ?
      `).all(activeContext.episode.episodeId) as Array<{ candidate_id: string; file_relative_path: string }>;
      const bindingPathMap = new Map(bindingRows.map((row) => [row.candidate_id, row.file_relative_path]));

      return {
        groupedRoots,
        missingLensCodes: selectedLayouts
          .filter((selected) => {
            const boundPath = bindingPathMap.get(selected.candidate_id);
            if (!boundPath) {
              return true;
            }

            return !existsSync(resolveStoredPath(activeContext.project.projectRootPath, boundPath));
          })
          .map((selected) => selected.lens_code),
      };
    });

    if (hydrationContext.missingLensCodes.length === 0) {
      return;
    }

    const layoutRoots = normalizeScanRootItems(hydrationContext.groupedRoots.layout, 'layout');
    const layoutScanPaths = getEnabledScanRootPaths(layoutRoots);
    if (layoutScanPaths.length === 0) {
      return;
    }

    const layoutVideoFiles = await collectBoundFilesFromRoots(layoutScanPaths, VIDEO_FILE_EXTENSIONS, activeContext.project.projectRootPath);
    const now = formatDateTime(new Date());
    this.withDatabase(activeContext.project.databasePath, (database) => {
      hydrationContext.missingLensCodes.forEach((lensCode) => {
        upsertAutoMatchedLayoutVideoBinding(database, {
          projectRootPath: activeContext.project.projectRootPath,
          episodeId: activeContext.episode.episodeId,
          lensCode,
          layoutVideoFiles,
          preserveExistingBinding: true,
          now,
        });
      });
    });
  }
}

function readProjectRow(database: DatabaseSync): ProjectRow | null {
  const row = database.prepare(`
    SELECT project_id, project_name, project_root_path, ma_check_path, mov_check_path, layout_check_path, create_time, update_time
    FROM project LIMIT 1
  `).get() as ProjectRow | undefined;
  return row ?? null;
}

function readFileCheckRecords(database: DatabaseSync, episodeId: string): FileCheckRecord[] {
  const rows = database.prepare(`
    SELECT check_id, episode_id, lens_code, ma_status, mov_status, layout_status, layout_candidate_count, file_overall_status, last_check_time
    FROM file_check WHERE episode_id = ? ORDER BY lens_code ASC
  `).all(episodeId) as unknown as FileCheckRow[];

  return rows.map((row) => ({
    checkId: row.check_id,
    episodeId: row.episode_id ?? '',
    lensCode: row.lens_code,
    maStatus: row.ma_status,
    movStatus: row.mov_status,
    layoutStatus: row.layout_status ?? '缺失',
    layoutCandidateCount: row.layout_candidate_count ?? 0,
    overallStatus: row.file_overall_status,
    lastCheckTime: row.last_check_time,
  }));
}

function readLayoutCandidates(database: DatabaseSync, episodeId: string, projectRootPath: string): Record<string, LensLayoutCandidate[]> {
  const rows = database.prepare(`
    SELECT candidate_id, episode_id, lens_code, file_relative_path, file_name, source_root, source, is_selected, bind_time
    FROM lens_layout_candidate
    WHERE episode_id = ?
    ORDER BY is_selected DESC, bind_time DESC, file_name ASC
  `).all(episodeId) as unknown as LayoutCandidateRow[];

  return rows.reduce<Record<string, LensLayoutCandidate[]>>((accumulator, row) => {
    const mapped = mapLayoutCandidateRow(row, projectRootPath);
    accumulator[mapped.lensCode] ??= [];
    accumulator[mapped.lensCode].push(mapped);
    return accumulator;
  }, {});
}

function readLayoutVideoBindings(database: DatabaseSync, episodeId: string, projectRootPath: string): Record<string, LensLayoutVideoBinding[]> {
  const rows = database.prepare(`
    SELECT binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time
    FROM lens_layout_video_binding WHERE episode_id = ? ORDER BY bind_time DESC
  `).all(episodeId) as unknown as LayoutVideoBindingRow[];

  return rows.reduce<Record<string, LensLayoutVideoBinding[]>>((accumulator, row) => {
    const mapped = mapLayoutVideoBindingRow(row, projectRootPath);
    accumulator[mapped.lensCode] ??= [];
    accumulator[mapped.lensCode].push(mapped);
    return accumulator;
  }, {});
}

function readLayoutReferenceChecks(database: DatabaseSync, episodeId: string, projectRootPath: string): LayoutReferenceCheckRecord[] {
  const checkRows = database.prepare(`
    SELECT check_id, episode_id, lens_code, candidate_id, layout_file_path, status, issue_count, path_missing_count, file_missing_count, filename_mismatch_count, checked_reference_count, error_message, last_check_time
    FROM layout_reference_check
    WHERE episode_id = ?
    ORDER BY issue_count DESC, last_check_time DESC, lens_code ASC
  `).all(episodeId) as unknown as LayoutReferenceCheckRow[];

  if (checkRows.length === 0) {
    return [];
  }

  const issueRows = database.prepare(`
    SELECT issue_id, check_id, issue_type, ref_original_path, ref_absolute_path, ref_directory, expected_file_name, core_basename, related_files_same_dir, related_files_parent_dirs
    FROM layout_reference_issue
    WHERE check_id IN (${checkRows.map(() => '?').join(', ')})
    ORDER BY issue_type ASC, expected_file_name ASC
  `).all(...checkRows.map((row) => row.check_id)) as unknown as LayoutReferenceIssueRow[];

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

  const selectedLayoutMap = readLayoutCandidates(database, episodeId, projectRootPath);
  const selectedLookup = new Map<string, LensLayoutCandidate>();
  Object.values(selectedLayoutMap).flat().filter((candidate) => candidate.isSelected).forEach((candidate) => {
    selectedLookup.set(candidate.candidateId, candidate);
  });

  return checkRows.map((row) => {
    const selected = selectedLookup.get(row.candidate_id);
    const absolutePath = selected?.absolutePath ?? resolveStoredPath(projectRootPath, row.layout_file_path);
    return {
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
    } satisfies LayoutReferenceCheckRecord;
  });
}

function buildLayoutReferenceSummary(checks: LayoutReferenceCheckRecord[], layoutCandidates: Record<string, LensLayoutCandidate[]>): LayoutReferenceSummary {
  const selectedLayoutLensCount = Object.values(layoutCandidates).filter((candidates) => candidates.some((candidate) => candidate.isSelected)).length;
  return {
    selectedLayoutLensCount,
    checkedLensCount: checks.length,
    issueLensCount: checks.filter((check) => check.issueCount > 0 || check.status === 'layout文件缺失' || check.status === '读取失败').length,
    totalIssueCount: checks.reduce((sum, check) => sum + check.issueCount, 0),
    lastCheckTime: checks[0]?.lastCheckTime,
  };
}

function matchesLayoutReferenceExportFilter(row: LayoutReferenceCheckRecord, request: ExportLayoutReferenceReportRequest): boolean {
  const matchesIssueView = (request.onlyWithIssues ?? true)
    ? row.issueCount > 0 || row.status === 'layout文件缺失' || row.status === '读取失败'
    : true;

  const matchesIssueType = request.issueType === undefined || request.issueType === 'all'
    ? true
    : row.issues.some((issue) => issue.issueType === request.issueType)
      || (request.issueType === '路径不存在' && row.status === 'layout文件缺失');

  return matchesIssueView && matchesIssueType;
}

function summarizeReferencePaths(row: LayoutReferenceCheckRecord, issueType?: ExportLayoutReferenceReportRequest['issueType']): string {
  const filteredIssues = row.issues.filter((issue) => issueType === undefined || issueType === 'all' ? true : issue.issueType === issueType);
  const paths = filteredIssues.map((issue) => issue.refAbsolutePath);

  if (row.status === 'layout文件缺失' && paths.length === 0) {
    return row.layoutAbsolutePath;
  }

  return Array.from(new Set(paths)).join('；');
}

function readSelectedLayoutCandidates(database: DatabaseSync, episodeId: string): SelectedLayoutRow[] {
  return database.prepare(`
    SELECT c.candidate_id, c.episode_id, c.lens_code, c.file_relative_path, c.file_name, c.source_root, c.source, c.is_selected, c.bind_time, l.lens_id, l.lens_name
    FROM lens_layout_candidate c
    INNER JOIN lens l ON l.episode_id = c.episode_id AND l.lens_code = c.lens_code
    WHERE c.episode_id = ? AND c.is_selected = 1
    ORDER BY c.lens_code ASC
  `).all(episodeId) as unknown as SelectedLayoutRow[];
}

function readSelectedLayoutCandidateByLensId(database: DatabaseSync, episodeId: string, lensId: string): SelectedLayoutRow | null {
  const row = database.prepare(`
    SELECT c.candidate_id, c.episode_id, c.lens_code, c.file_relative_path, c.file_name, c.source_root, c.source, c.is_selected, c.bind_time, l.lens_id, l.lens_name
    FROM lens_layout_candidate c
    INNER JOIN lens l ON l.episode_id = c.episode_id AND l.lens_code = c.lens_code
    WHERE c.episode_id = ? AND l.lens_id = ? AND c.is_selected = 1
    LIMIT 1
  `).get(episodeId, lensId) as SelectedLayoutRow | undefined;

  return row ?? null;
}

function deleteLayoutReferenceChecksByEpisode(database: DatabaseSync, episodeId: string): void {
  const checkIds = database.prepare('SELECT check_id FROM layout_reference_check WHERE episode_id = ?').all(episodeId) as Array<{ check_id: string }>;
  if (checkIds.length > 0) {
    database.prepare(`DELETE FROM layout_reference_issue WHERE check_id IN (${checkIds.map(() => '?').join(', ')})`).run(...checkIds.map((row) => row.check_id));
  }
  database.prepare('DELETE FROM layout_reference_check WHERE episode_id = ?').run(episodeId);
}

function deleteLayoutReferenceCheckByCandidate(database: DatabaseSync, episodeId: string, candidateId: string): void {
  const checkIds = database.prepare('SELECT check_id FROM layout_reference_check WHERE episode_id = ? AND candidate_id = ?').all(episodeId, candidateId) as Array<{ check_id: string }>;
  if (checkIds.length > 0) {
    database.prepare(`DELETE FROM layout_reference_issue WHERE check_id IN (${checkIds.map(() => '?').join(', ')})`).run(...checkIds.map((row) => row.check_id));
  }
  database.prepare('DELETE FROM layout_reference_check WHERE episode_id = ? AND candidate_id = ?').run(episodeId, candidateId);
}

function writeLayoutReferenceCheck(database: DatabaseSync, episodeId: string, selected: SelectedLayoutRow, result: ReferenceCheckResult, now: string): void {
  const checkId = createCompactId();
  database.prepare(`
    INSERT INTO layout_reference_check (check_id, episode_id, lens_code, candidate_id, layout_file_path, status, issue_count, path_missing_count, file_missing_count, filename_mismatch_count, checked_reference_count, error_message, last_check_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkId,
    episodeId,
    selected.lens_code,
    selected.candidate_id,
    selected.file_relative_path,
    result.status,
    result.issueCount,
    result.pathMissingCount,
    result.fileMissingCount,
    result.fileNameMismatchCount,
    result.checkedReferenceCount,
    result.errorMessage ?? null,
    now,
  );

  result.issues.forEach((issue) => {
    database.prepare(`
      INSERT INTO layout_reference_issue (issue_id, check_id, issue_type, ref_original_path, ref_absolute_path, ref_directory, expected_file_name, core_basename, related_files_same_dir, related_files_parent_dirs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createCompactId(),
      checkId,
      issue.issueType,
      issue.refOriginalPath,
      issue.refAbsolutePath,
      issue.refDirectory,
      issue.expectedFileName,
      issue.coreBasename,
      JSON.stringify(issue.relatedFilesSameDir),
      JSON.stringify(issue.relatedFilesParentDirs),
    );
  });
}

function readLensBindings(database: DatabaseSync, episodeId: string, projectRootPath: string): Record<string, LensBoundFile[]> {
  const rows = database.prepare(`
    SELECT file_id, episode_id, lens_code, version_num, file_type, file_relative_path, source_root, bind_time
    FROM lens_file WHERE episode_id = ? ORDER BY bind_time DESC
  `).all(episodeId) as unknown as LensFileRow[];

  return rows.reduce<Record<string, LensBoundFile[]>>((accumulator, row) => {
    const mapped = mapLensFileRow(row, projectRootPath);
    accumulator[mapped.lensCode] ??= [];
    accumulator[mapped.lensCode].push(mapped);
    return accumulator;
  }, {});
}

function mapLensFileRow(row: LensFileRow, projectRootPath: string): LensBoundFile {
  return {
    fileId: row.file_id,
    lensCode: row.lens_code,
    versionNum: row.version_num,
    fileType: row.file_type,
    relativePath: row.file_relative_path,
    bindTime: row.bind_time,
    absolutePath: path.resolve(projectRootPath, row.file_relative_path),
    sourceRoot: row.source_root ?? undefined,
  };
}

function mapLayoutCandidateRow(row: LayoutCandidateRow, projectRootPath: string): LensLayoutCandidate {
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

function mapLayoutVideoBindingRow(row: LayoutVideoBindingRow, projectRootPath: string): LensLayoutVideoBinding {
  const absolutePath = resolveStoredPath(projectRootPath, row.file_relative_path);
  return {
    bindingId: row.binding_id,
    candidateId: row.candidate_id,
    lensCode: row.lens_code,
    fileName: row.file_name,
    relativePath: row.file_relative_path,
    absolutePath,
    bindTime: row.bind_time,
    exists: existsSync(absolutePath),
    sourceRoot: row.source_root ?? undefined,
  };
}

function writeLifecycleEvent(database: DatabaseSync, payload: {
  lensId: string;
  episodeId: string;
  eventType: '文件绑定';
  title: string;
  detail: string;
  versionNum: string;
  fileName: string;
  toStatus: LensStatus;
  eventTime: string;
}): void {
  database.prepare(`
    INSERT INTO lens_lifecycle (event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(createCompactId(), payload.lensId, payload.episodeId, payload.eventType, payload.title, payload.detail, null, payload.toStatus, payload.versionNum, payload.fileName, payload.eventTime);
}

function buildFileName(lensCode: string, versionTag: string, versionNum: string): string {
  return `${lensCode}_${normalizeNamingTag(versionTag, 'ANI')}_${normalizeVersion(versionNum).toLowerCase()}`;
}

function normalizeVersion(versionNum: string): string {
  const text = versionNum.trim().toUpperCase();
  const match = text.match(/^V?(\d{1,3})$/);
  if (!match) {
    return text || 'V01';
  }

  return `V${match[1].padStart(Math.max(match[1].length, 2), '0')}`;
}

function normalizeLensStatus(status: string): LensStatus {
  if (status === '提交' || status === '返修' || status === '通过' || status === '关闭') {
    return status;
  }

  return '制作';
}

function normalizeNamingTag(value: string | null | undefined, fallback: string): string {
  const text = value?.trim() ?? '';
  return text ? text.toUpperCase() : fallback;
}

function buildFileCheckSummary(records: FileCheckRecord[]): FileCheckSummary {
  return {
    totalLensCount: records.length,
    missingMaCount: records.filter((record) => record.maStatus === '缺失').length,
    missingMovCount: records.filter((record) => record.movStatus === '缺失').length,
    missingLayoutCount: records.filter((record) => record.layoutStatus === '缺失').length,
    allMissingCount: records.filter((record) => record.overallStatus === '全部缺失').length,
    lastCheckTime: records[0]?.lastCheckTime,
  };
}

async function evaluateLayoutReferenceCandidate(projectRootPath: string, selected: SelectedLayoutRow): Promise<ReferenceCheckResult> {
  const layoutAbsolutePath = resolveStoredPath(projectRootPath, selected.file_relative_path);
  if (!existsSync(layoutAbsolutePath)) {
    return {
      status: 'layout文件缺失',
      checkedReferenceCount: 0,
      issueCount: 0,
      pathMissingCount: 0,
      fileMissingCount: 0,
      fileNameMismatchCount: 0,
      errorMessage: '当前采用的 layout 文件在磁盘上不存在。',
      issues: [],
    };
  }

  try {
    const content = await readFile(layoutAbsolutePath, 'utf8');
    const references = extractMayaReferences(content);
    const uniqueReferences = Array.from(new Map(references.map((refPath) => [resolveReferenceAbsolutePath(refPath, layoutAbsolutePath), refPath])).entries());
    const issues = await Promise.all(uniqueReferences.map(async ([absolutePath, originalPath]) => inspectReferenceIssue(layoutAbsolutePath, originalPath, absolutePath)));
    const invalidIssues = issues.filter((issue): issue is Omit<LayoutReferenceIssue, 'issueId'> => Boolean(issue));
    const pathMissingCount = invalidIssues.filter((issue) => issue.issueType === '路径不存在').length;
    const fileMissingCount = invalidIssues.filter((issue) => issue.issueType === '路径存在但文件不存在').length;
    const fileNameMismatchCount = invalidIssues.filter((issue) => issue.issueType === '路径存在但文件名不匹配').length;

    return {
      status: invalidIssues.length === 0 ? '正常' : '存在缺失',
      checkedReferenceCount: uniqueReferences.length,
      issueCount: invalidIssues.length,
      pathMissingCount,
      fileMissingCount,
      fileNameMismatchCount,
      issues: invalidIssues,
    };
  } catch (error) {
    return {
      status: '读取失败',
      checkedReferenceCount: 0,
      issueCount: 0,
      pathMissingCount: 0,
      fileMissingCount: 0,
      fileNameMismatchCount: 0,
      errorMessage: error instanceof Error ? error.message : '读取 layout 文件失败。',
      issues: [],
    };
  }
}

function extractMayaReferences(content: string): string[] {
  const references: string[] = [];
  const refPatternWithType = /file\s+(-r|-reference)\s+.*?-typ\s+"[^"]+"\s+"([^"]+?)"\s*;/gis;
  const refPattern = /file\s+(-r|-reference)\s+[^\"]*?"([^"]+?)"\s*;/gis;

  for (const match of content.matchAll(refPatternWithType)) {
    const refPath = match[2]?.trim();
    if (refPath && !refPath.startsWith('|')) {
      references.push(refPath);
    }
  }

  for (const match of content.matchAll(refPattern)) {
    const refPath = match[2]?.trim();
    if (refPath && !refPath.startsWith('|') && !references.includes(refPath)) {
      references.push(refPath);
    }
  }

  return references;
}

async function inspectReferenceIssue(layoutAbsolutePath: string, originalPath: string, absolutePath: string): Promise<Omit<LayoutReferenceIssue, 'issueId'> | null> {
  const refDirectory = path.dirname(absolutePath);
  const expectedFileName = path.basename(absolutePath);
  const coreBasename = normalizeReferenceCoreName(path.basename(expectedFileName, path.extname(expectedFileName)));
  const directoryExists = existsSync(refDirectory) && (await stat(refDirectory)).isDirectory();
  const fileExists = existsSync(absolutePath);

  if (directoryExists && fileExists) {
    return null;
  }

  let relatedFilesSameDir: string[] = [];
  let relatedFilesParentDirs: string[] = [];
  let issueType: LayoutReferenceIssue['issueType'];

  if (!directoryExists) {
    relatedFilesParentDirs = await searchParentRelatedFiles(refDirectory, coreBasename);
    issueType = '路径不存在';
  } else {
    relatedFilesSameDir = await searchRelatedFiles(refDirectory, coreBasename);
    const hasMismatch = relatedFilesSameDir.length > 0;
    issueType = hasMismatch ? '路径存在但文件名不匹配' : '路径存在但文件不存在';
  }

  return {
    issueType,
    refOriginalPath: originalPath,
    refAbsolutePath: absolutePath,
    refDirectory,
    expectedFileName,
    coreBasename,
    relatedFilesSameDir,
    relatedFilesParentDirs,
  };
}

function resolveReferenceAbsolutePath(refPath: string, layoutAbsolutePath: string): string {
  return path.isAbsolute(refPath) ? path.normalize(refPath) : path.resolve(path.dirname(layoutAbsolutePath), refPath);
}

async function searchRelatedFiles(rootDir: string, coreBasename: string): Promise<string[]> {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await searchRelatedFiles(fullPath, coreBasename));
      continue;
    }

    if (entry.isFile() && normalizeReferenceCoreName(path.basename(entry.name, path.extname(entry.name))) === coreBasename) {
      results.push(fullPath);
    }
  }

  return results;
}

async function searchParentRelatedFiles(refDir: string, coreBasename: string): Promise<string[]> {
  const results: string[] = [];
  const seen = new Set<string>();
  let currentDir = refDir;
  for (let level = 0; level < 5; level += 1) {
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
    if (!existsSync(currentDir)) {
      continue;
    }

    for (const filePath of await searchRelatedFiles(currentDir, coreBasename)) {
      if (!seen.has(filePath)) {
        seen.add(filePath);
        results.push(filePath);
      }
    }
  }

  return results;
}

function normalizeReferenceCoreName(value: string): string {
  return value.replace(/(_HI|_LOW|_v\d+|_ok|_rig|_RS|_lo)$/i, '').toUpperCase();
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

async function collectBoundFiles(directoryPath: string, extensions: readonly string[], projectRootPath: string): Promise<DiscoveredBoundFile[]> {
  const groups = await Promise.all(extensions.map((extension) => collectMatchingFiles(directoryPath, extension, projectRootPath, directoryPath)));
  return groups.flat();
}

async function collectBoundFilesFromRoots(directoryPaths: string[], extensions: string | readonly string[], projectRootPath: string): Promise<DiscoveredBoundFile[]> {
  const normalizedExtensions = Array.isArray(extensions) ? extensions : [extensions];
  const allFiles = (await Promise.all(directoryPaths.map((directoryPath) => collectBoundFiles(directoryPath, normalizedExtensions, projectRootPath)))).flat();
  const uniqueFiles = new Map<string, DiscoveredBoundFile>();

  allFiles.forEach((file) => {
    const key = `${file.fileName}::${file.storedPath}`;
    if (!uniqueFiles.has(key)) {
      uniqueFiles.set(key, file);
    }
  });

  return [...uniqueFiles.values()];
}

async function collectMatchingFilesFromRoots(directoryPaths: string[], extension: string, projectRootPath?: string): Promise<DiscoveredLayoutFile[]> {
  const uniqueFiles = new Map<string, DiscoveredLayoutFile>();
  const groups = await Promise.all(directoryPaths.map((directoryPath, index) => collectMatchingFiles(directoryPath, extension, projectRootPath, directoryPath, index)));
  groups.flat().forEach((file) => {
    uniqueFiles.set(`${file.fileName}::${file.storedPath}`, file);
  });
  return [...uniqueFiles.values()];
}

async function collectMatchingFiles(directoryPath: string, extension: string, projectRootPath?: string, sourceRoot?: string, sourcePriority: number = 0): Promise<DiscoveredLayoutFile[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files: DiscoveredLayoutFile[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectMatchingFiles(fullPath, extension, projectRootPath, sourceRoot ?? directoryPath, sourcePriority));
        continue;
      }

      if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) {
        files.push({
          fileName: entry.name,
          storedPath: toStoredPath(projectRootPath ?? directoryPath, fullPath),
          sourceRoot: sourceRoot ?? directoryPath,
          sourcePriority,
        });
      }
    }

    return files;
  } catch {
    return [];
  }
}

function matchLayoutFiles(files: DiscoveredLayoutFile[], lensCode: string, lensName: string, layoutTag: string): DiscoveredLayoutFile[] {
  const prefixes = [lensCode, lensName]
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const normalizedLayoutTag = normalizeNamingTag(layoutTag, 'LAY');

  return files
    .filter((file) => {
      const baseName = path.basename(file.fileName, '.ma').toUpperCase();
      const pathSegments = file.storedPath
        .replaceAll('\\', '/')
        .split('/')
        .map((segment) => segment.trim().toUpperCase())
        .filter(Boolean);

      return prefixes.some((prefix) => (
        baseName === prefix
        || baseName === `${prefix}_${normalizedLayoutTag}`
        || baseName.startsWith(`${prefix}_`)
        || baseName.startsWith(`${prefix}_${normalizedLayoutTag}_`)
        || pathSegments.includes(prefix)
      ));
    })
    .sort((left, right) => compareLayoutCandidatePriority(left, right, prefixes, normalizedLayoutTag));
}

function compareLayoutCandidatePriority(
  left: DiscoveredLayoutFile,
  right: DiscoveredLayoutFile,
  prefixes: string[],
  layoutTag: string,
): number {
  const scoreDiff = scoreMatchedLayoutCandidate(right, prefixes, layoutTag) - scoreMatchedLayoutCandidate(left, prefixes, layoutTag);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const versionDiff = (extractVersionNumber(right.fileName) ?? 0) - (extractVersionNumber(left.fileName) ?? 0);
  if (versionDiff !== 0) {
    return versionDiff;
  }

  const namingDiff = compareLayoutCandidateNamingPriority(right.fileName, left.fileName, prefixes, layoutTag);
  if (namingDiff !== 0) {
    return namingDiff;
  }

  const sourcePriorityDiff = left.sourcePriority - right.sourcePriority;
  if (sourcePriorityDiff !== 0) {
    return sourcePriorityDiff;
  }

  return left.fileName.localeCompare(right.fileName, 'zh-CN');
}

function scoreMatchedLayoutCandidate(file: DiscoveredLayoutFile, prefixes: string[], layoutTag: string): number {
  return scoreLayoutCandidate(file.fileName, prefixes, layoutTag);
}

function compareLayoutCandidateNamingPriority(
  leftFileName: string,
  rightFileName: string,
  prefixes: string[],
  layoutTag: string,
): number {
  return scoreLayoutCandidateNamingPriority(leftFileName, prefixes, layoutTag) - scoreLayoutCandidateNamingPriority(rightFileName, prefixes, layoutTag);
}

function scoreLayoutCandidateNamingPriority(fileName: string, prefixes: string[], layoutTag: string): number {
  const baseName = path.basename(fileName, '.ma').toUpperCase();
  const normalizedLayoutTag = layoutTag.trim().toUpperCase() || 'LAY';
  const bestPrefix = prefixes.find((prefix) => baseName.startsWith(prefix));
  if (!bestPrefix) {
    return 0;
  }

  if (baseName === `${bestPrefix}_${normalizedLayoutTag}`) {
    return 400;
  }

  if (baseName.startsWith(`${bestPrefix}_${normalizedLayoutTag}_`)) {
    return 320;
  }

  if (baseName.startsWith(`${bestPrefix}_`)) {
    return 220;
  }

  if (baseName === bestPrefix) {
    return 160;
  }

  return 0;
}

function scoreLayoutCandidate(fileName: string, prefixes: string[], layoutTag: string): number {
  const baseName = path.basename(fileName, '.ma').toUpperCase();
  const bestPrefix = prefixes.find((prefix) => baseName.startsWith(prefix));
  if (!bestPrefix) {
    return 0;
  }

  let score = 100;
  if (baseName === `${bestPrefix}_${layoutTag}`) {
    score += 60;
  }
  if (baseName.startsWith(`${bestPrefix}_${layoutTag}_`)) {
    score += 80;
  }
  if (baseName.includes(`_${layoutTag}_`)) {
    score += 20;
  }
  if ((extractVersionNumber(baseName) ?? 0) > 0) {
    score += 10;
  }

  return score;
}

function upsertLensFileCheck(database: DatabaseSync, payload: {
  episodeId: string;
  lensId: string;
  lensCode: string;
  lensName: string;
  lensStatus: LensStatus;
  versionTag: string;
  versionNum: string;
  projectRootPath: string;
  lensFolderRootPath?: string;
  maFiles: DiscoveredBoundFile[];
  movFiles: DiscoveredBoundFile[];
  layoutFiles: DiscoveredLayoutFile[];
  layoutTag: string;
  now: string;
}): DiscoveredLayoutFile[] {
  const matchedMaCandidate = selectBestVersionFileCandidate(payload.maFiles, payload.lensCode, payload.versionTag, payload.versionNum);
  const matchedMovCandidate = selectBestVersionFileCandidate(payload.movFiles, payload.lensCode, payload.versionTag, payload.versionNum)
    ?? findFallbackMovCandidate(payload.projectRootPath, payload.lensFolderRootPath, payload.lensCode, payload.versionTag, payload.versionNum);
  const maStatus = matchedMaCandidate
    ? upsertAutoMatchedBinding(database, payload, 'ma', matchedMaCandidate)
    : (removeVersionBinding(database, payload.episodeId, payload.lensCode, payload.versionNum, 'ma'), '缺失');
  const movStatus = matchedMovCandidate
    ? upsertAutoMatchedBinding(database, payload, 'mov', matchedMovCandidate)
    : (removeVersionBinding(database, payload.episodeId, payload.lensCode, payload.versionNum, 'mov'), '缺失');
  const matchedLayouts = matchLayoutFiles(payload.layoutFiles, payload.lensCode, payload.lensName, payload.layoutTag);
  const layoutStatus: '存在' | '缺失' = matchedLayouts.length > 0 ? '存在' : '缺失';
  const overallStatus = buildOverallStatus(maStatus, movStatus, layoutStatus);

  database.prepare(`DELETE FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ? AND source = 'auto-scan'`).run(payload.episodeId, payload.lensCode);
  for (const matchedLayout of matchedLayouts) {
      database.prepare(`
        INSERT INTO lens_layout_candidate (candidate_id, episode_id, lens_code, file_relative_path, file_name, source_root, source, is_selected, bind_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(createCompactId(), payload.episodeId, payload.lensCode, matchedLayout.storedPath, matchedLayout.fileName, matchedLayout.sourceRoot, 'auto-scan', 0, payload.now);
    }

  if (matchedLayouts.length > 0) {
    const preferredLayout = matchedLayouts[0];
    database.prepare(`UPDATE lens_layout_candidate SET is_selected = CASE WHEN file_name = ? THEN 1 ELSE 0 END WHERE episode_id = ? AND lens_code = ?`).run(preferredLayout.fileName, payload.episodeId, payload.lensCode);
  }

  const existing = database.prepare(`SELECT check_id FROM file_check WHERE episode_id = ? AND lens_code = ?`).get(payload.episodeId, payload.lensCode) as { check_id: string } | undefined;
  if (existing) {
    database.prepare(`
      UPDATE file_check
      SET ma_status = ?, mov_status = ?, layout_status = ?, layout_candidate_count = ?, file_overall_status = ?, last_check_time = ?
      WHERE check_id = ?
    `).run(maStatus, movStatus, layoutStatus, matchedLayouts.length, overallStatus, payload.now, existing.check_id);
  } else {
    database.prepare(`
      INSERT INTO file_check (check_id, episode_id, lens_code, ma_status, mov_status, layout_status, layout_candidate_count, file_overall_status, last_check_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createCompactId(), payload.episodeId, payload.lensCode, maStatus, movStatus, layoutStatus, matchedLayouts.length, overallStatus, payload.now);
  }

  return matchedLayouts;
}

async function syncLensFrameFromLayoutVideo(database: DatabaseSync, payload: {
  projectRootPath: string;
  episodeId: string;
  lensCode: string;
  frameSourceLocked: number;
  singleFrame: number;
  layoutVideoFiles: DiscoveredBoundFile[];
  selectedLayoutFileName?: string;
  now: string;
}): Promise<number | null> {
  if (payload.frameSourceLocked === 1 && payload.singleFrame > 0) {
    return null;
  }

  const matchedVideo = matchLayoutVideoFileByLensCode(payload.lensCode, payload.layoutVideoFiles, payload.selectedLayoutFileName);
  if (!matchedVideo) {
    return null;
  }

  try {
    const settings = await settingsService.getSettings();
    const metadata = await probeVideoMetadata(settings.ffprobePath, resolveStoredPath(payload.projectRootPath, matchedVideo.storedPath));
    if (!metadata.frameCount || metadata.frameCount <= 0) {
      return null;
    }

    database.prepare(`
      UPDATE lens
      SET single_frame = ?, frame_source_locked = 1, update_time = ?
      WHERE episode_id = ? AND lens_code = ?
    `).run(metadata.frameCount, payload.now, payload.episodeId, payload.lensCode);
    return metadata.frameCount;
  } catch {
    // layout 视频帧数回填仅做兜底，不阻塞主扫描流程
    return null;
  }
}

function upsertAutoMatchedLayoutVideoBinding(database: DatabaseSync, payload: {
  projectRootPath: string;
  episodeId: string;
  lensCode: string;
  layoutVideoFiles: DiscoveredBoundFile[];
  preserveExistingBinding?: boolean;
  now: string;
}): void {
  const selectedCandidate = database.prepare(`
    SELECT candidate_id, file_name FROM lens_layout_candidate
    WHERE episode_id = ? AND lens_code = ?
    ORDER BY is_selected DESC, bind_time DESC
    LIMIT 1
  `).get(payload.episodeId, payload.lensCode) as { candidate_id: string; file_name: string } | undefined;
  if (!selectedCandidate) {
    return;
  }

  const existing = database.prepare(`
    SELECT binding_id, file_relative_path FROM lens_layout_video_binding WHERE episode_id = ? AND candidate_id = ?
  `).get(payload.episodeId, selectedCandidate.candidate_id) as { binding_id: string; file_relative_path: string } | undefined;

  if (existing && payload.preserveExistingBinding && existsSync(resolveStoredPath(payload.projectRootPath, existing.file_relative_path))) {
    return;
  }

  const matchedVideo = matchLayoutVideoFileByLensCode(payload.lensCode, payload.layoutVideoFiles, selectedCandidate.file_name);
  if (!matchedVideo) {
    return;
  }

  if (existing) {
    database.prepare(`
      UPDATE lens_layout_video_binding
      SET file_relative_path = ?, file_name = ?, source_root = ?, bind_time = ?
      WHERE binding_id = ?
    `).run(matchedVideo.storedPath, matchedVideo.fileName, matchedVideo.sourceRoot, payload.now, existing.binding_id);
    return;
  }

  database.prepare(`
    INSERT INTO lens_layout_video_binding (binding_id, episode_id, lens_code, candidate_id, file_relative_path, file_name, source_root, bind_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    createCompactId(),
    payload.episodeId,
    payload.lensCode,
    selectedCandidate.candidate_id,
    matchedVideo.storedPath,
    matchedVideo.fileName,
    matchedVideo.sourceRoot,
    payload.now,
  );
}

function matchLayoutVideoFileByLensCode(
  lensCode: string,
  videoFiles: DiscoveredBoundFile[],
  selectedLayoutFileName?: string,
): DiscoveredBoundFile | null {
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
  left: { file: DiscoveredBoundFile; score: number },
  right: { file: DiscoveredBoundFile; score: number },
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

  const sourcePriorityDiff = left.file.sourcePriority - right.file.sourcePriority;
  if (sourcePriorityDiff !== 0) {
    return sourcePriorityDiff;
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

function scoreLayoutVideoFileMatch(
  file: DiscoveredBoundFile,
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
  if (!hasLayoutVideoKeyword(baseNameWithoutVersion)) {
    return 0;
  }

  let score = 0;
  if (baseNameWithoutVersion === `${normalizedLensCode}_LAY` || baseNameWithoutVersion === `${normalizedLensCode}_LAYOUT`) {
    score += 400;
  } else if (baseNameWithoutVersion.startsWith(`${normalizedLensCode}_`)) {
    score += 320;
  } else if (baseNameWithoutVersion === normalizedLensCode) {
    score += 240;
  }
  if (fileVersion !== null) {
    score += Math.min(fileVersion, 99);
  }
  score += scoreLayoutVideoLensStemAffinity(baseNameWithoutVersion, normalizedLensCode);

  return score >= 140 ? score : 0;
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

function normalizeLooseComparableText(value: string): string {
  return value.replace(/[^A-Z0-9]+/gi, '').toUpperCase();
}

function normalizeLooseComparableTextWithNumericNormalization(value: string): string {
  return value
    .replace(/\d+/g, (match) => String(Number(match)))
    .replace(/[^A-Z0-9]+/gi, '')
    .toUpperCase();
}

function findFallbackMovCandidate(
  _projectRootPath: string,
  _lensFolderRootPath: string | undefined,
  _lensCode: string,
  _versionTag: string,
  _versionNum: string,
): DiscoveredBoundFile | null {
  return null;
}

function hasLayoutVideoKeyword(baseName: string): boolean {
  return /(?:^|[^A-Z0-9])(LAY|LAYOUT)(?=$|[^A-Z0-9])/i.test(baseName);
}

function refreshLensBindingStatus(database: DatabaseSync, payload: {
  episodeId: string;
  lensId: string;
  lensCode: string;
  lensStatus: LensStatus;
  versionTag: string;
  versionNum: string;
  projectRootPath: string;
  lensFolderRootPath?: string;
  maFiles: DiscoveredBoundFile[];
  movFiles: DiscoveredBoundFile[];
  now: string;
}): void {
  const matchedMaCandidate = selectBestVersionFileCandidate(payload.maFiles, payload.lensCode, payload.versionTag, payload.versionNum);
  const matchedMovCandidate = selectBestVersionFileCandidate(payload.movFiles, payload.lensCode, payload.versionTag, payload.versionNum)
    ?? findFallbackMovCandidate(payload.projectRootPath, payload.lensFolderRootPath, payload.lensCode, payload.versionTag, payload.versionNum);
  const maStatus = matchedMaCandidate
    ? upsertAutoMatchedBinding(database, payload, 'ma', matchedMaCandidate)
    : (removeVersionBinding(database, payload.episodeId, payload.lensCode, payload.versionNum, 'ma'), '缺失');
  const movStatus = matchedMovCandidate
    ? upsertAutoMatchedBinding(database, payload, 'mov', matchedMovCandidate)
    : (removeVersionBinding(database, payload.episodeId, payload.lensCode, payload.versionNum, 'mov'), '缺失');

  const layoutCandidateCount = database.prepare(`SELECT COUNT(1) as count FROM lens_layout_candidate WHERE episode_id = ? AND lens_code = ?`).get(payload.episodeId, payload.lensCode) as { count: number };
  const layoutStatus: '存在' | '缺失' = layoutCandidateCount.count > 0 ? '存在' : '缺失';
  const overallStatus = buildOverallStatus(maStatus, movStatus, layoutStatus);
  const existing = database.prepare(`SELECT check_id FROM file_check WHERE episode_id = ? AND lens_code = ?`).get(payload.episodeId, payload.lensCode) as { check_id: string } | undefined;

  if (existing) {
    database.prepare(`
      UPDATE file_check
      SET ma_status = ?, mov_status = ?, layout_status = ?, layout_candidate_count = ?, file_overall_status = ?, last_check_time = ?
      WHERE check_id = ?
    `).run(maStatus, movStatus, layoutStatus, layoutCandidateCount.count, overallStatus, payload.now, existing.check_id);
  } else {
    database.prepare(`
      INSERT INTO file_check (check_id, episode_id, lens_code, ma_status, mov_status, layout_status, layout_candidate_count, file_overall_status, last_check_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createCompactId(), payload.episodeId, payload.lensCode, maStatus, movStatus, layoutStatus, layoutCandidateCount.count, overallStatus, payload.now);
  }
}

function findVersionFileCandidates(files: DiscoveredBoundFile[], lensCode: string, versionTag: string, versionNum: string): DiscoveredBoundFile[] {
  return files
    .map((file) => ({ file, score: scoreVersionFileMatch(file, lensCode, versionTag, versionNum) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.file.sourcePriority - right.file.sourcePriority || left.file.fileName.localeCompare(right.file.fileName, 'zh-CN'))
    .map((item) => item.file);
}

function selectBestVersionFileCandidate(files: DiscoveredBoundFile[], lensCode: string, versionTag: string, versionNum: string): DiscoveredBoundFile | null {
  return findVersionFileCandidates(files, lensCode, versionTag, versionNum)[0] ?? null;
}

function scoreVersionFileMatch(file: DiscoveredBoundFile, lensCode: string, versionTag: string, versionNum: string): number {
  const extension = path.extname(file.fileName);
  const baseName = path.basename(file.fileName, extension).toUpperCase();
  const relativePath = file.storedPath.replaceAll('\\', '/').toUpperCase();
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
  if (baseName.includes(`_${normalizeNamingTag(versionTag, 'ANI')}_`)) {
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

function upsertAutoMatchedBinding(database: DatabaseSync, payload: {
  episodeId: string;
  lensId: string;
  lensCode: string;
  lensStatus: LensStatus;
  versionNum: string;
  now: string;
}, fileType: BindFileType, matchedFile: DiscoveredBoundFile | null): '存在' | '缺失' {
  const existing = database.prepare(`
    SELECT file_id, file_relative_path FROM lens_file WHERE episode_id = ? AND lens_code = ? AND version_num = ? AND file_type = ?
  `).get(payload.episodeId, payload.lensCode, payload.versionNum, fileType) as { file_id: string; file_relative_path: string } | undefined;

  if (!matchedFile) {
    return existing ? '存在' : '缺失';
  }

  if (existing) {
    database.prepare(`
      UPDATE lens_file SET file_relative_path = ?, source_root = ?, bind_time = ? WHERE file_id = ?
    `).run(matchedFile.storedPath, matchedFile.sourceRoot, payload.now, existing.file_id);
  } else {
    database.prepare(`
      INSERT INTO lens_file (file_id, episode_id, lens_code, version_num, file_type, file_relative_path, source_root, bind_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createCompactId(), payload.episodeId, payload.lensCode, payload.versionNum, fileType, matchedFile.storedPath, matchedFile.sourceRoot, payload.now);
  }

  return '存在';
}

function removeVersionBinding(database: DatabaseSync, episodeId: string, lensCode: string, versionNum: string, fileType: BindFileType): void {
  database.prepare(`DELETE FROM lens_file WHERE episode_id = ? AND lens_code = ? AND version_num = ? AND file_type = ?`).run(episodeId, lensCode, versionNum, fileType);
}

function buildOverallStatus(maStatus: '存在' | '缺失', movStatus: '存在' | '缺失', layoutStatus: '存在' | '缺失'): FileOverallStatus {
  if (maStatus === '存在' && movStatus === '存在' && layoutStatus === '存在') {
    return '正常';
  }

  if (maStatus === '缺失' && movStatus === '缺失' && layoutStatus === '缺失') {
    return '全部缺失';
  }

  const missingItems = [
    maStatus === '缺失' ? 'ma' : null,
    movStatus === '缺失' ? 'mov' : null,
    layoutStatus === '缺失' ? 'layout' : null,
  ].filter(Boolean);

  if (missingItems.length === 1) {
    return `缺失${missingItems[0]}` as FileOverallStatus;
  }

  return `缺失${missingItems.join('+')}` as FileOverallStatus;
}

function toStoredPath(projectRootPath: string, absolutePath: string): string {
  const relativePath = path.relative(projectRootPath, absolutePath);
  return relativePath.startsWith('..') ? absolutePath : relativePath;
}

function resolveStoredPath(projectRootPath: string, storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.resolve(projectRootPath, storedPath);
}

function writeOperateLog(database: DatabaseSync, lensCode: string | null, operateType: string, oldContent: string | null, newContent: string | null, operateTime: string): void {
  database.prepare(`
    INSERT INTO operate_log (log_id, lens_code, operate_type, old_content, new_content, operate_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(createCompactId(), lensCode, operateType, oldContent, newContent, operateTime);
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeScanRootItems(items: ScanRootConfigItem[], fileKind: 'ma' | 'mov' | 'layout'): ConfiguredScanRoot[] {
  return items
    .map((item, index) => ({
      rootId: item.rootId.trim(),
      fileKind,
      label: item.label.trim(),
      absolutePath: item.absolutePath.trim(),
      initExcelPath: item.initExcelPath?.trim() || undefined,
      priority: Number.isFinite(item.priority) ? item.priority : (index + 1) * 10,
      isEnabled: item.isEnabled,
    }))
    .filter((item) => item.absolutePath.length > 0);
}

function resolveMovScanPaths(roots: ConfiguredScanRoot[], projectRootPath: string, lensFolderRootPath?: string, movCheckPath?: string): string[] {
  const configured = getEnabledScanRootPaths(roots, lensFolderRootPath);
  const extraRoots = [
    ...collectMovScanFallbackRoots(projectRootPath, lensFolderRootPath),
    ...findMovEpisodeFolders(projectRootPath, lensFolderRootPath),
    ...(movCheckPath?.trim() ? [path.normalize(movCheckPath.trim())] : []),
  ];
  return Array.from(new Set([...extraRoots, ...configured]));
}

function collectMovScanFallbackRoots(projectRootPath: string, lensFolderRootPath?: string): string[] {
  const candidates = [projectRootPath, lensFolderRootPath]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  const roots: string[] = [];

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    roots.push(normalized);

    const dailyFolder = findExistingSubPath(normalized, ['shot_work', 'DailyFolder']);
    if (dailyFolder) {
      roots.push(dailyFolder);
      const episodeFolder = findDeepestEpisodeFolder(dailyFolder);
      if (episodeFolder) {
        roots.push(episodeFolder);
      }
    }
  }

  return roots;
}

function findMovEpisodeFolders(projectRootPath: string, lensFolderRootPath?: string): string[] {
  const seeds = [projectRootPath, lensFolderRootPath]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  const result = new Set<string>();

  for (const seed of seeds) {
    const normalizedSeed = path.normalize(seed);
    for (const dailyFolder of findDirectoriesByName(normalizedSeed, 'DailyFolder', 5)) {
      result.add(dailyFolder);
      try {
        const entries = readdirSync(dailyFolder, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && /^EP\d+/i.test(entry.name)) {
            result.add(path.join(dailyFolder, entry.name));
          }
        }
      } catch {
        // 忽略枚举失败，保留已有根目录
      }
    }
  }

  return [...result.values()];
}

function findDirectoriesByName(basePath: string, directoryName: string, maxDepth: number): string[] {
  if (!existsSync(basePath) || maxDepth < 0) {
    return [];
  }

  const matched: string[] = [];
  const stack: Array<{ currentPath: string; depth: number }> = [{ currentPath: basePath, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }

    const { currentPath, depth } = item;
    if (depth > maxDepth) {
      continue;
    }

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const childPath = path.join(currentPath, entry.name);
        if (entry.name.localeCompare(directoryName, 'zh-CN', { sensitivity: 'accent' }) === 0) {
          matched.push(childPath);
        }

        if (depth < maxDepth) {
          stack.push({ currentPath: childPath, depth: depth + 1 });
        }
      }
    } catch {
      // 忽略无法读取的目录
    }
  }

  return matched;
}

function findExistingSubPath(basePath: string, segments: string[]): string | null {
  const candidate = path.join(basePath, ...segments);
  return existsSync(candidate) ? candidate : null;
}

function findDeepestEpisodeFolder(dailyFolderPath: string): string | null {
  if (!existsSync(dailyFolderPath)) {
    return null;
  }

  try {
    const entries = readdirSync(dailyFolderPath, { withFileTypes: true });
    const episodeFolders = entries
      .filter((entry) => entry.isDirectory() && /^EP\d+/i.test(entry.name))
      .map((entry) => path.join(dailyFolderPath, entry.name));
    return episodeFolders.sort((left, right) => left.localeCompare(right, 'zh-CN'))[0] ?? null;
  } catch {
    return null;
  }
}

function emptyState(error: string): FileCheckStatePayload {
  return {
    success: false,
    activeProjectId: null,
    activeEpisodeId: null,
    activeEpisodeCode: '',
    activeEpisodeName: '',
    config: { versionTag: 'ANI', layoutTag: 'LAY', lensFolderRootPath: '', layoutCheckPath: '', lensRoots: [], layoutRoots: [] },
    records: [],
    bindings: {},
    layoutCandidates: {},
    layoutVideoBindings: {},
    summary: { totalLensCount: 0, missingMaCount: 0, missingMovCount: 0, missingLayoutCount: 0, allMissingCount: 0 },
    layoutReferenceChecks: [],
    layoutReferenceSummary: { selectedLayoutLensCount: 0, checkedLensCount: 0, issueLensCount: 0, totalIssueCount: 0 },
    error,
  };
}

function emitFileCheckProgress(event: FileCheckProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('fileCheck:progress', event);
  }
}

export const fileCheckService = new FileCheckService();
