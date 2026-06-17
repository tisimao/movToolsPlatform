import { copyFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  CommitVersionUploadRequest,
  PrepareVersionUploadRequest,
  VersionUploadFileType,
  VersionUploadItem,
  VersionUploadResponse,
  VersionUploadSummary,
} from '../../../src/types/ipc';
import { projectService } from '../project/projectService';
import { getEnabledScanRootPaths, readGroupedConfiguredScanRoots } from '../project/scanRootService';
import { fileCheckService } from '../file-check/fileCheckService';

interface ActiveContext {
  project: NonNullable<Awaited<ReturnType<typeof projectService.getActiveProjectSummary>>>;
  episode: NonNullable<Awaited<ReturnType<typeof projectService.getActiveEpisodeSummary>>>;
}

interface LensUploadRow {
  lens_id: string;
  lens_code: string;
  lens_name: string | null;
}

interface UploadSourceFile {
  sourcePath: string;
  fileName: string;
  extension: string;
  supported: boolean;
  fileType?: VersionUploadFileType;
}

const VIDEO_FILE_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mxf', '.mpg', '.mpeg', '.wmv']);

class VersionUploadService {
  async prepare(request: PrepareVersionUploadRequest): Promise<VersionUploadResponse> {
    const activeContext = await this.requireActiveContext();
    if (!activeContext) {
      return emptyResponse('请先创建或打开项目，并选择当前集。');
    }

    const roots = this.resolveLensRoots(activeContext);
    if (roots.length === 0) {
      return emptyResponse('请先配置当前集镜头版本文件根目录。');
    }

    const sourceFiles = await collectSourceFiles(request.sourcePaths);
    const lenses = this.readLenses(activeContext);
    const items: VersionUploadItem[] = [];

    for (const sourceFile of sourceFiles) {
      items.push(await this.buildPreviewItem(sourceFile, lenses, roots, request.conflictStrategy));
    }

    return {
      success: true,
      items,
      summary: summarizeItems(items, sourceFiles.length),
      affectedLensIds: getAffectedLensIds(items),
    };
  }

  async commit(request: CommitVersionUploadRequest): Promise<VersionUploadResponse> {
    if (request.conflictStrategy === 'overwrite' && !request.overwriteConfirmed) {
      return emptyResponse('覆盖已有文件前需要二次确认。');
    }

    const prepared = await this.prepare(request);
    if (!prepared.success) {
      return prepared;
    }

    const items: VersionUploadItem[] = [];
    for (const item of prepared.items) {
      if (item.status !== 'ready' && item.status !== 'will-overwrite') {
        items.push(item.status === 'exists-skip' ? { ...item, status: 'skipped' } : item);
        continue;
      }

      if (!item.targetPath) {
        items.push({ ...item, status: 'copy-failed', error: '目标路径为空。' });
        continue;
      }

      try {
        await copyFile(item.sourcePath, item.targetPath, item.status === 'will-overwrite' ? 0 : constants.COPYFILE_EXCL);
        items.push({
          ...item,
          status: item.status === 'will-overwrite' ? 'overwritten' : 'copied',
          error: undefined,
        });
      } catch (error) {
        items.push({
          ...item,
          status: 'copy-failed',
          error: error instanceof Error ? error.message : '文件复制失败。',
        });
      }
    }

    const affectedLensIds = getAffectedLensIds(items.filter((item) => item.status === 'copied' || item.status === 'overwritten'));
    if (affectedLensIds.length > 0) {
      await fileCheckService.refreshLensBindings({ lensIds: affectedLensIds });
    }

    return {
      success: true,
      items,
      summary: summarizeItems(items, prepared.summary.scannedCount),
      affectedLensIds,
    };
  }

  private async buildPreviewItem(
    sourceFile: UploadSourceFile,
    lenses: LensUploadRow[],
    roots: string[],
    conflictStrategy: PrepareVersionUploadRequest['conflictStrategy'],
  ): Promise<VersionUploadItem> {
    const baseItem = {
      itemId: createCompactId(),
      sourcePath: sourceFile.sourcePath,
      fileName: sourceFile.fileName,
      fileType: sourceFile.fileType,
    };

    if (!sourceFile.supported || !sourceFile.fileType) {
      return { ...baseItem, status: 'unsupported-type', error: '文件类型不支持。' };
    }

    if (!(await isFile(sourceFile.sourcePath))) {
      return { ...baseItem, status: 'missing-source', error: '源文件不存在。' };
    }

    const matchedLens = matchLensByFileName(sourceFile.fileName, lenses);
    if (!matchedLens) {
      return { ...baseItem, status: 'unmatched-lens', error: '未匹配到当前集镜头。' };
    }

    const versionNum = parseVersionNum(sourceFile.fileName, matchedLens.lens_code);
    if (!versionNum) {
      return {
        ...baseItem,
        lensId: matchedLens.lens_id,
        lensCode: matchedLens.lens_code,
        status: 'invalid-name',
        error: '文件名未识别到版本号。',
      };
    }

    const targetFolderPath = await findTargetFolder(roots, matchedLens.lens_code);
    if (!targetFolderPath) {
      return {
        ...baseItem,
        lensId: matchedLens.lens_id,
        lensCode: matchedLens.lens_code,
        versionNum,
        status: 'missing-target-folder',
        error: '目标镜头文件夹不存在。',
      };
    }

    const targetPath = path.join(targetFolderPath, sourceFile.fileName);
    const targetExists = await isFile(targetPath);
    const status = targetExists
      ? (conflictStrategy === 'overwrite' ? 'will-overwrite' : 'exists-skip')
      : 'ready';

    return {
      ...baseItem,
      lensId: matchedLens.lens_id,
      lensCode: matchedLens.lens_code,
      versionNum,
      targetFolderPath,
      targetPath,
      status,
    };
  }

