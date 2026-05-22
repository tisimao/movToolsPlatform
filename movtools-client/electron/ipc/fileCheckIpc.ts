import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  addLayoutVideoBindingRequestSchema,
  addLayoutCandidateRequestSchema,
  bindLensFileRequestSchema,
  exportLayoutReferenceReportRequestSchema,
  fileCheckConfigRequestSchema,
  refreshLensBindingsRequestSchema,
  scanSingleLensFileCheckRequestSchema,
  scanSingleLensLayoutReferenceRequestSchema,
  selectLayoutCandidateRequestSchema,
} from '../../src/types/ipc';
import { fileCheckService } from '../services/file-check/fileCheckService';

export function registerFileCheckIpc(): void {
  ipcMain.handle('fileCheck:getState', async () => fileCheckService.getState());

  ipcMain.handle('fileCheck:updateConfig', async (_event, request: unknown) => {
    const parsed = fileCheckConfigRequestSchema.parse(request);
    return fileCheckService.updateConfig(parsed);
  });

  ipcMain.handle('fileCheck:scan', async () => fileCheckService.scanMissingFiles());
  ipcMain.handle('fileCheck:scanLayout', async () => fileCheckService.scanLayoutCandidates());
  ipcMain.handle('fileCheck:scanLayoutReferences', async () => fileCheckService.scanLayoutReferences());
  ipcMain.handle('fileCheck:scanLens', async (_event, request: unknown) => {
    const parsed = scanSingleLensFileCheckRequestSchema.parse(request);
    return fileCheckService.scanSingleLens(parsed);
  });
  ipcMain.handle('fileCheck:refreshLensBindings', async (_event, request: unknown) => {
    const parsed = refreshLensBindingsRequestSchema.parse(request);
    return fileCheckService.refreshLensBindings(parsed);
  });
  ipcMain.handle('fileCheck:scanLensLayoutReferences', async (_event, request: unknown) => {
    const parsed = scanSingleLensLayoutReferenceRequestSchema.parse(request);
    return fileCheckService.scanSingleLensLayoutReferences(parsed);
  });
  ipcMain.handle('fileCheck:exportLayoutReferences', async (_event, request: unknown) => {
    const parsed = exportLayoutReferenceReportRequestSchema.parse(request ?? {});
    const targetWindow = BrowserWindow.getFocusedWindow();
    const result = targetWindow
      ? await dialog.showSaveDialog(targetWindow, {
        defaultPath: `layout引用问题同步表_${formatFileTimestamp(new Date())}.xlsx`,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      })
      : await dialog.showSaveDialog({
        defaultPath: `layout引用问题同步表_${formatFileTimestamp(new Date())}.xlsx`,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'layout 引用报告导出已取消。' };
    }

    return fileCheckService.exportLayoutReferenceReport({ ...parsed, filePath: result.filePath });
  });

  ipcMain.handle('fileCheck:bindFile', async (_event, request: unknown) => {
    const parsed = bindLensFileRequestSchema.parse(request);
    return fileCheckService.bindLensFile(parsed);
  });

  ipcMain.handle('fileCheck:openBoundFile', async (_event, fileId: string) => fileCheckService.openBoundFile(fileId));
  ipcMain.handle('fileCheck:selectLayoutCandidate', async (_event, request: unknown) => {
    const parsed = selectLayoutCandidateRequestSchema.parse(request);
    return fileCheckService.selectLayoutCandidate(parsed);
  });
  ipcMain.handle('fileCheck:addLayoutCandidate', async (_event, request: unknown) => {
    const parsed = addLayoutCandidateRequestSchema.parse(request);
    return fileCheckService.addLayoutCandidate(parsed);
  });
  ipcMain.handle('fileCheck:addLayoutVideoBinding', async (_event, request: unknown) => {
    const parsed = addLayoutVideoBindingRequestSchema.parse(request);
    return fileCheckService.addLayoutVideoBinding(parsed);
  });
}

function formatFileTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
