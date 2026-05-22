import { randomUUID } from 'node:crypto';
import { copyFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { shell } from 'electron';
import { ensureDirectoryExists, ensureFileExists } from '../file/fileService';
import { projectService } from '../project/projectService';
import { loadXlsx } from '../../shared/xlsx';
import type {
  ExecuteExtractRequest,
  ExtractProgressEvent,
  ExtractActionResponse,
  GenerateExtractPreviewRequest,
} from '../../../src/types/ipc';
import type {
  ExtractExecutionLogItem,
  ExtractHistoryResponse,
  ExtractPreviewItem,
  ExtractPreviewResponse,
  ExtractRecordItem,
} from '../../../src/types/extract';
import type { LensStatus } from '../../../src/types/lens';

interface PreviewSession {
  projectId: string;
  items: ExtractPreviewItem[];
}

interface LensRow {
  episode_id: string | null;
  lens_code: string;
  maker: string | null;
  lens_status: string;
  version_num: string | null;
  file_name: string | null;
}

interface LensFileRow {
  file_id: string;
  episode_id: string | null;
  lens_code: string;
  version_num: string;
  file_type: 'ma' | 'mov';
  file_relative_path: string;
}

interface ExtractRecordRow {
  record_id: string;
  extract_time: string;
  file_total: number;
  ma_file_num: number;
  mov_file_num: number;
  target_path: string;
  is_success: '是' | '否';
  fail_reason: string | null;
}

class ExtractService {
  private readonly previewSessions = new Map<string, PreviewSession>();

  async generatePreview(request: GenerateExtractPreviewRequest): Promise<ExtractPreviewResponse> {
    const activeProject = await projectService.getActiveProjectSummary();
    const activeEpisode = await projectService.getActiveEpisodeSummary();
    if (!activeProject || !activeEpisode || activeEpisode.projectId !== activeProject.projectId) {
      return { success: false, items: [], error: '请先在项目页创建或打开一个项目。' };
    }

    return this.withDatabase(activeProject.databasePath, (database) => {
      const lenses = database.prepare(`
        SELECT episode_id, lens_code, maker, lens_status, version_num, file_name
        FROM lens
        WHERE episode_id = ?
        ORDER BY lens_code ASC
      `).all(activeEpisode.episodeId) as unknown as LensRow[];

      const bindings = database.prepare(`
        SELECT file_id, episode_id, lens_code, version_num, file_type, file_relative_path
        FROM lens_file
        WHERE episode_id = ?
      `).all(activeEpisode.episodeId) as unknown as LensFileRow[];

      const bindingMap = bindings.reduce<Map<string, LensFileRow[]>>((map, row) => {
        const key = `${row.lens_code}::${row.version_num}`;
        const list = map.get(key) ?? [];
        list.push(row);
        map.set(key, list);
        return map;
      }, new Map());

      const items: ExtractPreviewItem[] = [];
      for (const lens of lenses) {
        if (!matchesFilter(lens, request)) {
          continue;
        }

        const versionNum = lens.version_num ?? '';
        if (!versionNum) {
          continue;
        }

        const key = `${lens.lens_code}::${versionNum}`;
        const currentBindings = bindingMap.get(key) ?? [];
        for (const binding of currentBindings) {
          if (!matchesFileSelection(binding.file_type, request.fileSelection)) {
            continue;
          }

          const extension = binding.file_type === 'ma' ? '.ma' : path.extname(binding.file_relative_path) || '.mov';
          items.push({
            itemId: binding.file_id,
            lensCode: lens.lens_code,
            maker: lens.maker ?? '',
            lensStatus: normalizeLensStatus(lens.lens_status),
            versionNum,
            fileName: lens.file_name ?? '',
            fileType: binding.file_type,
            sourcePath: path.resolve(activeProject.projectRootPath, binding.file_relative_path),
            targetFileName: `${(lens.file_name ?? `${lens.lens_code}_ani_${versionNum.toLowerCase()}`).trim()}${extension}`,
          });
        }
      }

      const previewId = createCompactId();
      this.previewSessions.set(previewId, { projectId: activeProject.projectId, items });
      return { success: true, previewId, items } satisfies ExtractPreviewResponse;
    });
  }

  async executeExtract(
    request: ExecuteExtractRequest,
    reportProgress?: (event: ExtractProgressEvent) => void,
  ): Promise<ExtractActionResponse> {
    const activeProject = await projectService.getActiveProjectSummary();
    if (!activeProject) {
      return { success: false, error: '请先在项目页创建或打开一个项目。' };
    }

    const preview = this.previewSessions.get(request.previewId);
    if (!preview || preview.projectId !== activeProject.projectId) {
      return { success: false, error: '待提取列表已失效，请重新生成并确认列表。' };
    }

    if (preview.items.length === 0) {
      return { success: false, error: '当前提取列表为空。' };
    }

    reportProgress?.({
      phase: 'started',
      message: '开始执行提取。',
      total: preview.items.length,
      logLine: `开始提取，共 ${preview.items.length} 个文件。`,
    });

    const result = await this.withDatabase(activeProject.databasePath, async (database) => {
      const now = formatDateTime(new Date());
      reportProgress?.({
        phase: 'preparing',
        message: `检查目标目录：${request.targetPath}`,
        total: preview.items.length,
        logLine: `准备目标目录：${request.targetPath}`,
      });
      await ensureDirectoryExists(request.targetPath);

      let maCount = 0;
      let movCount = 0;
      const logs: ExtractExecutionLogItem[] = [];

      for (const item of preview.items) {
        reportProgress?.({
          phase: 'copying',
          message: `正在处理 ${item.lensCode} / ${item.fileType}`,
          current: logs.length + 1,
          total: preview.items.length,
          lensCode: item.lensCode,
          fileType: item.fileType,
          logLine: `开始处理 ${item.lensCode} / ${item.fileType}：${item.sourcePath}`,
        });
        try {
          await ensureFileExists(item.sourcePath);
          const targetPath = path.join(request.targetPath, item.targetFileName);
          await copyFile(item.sourcePath, targetPath);

          if (item.fileType === 'ma') {
            maCount += 1;
          } else {
            movCount += 1;
          }

          logs.push({
            itemId: item.itemId,
            lensCode: item.lensCode,
            fileType: item.fileType,
            sourcePath: item.sourcePath,
            targetPath,
            targetFileName: item.targetFileName,
            success: true,
          });
          reportProgress?.({
            phase: 'copying',
            message: `${item.lensCode} / ${item.fileType} 提取成功。`,
            current: logs.length,
            total: preview.items.length,
            lensCode: item.lensCode,
            fileType: item.fileType,
            success: true,
            logLine: `成功 ${item.lensCode} / ${item.fileType} -> ${targetPath}`,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          logs.push({
            itemId: item.itemId,
            lensCode: item.lensCode,
            fileType: item.fileType,
            sourcePath: item.sourcePath,
            targetFileName: item.targetFileName,
            success: false,
            error: errorMessage,
          });
          reportProgress?.({
            phase: 'failed',
            message: `${item.lensCode} / ${item.fileType} 提取失败。`,
            current: logs.length,
            total: preview.items.length,
            lensCode: item.lensCode,
            fileType: item.fileType,
            success: false,
            logLine: `失败 ${item.lensCode} / ${item.fileType}：${errorMessage}`,
          });
        }
      }

      const failedCount = logs.filter((item) => !item.success).length;
      const successCount = logs.length - failedCount;
      const failReason = failedCount > 0 ? `成功 ${successCount} 个，失败 ${failedCount} 个。` : '';
      const manifestPath = await writeExtractManifest({
        targetDirectory: request.targetPath,
        rows: logs
          .filter((item) => item.success)
          .map((item, index) => ({
            '序号': index + 1,
            '镜头名称（含版本号）': buildLensDisplayName(item, preview.items),
            '文件名称': item.targetFileName,
          })),
      });

      writeExtractRecord(database, {
        recordId: createCompactId(),
        extractTime: now,
        fileTotal: preview.items.length,
        maFileNum: maCount,
        movFileNum: movCount,
        targetPath: request.targetPath,
        isSuccess: failedCount === 0 ? '是' : '否',
        failReason,
      });
      writeOperateLog(database, '文件提取', null, `提取文件总数：${preview.items.length}，成功：${successCount}，失败：${failedCount}，目标路径：${request.targetPath}`, now);
      this.previewSessions.delete(request.previewId);

      reportProgress?.({
        phase: failedCount === 0 ? 'completed' : 'failed',
        message: failedCount === 0 ? '提取完成。' : '提取完成，但有失败项。',
        current: logs.length,
        total: preview.items.length,
        success: failedCount === 0,
        logLine: `提取结束：总数 ${preview.items.length}，成功 ${successCount}，失败 ${failedCount}，清单：${manifestPath}`,
      });

      return {
        success: failedCount === 0,
        error: failedCount > 0 ? `部分文件提取失败：成功 ${successCount} 个，失败 ${failedCount} 个。` : undefined,
        fileTotal: preview.items.length,
        successCount,
        failedCount,
        maFileNum: maCount,
        movFileNum: movCount,
        logs,
        manifestPath,
      } satisfies ExtractActionResponse;
    });

    return result;
  }

  async getHistory(): Promise<ExtractHistoryResponse> {
    const activeProject = await projectService.getActiveProjectSummary();
    if (!activeProject) {
      return { success: false, records: [], error: '请先在项目页创建或打开一个项目。' };
    }

    return this.withDatabase(activeProject.databasePath, (database) => {
      const rows = database.prepare(`
        SELECT record_id, extract_time, file_total, ma_file_num, mov_file_num, target_path, is_success, fail_reason
        FROM extract_record ORDER BY extract_time DESC
      `).all() as unknown as ExtractRecordRow[];

      return {
        success: true,
        records: rows.map((row) => ({
          recordId: row.record_id,
          extractTime: row.extract_time,
          fileTotal: row.file_total,
          maFileNum: row.ma_file_num,
          movFileNum: row.mov_file_num,
          targetPath: row.target_path,
          isSuccess: row.is_success,
          failReason: row.fail_reason ?? '',
        })),
      } satisfies ExtractHistoryResponse;
    });
  }

  async openTargetPath(targetPath: string): Promise<ExtractActionResponse> {
    const openError = await shell.openPath(targetPath);
    if (openError) {
      return { success: false, error: `打开目标目录失败：${openError}` };
    }
    return { success: true };
  }

  private withDatabase<T>(databasePath: string, action: (database: DatabaseSync) => Promise<T> | T): Promise<T> | T {
    const database = new DatabaseSync(databasePath);
    try {
      return action(database);
    } finally {
      database.close();
    }
  }
}

function matchesFilter(lens: LensRow, request: GenerateExtractPreviewRequest): boolean {
  if (request.lensCode && !lens.lens_code.toLowerCase().includes(request.lensCode.toLowerCase())) {
    return false;
  }
  if (request.maker && !(lens.maker ?? '').toLowerCase().includes(request.maker.toLowerCase())) {
    return false;
  }
  if (request.lensStatus && normalizeLensStatus(lens.lens_status) !== request.lensStatus) {
    return false;
  }
  if (request.versionNum && (lens.version_num ?? '') !== request.versionNum) {
    return false;
  }
  return true;
}

function matchesFileSelection(fileType: 'ma' | 'mov', selection: 'ma' | 'mov' | 'ma+mov'): boolean {
  return selection === 'ma+mov' ? true : fileType === selection;
}

function normalizeLensStatus(status: string): LensStatus {
  if (status === '提交' || status === '返修' || status === '通过' || status === '关闭') {
    return status;
  }

  return '制作';
}

function writeExtractRecord(database: DatabaseSync, record: ExtractRecordItem): void {
  database.prepare(`
    INSERT INTO extract_record (record_id, extract_time, file_total, ma_file_num, mov_file_num, target_path, is_success, fail_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.recordId,
    record.extractTime,
    record.fileTotal,
    record.maFileNum,
    record.movFileNum,
    record.targetPath,
    record.isSuccess,
    record.failReason || null,
  );
}

function writeOperateLog(database: DatabaseSync, operateType: string, oldContent: string | null, newContent: string | null, operateTime: string): void {
  database.prepare(`
    INSERT INTO operate_log (log_id, lens_code, operate_type, old_content, new_content, operate_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(createCompactId(), null, operateType, oldContent, newContent, operateTime);
}

function createCompactId(): string {
  return randomUUID().replaceAll('-', '');
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function writeExtractManifest(payload: {
  targetDirectory: string;
  rows: Array<{
    '序号': number;
    '镜头名称（含版本号）': string;
    '文件名称': string;
  }>;
}): Promise<string> {
  const xlsx = await loadXlsx();
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(payload.rows);
  worksheet['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 40 }];
  xlsx.utils.book_append_sheet(workbook, worksheet, '提取清单');

  const manifestPath = path.join(payload.targetDirectory, `提取清单_${formatFileTimestamp(new Date())}.xlsx`);
  const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  await writeFile(manifestPath, buffer);
  return manifestPath;
}

function buildLensDisplayName(item: ExtractExecutionLogItem, previewItems: ExtractPreviewItem[]): string {
  const matched = previewItems.find((previewItem) => previewItem.itemId === item.itemId);
  const baseName = matched?.fileName?.trim() || item.lensCode;
  const versionNum = matched?.versionNum?.trim();
  if (!versionNum) {
    return baseName;
  }

  return baseName.includes(versionNum) ? baseName : `${baseName}_${versionNum}`;
}

function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export const extractService = new ExtractService();
