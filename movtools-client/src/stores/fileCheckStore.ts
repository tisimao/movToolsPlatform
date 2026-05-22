import { create } from 'zustand';
import type { FileCheckConfig, FileCheckRecord, FileCheckSummary, LayoutReferenceCheckRecord, LayoutReferenceSummary, LensBoundFile, LensLayoutCandidate, LensLayoutVideoBinding } from '../types/fileCheck';

/**
 * 文件检查状态接口
 */
interface FileCheckState {
  /** 当前激活的项目ID */
  activeProjectId: string | null;
  /** 当前激活的项目名称 */
  activeProjectName: string;
  /** 当前激活的剧集ID */
  activeEpisodeId: string | null;
  /** 当前激活的剧集代码 */
  activeEpisodeCode: string;
  /** 当前激活的剧集名称 */
  activeEpisodeName: string;
  /** 绑定的文件映射（镜头ID -> 绑定文件列表） */
  bindings: Record<string, LensBoundFile[]>;
  /** Layout 候选映射（镜头编号 -> 候选列表） */
  layoutCandidates: Record<string, LensLayoutCandidate[]>;
  /** Layout 视频绑定映射（镜头编号 -> 绑定视频列表） */
  layoutVideoBindings: Record<string, LensLayoutVideoBinding[]>;
  /** 文件检查配置 */
  config: FileCheckConfig;
  /** 文件检查记录列表 */
  records: FileCheckRecord[];
  /** 文件检查汇总信息 */
  summary: FileCheckSummary;
  /** Layout 引用检查记录列表 */
  layoutReferenceChecks: LayoutReferenceCheckRecord[];
  /** Layout 引用检查汇总信息 */
  layoutReferenceSummary: LayoutReferenceSummary;
  /** 设置状态载荷的更新函数 */
  setStatePayload: (payload: {
    /** 当前激活的项目ID */
    activeProjectId: string | null;
    /** 当前激活的项目名称（可选） */
    activeProjectName?: string;
    /** 当前激活的剧集ID（可选） */
    activeEpisodeId?: string | null;
    /** 当前激活的剧集代码（可选） */
    activeEpisodeCode?: string;
    /** 当前激活的剧集名称（可选） */
    activeEpisodeName?: string;
    /** 绑定的文件映射 */
    bindings: Record<string, LensBoundFile[]>;
    /** Layout 候选映射 */
    layoutCandidates: Record<string, LensLayoutCandidate[]>;
    /** Layout 视频绑定映射 */
    layoutVideoBindings: Record<string, LensLayoutVideoBinding[]>;
    /** 文件检查配置 */
    config: FileCheckConfig;
    /** 文件检查记录列表 */
    records: FileCheckRecord[];
    /** 文件检查汇总信息 */
    summary: FileCheckSummary;
    /** Layout 引用检查记录列表 */
    layoutReferenceChecks: LayoutReferenceCheckRecord[];
    /** Layout 引用检查汇总信息 */
    layoutReferenceSummary: LayoutReferenceSummary;
  }) => void;
}

/**
 * 文件检查状态存储
 * 使用 Zustand 管理文件检查的状态和数据
 */
export const useFileCheckStore = create<FileCheckState>((set) => ({
  /** 初始状态：没有激活的项目 */
  activeProjectId: null,
  /** 初始项目名称为空字符串 */
  activeProjectName: '',
  /** 初始状态：没有激活的剧集 */
  activeEpisodeId: null,
  /** 初始剧集代码为空字符串 */
  activeEpisodeCode: '',
  /** 初始剧集名称为空字符串 */
  activeEpisodeName: '',
  /** 初始绑定映射为空对象 */
  bindings: {},
  /** 初始 Layout 候选映射为空对象 */
  layoutCandidates: {},
  /** 初始 Layout 视频绑定映射为空对象 */
  layoutVideoBindings: {},
  /** 初始文件检查配置：默认 Layout 标签为 LAY，空的根目录数组 */
  config: { versionTag: 'ANI', layoutTag: 'LAY', lensFolderRootPath: '', layoutCheckPath: '', lensRoots: [], layoutRoots: [] },
  /** 初始记录列表为空数组 */
  records: [],
  /** 初始汇总信息：所有计数为 0 */
  summary: { totalLensCount: 0, missingMaCount: 0, missingMovCount: 0, missingLayoutCount: 0, allMissingCount: 0 },
  /** 初始 Layout 引用检查记录列表为空数组 */
  layoutReferenceChecks: [],
  /** 初始 Layout 引用检查汇总信息：所有计数为 0 */
  layoutReferenceSummary: { selectedLayoutLensCount: 0, checkedLensCount: 0, issueLensCount: 0, totalIssueCount: 0 },
  /** 设置状态载荷的更新函数 */
  setStatePayload: (payload) => set({
    activeProjectId: payload.activeProjectId,
    activeProjectName: payload.activeProjectName ?? '',
    activeEpisodeId: payload.activeEpisodeId ?? null,
    activeEpisodeCode: payload.activeEpisodeCode ?? '',
    activeEpisodeName: payload.activeEpisodeName ?? '',
    bindings: payload.bindings,
    layoutCandidates: payload.layoutCandidates,
    layoutVideoBindings: payload.layoutVideoBindings,
    config: payload.config,
    records: payload.records,
    summary: payload.summary,
    layoutReferenceChecks: payload.layoutReferenceChecks,
    layoutReferenceSummary: payload.layoutReferenceSummary,
  }),
}));
