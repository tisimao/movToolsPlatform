import { app, ipcMain } from 'electron';
import type { AppInfo } from '../../src/types/ipc';

export function registerAppIpc(): void {
  ipcMain.handle('app:getInfo', async () => ({
    name: app.getName(),
    version: app.getVersion(),
  } satisfies AppInfo));
}
