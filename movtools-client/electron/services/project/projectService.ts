/**
 * 项目服务
 * 
 * 处理项目的创建、打开、删除、集管理、镜头导入等核心业务逻辑。
 * 负责维护项目注册表（projects.json）和项目清单（.molee-project/project.json），并兼容旧版 .xj3-project。
 */
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ScanRootConfigItem } from '../../../src/types/fileCheck';
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from '../../../src/types/project';
import type { ApplyProjectInitializationRequest, ApplyProjectInitializationResponse, ProjectClientAction, ProjectInitializationResult, ProjectLensFolderPlan } from '../../../src/types/ipc';
import { initializeProjectDatabase } from './dbService';
import { readGroupedConfiguredScanRoots, replaceLayoutScanRoots, replaceLensScanRoots, type ConfiguredScanRoot } from './scanRootService';
import { parseLensImportRow, type ParsedLensImportRow } from '../lens/lensImport';
import { loadXlsx } from '../../shared/xlsx';
import { ensureLensFolder, removeCreatedLensFolders, resolveLensFolderName, validateLensFolderName } from '../lens/lensFolderService';
import type { PrepareProjectInitializationRequest, PrepareProjectInitializationResponse, ProjectLensSyncRequest } from '../../../src/types/ipc';
import { collectEnabledRootPaths, getLensLayoutRootConflictMessageFromPaths } from '../../../src/utils/projectActivationPaths';

/** 创建项目请求参数 */
interface CreateProjectRequest {
  projectName: string;
  projectRootPath: string;
  initialEpisodeCode?: string;
  initialEpisodeName?: string;
  initExcelPath?: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
}

/** 创建集请求参数 */
interface CreateEpisodeRequest {
  projectId: string;
  episodeCode: string;
  episodeName?: string;
  initExcelPath?: string;
  lensFolderRootPath?: string;
  layoutCheckPath?: string;
  lensRoots?: ScanRootConfigItem[];
  layoutRoots?: ScanRootConfigItem[];
}

/** 打开项目请求参数 */
interface OpenProjectRequest {
  projectRootPath: string;
}

/** 删除项目请求参数 */
interface DeleteProjectRequest {
  projectId: string;
  removeFiles?: boolean;
}

/** 项目变更响应 */
interface ProjectMutationResponse {
  success: boolean;
  project?: ProjectSummary;
  initialEpisode?: EpisodeSummary | null;
  workspace?: ProjectWorkspace;
  initResult?: ProjectInitializationResult;
  message?: string;
  error?: string;
}

/** 集列表响应 */
interface EpisodeListResponse {
  success: boolean;
  episodes: EpisodeSummary[];
  activeProjectId: string | null;
  activeEpisodeId: string | null;
  error?: string;
}

/** 集变更响应 */
interface EpisodeMutationResponse {
  success: boolean;
  episode?: EpisodeSummary;
  workspace?: ProjectWorkspace;
  episodes?: EpisodeSummary[];
  initResult?: ProjectInitializationResult;
  message?: string;
  error?: string;
}

/** 设置激活集结果 */
interface SetActiveEpisodeResult {
  success: boolean;
  workspace?: ProjectWorkspace;
  episode?: EpisodeSummary;
  error?: string;
}

/** 项目注册表文件结构 */
interface ProjectRegistryFile {
  activeProjectId: string | null;
  activeEpisodeId: string | null;
  projects: ProjectSummary[];
}

/** 项目清单文件结构 */
interface ProjectManifest {
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  databaseRelativePath: string;
  backupRelativePath: string;
  lensFolderRootPath?: string;
}

/** 数据库查询出的集原始行 */
interface RawEpisodeRow {
  episode_id: string;
  project_id: string;
  episode_code: string;
  episode_name: string;
  lens_folder_root_path: string | null;
  layout_check_path: string | null;
  version_tag: string | null;
  layout_tag: string | null;
  init_excel_path: string | null;
  create_time: string;
  update_time: string;
}

interface LensRootExcelImport {
  rootPath: string;
  excelPath: string;
  rootCode: string;
}

interface PreparedLensSeedRow extends ParsedLensImportRow {
  targetRootPath: string;
  excelPath: string;
  rootCode: string;
}

function normalizeNamingTag(value: string | null | undefined, fallback: string): string {
  const text = value?.trim() ?? '';
  return text ? text.toUpperCase() : fallback;
}

/** 应用数据目录下的项目注册表路径 */
const registryPath = path.join(app.getPath('userData'), 'projects.json');
/** 项目清单目录名 */
const manifestDirName = '.molee-project';
const legacyManifestDirName = '.xj3-project';
/** 项目清单文件名 */
const manifestFileName = 'project.json';
const databaseRelativePath = path.join('data', 'molee-project.db');
const backupRelativePath = 'backup';

class ProjectService {
  async getActiveProjectSummary(): Promise<ProjectSummary | null> {
    const registry = await this.readRegistry();
    if (!registry.activeProjectId) {
      return null;
    }

    return registry.projects.find((entry) => entry.projectId === registry.activeProjectId) ?? null;
  }

  async getActiveEpisodeSummary(): Promise<EpisodeSummary | null> {
    const registry = await this.readRegistry();
    if (!registry.activeProjectId) {
      return null;
    }

    const project = registry.projects.find((entry) => entry.projectId === registry.activeProjectId);
    if (!project) {
      return null;
    }

    await ensureLegacyEpisodeMigration(project);
    const episodes = this.readEpisodes(project.databasePath, project.projectId);
    if (episodes.length === 0) {
      return null;
    }

    return episodes.find((entry) => entry.episodeId === registry.activeEpisodeId) ?? episodes[0] ?? null;
  }

  async listWorkspace(): Promise<ProjectWorkspace> {
    const registry = await this.readRegistry();
    const activeEpisodeId = await this.resolveActiveEpisodeId(registry.projects, registry.activeProjectId, registry.activeEpisodeId);
    return {
      projects: registry.projects,
      activeProjectId: registry.activeProjectId,
      activeEpisodeId,
    };
  }

  async listEpisodes(projectId?: string): Promise<EpisodeListResponse> {
    const registry = await this.readRegistry();
    const targetProjectId = projectId ?? registry.activeProjectId;
    if (!targetProjectId) {
      return { success: false, episodes: [], activeProjectId: null, activeEpisodeId: null, error: '请先创建或打开一个项目。' };
    }

    const project = registry.projects.find((entry) => entry.projectId === targetProjectId);
    if (!project) {
      return { success: false, episodes: [], activeProjectId: null, activeEpisodeId: null, error: '未找到对应项目。' };
    }

    await ensureLegacyEpisodeMigration(project);
    const episodes = this.readEpisodes(project.databasePath, project.projectId);
    const activeEpisodeId = registry.activeProjectId === project.projectId
      ? episodes.find((entry) => entry.episodeId === registry.activeEpisodeId)?.episodeId ?? episodes[0]?.episodeId ?? null
      : episodes[0]?.episodeId ?? null;

    return {
      success: true,
      episodes,
      activeProjectId: project.projectId,
      activeEpisodeId,
    };
  }

