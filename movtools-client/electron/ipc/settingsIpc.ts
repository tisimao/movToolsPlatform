import { ipcMain } from 'electron';
import { updateSettingsSchema } from '../../src/types/ipc';
import { settingsService } from '../services/settings/settingsService';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => settingsService.getSettings());
  ipcMain.handle('settings:status', async () => settingsService.getEnvironmentStatus());

  ipcMain.handle('settings:validate', async (_event, request: unknown) => {
    const parsed = updateSettingsSchema.parse(request);
    return settingsService.validateSettings(parsed);
  });

  ipcMain.handle('settings:update', async (_event, request: unknown) => {
    const parsed = updateSettingsSchema.parse(request);
    return settingsService.updateSettings(parsed);
  });

  ipcMain.handle('settings:clearPreviewCache', async () => settingsService.clearPreviewCache());
}
