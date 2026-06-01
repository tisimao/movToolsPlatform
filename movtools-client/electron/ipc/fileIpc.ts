import { ipcMain } from 'electron';
import { readFileAsBase64 } from '../services/file/fileService';
import { access, stat } from 'node:fs/promises';

export function registerFileIpc(): void {
  ipcMain.handle('file:exists', async (_event, request: { path: string }) => {
    const targetPath = request.path.trim();
    if (!targetPath) {
      return { success: false, exists: false, error: '路径不能为空。' };
    }

    try {
      await access(targetPath);
      return { success: true, exists: true, permissionDenied: false };
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        return { success: true, exists: true, permissionDenied: true };
      }

      try {
        await stat(targetPath);
        return { success: true, exists: true, permissionDenied: false };
      } catch (statError: unknown) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode === 'EACCES' || statCode === 'EPERM') {
          return { success: true, exists: true, permissionDenied: true };
        }
        return { success: true, exists: false, permissionDenied: false };
      }
    }
  });

  ipcMain.handle('file:readBase64', async (_event, request: { path: string }) => {
    const targetPath = request.path.trim();
    if (!targetPath) {
      return { success: false, error: '路径不能为空。' };
    }

    try {
      const data = await readFileAsBase64(targetPath);
      return { success: true, ...data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取文件失败。' };
    }
  });

  ipcMain.handle('file:existsAndRead', async (_event, request: { path: string }) => {
    const targetPath = request.path.trim();
    if (!targetPath) {
      return { success: false, exists: false, error: '路径不能为空。' };
    }

    try {
      await access(targetPath);
      const data = await readFileAsBase64(targetPath);
      return { success: true, exists: true, ...data };
    } catch (error) {
      return { success: true, exists: false, error: error instanceof Error ? error.message : '读取文件失败。' };
    }
  });
}