  async createProject(request: CreateProjectRequest): Promise<ProjectMutationResponse> {
    const projectName = request.projectName.trim();
    const projectRootPath = path.resolve(request.projectRootPath.trim());
    const initialEpisodeCode = normalizeEpisodeCode(request.initialEpisodeCode?.trim() || 'EP01');
    const initialEpisodeName = (request.initialEpisodeName?.trim() || initialEpisodeCode).trim();
    const initExcelPath = request.initExcelPath?.trim() || '';
    const lensRoots = normalizeRootInput(request.lensRoots, request.lensFolderRootPath, 'ma');
    const layoutRoots = normalizeRootInput(request.layoutRoots, request.layoutCheckPath, 'layout');
    const lensFolderRootPath = getPrimaryRootPath(lensRoots);
    const layoutCheckPath = getPrimaryRootPath(layoutRoots);

    if (!projectName) {
      return { success: false, error: '项目名称不能为空。' };
    }

    if (!projectRootPath) {
      return { success: false, error: '项目根目录不能为空。' };
    }

    if (!initialEpisodeCode) {
      return { success: false, error: '首集编号不能为空。' };
    }

    if (!lensFolderRootPath) {
      return { success: false, error: '请先选择首集镜头文件根目录。' };
    }

    if (!layoutCheckPath) {
      return { success: false, error: '请先选择首集 layout 文件根目录。' };
    }

    const rootConflictMessage = getLensLayoutRootConflictMessageFromPaths(
      collectEnabledRootPaths(lensRoots),
      collectEnabledRootPaths(layoutRoots),
    );
    if (rootConflictMessage) {
      return { success: false, error: rootConflictMessage };
    }

    const materialRootError = await validateRealRootDirectories([...lensRoots, ...layoutRoots]);
    if (materialRootError) {
      return { success: false, error: materialRootError };
    }

    const manifestPath = this.getCurrentManifestPath(projectRootPath);
    try {
      await access(manifestPath);
      return { success: false, error: '该目录已存在制片项目，请直接打开。' };
    } catch {
      try {
        await access(this.getLegacyManifestPath(projectRootPath));
        return { success: false, error: '该目录已存在旧版制片项目，请直接打开。' };
      } catch {
        // expected when creating a new project
      }
    }

    await mkdir(projectRootPath, { recursive: true });
    await mkdir(path.join(projectRootPath, path.dirname(databaseRelativePath)), { recursive: true });
    await mkdir(path.join(projectRootPath, backupRelativePath), { recursive: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });

    const now = formatDateTime(new Date());
    const projectId = createCompactId();
    const manifest: ProjectManifest = {
      projectId,
      projectName,
      createdAt: now,
      updatedAt: now,
      databaseRelativePath,
      backupRelativePath,
      lensFolderRootPath,
    };

    const summary = this.mapManifestToSummary(projectRootPath, manifest, now);

    await initializeProjectDatabase(summary.databasePath, {
      projectId: summary.projectId,
      projectName: summary.projectName,
      projectRootPath: summary.projectRootPath,
      lensFolderRootPath: summary.lensFolderRootPath,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    });

    const episode = await createEpisodeInProject(summary, {
      projectId: summary.projectId,
      episodeCode: initialEpisodeCode,
      episodeName: initialEpisodeName,
      initExcelPath: initExcelPath || undefined,
      lensFolderRootPath,
      layoutCheckPath: layoutCheckPath || undefined,
      lensRoots: toScanRootItems(lensRoots, 'ma'),
      layoutRoots: toScanRootItems(layoutRoots, 'layout'),
    });
    const initResult = episode.initResult ?? {
      status: episode.success ? 'success' : 'failed',
      message: episode.success ? '首集初始化完成。' : episode.error ?? '首集初始化失败。',
      excelImportAttempted: Boolean(initExcelPath),
      excelImportSuccess: episode.success,
      createdLensCount: 0,
      lensFoldersPlanned: 0,
      lensFoldersCreated: 0,
      pendingClientActions: [],
      errors: episode.success ? [] : [episode.error ?? '首集初始化失败。'],
    };

    await writeJsonFile(manifestPath, manifest);

    const registry = await this.readRegistry();
    const nextRegistry = upsertProject(registry, summary, summary.projectId, episode.success ? episode.episode?.episodeId ?? null : null);
    await this.writeRegistry(nextRegistry);

    return {
      success: true,
      project: summary,
      initialEpisode: episode.success ? episode.episode ?? null : null,
      workspace: {
        projects: nextRegistry.projects,
        activeProjectId: nextRegistry.activeProjectId,
        activeEpisodeId: nextRegistry.activeEpisodeId,
      },
      initResult,
      message: initResult.message,
    };
  }

  async prepareInitialization(request: PrepareProjectInitializationRequest): Promise<PrepareProjectInitializationResponse> {
    const initExcelPath = request.initExcelPath?.trim() || '';
    const lensRoots = normalizeRootInput(request.lensRoots, undefined, 'ma');
    const imports = resolveLensRootExcelImports(lensRoots, initExcelPath);

    if (imports.length === 0) {
      return {
        success: true,
        initResult: {
          status: 'skipped',
          message: '未提供可解析的初始化 Excel，已跳过本地解析。',
          excelImportAttempted: false,
          excelImportSuccess: false,
          createdLensCount: 0,
          lensFoldersPlanned: 0,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [],
        },
        preparedLensSyncItems: [],
      };
    }

    try {
      const validRows = await readPreparedLensSeedRows(imports);
      if (validRows.length === 0) {
        return {
          success: false,
          initResult: {
            status: 'failed',
            message: '本地解析失败：初始化 Excel 中没有可导入的数据。',
            excelImportAttempted: true,
            excelImportSuccess: false,
            createdLensCount: 0,
            lensFoldersPlanned: 0,
            lensFoldersCreated: 0,
            pendingClientActions: [],
            errors: ['初始化 Excel 中没有可导入的数据。'],
          },
          preparedLensSyncItems: [],
          error: '本地解析失败：初始化 Excel 中没有可导入的数据。',
        };
      }

      const seenCodes = new Set<string>();
      const seenFolderNames = new Set<string>();
      const preparedLensSyncItems: ProjectLensSyncRequest[] = [];

      for (const row of validRows) {
        if (seenCodes.has(row.lensCode)) {
          const message = `本地校验失败：导入文件中存在重复镜头编号：${row.lensCode}`;
          return {
            success: false,
            initResult: {
              status: 'failed',
              message,
              excelImportAttempted: true,
              excelImportSuccess: false,
              createdLensCount: 0,
              lensFoldersPlanned: 0,
              lensFoldersCreated: 0,
              pendingClientActions: [],
              errors: [message],
            },
            preparedLensSyncItems: [],
            error: message,
          };
        }
        seenCodes.add(row.lensCode);

        const folderName = resolveLensFolderName(row.lensName, row.lensCode);
        const folderNameError = validateLensFolderName(folderName);
        if (folderNameError) {
          const message = `本地校验失败：${folderNameError}`;
          return {
            success: false,
            initResult: {
              status: 'failed',
              message,
              excelImportAttempted: true,
              excelImportSuccess: false,
              createdLensCount: 0,
              lensFoldersPlanned: 0,
              lensFoldersCreated: 0,
              pendingClientActions: [],
              errors: [message],
            },
            preparedLensSyncItems: [],
            error: message,
          };
        }

        const folderKey = `${row.targetRootPath.toUpperCase()}::${folderName.toUpperCase()}`;
        if (seenFolderNames.has(folderKey)) {
          const message = `本地校验失败：导入文件中存在重复镜头文件夹名称：${folderName}`;
          return {
            success: false,
            initResult: {
              status: 'failed',
              message,
              excelImportAttempted: true,
              excelImportSuccess: false,
              createdLensCount: 0,
              lensFoldersPlanned: 0,
              lensFoldersCreated: 0,
              pendingClientActions: [],
              errors: [message],
            },
            preparedLensSyncItems: [],
            error: message,
          };
        }
        seenFolderNames.add(folderKey);

        preparedLensSyncItems.push({
          code: row.lensCode,
          name: row.lensName,
          sequence: row.sceneNo > 0 ? row.sceneNo : preparedLensSyncItems.length + 1,
          singleFrame: row.hasSingleFrame ? row.singleFrame : 0,
          maker: row.maker || null,
          description: row.maker ? `负责人：${row.maker}` : null,
          rootCode: row.rootCode,
          logicalPath: `${row.rootCode}/${folderName}`,
          versionTag: 'ANI',
          layoutTag: 'LAY',
        });
      }

      return {
        success: true,
        initResult: {
          status: 'success',
          message: `本地解析成功，已准备 ${preparedLensSyncItems.length} 条镜头同步数据。`,
          excelImportAttempted: true,
          excelImportSuccess: true,
          createdLensCount: preparedLensSyncItems.length,
          lensFoldersPlanned: 0,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [],
        },
        preparedLensSyncItems,
      };
    } catch (error) {
      const message = error instanceof Error ? `本地解析失败：${error.message}` : '本地解析失败：未知错误。';
      return {
        success: false,
        initResult: {
          status: 'failed',
          message,
          excelImportAttempted: true,
          excelImportSuccess: false,
          createdLensCount: 0,
          lensFoldersPlanned: 0,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [message],
        },
        preparedLensSyncItems: [],
        error: message,
      };
    }
  }

