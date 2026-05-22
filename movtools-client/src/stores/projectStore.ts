/**
 * 项目状态管理
 * 
 * 使用 Zustand 管理全局项目状态，包括项目列表和当前激活的项目/集。
 */
import { create } from 'zustand';
import type { ProjectMemberSummary, ProjectSummary, ProjectWorkspace } from '../types/project';

/** 项目状态接口 */
interface ProjectState {
  projects: ProjectSummary[];       // 所有项目列表
  activeProjectId: string | null;  // 当前激活的项目 ID
  activeEpisodeId: string | null;   // 当前激活的集 ID
  currentProjectMembers: ProjectMemberSummary[];
  /** 更新整个工作空间状态 */
  setWorkspace: (workspace: ProjectWorkspace) => void;
  setCurrentProjectMembers: (members: ProjectMemberSummary[]) => void;
  /** 重置整个工作空间状态 */
  resetWorkspace: () => void;
}

/** 项目状态存储 */
export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  activeEpisodeId: null,
  currentProjectMembers: [],
  setWorkspace: (workspace) => set({
    projects: workspace.projects,
    activeProjectId: workspace.activeProjectId,
    activeEpisodeId: workspace.activeEpisodeId,
  }),
  setCurrentProjectMembers: (members) => set({ currentProjectMembers: members }),
  resetWorkspace: () => set({
    projects: [],
    activeProjectId: null,
    activeEpisodeId: null,
    currentProjectMembers: [],
  }),
}));
