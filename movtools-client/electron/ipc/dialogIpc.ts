import { dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DialogPickFileOptions, ManualDocument, SaveAnnotationImageRequest } from '../../src/types/ipc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manualPaths: Record<ManualDocument, string> = {
  usage: path.resolve(__dirname, '../../docs/使用说明.md'),
  testing: path.resolve(__dirname, '../../docs/测试说明（小白版）.md'),
};

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:pickFile', async (_event, options?: DialogPickFileOptions) => {
    const result = await dialog.showOpenDialog({
      title: options?.title,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
      properties: ['openFile'],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:pickFiles', async (_event, options?: DialogPickFileOptions) => {
    const result = await dialog.showOpenDialog({
      title: options?.title,
      filters: options?.filters,
      defaultPath: options?.defaultPath,
      properties: ['openFile', 'multiSelections'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:savePastedImage', async (_event, request: { dataUrl: string }) => {
    const matched = request.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matched) {
      throw new Error('剪贴板内容不是有效图片。');
    }

    const mimeType = matched[1];
    const base64Content = matched[2];
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] ?? 'png';
    const targetDirectory = path.join(os.tmpdir(), 'movtools-pasted-images');
    const fileName = `pasted-${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(targetDirectory, fileName);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(filePath, Buffer.from(base64Content, 'base64'));
    return filePath;
  });

  ipcMain.handle('dialog:saveAnnotationImage', async (_event, request: SaveAnnotationImageRequest) => {
    const matched = request.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!matched) {
      throw new Error('剪贴板内容不是有效图片。');
    }

    const mimeType = matched[1];
    const base64Content = matched[2];
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] ?? 'png';
    const targetDirectory = path.join(os.tmpdir(), 'movtools-annotation-images', request.shotId);
    const fileName = `${request.frameNumber}-${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(targetDirectory, fileName);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(filePath, Buffer.from(base64Content, 'base64'));
    return { success: true, localPath: filePath };
  });

  ipcMain.handle('dialog:openManual', async (_event, manual: ManualDocument) => {
    const filePath = manualPaths[manual];
    if (!filePath) {
      return { success: false, error: '未找到对应的说明文档。' };
    }

    try {
      await access(filePath);
    } catch {
      return { success: false, error: '说明文档文件不存在。' };
    }

    const openError = await shell.openPath(filePath);
    if (openError) {
      return { success: false, error: `打开说明文档失败：${openError}` };
    }

    return { success: true };
  });

  ipcMain.handle('dialog:openPath', async (_event, filePath: string) => {
    if (!filePath.trim()) {
      return { success: false, error: '文件路径不能为空。' };
    }

    const openError = await shell.openPath(filePath);
    if (openError) {
      return { success: false, error: `打开文件失败：${openError}` };
    }

    return { success: true };
  });
}