  async applyInitialization(request: ApplyProjectInitializationRequest): Promise<ApplyProjectInitializationResponse> {
    const pendingActions = new Set(request.pendingClientActions ?? []);
    let initResult: ProjectInitializationResult;
    const executedClientActions: ProjectClientAction[] = [];

    if (pendingActions.has('create_lens_folders')) {
      if (!request.lensFolderPlans || request.lensFolderPlans.length === 0) {
        initResult = {
          status: 'failed',
          message: '缺少真实镜头文件夹创建计划，无法消费 create_lens_folders。',
          excelImportAttempted: false,
          excelImportSuccess: false,
          createdLensCount: 0,
          lensFoldersPlanned: 0,
          lensFoldersCreated: 0,
          pendingClientActions: Array.from(pendingActions),
          errors: ['缺少真实镜头文件夹创建计划。'],
        };
      } else {
        const rootInit = await ensureInitializationRoots({ lensRoots: request.lensRoots, layoutRoots: request.layoutRoots });
        const folderInit = await createLensFoldersFromPlans(request.lensFolderPlans);
        initResult = mergeInitializationResults(rootInit, folderInit, []);
        pendingActions.delete('create_lens_folders');
        executedClientActions.push('create_lens_folders');
      }
    } else {
      initResult = await ensureInitializationRoots({ lensRoots: request.lensRoots, layoutRoots: request.layoutRoots });
    }

    if (pendingActions.has('refresh_local_episode_workspace')) {
      const refreshResult = await this.refreshLocalEpisodeWorkspace(request);
      if (refreshResult.status !== 'failed') {
        pendingActions.delete('refresh_local_episode_workspace');
        executedClientActions.push('refresh_local_episode_workspace');
      }
      initResult = mergeInitializationResults(initResult, refreshResult, Array.from(pendingActions));
    }

    initResult.pendingClientActions = Array.from(pendingActions);
    return {
      success: initResult.status !== 'failed',
      initResult,
      executedClientActions,
      error: initResult.status === 'failed' ? initResult.message : undefined,
    };
  }

  async createEpisode(request: CreateEpisodeRequest): Promise<EpisodeMutationResponse> {
    const registry = await this.readRegistry();
    const project = registry.projects.find((entry) => entry.projectId === request.projectId);
    if (!project) {
      return { success: false, error: '未找到对应项目。' };
    }

    await ensureLegacyEpisodeMigration(project);
    const result = await createEpisodeInProject(project, request);
    if (!result.success) {
      return result;
    }

    const nextRegistry = upsertProject(registry, project, project.projectId, result.episode?.episodeId ?? registry.activeEpisodeId);
    await this.writeRegistry(nextRegistry);
    const episodes = this.readEpisodes(project.databasePath, project.projectId);

    return {
      success: true,
      episode: result.episode,
      episodes,
      workspace: {
        projects: nextRegistry.projects,
        activeProjectId: nextRegistry.activeProjectId,
        activeEpisodeId: nextRegistry.activeEpisodeId,
      },
    };
  }

  async openProject(request: OpenProjectRequest): Promise<ProjectMutationResponse> {
    const projectRootPath = path.resolve(request.projectRootPath.trim());
    if (!projectRootPath) {
      return { success: false, error: '项目根目录不能为空。' };
    }

    const manifest = await this.readManifest(projectRootPath);
    if (!manifest) {
      return { success: false, error: '所选目录不是已初始化的制片项目。' };
    }

    const now = formatDateTime(new Date());
    const summary = this.mapManifestToSummary(projectRootPath, { ...manifest, updatedAt: manifest.updatedAt }, now);

    await initializeProjectDatabase(summary.databasePath, {
      projectId: summary.projectId,
      projectName: summary.projectName,
      projectRootPath: summary.projectRootPath,
      lensFolderRootPath: summary.lensFolderRootPath,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    });

    await ensureLegacyEpisodeMigration(summary);
    const episodes = this.readEpisodes(summary.databasePath, summary.projectId);

    const registry = await this.readRegistry();
    const preferredEpisodeId = registry.activeProjectId === summary.projectId ? registry.activeEpisodeId : null;
    const activeEpisodeId = episodes.find((entry) => entry.episodeId === preferredEpisodeId)?.episodeId ?? episodes[0]?.episodeId ?? null;
    const nextRegistry = upsertProject(registry, summary, summary.projectId, activeEpisodeId);
    await this.writeRegistry(nextRegistry);

    return {
      success: true,
      project: summary,
      workspace: {
        projects: nextRegistry.projects,
        activeProjectId: nextRegistry.activeProjectId,
        activeEpisodeId: nextRegistry.activeEpisodeId,
      },
    };
  }

  async setActiveProject(projectId: string): Promise<ProjectMutationResponse> {
    const registry = await this.readRegistry();
    const project = registry.projects.find((entry) => entry.projectId === projectId);
    if (!project) {
      return { success: false, error: '未找到对应项目。' };
    }

    await ensureLegacyEpisodeMigration(project);
    const episodes = this.readEpisodes(project.databasePath, project.projectId);
    const nextActiveEpisodeId = episodes.find((entry) => entry.episodeId === registry.activeEpisodeId)?.episodeId ?? episodes[0]?.episodeId ?? null;
    const nextProjects = registry.projects.map((entry) => (
      entry.projectId === projectId
        ? { ...entry, lastOpenedAt: formatDateTime(new Date()) }
        : entry
    ));

    const nextRegistry: ProjectRegistryFile = {
      activeProjectId: projectId,
      activeEpisodeId: nextActiveEpisodeId,
      projects: nextProjects,
    };

    await this.writeRegistry(nextRegistry);

    return {
      success: true,
      project: nextProjects.find((entry) => entry.projectId === projectId),
      workspace: {
        projects: nextRegistry.projects,
        activeProjectId: nextRegistry.activeProjectId,
        activeEpisodeId: nextRegistry.activeEpisodeId,
      },
    };
  }

  async setActiveEpisode(episodeId: string): Promise<SetActiveEpisodeResult> {
    const registry = await this.readRegistry();

    for (const project of registry.projects) {
      await ensureLegacyEpisodeMigration(project);
      const episodes = this.readEpisodes(project.databasePath, project.projectId);
      const episode = episodes.find((entry) => entry.episodeId === episodeId);
      if (!episode) {
        continue;
      }

      const nextRegistry: ProjectRegistryFile = {
        activeProjectId: project.projectId,
        activeEpisodeId: episode.episodeId,
        projects: registry.projects.map((entry) => (
          entry.projectId === project.projectId
            ? { ...entry, lastOpenedAt: formatDateTime(new Date()) }
            : entry
        )),
      };

      await this.writeRegistry(nextRegistry);

      return {
        success: true,
        episode,
        workspace: {
          projects: nextRegistry.projects,
          activeProjectId: nextRegistry.activeProjectId,
          activeEpisodeId: nextRegistry.activeEpisodeId,
        },
      };
    }

    return { success: false, error: '未找到对应集。' };
  }

