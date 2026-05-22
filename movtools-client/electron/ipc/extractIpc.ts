import { ipcMain } from 'electron';
import type { ExtractProgressEvent } from '../../src/types/ipc';
import {
  executeExtractRequestSchema,
  generateExtractPreviewRequestSchema,
} from '../../src/types/ipc';
import { extractService } from '../services/extract/extractService';

export function registerExtractIpc(): void {
  ipcMain.handle('extract:preview', async (_event, request: unknown) => {
    const parsed = generateExtractPreviewRequestSchema.parse(request);
    return extractService.generatePreview(parsed);
  });

  ipcMain.handle('extract:execute', async (_event, request: unknown) => {
    const parsed = executeExtractRequestSchema.parse(request);
    return extractService.executeExtract(parsed, (payload: ExtractProgressEvent) => {
      _event.sender.send('extract:progress', payload);
    });
  });

  ipcMain.handle('extract:history', async () => extractService.getHistory());
  ipcMain.handle('extract:openTarget', async (_event, targetPath: string) => extractService.openTargetPath(targetPath));
}
