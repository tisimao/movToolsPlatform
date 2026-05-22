import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  batchDeleteLensRequestSchema,
  batchImportLensRequestSchema,
  batchUpdateLensStatusRequestSchema,
  batchUpdateLensVersionTagRequestSchema,
  createLensRequestSchema,
  deleteLensRequestSchema,
  exportLensIssueReportRequestSchema,
  getLensDetailRequestSchema,
  resolveLensLocalPreviewRequestSchema,
  updateLensRequestSchema,
  updateReworkRecordRequestSchema,
  updateLensStatusRequestSchema,
} from '../../src/types/ipc';
import { lensService } from '../services/lens/lensService';

export function registerLensIpc(): void {
  ipcMain.handle('lens:list', async () => lensService.listLenses());

  ipcMain.handle('lens:detail', async (_event, request: unknown) => {
    const parsed = getLensDetailRequestSchema.parse(request);
    return lensService.getLensDetail(parsed);
  });

  ipcMain.handle('lens:resolveLocalPreview', async (_event, request: unknown) => {
    const parsed = resolveLensLocalPreviewRequestSchema.parse(request);
    return lensService.resolveLocalPreview(parsed);
  });

  ipcMain.handle('lens:create', async (_event, request: unknown) => {
    const parsed = createLensRequestSchema.parse(request);
    return lensService.createLens(parsed);
  });

  ipcMain.handle('lens:update', async (_event, request: unknown) => {
    const parsed = updateLensRequestSchema.parse(request);
    return lensService.updateLens(parsed);
  });

  ipcMain.handle('lens:updateStatus', async (_event, request: unknown) => {
    const parsed = updateLensStatusRequestSchema.parse(request);
    return lensService.updateLensStatus(parsed);
  });

  ipcMain.handle('lens:updateReworkRecord', async (_event, request: unknown) => {
    const parsed = updateReworkRecordRequestSchema.parse(request);
    return lensService.updateReworkRecord(parsed);
  });

  ipcMain.handle('lens:batchUpdateStatus', async (_event, request: unknown) => {
    const parsed = batchUpdateLensStatusRequestSchema.parse(request);
    return lensService.batchUpdateLensStatus(parsed);
  });

  ipcMain.handle('lens:batchUpdateVersionTag', async (_event, request: unknown) => {
    const parsed = batchUpdateLensVersionTagRequestSchema.parse(request);
    return lensService.batchUpdateLensVersionTag(parsed);
  });

  ipcMain.handle('lens:delete', async (_event, request: unknown) => {
    const parsed = deleteLensRequestSchema.parse(request);
    return lensService.deleteLens(parsed);
  });

  ipcMain.handle('lens:batchDelete', async (_event, request: unknown) => {
    const parsed = batchDeleteLensRequestSchema.parse(request);
    return lensService.batchDeleteLenses(parsed);
  });

  ipcMain.handle('lens:import', async (_event, request: unknown) => {
    const parsed = batchImportLensRequestSchema.parse(request);
    return lensService.importLenses(parsed);
  });

  ipcMain.handle('lens:exportIssues', async (_event, request: unknown) => {
    const parsed = exportLensIssueReportRequestSchema.parse(request);
    const targetWindow = BrowserWindow.getFocusedWindow();
    const dialogOptions = {
      defaultPath: `${parsed.mode === 'missing-layout' ? '缺失Layout镜头清单' : '镜头缺项同步表'}_${formatFileTimestamp(new Date())}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    };
    const result = targetWindow
      ? await dialog.showSaveDialog(targetWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
      return { success: false, error: '缺项表导出已取消。' };
    }

    return lensService.exportIssueReport({ ...parsed, filePath: result.filePath });
  });
}

function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