  private async refreshLocalEpisodeWorkspace(request: ApplyProjectInitializationRequest): Promise<ProjectInitializationResult> {
    if (!request.projectId || !request.episodeId) {
      return {
        status: 'failed',
        message: '刷新本地集工作区需要 projectId 和 episodeId。',
        excelImportAttempted: false,
        excelImportSuccess: false,
        createdLensCount: 0,
        lensFoldersPlanned: 0,
        lensFoldersCreated: 0,
        pendingClientActions: ['refresh_local_episode_workspace'],
        errors: ['缺少 projectId 或 episodeId。'],
      };
    }

    const lensSyncItems = request.lensSyncItems ?? [];

    const registry = await this.readRegistry();
    const project = registry.projects.find((entry) => entry.projectId === request.projectId);
    if (!project) {
      return {
        status: 'failed',
        message: `未找到要刷新的项目：${request.projectId}`,
        excelImportAttempted: false,
        excelImportSuccess: false,
        createdLensCount: 0,
        lensFoldersPlanned: 0,
        lensFoldersCreated: 0,
        pendingClientActions: ['refresh_local_episode_workspace'],
        errors: [`未找到要刷新的项目：${request.projectId}`],
      };
    }

    const database = new DatabaseSync(project.databasePath);
    const now = formatDateTime(new Date());
    const normalizedLensRoots = normalizeRootInput(request.lensRoots, undefined, 'ma');
    const normalizedLayoutRoots = normalizeRootInput(request.layoutRoots, undefined, 'layout');

    try {
      const hasEpisode = database.prepare('SELECT episode_id FROM episode WHERE episode_id = ? LIMIT 1').get(request.episodeId) as { episode_id: string } | undefined;
      const versionTag = normalizeNamingTag(request.versionTag ?? lensSyncItems.find((item) => item.versionTag?.trim())?.versionTag ?? 'ANI', 'ANI');
      const layoutTag = normalizeNamingTag(request.layoutTag ?? lensSyncItems.find((item) => item.layoutTag?.trim())?.layoutTag ?? 'LAY', 'LAY');
      const episodeCode = (request.episodeCode?.trim() || request.episodeId).trim();
      const episodeName = (request.episodeName?.trim() || episodeCode).trim();
      const lensFolderRootPath = request.lensRoots?.find((root) => root.isEnabled && root.absolutePath.trim())?.absolutePath.trim() ?? null;
      const layoutCheckPath = request.layoutRoots?.find((root) => root.isEnabled && root.absolutePath.trim())?.absolutePath.trim() ?? null;

      database.exec('BEGIN');
      try {
        if (normalizedLensRoots.length > 0) {
          replaceLensScanRoots(database, { projectId: project.projectId, episodeId: request.episodeId }, normalizedLensRoots, now);
        }

        if (normalizedLayoutRoots.length > 0) {
          replaceLayoutScanRoots(database, { projectId: project.projectId, episodeId: request.episodeId }, normalizedLayoutRoots, now);
        }

        database.prepare(`DELETE FROM lens_lifecycle_attachment WHERE event_id IN (SELECT event_id FROM lens_lifecycle WHERE episode_id = ?)` ).run(request.episodeId);
        database.prepare(`DELETE FROM lens_lifecycle WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM lens_file WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM lens_layout_candidate WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM lens_layout_video_binding WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM layout_reference_issue WHERE check_id IN (SELECT check_id FROM layout_reference_check WHERE episode_id = ?)` ).run(request.episodeId);
        database.prepare(`DELETE FROM layout_reference_check WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM file_check WHERE episode_id = ?`).run(request.episodeId);
        database.prepare(`DELETE FROM lens WHERE episode_id = ?`).run(request.episodeId);

        if (hasEpisode) {
          database.prepare(`
            UPDATE episode
            SET episode_code = ?, episode_name = ?, lens_folder_root_path = COALESCE(?, lens_folder_root_path), layout_check_path = COALESCE(?, layout_check_path), version_tag = ?, layout_tag = ?, update_time = ?
            WHERE episode_id = ?
          `).run(episodeCode, episodeName, lensFolderRootPath, layoutCheckPath, versionTag, layoutTag, now, request.episodeId);
        } else {
          database.prepare(`
            INSERT INTO episode (episode_id, project_id, episode_code, episode_name, lens_folder_root_path, layout_check_path, version_tag, layout_tag, init_excel_path, create_time, update_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(request.episodeId, project.projectId, episodeCode, episodeName, lensFolderRootPath, layoutCheckPath, versionTag, layoutTag, now, now);
        }

        for (const item of lensSyncItems) {
          const lensId = item.lensId ?? item.code;
          const itemVersionTag = normalizeNamingTag(item.versionTag ?? versionTag, versionTag);
          const itemVersionNum = 'V01';
          const fileName = item.logicalPath?.trim().split(/[\\/]/).pop() || `${item.code}_${itemVersionTag}_${itemVersionNum.toLowerCase()}`;
          database.prepare(`
            INSERT INTO lens (lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, frame_source_locked, maker, note, lens_status, version_tag, version_num, file_name, update_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            lensId,
            request.episodeId,
            item.code,
            item.sequence,
            item.name,
            item.singleFrame ?? 0,
            1,
            item.maker ?? '',
            item.description ?? null,
            item.lensStatus ?? '制作',
            itemVersionTag,
            itemVersionNum,
            fileName,
            now,
          );
        }

        database.prepare(`UPDATE project SET lens_folder_root_path = COALESCE(?, lens_folder_root_path), ma_check_path = COALESCE(?, ma_check_path), mov_check_path = COALESCE(?, mov_check_path), layout_check_path = COALESCE(?, layout_check_path), update_time = ? WHERE project_id = ?`)
          .run(lensFolderRootPath, lensFolderRootPath, lensFolderRootPath, layoutCheckPath, now, project.projectId);

        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }

      return {
        status: 'success',
        message: `本地集工作区已刷新，镜头 ${lensSyncItems.length} 条。`,
        excelImportAttempted: false,
        excelImportSuccess: false,
        createdLensCount: lensSyncItems.length,
        lensFoldersPlanned: 0,
        lensFoldersCreated: 0,
        pendingClientActions: [],
        errors: [],
      };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : '刷新本地集工作区失败。',
        excelImportAttempted: false,
        excelImportSuccess: false,
        createdLensCount: 0,
        lensFoldersPlanned: 0,
        lensFoldersCreated: 0,
        pendingClientActions: ['refresh_local_episode_workspace'],
        errors: [error instanceof Error ? error.message : '刷新本地集工作区失败。'],
      };
    } finally {
      database.close();
    }
  }

  async deleteProject(request: DeleteProjectRequest): Promise<ProjectMutationResponse> {
    const registry = await this.readRegistry();
    const project = registry.projects.find((entry) => entry.projectId === request.projectId);
    if (!project) {
      return { success: false, error: '未找到对应项目。' };
    }

    if (request.removeFiles) {
      await rm(project.projectRootPath, { recursive: true, force: true });
    }

    const nextProjects = registry.projects.filter((entry) => entry.projectId !== request.projectId);
    const fallbackProjectId = nextProjects[0]?.projectId ?? null;
    const fallbackEpisodeId = fallbackProjectId ? await this.resolveActiveEpisodeId(nextProjects, fallbackProjectId, null) : null;
    const nextRegistry: ProjectRegistryFile = {
      activeProjectId: registry.activeProjectId === request.projectId ? fallbackProjectId : registry.activeProjectId,
      activeEpisodeId: registry.activeProjectId === request.projectId ? fallbackEpisodeId : registry.activeEpisodeId,
      projects: nextProjects,
    };

    await this.writeRegistry(nextRegistry);

    return {
      success: true,
      workspace: {
        projects: nextRegistry.projects,
        activeProjectId: nextRegistry.activeProjectId,
        activeEpisodeId: nextRegistry.activeEpisodeId,
      },
    };
  }

