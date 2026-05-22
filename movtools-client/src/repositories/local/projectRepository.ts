/**
 * 本地项目仓储实现
 * 
 * 通过 window.movtools API（preload 暴露）调用主进程服务。
 */
import type { IProjectRepository } from '../types';
import type { EpisodeSummary, ProjectSummary, ProjectWorkspace } from '../../types/project';
import type { ApplyProjectInitializationRequest, ApplyProjectInitializationResponse, ProjectInitializationResult } from '../../types/ipc';

class LocalProjectRepository implements IProjectRepository {
  async getWorkspace(): Promise<ProjectWorkspace> {
    return window.movtools.project.list();
  }

  async getProject(projectId: string): Promise<ProjectSummary | null> {
    const workspace = await this.getWorkspace();
    return workspace.projects.find((p) => p.projectId === projectId) ?? null;
  }

  async listEpisodes(projectId: string): Promise<{ success: boolean; episodes: EpisodeSummary[]; activeProjectId: string | null; activeEpisodeId: string | null; error?: string }> {
    return window.movtools.project.listEpisodes(projectId);
  }

  async createProject(request: {
    projectName: string;
    projectRootPath: string;
    initialEpisodeCode?: string;
    initialEpisodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
    members?: Array<{
      userId: string;
      projectRoleCode: string;
    }>;
    memberUserIds?: string[];
  }): Promise<{ success: boolean; project?: ProjectSummary; initialEpisode?: EpisodeSummary | null; workspace?: ProjectWorkspace; initResult?: ProjectInitializationResult; message?: string; error?: string }> {
    return window.movtools.project.create(request as Parameters<typeof window.movtools.project.create>[0]);
  }

  async applyInitialization(request: ApplyProjectInitializationRequest): Promise<ApplyProjectInitializationResponse> {
    return window.movtools.project.applyInitialization(request as Parameters<typeof window.movtools.project.applyInitialization>[0]);
  }

  async openProject(projectRootPath: string): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }> {
    return window.movtools.project.open({ projectRootPath });
  }

  async setActiveProject(projectId: string, _options?: {
    projectRootPath?: string;
    lensFolderRootPath?: string;
    layoutCheckPath?: string;
  }): Promise<{ success: boolean; project?: ProjectSummary; workspace?: ProjectWorkspace; error?: string }> {
    return window.movtools.project.setActive({ projectId });
  }

  async createEpisode(request: {
    projectId: string;
    episodeCode: string;
    episodeName?: string;
    initExcelPath?: string;
    lensRoots?: unknown[];
    layoutRoots?: unknown[];
  }): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; episodes?: EpisodeSummary[]; error?: string }> {
    return window.movtools.project.createEpisode(request as Parameters<typeof window.movtools.project.createEpisode>[0]);
  }

  async setActiveEpisode(episodeId: string): Promise<{ success: boolean; episode?: EpisodeSummary; workspace?: ProjectWorkspace; error?: string }> {
    return window.movtools.project.setActiveEpisode({ episodeId });
  }

  async deleteProject(projectId: string, removeFiles?: boolean): Promise<{ success: boolean; workspace?: ProjectWorkspace; error?: string }> {
    return window.movtools.project.delete({ projectId, removeFiles });
  }
}

export const localProjectRepository = new LocalProjectRepository();