  private async requireActiveContext(): Promise<ActiveContext | null> {
    const project = await projectService.getActiveProjectSummary();
    const episode = await projectService.getActiveEpisodeSummary();
    if (!project || !episode || episode.projectId !== project.projectId) {
      return null;
    }

    return { project, episode };
  }

  private resolveLensRoots(activeContext: ActiveContext): string[] {
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      const groupedRoots = readGroupedConfiguredScanRoots(database, {
        projectId: activeContext.project.projectId,
        episodeId: activeContext.episode.episodeId,
      });
      return getEnabledScanRootPaths(groupedRoots.lens, activeContext.episode.lensFolderRootPath);
    } finally {
      database.close();
    }
  }

  private readLenses(activeContext: ActiveContext): LensUploadRow[] {
    const database = new DatabaseSync(activeContext.project.databasePath);
    try {
      return database.prepare(`
        SELECT lens_id, lens_code, lens_name
        FROM lens
        WHERE episode_id = ?
        ORDER BY length(lens_code) DESC, lens_code ASC
      `).all(activeContext.episode.episodeId) as unknown as LensUploadRow[];
    } finally {
      database.close();
    }
  }
}

async function collectSourceFiles(sourcePaths: string[]): Promise<UploadSourceFile[]> {
  const result: UploadSourceFile[] = [];
  const visited = new Set<string>();

  for (const sourcePath of sourcePaths) {
    await collectSourcePath(path.resolve(sourcePath), result, visited);
  }

  return result;
}

async function collectSourcePath(sourcePath: string, result: UploadSourceFile[], visited: Set<string>): Promise<void> {
  const normalized = path.normalize(sourcePath);
  if (visited.has(normalized)) {
    return;
  }
  visited.add(normalized);

  let sourceStat;
  try {
    sourceStat = await stat(normalized);
  } catch {
    result.push(buildSourceFile(normalized, false));
    return;
  }

  if (sourceStat.isDirectory()) {
    const entries = await readdir(normalized, { withFileTypes: true });
    for (const entry of entries) {
      await collectSourcePath(path.join(normalized, entry.name), result, visited);
    }
    return;
  }

  if (sourceStat.isFile()) {
    result.push(buildSourceFile(normalized, true));
  }
}

function buildSourceFile(sourcePath: string, exists: boolean): UploadSourceFile {
  const fileName = path.basename(sourcePath);
  const extension = path.extname(fileName).toLowerCase();
  const fileType = resolveFileType(extension);
  return {
    sourcePath,
    fileName,
    extension,
    supported: exists && Boolean(fileType),
    fileType,
  };
}

function resolveFileType(extension: string): VersionUploadFileType | undefined {
  if (extension === '.ma') {
    return 'ma';
  }

  if (VIDEO_FILE_EXTENSIONS.has(extension)) {
    return 'mov';
  }

  return undefined;
}

function matchLensByFileName(fileName: string, lenses: LensUploadRow[]): LensUploadRow | null {
  const normalizedFileName = fileName.toUpperCase();
  return [...lenses]
    .sort((left, right) => right.lens_code.length - left.lens_code.length)
    .find((lens) => {
      const lensCode = lens.lens_code.toUpperCase();
      return normalizedFileName.startsWith(`${lensCode}_`) || normalizedFileName.startsWith(`${lensCode}.`);
    }) ?? null;
}

function parseVersionNum(fileName: string, lensCode: string): string | null {
  const baseName = path.basename(fileName, path.extname(fileName));
  const suffix = baseName.slice(lensCode.length);
  const match = suffix.match(/(?:^|_)v(\d{1,4})(?:_|$)/i);
  return match ? `V${match[1].padStart(2, '0')}` : null;
}

async function findTargetFolder(roots: string[], folderName: string): Promise<string | null> {
  for (const root of roots) {
    const candidate = path.join(root, folderName);
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isFile();
  } catch {
    return false;
  }
}

function summarizeItems(items: VersionUploadItem[], scannedCount: number): VersionUploadSummary {
  return {
    scannedCount,
    supportedCount: items.filter((item) => item.fileType === 'ma' || item.fileType === 'mov').length,
    readyCount: items.filter((item) => item.status === 'ready').length,
    overwriteCount: items.filter((item) => item.status === 'will-overwrite' || item.status === 'overwritten').length,
    skippedCount: items.filter((item) => item.status === 'exists-skip' || item.status === 'skipped').length,
    copiedCount: items.filter((item) => item.status === 'copied').length,
    overwrittenCount: items.filter((item) => item.status === 'overwritten').length,
    failedCount: items.filter((item) => item.status === 'copy-failed'
      || item.status === 'missing-target-folder'
      || item.status === 'unmatched-lens'
      || item.status === 'invalid-name'
      || item.status === 'unsupported-type'
      || item.status === 'missing-source').length,
    affectedLensCount: getAffectedLensIds(items).length,
  };
}

function getAffectedLensIds(items: VersionUploadItem[]): string[] {
  return Array.from(new Set(items.map((item) => item.lensId).filter((lensId): lensId is string => Boolean(lensId))));
}

function emptyResponse(error: string): VersionUploadResponse {
  return {
    success: false,
    items: [],
    summary: summarizeItems([], 0),
    affectedLensIds: [],
    error,
  };
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}

export const versionUploadService = new VersionUploadService();
