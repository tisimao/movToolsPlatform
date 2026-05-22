import { ipcMain } from 'electron';
import {
  applyProjectInitializationRequestSchema,
  createEpisodeRequestSchema,
  createProjectRequestSchema,
  deleteProjectRequestSchema,
  openProjectRequestSchema,
  prepareProjectInitializationRequestSchema,
  setActiveEpisodeRequestSchema,
  setActiveProjectRequestSchema,
} from '../../src/types/ipc';
import { projectService } from '../services/project/projectService';

export function registerProjectIpc(): void {
  ipcMain.handle('project:list', async () => projectService.listWorkspace());

  ipcMain.handle('project:create', async (_event, request: unknown) => {
    const parsed = createProjectRequestSchema.parse(request);
    return projectService.createProject(parsed);
  });

  ipcMain.handle('project:prepareInitialization', async (_event, request: unknown) => {
    const parsed = prepareProjectInitializationRequestSchema.parse(request);
    return projectService.prepareInitialization(parsed);
  });

  ipcMain.handle('project:applyInitialization', async (_event, request: unknown) => {
    try {
      const parsed = applyProjectInitializationRequestSchema.parse(request);
      return await projectService.applyInitialization(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : '项目初始化失败。';
      console.error('[project:applyInitialization] failed:', error);
      return {
        success: false,
        initResult: {
          status: 'failed',
          message,
          excelImportAttempted: false,
          excelImportSuccess: false,
          createdLensCount: 0,
          lensFoldersPlanned: 0,
          lensFoldersCreated: 0,
          pendingClientActions: [],
          errors: [message],
        },
        error: message,
      };
    }
  });

  ipcMain.handle('project:open', async (_event, request: unknown) => {
    const parsed = openProjectRequestSchema.parse(request);
    return projectService.openProject(parsed);
  });

  ipcMain.handle('project:listEpisodes', async (_event, projectId?: string) => projectService.listEpisodes(projectId));

  ipcMain.handle('project:createEpisode', async (_event, request: unknown) => {
    const parsed = createEpisodeRequestSchema.parse(request);
    return projectService.createEpisode(parsed);
  });

  ipcMain.handle('project:setActive', async (_event, request: unknown) => {
    const parsed = setActiveProjectRequestSchema.parse(request);
    return projectService.setActiveProject(parsed.projectId);
  });

  ipcMain.handle('project:setActiveEpisode', async (_event, request: unknown) => {
    const parsed = setActiveEpisodeRequestSchema.parse(request);
    return projectService.setActiveEpisode(parsed.episodeId);
  });

  ipcMain.handle('project:delete', async (_event, request: unknown) => {
    const parsed = deleteProjectRequestSchema.parse(request);
    return projectService.deleteProject(parsed);
  });
}