  private async readRegistry(): Promise<ProjectRegistryFile> {
    try {
      const content = await readFile(registryPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<ProjectRegistryFile>;
      const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
      const projects = await Promise.all(rawProjects.map((entry) => this.hydrateProjectEntry(entry)));
      const validProjects = projects.filter((entry): entry is ProjectSummary => entry !== null);
      const activeProjectId = validProjects.some((entry) => entry.projectId === parsed.activeProjectId) ? parsed.activeProjectId ?? null : validProjects[0]?.projectId ?? null;
      const activeEpisodeId = await this.resolveActiveEpisodeId(validProjects, activeProjectId, parsed.activeEpisodeId ?? null);

      return {
        activeProjectId,
        activeEpisodeId,
        projects: validProjects,
      };
    } catch {
      return {
        activeProjectId: null,
        activeEpisodeId: null,
        projects: [],
      };
    }
  }

  private async writeRegistry(registry: ProjectRegistryFile): Promise<void> {
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeJsonFile(registryPath, registry);
  }

  private async hydrateProjectEntry(entry: ProjectSummary): Promise<ProjectSummary | null> {
    if (!entry?.projectRootPath) {
      return null;
    }

    try {
      await stat(await this.getManifestPath(entry.projectRootPath));
      const manifest = await this.readManifest(entry.projectRootPath);
      if (!manifest) {
        return null;
      }

      return this.mapManifestToSummary(entry.projectRootPath, manifest, entry.lastOpenedAt);
    } catch {
      return null;
    }
  }

  private async readManifest(projectRootPath: string): Promise<ProjectManifest | null> {
    try {
      const content = await readFile(await this.getManifestPath(projectRootPath), 'utf8');
      return JSON.parse(content) as ProjectManifest;
    } catch {
      return null;
    }
  }

  private mapManifestToSummary(projectRootPath: string, manifest: ProjectManifest, lastOpenedAt?: string): ProjectSummary {
    return {
      projectId: manifest.projectId,
      projectName: manifest.projectName,
      projectRootPath,
      databasePath: path.join(projectRootPath, manifest.databaseRelativePath),
      backupDir: path.join(projectRootPath, manifest.backupRelativePath),
      lensFolderRootPath: manifest.lensFolderRootPath,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      lastOpenedAt,
    };
  }

  private async getManifestPath(projectRootPath: string): Promise<string> {
    const currentPath = this.getCurrentManifestPath(projectRootPath);
    try {
      await access(currentPath);
      return currentPath;
    } catch {
      const legacyPath = this.getLegacyManifestPath(projectRootPath);
      return legacyPath;
    }
  }

  private getCurrentManifestPath(projectRootPath: string): string {
    return path.join(projectRootPath, manifestDirName, manifestFileName);
  }

  private getLegacyManifestPath(projectRootPath: string): string {
    return path.join(projectRootPath, legacyManifestDirName, manifestFileName);
  }

  private readEpisodes(databasePath: string, projectId: string): EpisodeSummary[] {
    const database = new DatabaseSync(databasePath);
    try {
      return (database.prepare(`
        SELECT episode_id, project_id, episode_code, episode_name, lens_folder_root_path, layout_check_path, version_tag, layout_tag, init_excel_path, create_time, update_time
        FROM episode
        WHERE project_id = ?
        ORDER BY create_time ASC, episode_code ASC
      `).all(projectId) as unknown as RawEpisodeRow[]).map((row) => {
        const episode = mapEpisodeRow(row);
        const groupedRoots = readGroupedConfiguredScanRoots(database, { projectId, episodeId: row.episode_id });
        return {
          ...episode,
          lensRoots: toScanRootItems(groupedRoots.lens, 'ma'),
          layoutRoots: toScanRootItems(groupedRoots.layout, 'layout'),
        } satisfies EpisodeSummary;
      });
    } catch {
      return [];
    } finally {
      database.close();
    }
  }

  private async resolveActiveEpisodeId(projects: ProjectSummary[], activeProjectId: string | null, preferredEpisodeId: string | null): Promise<string | null> {
    if (!activeProjectId) {
      return null;
    }

    const project = projects.find((entry) => entry.projectId === activeProjectId);
    if (!project) {
      return null;
    }

    await ensureLegacyEpisodeMigration(project);
    const episodes = this.readEpisodes(project.databasePath, project.projectId);
    if (episodes.length === 0) {
      return null;
    }

    return episodes.find((entry) => entry.episodeId === preferredEpisodeId)?.episodeId ?? episodes[0]?.episodeId ?? null;
  }
}

async function createEpisodeInProject(project: ProjectSummary, request: CreateEpisodeRequest): Promise<EpisodeMutationResponse> {
  const episodeCode = normalizeEpisodeCode(request.episodeCode?.trim() || '');
  const episodeName = (request.episodeName?.trim() || episodeCode).trim();
  const initExcelPath = request.initExcelPath?.trim() || '';
  const lensRoots = normalizeRootInput(request.lensRoots, request.lensFolderRootPath, 'ma');
  const layoutRoots = normalizeRootInput(request.layoutRoots, request.layoutCheckPath, 'layout');
  const lensFolderRootPath = getPrimaryRootPath(lensRoots);
  const layoutCheckPath = getPrimaryRootPath(layoutRoots);
  const lensFolderPlanned = lensRoots.filter((root) => root.isEnabled && root.absolutePath.trim()).length;
  const excelImportAttempted = Boolean(resolveLensRootExcelImports(lensRoots, initExcelPath).length);

  if (!episodeCode) {
    return {
      success: false,
      error: '集编号不能为空。',
      initResult: {
        status: 'failed',
        message: '集编号不能为空。',
        excelImportAttempted,
        excelImportSuccess: false,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: [],
        errors: ['集编号不能为空。'],
      },
    };
  }

  if (!lensFolderRootPath) {
    return {
      success: false,
      error: '请先选择该集镜头文件根目录。',
      initResult: {
        status: 'skipped',
        message: '未执行首集初始化：缺少镜头文件根目录。',
        excelImportAttempted,
        excelImportSuccess: false,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: ['create_lens_folders'],
        errors: ['请先选择该集镜头文件根目录。'],
      },
    };
  }

  if (!layoutCheckPath) {
    return {
      success: false,
      error: '请先选择该集 layout 文件根目录。',
      initResult: {
        status: 'skipped',
        message: '未执行首集初始化：缺少 layout 文件根目录。',
        excelImportAttempted,
        excelImportSuccess: false,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: ['create_lens_folders'],
        errors: ['请先选择该集 layout 文件根目录。'],
      },
    };
  }

    const rootConflictMessage = getLensLayoutRootConflictMessageFromPaths(
      collectEnabledRootPaths(lensRoots),
      collectEnabledRootPaths(layoutRoots),
    );
    if (rootConflictMessage) {
      return {
        success: false,
        error: rootConflictMessage,
      initResult: {
        status: 'failed',
        message: rootConflictMessage,
        excelImportAttempted,
        excelImportSuccess: false,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: [],
        errors: [rootConflictMessage],
      },
    };
  }

  const database = new DatabaseSync(project.databasePath);
  const now = formatDateTime(new Date());
  const episode: EpisodeSummary = {
    episodeId: createCompactId(),
    projectId: project.projectId,
    episodeCode,
    episodeName,
    lensFolderRootPath,
    layoutCheckPath,
    versionTag: 'ANI',
    layoutTag: 'LAY',
    initExcelPath: initExcelPath || undefined,
    lensRoots: toScanRootItems(lensRoots, 'ma'),
    layoutRoots: toScanRootItems(layoutRoots, 'layout'),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const duplicate = database.prepare('SELECT episode_id FROM episode WHERE project_id = ? AND episode_code = ?').get(project.projectId, episodeCode);
    if (duplicate) {
      return {
        success: false,
        error: `集编号「${episodeCode}」已存在。`,
        initResult: {
          status: 'failed',
          message: `集编号「${episodeCode}」已存在。`,
          excelImportAttempted,
          excelImportSuccess: false,
          lensFoldersPlanned: lensFolderPlanned,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [`集编号「${episodeCode}」已存在。`],
        },
      };
    }

    const materialRootError = await validateRealRootDirectories([...lensRoots, ...layoutRoots]);
    if (materialRootError) {
      return {
        success: false,
        error: materialRootError,
        initResult: {
          status: 'failed',
          message: materialRootError,
          excelImportAttempted,
          excelImportSuccess: false,
          lensFoldersPlanned: lensFolderPlanned,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [materialRootError],
        },
      };
    }

    const lensRootStat = await stat(lensFolderRootPath);
    if (!lensRootStat.isDirectory()) {
      return {
        success: false,
        error: `镜头根目录不是文件夹：${lensFolderRootPath}`,
        initResult: {
          status: 'failed',
          message: `镜头根目录不是文件夹：${lensFolderRootPath}`,
          excelImportAttempted,
          excelImportSuccess: false,
          lensFoldersPlanned: lensFolderPlanned,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [`镜头根目录不是文件夹：${lensFolderRootPath}`],
        },
      };
    }

    database.prepare(`
      INSERT INTO episode (episode_id, project_id, episode_code, episode_name, lens_folder_root_path, layout_check_path, version_tag, layout_tag, init_excel_path, create_time, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(episode.episodeId, episode.projectId, episode.episodeCode, episode.episodeName, episode.lensFolderRootPath ?? null, episode.layoutCheckPath ?? null, episode.versionTag ?? 'ANI', episode.layoutTag ?? 'LAY', episode.initExcelPath ?? null, episode.createdAt, episode.updatedAt);
    replaceLensScanRoots(database, { projectId: project.projectId, episodeId: episode.episodeId }, lensRoots, now);
    replaceLayoutScanRoots(database, { projectId: project.projectId, episodeId: episode.episodeId }, layoutRoots, now);

    const excelImports = resolveLensRootExcelImports(lensRoots, initExcelPath);
    if (excelImports.length > 0) {
      const importResult = await seedLensesFromRootExcels(project.databasePath, episode, excelImports);
      if (!importResult.success) {
        database.prepare('DELETE FROM episode WHERE episode_id = ?').run(episode.episodeId);
        return {
          success: false,
          error: `初始化导入镜头失败：${importResult.error}`,
          initResult: {
            status: 'failed',
            message: `初始化导入镜头失败：${importResult.error}`,
            excelImportAttempted: true,
            excelImportSuccess: false,
            lensFoldersPlanned: lensFolderPlanned,
            lensFoldersCreated: 0,
            pendingClientActions: [],
            errors: [importResult.error ?? '初始化导入镜头失败。'],
          },
        };
      }

      return {
        success: true,
        episode,
        initResult: {
          status: 'success',
          message: `首集已初始化，导入镜头 ${importResult.importedCount ?? 0} 个。`,
          excelImportAttempted: true,
          excelImportSuccess: true,
          createdLensCount: importResult.importedCount ?? 0,
          lensFoldersPlanned: lensFolderPlanned,
          lensFoldersCreated: importResult.importedCount ?? 0,
          pendingClientActions: [],
          errors: [],
        },
      };
    }

    return {
      success: true,
      episode,
      initResult: {
        status: 'skipped',
        message: '已创建首集，但未提供初始化 Excel，未执行镜头导入。',
        excelImportAttempted: false,
        excelImportSuccess: false,
        createdLensCount: 0,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: ['create_lens_folders'],
        errors: [],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建集失败。';
    return {
      success: false,
      error: message,
      initResult: {
        status: 'failed',
        message,
        excelImportAttempted,
        excelImportSuccess: false,
        lensFoldersPlanned: lensFolderPlanned,
        lensFoldersCreated: 0,
        pendingClientActions: [],
        errors: [message],
      },
    };
  } finally {
    database.close();
  }
}

async function validateRealRootDirectories(roots: ConfiguredScanRoot[]): Promise<string | null> {
  const enabledRoots = roots.filter((root) => root.isEnabled && root.absolutePath.trim());
  for (const root of enabledRoots) {
    const rootPath = root.absolutePath.trim();
    try {
      const existing = await stat(rootPath);
      if (!existing.isDirectory()) {
        return `${root.label || root.fileKind}：素材目录不是文件夹：${rootPath}`;
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return `${root.label || root.fileKind}：素材目录缺失：${rootPath}`;
      }
      return `${root.label || root.fileKind}：素材目录检查失败：${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  return null;
}

async function ensureInitializationRoots(request: ApplyProjectInitializationRequest): Promise<ProjectInitializationResult> {
    const roots = [
      ...(request.lensRoots ?? []),
      ...(request.layoutRoots ?? []),
    ]
      .filter((root) => root.isEnabled && root.absolutePath.trim())
      .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'));

  if (roots.length === 0) {
    return {
      status: 'not_requested',
      message: '未配置需要收口的本地目录。',
      excelImportAttempted: false,
      excelImportSuccess: false,
      createdLensCount: 0,
      lensFoldersPlanned: 0,
      lensFoldersCreated: 0,
      pendingClientActions: [],
      errors: [],
    };
  }

  const errors: string[] = [];
  let createdCount = 0;

  for (const root of roots) {
    const rootPath = root.absolutePath.trim();
    try {
      const existing = await stat(rootPath);
      if (!existing.isDirectory()) {
        throw new Error(`路径已存在但不是文件夹：${rootPath}`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        errors.push(`${root.label || root.fileKind}：素材目录缺失，无法自动创建。请先确认本机真实目录是否存在：${rootPath}`);
      } else {
        errors.push(error instanceof Error ? `${root.label || root.fileKind}：${error.message}` : `${root.label || root.fileKind}：素材目录检查失败。`);
      }
    }
  }

  if (errors.length === 0) {
    return {
      status: 'success',
      message: `已完成 ${roots.length} 个本地目录收口。`,
      excelImportAttempted: false,
      excelImportSuccess: false,
      createdLensCount: 0,
      lensFoldersPlanned: roots.length,
      lensFoldersCreated: createdCount,
      pendingClientActions: [],
      errors: [],
    };
  }

  return {
    status: createdCount > 0 ? 'partial_success' : 'failed',
    message: createdCount > 0
      ? `本地目录收口部分完成：${createdCount}/${roots.length}。`
      : `本地目录收口失败：${errors[0]}`,
    excelImportAttempted: false,
    excelImportSuccess: false,
    createdLensCount: 0,
    lensFoldersPlanned: roots.length,
    lensFoldersCreated: createdCount,
    pendingClientActions: [],
    errors,
  };
}

function mergeInitializationResults(base: ProjectInitializationResult, local: ProjectInitializationResult, pendingClientActions: ProjectClientAction[]): ProjectInitializationResult {
  const errors = Array.from(new Set([...(base.errors ?? []), ...(local.errors ?? [])]));
  let status: ProjectInitializationResult['status'] = base.status;

  if (base.status === 'failed' || local.status === 'failed') {
    status = 'failed';
  } else if (pendingClientActions.length > 0 || base.status === 'partial_success' || local.status === 'partial_success') {
    status = 'partial_success';
  } else if (base.status === 'success' || local.status === 'success') {
    status = 'success';
  } else if (base.status === 'skipped' || local.status === 'skipped') {
    status = base.status === 'skipped' ? 'skipped' : local.status;
  } else if (base.status === 'not_requested' && local.status === 'not_requested') {
    status = 'not_requested';
  }

  return {
    status,
    message: local.message || base.message,
    excelImportAttempted: base.excelImportAttempted || local.excelImportAttempted,
    excelImportSuccess: base.excelImportSuccess || local.excelImportSuccess,
    createdLensCount: base.createdLensCount ?? local.createdLensCount,
    lensFoldersPlanned: local.lensFoldersPlanned ?? base.lensFoldersPlanned,
    lensFoldersCreated: local.lensFoldersCreated ?? base.lensFoldersCreated,
    pendingClientActions,
    errors,
  };
}

async function createLensFoldersFromPlans(plans: ProjectLensFolderPlan[]): Promise<ProjectInitializationResult> {
  const normalizedPlans = plans
    .map((plan) => ({
      ...plan,
      rootPath: plan.rootPath.trim(),
      folderName: plan.folderName.trim(),
      lensCode: plan.lensCode.trim(),
      lensName: plan.lensName?.trim(),
    }))
    .filter((plan) => plan.rootPath && plan.folderName);

  if (normalizedPlans.length === 0) {
    return {
      status: 'not_requested',
      message: '未配置需要创建的镜头文件夹。',
      excelImportAttempted: false,
      excelImportSuccess: false,
      createdLensCount: 0,
      lensFoldersPlanned: 0,
      lensFoldersCreated: 0,
      pendingClientActions: [],
      errors: [],
    };
  }

  const errors: string[] = [];
  const failedRootPaths = new Set<string>();

  for (const rootPath of new Set(normalizedPlans.map((plan) => plan.rootPath))) {
    try {
      const rootStat = await stat(rootPath);
      if (!rootStat.isDirectory()) {
        failedRootPaths.add(rootPath);
        errors.push(`镜头根目录不是文件夹：${rootPath}`);
      }
    } catch (error) {
      failedRootPaths.add(rootPath);
      errors.push(error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? `镜头根目录缺失：${rootPath}`
        : error instanceof Error
          ? error.message
          : `镜头根目录检查失败：${rootPath}`);
    }
  }

  let createdCount = 0;

  for (const plan of normalizedPlans) {
    if (failedRootPaths.has(plan.rootPath)) {
      continue;
    }

    const folderNameError = validateLensFolderName(plan.folderName);
    if (folderNameError) {
      errors.push(`${plan.lensCode || plan.lensName || '镜头'}：${folderNameError}`);
      continue;
    }

    try {
      const folderResult = await ensureLensFolder(plan.rootPath, plan.folderName);
      if (folderResult.created) {
        createdCount += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? `${plan.lensCode || plan.lensName || '镜头'}：${error.message}` : `${plan.lensCode || plan.lensName || '镜头'}：镜头文件夹创建失败。`);
    }
  }

  if (errors.length === 0) {
    return {
      status: 'success',
      message: `已完成 ${normalizedPlans.length} 个镜头文件夹创建。`,
      excelImportAttempted: false,
      excelImportSuccess: false,
      createdLensCount: 0,
      lensFoldersPlanned: normalizedPlans.length,
      lensFoldersCreated: createdCount,
      pendingClientActions: [],
      errors: [],
    };
  }

  return {
    status: createdCount > 0 ? 'partial_success' : 'failed',
    message: createdCount > 0
      ? `镜头文件夹创建部分完成：${createdCount}/${normalizedPlans.length}。`
      : `镜头文件夹创建失败：${errors[0]}`,
    excelImportAttempted: false,
    excelImportSuccess: false,
    createdLensCount: 0,
    lensFoldersPlanned: normalizedPlans.length,
    lensFoldersCreated: createdCount,
    pendingClientActions: [],
    errors,
  };
}

async function ensureLegacyEpisodeMigration(project: ProjectSummary): Promise<void> {
  const database = new DatabaseSync(project.databasePath);
  try {
    const episodes = database.prepare('SELECT episode_id FROM episode WHERE project_id = ? LIMIT 1').get(project.projectId) as { episode_id: string } | undefined;
    const lensWithoutEpisode = database.prepare("SELECT lens_id FROM lens WHERE COALESCE(TRIM(episode_id), '') = '' LIMIT 1").get() as { lens_id: string } | undefined;

    let fallbackEpisodeId = episodes?.episode_id;
    if (!fallbackEpisodeId) {
      fallbackEpisodeId = createCompactId();
      const now = formatDateTime(new Date());
        database.prepare(`
          INSERT INTO episode (episode_id, project_id, episode_code, episode_name, lens_folder_root_path, layout_check_path, version_tag, layout_tag, init_excel_path, create_time, update_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(fallbackEpisodeId, project.projectId, 'EP01', '默认镜头表', project.lensFolderRootPath ?? null, project.layoutCheckPath ?? null, 'ANI', 'LAY', null, now, now);
    }

    if (lensWithoutEpisode) {
      database.prepare("UPDATE lens SET episode_id = ? WHERE COALESCE(TRIM(episode_id), '') = ''").run(fallbackEpisodeId);
      try {
        database.prepare(`
          UPDATE lens_file
          SET episode_id = (
            SELECT lens.episode_id FROM lens WHERE lens.lens_code = lens_file.lens_code LIMIT 1
          )
          WHERE COALESCE(TRIM(episode_id), '') = ''
        `).run();
      } catch {
        // ignore if lens_file table is in legacy shape
      }
    }
  } finally {
    database.close();
  }
}

async function seedLensesFromRootExcels(databasePath: string, episode: EpisodeSummary, imports: LensRootExcelImport[]): Promise<{ success: boolean; importedCount?: number; error?: string }> {
  const createdFolderPaths: string[] = [];

  try {
    const validRows = await readPreparedLensSeedRows(imports);
    if (validRows.length === 0) {
      return { success: false, error: '初始化 Excel 中没有可导入的数据。' };
    }

    const seenCodes = new Set<string>();
    for (const row of validRows) {
      if (seenCodes.has(row.lensCode)) {
        return { success: false, error: `导入文件中存在重复镜头编号：${row.lensCode}` };
      }
      seenCodes.add(row.lensCode);

      const folderName = resolveLensFolderName(row.lensName, row.lensCode);
      const folderNameError = validateLensFolderName(folderName);
      if (folderNameError) {
        return { success: false, error: folderNameError };
      }
    }

    const seenFolderNames = new Set<string>();
    for (const row of validRows) {
      const folderNameKey = `${row.targetRootPath.toUpperCase()}::${resolveLensFolderName(row.lensName, row.lensCode).toUpperCase()}`;
      if (seenFolderNames.has(folderNameKey)) {
        return { success: false, error: `导入文件中存在重复镜头文件夹名称：${resolveLensFolderName(row.lensName, row.lensCode)}` };
      }
      seenFolderNames.add(folderNameKey);
    }

    const database = new DatabaseSync(databasePath);

    try {
      const duplicate = validRows.find((row) => database.prepare('SELECT lens_id FROM lens WHERE episode_id = ? AND lens_code = ?').get(episode.episodeId, row.lensCode));
      if (duplicate) {
        return { success: false, error: `镜头编号「${duplicate.lensCode}」已存在，导入终止。` };
      }

      const duplicateFolderOwner = validRows.find((row) => database.prepare(`
        SELECT lens_id FROM lens WHERE episode_id = ? AND COALESCE(NULLIF(TRIM(lens_name), ''), lens_code) = ?
      `).get(episode.episodeId, resolveLensFolderName(row.lensName, row.lensCode)));
      if (duplicateFolderOwner) {
        return { success: false, error: `镜头文件夹名称「${resolveLensFolderName(duplicateFolderOwner.lensName, duplicateFolderOwner.lensCode)}」已存在。` };
      }

      for (const row of validRows) {
        const rootStat = await stat(row.targetRootPath);
        if (!rootStat.isDirectory()) {
          return { success: false, error: `镜头根目录不是文件夹：${row.targetRootPath}` };
        }
        const folderResult = await ensureLensFolder(row.targetRootPath, resolveLensFolderName(row.lensName, row.lensCode));
        if (folderResult.created) {
          createdFolderPaths.push(folderResult.folderPath);
        }
      }

      database.exec('BEGIN');

      try {
        const now = formatDateTime(new Date());
        let importedCount = 0;

        for (const row of validRows) {
          const versionNum = 'V01';
          const versionTag = (episode.versionTag ?? 'ANI').trim().toUpperCase() || 'ANI';
          const fileName = `${row.lensCode}_${versionTag}_${versionNum.toLowerCase()}`;
          const lensId = createCompactId();
          database.prepare(`
            INSERT INTO lens (lens_id, episode_id, lens_code, scene_no, lens_name, single_frame, maker, lens_status, version_tag, version_num, file_name, update_time, frame_source_locked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(lensId, episode.episodeId, row.lensCode, row.sceneNo, row.lensName, row.singleFrame, row.maker, row.lensStatus, versionTag, versionNum, fileName, now, row.hasSingleFrame ? 1 : 0);
          database.prepare(`
            INSERT INTO lens_lifecycle (event_id, lens_id, episode_id, event_type, title, detail, from_status, to_status, version_num, file_name, event_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(createCompactId(), lensId, episode.episodeId, '创建', '集初始化导入', '创建镜头并写入首版生命周期。', null, row.lensStatus, versionNum, fileName, now);
          importedCount += 1;
        }

        database.prepare(`
          INSERT INTO operate_log (log_id, lens_code, operate_type, old_content, new_content, operate_time)
          VALUES (?, NULL, ?, NULL, ?, ?)
        `).run(createCompactId(), '集初始化导入', `集 ${episode.episodeCode} 初始化导入镜头数量：${importedCount}`, now);

        database.exec('COMMIT');
        return { success: true, importedCount };
      } catch (error) {
        database.exec('ROLLBACK');
        await removeCreatedLensFolders(createdFolderPaths);
        return { success: false, error: error instanceof Error ? error.message : '初始化写入数据库失败。' };
      }
    } finally {
      database.close();
    }
  } catch (error) {
    if (createdFolderPaths.length > 0) {
      await removeCreatedLensFolders(createdFolderPaths);
    }
    return { success: false, error: error instanceof Error ? error.message : '初始化镜头失败。' };
  }
}

async function readPreparedLensSeedRows(imports: LensRootExcelImport[]): Promise<PreparedLensSeedRow[]> {
  const normalizedImports = imports
    .map((item) => ({
      rootPath: item.rootPath.trim(),
      excelPath: item.excelPath.trim(),
      rootCode: item.rootCode.trim(),
    }))
    .filter((item) => item.rootPath && item.excelPath);

  if (normalizedImports.length === 0) {
    return [];
  }

  const XLSX = await loadXlsx();
  const preparedRows: PreparedLensSeedRow[] = [];

  for (const item of normalizedImports) {
    const workbook = XLSX.readFile(item.excelPath);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error(`Excel 文件中没有可读取的工作表：${item.excelPath}`);
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', blankrows: false });
    if (rows.length === 0) {
      throw new Error(`Excel 中没有可导入的数据：${item.excelPath}`);
    }

    const parsedRows = rows.map((row) => parseLensImportRow(row, { allowEmptySingleFrame: true }));
    const invalidRow = parsedRows.find((row) => 'error' in row);
    if (invalidRow && 'error' in invalidRow) {
      throw new Error(`${invalidRow.error}（来源：${item.excelPath}）`);
    }

    preparedRows.push(...(parsedRows as ParsedLensImportRow[]).map((row) => ({
      ...row,
      targetRootPath: item.rootPath,
      excelPath: item.excelPath,
      rootCode: item.rootCode,
    })));
  }

  return preparedRows;
}

function resolveLensRootExcelImports(roots: ConfiguredScanRoot[], legacyExcelPath?: string): LensRootExcelImport[] {
  const explicitImports = roots
    .filter((root) => root.fileKind === 'ma' && root.absolutePath.trim() && root.initExcelPath?.trim())
    .map((root) => ({
      rootPath: root.absolutePath.trim(),
      excelPath: root.initExcelPath!.trim(),
      rootCode: root.rootId || root.label || root.fileKind,
    }));

  if (explicitImports.length > 0) {
    return explicitImports;
  }

  const fallbackExcelPath = legacyExcelPath?.trim() ?? '';
  if (!fallbackExcelPath) {
    return [];
  }

  const primaryRootPath = getPrimaryRootPath(roots);
  const primaryRoot = roots.find((root) => root.absolutePath.trim() === primaryRootPath) ?? roots.find((root) => root.fileKind === 'ma');
  return primaryRootPath ? [{ rootPath: primaryRootPath, excelPath: fallbackExcelPath, rootCode: primaryRoot?.rootId || primaryRoot?.label || primaryRoot?.fileKind || 'ma' }] : [];
}

async function cleanupProjectArtifacts(databasePath: string, manifestPath: string): Promise<void> {
  await Promise.allSettled([
    rm(databasePath, { force: true }),
    rm(path.dirname(databasePath), { recursive: true, force: true }),
    rm(path.dirname(manifestPath), { recursive: true, force: true }),
  ]);
}

function upsertProject(registry: ProjectRegistryFile, project: ProjectSummary, activeProjectId: string, activeEpisodeId: string | null): ProjectRegistryFile {
  const nextProjects = registry.projects.filter((entry) => entry.projectId !== project.projectId);
  nextProjects.unshift(project);

  return {
    activeProjectId,
    activeEpisodeId,
    projects: nextProjects,
  };
}

function mapEpisodeRow(row: RawEpisodeRow): EpisodeSummary {
  return {
    episodeId: row.episode_id,
    projectId: row.project_id,
    episodeCode: row.episode_code,
    episodeName: row.episode_name,
    lensFolderRootPath: row.lens_folder_root_path ?? undefined,
    layoutCheckPath: row.layout_check_path ?? undefined,
    versionTag: row.version_tag ?? 'ANI',
    layoutTag: row.layout_tag ?? 'LAY',
    initExcelPath: row.init_excel_path ?? undefined,
    createdAt: row.create_time,
    updatedAt: row.update_time,
  };
}

function normalizeRootInput(items: ScanRootConfigItem[] | undefined, fallbackPath: string | undefined, fallbackKind: 'ma' | 'layout'): ConfiguredScanRoot[] {
  const normalizedItems = (items ?? [])
    .map((item, index) => ({
      rootId: item.rootId.trim() || createCompactId(),
      fileKind: fallbackKind,
      label: item.label.trim(),
      absolutePath: item.absolutePath.trim() ? path.resolve(item.absolutePath.trim()) : '',
      initExcelPath: item.initExcelPath?.trim() ? path.resolve(item.initExcelPath.trim()) : undefined,
      priority: Number.isFinite(item.priority) ? item.priority : (index + 1) * 10,
      isEnabled: item.isEnabled,
    }))
    .filter((item) => item.absolutePath);

  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  const normalizedFallback = fallbackPath?.trim() ? path.resolve(fallbackPath.trim()) : '';
  if (!normalizedFallback) {
    return [];
  }

  return [{
    rootId: createCompactId(),
    fileKind: fallbackKind,
    label: fallbackKind === 'layout' ? '默认 Layout 根目录' : '默认镜头根目录',
    absolutePath: normalizedFallback,
    initExcelPath: undefined,
    priority: 100,
    isEnabled: true,
  }];
}

function getPrimaryRootPath(roots: ConfiguredScanRoot[]): string {
  return roots
    .filter((item) => item.isEnabled && item.absolutePath.trim())
    .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'zh-CN'))[0]?.absolutePath ?? '';
}

function toScanRootItems(roots: ConfiguredScanRoot[], fileKind: 'ma' | 'layout'): ScanRootConfigItem[] {
  return roots.map((root) => ({
    rootId: root.rootId,
    fileKind,
    label: root.label,
    absolutePath: root.absolutePath,
    initExcelPath: root.initExcelPath,
    priority: root.priority,
    isEnabled: root.isEnabled,
  }));
}

function normalizeEpisodeCode(value: string): string {
  return value.trim().toUpperCase();
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export const projectService = new ProjectService();
