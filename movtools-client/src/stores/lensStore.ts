/**
 * 镜头状态管理
 * 
 * 使用 Zustand 管理镜头列表状态和当前上下文信息。
 */
import { create } from 'zustand';
import type { LensRecord } from '../types/lens';

/** 镜头状态接口 */
interface LensState {
  lenses: LensRecord[];           // 当前集的镜头列表
  activeProjectId: string | null;  // 所属项目 ID
  activeProjectName: string;       // 所属项目名称
  activeEpisodeId: string | null;  // 所属集 ID
  activeEpisodeName: string;       // 所属集名称
  activeEpisodeCode: string;       // 所属集编号
  episodeVersionTag: string;
  episodeLayoutTag: string;
  /** 更新镜头列表和上下文 */
  setLensList: (payload: { lenses: LensRecord[]; activeProjectId: string | null; activeProjectName?: string; activeEpisodeId?: string | null; activeEpisodeName?: string; activeEpisodeCode?: string; episodeVersionTag?: string; episodeLayoutTag?: string }) => void;
  /** 重置镜头列表和上下文 */
  resetLensList: () => void;
}

/** 镜头状态存储 */
export const useLensStore = create<LensState>((set) => ({
  lenses: [],
  activeProjectId: null,
  activeProjectName: '',
  activeEpisodeId: null,
  activeEpisodeName: '',
  activeEpisodeCode: '',
  episodeVersionTag: 'ANI',
  episodeLayoutTag: 'LAY',
  setLensList: (payload) => set({
    lenses: payload.lenses,
    activeProjectId: payload.activeProjectId,
    activeProjectName: payload.activeProjectName ?? '',
    activeEpisodeId: payload.activeEpisodeId ?? null,
    activeEpisodeName: payload.activeEpisodeName ?? '',
    activeEpisodeCode: payload.activeEpisodeCode ?? '',
    episodeVersionTag: payload.episodeVersionTag ?? 'ANI',
    episodeLayoutTag: payload.episodeLayoutTag ?? 'LAY',
  }),
  resetLensList: () => set({
    lenses: [],
    activeProjectId: null,
    activeProjectName: '',
    activeEpisodeId: null,
    activeEpisodeName: '',
    activeEpisodeCode: '',
    episodeVersionTag: 'ANI',
    episodeLayoutTag: 'LAY',
  }),
}));
